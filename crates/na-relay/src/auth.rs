//! Sign-in (Google OIDC / GitHub OAuth, both with state + PKCE), one-time code exchange, rotating
//! refresh tokens, devices and "Add phone" pairing codes.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::db::{Device, Identity, Refresh, Status, User};
use crate::util::{ApiError, ApiResult, b64u, ct_eq, hash, now, s256, token, unb64u};
use crate::{ACCESS_TTL, Access, Authed, Code, Flow, Ip, PAIR_TTL, Pair, Relay, bearer};

const PLATFORMS: &[&str] = &["macos", "windows", "linux", "android", "ios", "web"];

pub async fn config(State(r): State<Arc<Relay>>) -> Json<Value> {
    Json(json!({ "providers": r.cfg.providers(), "pair_ttl": PAIR_TTL, "vapid": r.push.vapid_public(), "fcm": r.push.fcm_ready() }))
}

/// Where a sign-in may return to: the app's deep link, a loopback port of the desktop app
/// (RFC 8252), or our own web pages.
fn redirect_allowed(r: &Relay, uri: &str) -> bool {
    if uri == "neuralagent://auth" {
        return true;
    }
    let Ok(u) = url::Url::parse(uri) else { return false };
    if u.scheme() == "http"
        && matches!(u.host_str(), Some("127.0.0.1") | Some("[::1]"))
        && u.path() == "/auth/callback"
        && u.query().is_none()
    {
        return true;
    }
    [format!("{}/app/", r.cfg.public_url), format!("{}/admin/", r.cfg.public_url)].iter().any(|p| uri == p)
}

fn back(uri: &str, params: &[(&str, &str)]) -> Response {
    match url::Url::parse(uri) {
        Ok(mut u) => {
            u.query_pairs_mut().extend_pairs(params);
            Redirect::to(u.as_str()).into_response()
        }
        Err(_) => ApiError::bad("bad redirect").into_response(),
    }
}

#[derive(Deserialize)]
pub struct StartQuery {
    redirect_uri: String,
    state: String,
    code_challenge: String,
    code_challenge_method: Option<String>,
    /// Test sign-in only.
    email: Option<String>,
    name: Option<String>,
}

pub async fn start(
    State(r): State<Arc<Relay>>,
    Ip(ip): Ip,
    Path(provider): Path<String>,
    Query(q): Query<StartQuery>,
) -> ApiResult<Response> {
    r.limit(ip)?;
    if !redirect_allowed(&r, &q.redirect_uri) {
        return Err(ApiError::bad("redirect_uri not allowed"));
    }
    if q.code_challenge.len() != 43
        || q.code_challenge_method.as_deref().unwrap_or("S256") != "S256"
        || q.state.is_empty()
        || q.state.len() > 200
    {
        return Err(ApiError::bad("PKCE S256 challenge and state are required"));
    }
    let callback = format!("{}/auth/{provider}/callback", r.cfg.public_url);
    let verifier = token();
    let flow = Flow {
        provider: provider.clone(),
        redirect_uri: q.redirect_uri.clone(),
        client_state: q.state.clone(),
        client_challenge: q.code_challenge.clone(),
        verifier: verifier.clone(),
        nonce: token(),
    };
    let state = token();
    let url = match provider.as_str() {
        "github" => {
            let p = r.cfg.github.as_ref().ok_or_else(|| ApiError::bad("GitHub sign-in is not set up"))?;
            url::Url::parse_with_params(
                "https://github.com/login/oauth/authorize",
                &[
                    ("client_id", p.client_id.as_str()),
                    ("redirect_uri", &callback),
                    ("scope", "user:email"),
                    ("state", &state),
                    ("code_challenge", &s256(&verifier)),
                    ("code_challenge_method", "S256"),
                ],
            )
        }
        "google" => {
            let p = r.cfg.google.as_ref().ok_or_else(|| ApiError::bad("Google sign-in is not set up"))?;
            url::Url::parse_with_params(
                "https://accounts.google.com/o/oauth2/v2/auth",
                &[
                    ("client_id", p.client_id.as_str()),
                    ("redirect_uri", &callback),
                    ("response_type", "code"),
                    ("scope", "openid email profile"),
                    ("state", &state),
                    ("nonce", &flow.nonce),
                    ("code_challenge", &s256(&verifier)),
                    ("code_challenge_method", "S256"),
                    ("prompt", "select_account"),
                ],
            )
        }
        "test" if r.cfg.test_login => {
            let email = q.email.as_deref().ok_or_else(|| ApiError::bad("email required"))?;
            let id = Identity { provider: "test", subject: email, email, name: q.name.as_deref().unwrap_or(email), avatar: None };
            return Ok(signed_in(&r, &flow, &id));
        }
        _ => return Err(ApiError::not_found()),
    }
    .map_err(|e| ApiError::bad(e.to_string()))?;
    r.flows.insert(state, flow, 600);
    Ok(Redirect::to(url.as_str()).into_response())
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

pub async fn callback(
    State(r): State<Arc<Relay>>,
    Ip(ip): Ip,
    Path(provider): Path<String>,
    Query(q): Query<CallbackQuery>,
) -> ApiResult<Response> {
    r.limit(ip)?;
    let flow = q.state.as_ref().and_then(|s| r.flows.take(s)).filter(|f| f.provider == provider);
    let Some(flow) = flow else {
        return Err(ApiError::bad("This sign-in link expired. Please start again in the app."));
    };
    let fail = |msg: &str| back(&flow.redirect_uri, &[("error", msg), ("state", &flow.client_state)]);
    if q.error.is_some() {
        return Ok(fail("cancelled"));
    }
    let Some(code) = q.code else { return Ok(fail("no code")) };
    let id = match provider.as_str() {
        "github" => github_identity(&r, &code, &flow).await,
        "google" => google_identity(&r, &code, &flow).await,
        _ => Err(anyhow::anyhow!("unknown provider")),
    };
    match id {
        Ok(p) => Ok(signed_in(
            &r,
            &flow,
            &Identity { provider: &provider, subject: &p.subject, email: &p.email, name: &p.name, avatar: p.avatar.as_deref() },
        )),
        Err(e) => {
            tracing::warn!(provider, "sign-in failed: {e:#}");
            Ok(fail("sign-in failed"))
        }
    }
}

/// Account found or created: hand a one-time code back to the app.
fn signed_in(r: &Relay, flow: &Flow, id: &Identity) -> Response {
    match r.db.login(id, &r.cfg.admins) {
        Ok((user, _)) if user.status == Status::Blocked => {
            back(&flow.redirect_uri, &[("error", "account blocked"), ("state", &flow.client_state)])
        }
        Ok((user, _)) => {
            let code = token();
            r.codes.insert(
                code.clone(),
                Code { user_id: user.id, challenge: flow.client_challenge.clone(), redirect_uri: flow.redirect_uri.clone() },
                120,
            );
            back(&flow.redirect_uri, &[("code", &code), ("state", &flow.client_state)])
        }
        Err(e) => {
            tracing::error!("login failed: {e:#}");
            back(&flow.redirect_uri, &[("error", "server error"), ("state", &flow.client_state)])
        }
    }
}

struct ProviderUser {
    subject: String,
    email: String,
    name: String,
    avatar: Option<String>,
}

async fn github_identity(r: &Relay, code: &str, flow: &Flow) -> anyhow::Result<ProviderUser> {
    let p = r.cfg.github.as_ref().ok_or_else(|| anyhow::anyhow!("not set up"))?;
    let callback = format!("{}/auth/github/callback", r.cfg.public_url);
    let tok: Value = r
        .http
        .post("https://github.com/login/oauth/access_token")
        .header("accept", "application/json")
        .form(&[
            ("client_id", p.client_id.as_str()),
            ("client_secret", &p.client_secret),
            ("code", code),
            ("redirect_uri", &callback),
            ("code_verifier", &flow.verifier),
        ])
        .send()
        .await?
        .json()
        .await?;
    let at = tok["access_token"].as_str().ok_or_else(|| anyhow::anyhow!("no token: {}", tok["error"]))?;
    let get = |url: &'static str| r.http.get(url).bearer_auth(at).header("accept", "application/vnd.github+json").send();
    let user: Value = get("https://api.github.com/user").await?.error_for_status()?.json().await?;
    let emails: Vec<Value> = get("https://api.github.com/user/emails").await?.error_for_status()?.json().await?;
    let email = emails
        .iter()
        .find(|e| e["primary"].as_bool() == Some(true) && e["verified"].as_bool() == Some(true))
        .and_then(|e| e["email"].as_str())
        .ok_or_else(|| anyhow::anyhow!("no verified primary email"))?;
    let login = user["login"].as_str().unwrap_or("GitHub user");
    Ok(ProviderUser {
        subject: user["id"].as_u64().ok_or_else(|| anyhow::anyhow!("no id"))?.to_string(),
        email: email.to_string(),
        name: user["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(login).to_string(),
        avatar: user["avatar_url"].as_str().map(str::to_string),
    })
}

async fn google_identity(r: &Relay, code: &str, flow: &Flow) -> anyhow::Result<ProviderUser> {
    let p = r.cfg.google.as_ref().ok_or_else(|| anyhow::anyhow!("not set up"))?;
    let callback = format!("{}/auth/google/callback", r.cfg.public_url);
    let tok: Value = r
        .http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", p.client_id.as_str()),
            ("client_secret", &p.client_secret),
            ("code", code),
            ("redirect_uri", &callback),
            ("grant_type", "authorization_code"),
            ("code_verifier", &flow.verifier),
        ])
        .send()
        .await?
        .json()
        .await?;
    let id_token = tok["id_token"].as_str().ok_or_else(|| anyhow::anyhow!("no id_token: {}", tok["error"]))?;
    // Received directly from Google's token endpoint over TLS, so the claims are checked but the
    // signature is not (OpenID Connect Core 3.1.3.7).
    let claims: Value = id_token
        .split('.')
        .nth(1)
        .and_then(unb64u)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| anyhow::anyhow!("bad id_token"))?;
    google_claims(&claims, &p.client_id, &flow.nonce)
}

fn google_claims(c: &Value, client_id: &str, nonce: &str) -> anyhow::Result<ProviderUser> {
    let iss = c["iss"].as_str().unwrap_or_default();
    anyhow::ensure!(iss == "https://accounts.google.com" || iss == "accounts.google.com", "issuer");
    anyhow::ensure!(c["aud"].as_str() == Some(client_id), "audience");
    anyhow::ensure!(c["exp"].as_i64().unwrap_or(0) > now(), "expired");
    anyhow::ensure!(c["nonce"].as_str().is_some_and(|n| ct_eq(n.as_bytes(), nonce.as_bytes())), "nonce");
    anyhow::ensure!(c["email_verified"].as_bool() == Some(true), "email not verified");
    Ok(ProviderUser {
        subject: c["sub"].as_str().ok_or_else(|| anyhow::anyhow!("sub"))?.to_string(),
        email: c["email"].as_str().ok_or_else(|| anyhow::anyhow!("email"))?.to_string(),
        name: c["name"].as_str().unwrap_or("Google user").to_string(),
        avatar: c["picture"].as_str().map(str::to_string),
    })
}

#[derive(Deserialize)]
pub struct NewDevice {
    name: String,
    platform: String,
    kind: String,
    pubkey: Option<String>,
}

fn check_pubkey(k: &str) -> ApiResult<()> {
    match unb64u(k) {
        Some(b) if b.len() == 32 => Ok(()),
        _ => Err(ApiError::bad("pubkey must be 32 bytes, base64url")),
    }
}

impl NewDevice {
    fn check(&self) -> ApiResult<()> {
        let n = self.name.trim();
        if n.is_empty() || n.chars().count() > 64 {
            return Err(ApiError::bad("device name: 1–64 characters"));
        }
        if !PLATFORMS.contains(&self.platform.as_str()) || !["host", "client"].contains(&self.kind.as_str()) {
            return Err(ApiError::bad("unknown platform or kind"));
        }
        if let Some(k) = &self.pubkey {
            check_pubkey(k)?;
        }
        Ok(())
    }
}

#[derive(Serialize)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    pub expires_in: i64,
    pub device_id: String,
    pub user: User,
}

fn access_for(r: &Relay, user: &User, device: &Device) -> String {
    let access = token();
    r.access.insert(hash(&access), Access { user_id: user.id.clone(), device_id: device.id.clone() }, ACCESS_TTL);
    access
}

fn new_device(r: &Relay, user: User, d: &NewDevice) -> ApiResult<Tokens> {
    let refresh = token();
    let device =
        r.db.add_device(&user.id, d.name.trim(), &d.platform, &d.kind, d.pubkey.as_deref(), &hash(&refresh))
            .map_err(|e| ApiError::bad(e.to_string()))?;
    let _ = r.db.bump("signins", 1);
    // The account's other devices list the new one right away (e.g. the computer that showed the QR).
    r.hub.presence(r, &user.id);
    Ok(Tokens { access: access_for(r, &user, &device), refresh, expires_in: ACCESS_TTL, device_id: device.id, user })
}

#[derive(Deserialize)]
pub struct Exchange {
    code: String,
    verifier: String,
    redirect_uri: String,
    device: NewDevice,
    /// "Why do you want access?" (optional, only for a new request).
    message: Option<String>,
}

pub async fn exchange(State(r): State<Arc<Relay>>, Ip(ip): Ip, Json(x): Json<Exchange>) -> ApiResult<Json<Tokens>> {
    r.limit(ip)?;
    x.device.check()?;
    let code = r.codes.take(&x.code).ok_or_else(|| ApiError::bad("code expired, sign in again"))?;
    if !ct_eq(s256(&x.verifier).as_bytes(), code.challenge.as_bytes()) || x.redirect_uri != code.redirect_uri {
        return Err(ApiError::bad("code does not match this sign-in"));
    }
    let mut user = r.db.user(&code.user_id)?.ok_or_else(ApiError::unauthorized)?;
    if user.status == Status::Blocked {
        return Err(ApiError::forbidden("account blocked"));
    }
    if user.status == Status::Pending {
        if let Some(m) = x.message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
            r.db.set_message(&user.id, &m.chars().take(500).collect::<String>())?;
            user = r.db.user(&user.id)?.ok_or_else(ApiError::unauthorized)?;
        }
        if r.db.take_notify(&user.id)? {
            let _ = r.db.bump("requests", 1);
            let (r2, u) = (r.clone(), user.clone());
            tokio::spawn(async move { r2.mail.access_requested(&r2.cfg.admins, &u).await });
        }
    }
    Ok(Json(new_device(&r, user, &x.device)?))
}

#[derive(Deserialize)]
pub struct RefreshBody {
    refresh: String,
}

pub async fn refresh(State(r): State<Arc<Relay>>, Ip(ip): Ip, Json(b): Json<RefreshBody>) -> ApiResult<Json<Tokens>> {
    r.limit(ip)?;
    let device = match r.db.refresh(&hash(&b.refresh))? {
        Refresh::Ok(d) => d,
        Refresh::Reused(d) => {
            tracing::warn!(device = %d.id, "old refresh token reused, device signed out");
            r.sign_out_device(&d.id, "signed out: this sign-in was used elsewhere");
            return Err(ApiError::unauthorized());
        }
        Refresh::Unknown => return Err(ApiError::unauthorized()),
    };
    let user = r.db.user(&device.user_id)?.ok_or_else(ApiError::unauthorized)?;
    if user.status == Status::Blocked {
        return Err(ApiError::forbidden("account blocked"));
    }
    let refresh = token();
    r.db.rotate(&device.id, &hash(&refresh))?;
    Ok(Json(Tokens { access: access_for(&r, &user, &device), refresh, expires_in: ACCESS_TTL, device_id: device.id, user }))
}

pub async fn logout(State(r): State<Arc<Relay>>, a: Authed) -> ApiResult<Json<Value>> {
    r.sign_out_device(&a.device.id, "signed out");
    Ok(Json(json!({ "ok": true })))
}

pub async fn me(a: Authed) -> Json<Value> {
    Json(json!({ "user": a.user, "device": a.device }))
}

#[derive(Deserialize)]
pub struct DeviceUpdate {
    name: Option<String>,
    pubkey: Option<String>,
}

pub async fn update_device(State(r): State<Arc<Relay>>, a: Authed, Json(b): Json<DeviceUpdate>) -> ApiResult<Json<Value>> {
    if let Some(k) = &b.pubkey {
        check_pubkey(k)?;
    }
    let name = b.name.as_deref().map(str::trim).filter(|n| !n.is_empty() && n.chars().count() <= 64);
    r.db.update_device(&a.device.id, name, b.pubkey.as_deref())?;
    r.hub.presence(&r, &a.user.id);
    Ok(Json(json!({ "ok": true })))
}

/// Registers how this device is woken for agents that need attention (`null` stops it).
pub async fn set_push(State(r): State<Arc<Relay>>, a: Authed, Json(t): Json<Option<crate::push::Target>>) -> ApiResult<Json<Value>> {
    if let Some(t) = &t {
        t.check().map_err(|e| ApiError::bad(e.to_string()))?;
    }
    if a.device.kind != "client" {
        return Err(ApiError::bad("only phones and browsers get push"));
    }
    r.db.set_push(&a.device.id, t.as_ref())?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn devices(State(r): State<Arc<Relay>>, a: Authed) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "devices": r.hub.device_list(&r, &a.user.id), "this": a.device.id })))
}

pub async fn delete_device(State(r): State<Arc<Relay>>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    match r.db.device(&id)? {
        Some(d) if d.user_id == a.user.id => {
            r.sign_out_device(&id, "signed out from another device");
            r.hub.presence(&r, &a.user.id);
            Ok(Json(json!({ "ok": true })))
        }
        _ => Err(ApiError::not_found()),
    }
}

pub async fn sign_out_all(State(r): State<Arc<Relay>>, a: Authed) -> ApiResult<Json<Value>> {
    for id in r.db.revoke_all(&a.user.id)? {
        r.sign_out_device(&id, "signed out everywhere");
    }
    Ok(Json(json!({ "ok": true })))
}

/// "Add phone": a one-time code for the QR, valid two minutes, only for this account.
pub async fn pair_create(State(r): State<Arc<Relay>>, a: Authed) -> ApiResult<Json<Value>> {
    if !a.user.can_route() {
        return Err(ApiError::forbidden("remote access is not switched on for this account"));
    }
    if a.device.kind != "host" || a.device.pubkey.is_none() {
        return Err(ApiError::bad("only a desktop with a device key can add a phone"));
    }
    let code = token();
    r.pairs.insert(hash(&code), Pair { user_id: a.user.id.clone(), host_device: a.device.id.clone() }, PAIR_TTL);
    Ok(Json(json!({ "code": code, "expires_in": PAIR_TTL, "relay": r.cfg.public_url, "host": a.device.id })))
}

#[derive(Deserialize)]
pub struct Redeem {
    code: String,
    device: NewDevice,
}

pub async fn pair_redeem(State(r): State<Arc<Relay>>, Ip(ip): Ip, headers: HeaderMap, Json(b): Json<Redeem>) -> ApiResult<Json<Value>> {
    r.limit(ip)?;
    b.device.check()?;
    if b.device.kind != "client" {
        return Err(ApiError::bad("a pairing code adds a phone or browser"));
    }
    let pair = r.pairs.take(&hash(&b.code)).ok_or_else(|| ApiError::bad("This code expired or was already used. Show a new one."))?;
    // A device already signed in to another account cannot join this one.
    if let Some(t) = bearer(&headers)
        && let Ok(a) = r.authenticate(t)
        && a.user.id != pair.user_id
    {
        return Err(ApiError::forbidden("This code belongs to another account."));
    }
    let user = r.db.user(&pair.user_id)?.ok_or_else(ApiError::unauthorized)?;
    if !user.can_route() {
        return Err(ApiError::forbidden("remote access is not switched on for this account"));
    }
    let host = r.db.device(&pair.host_device)?.ok_or_else(|| ApiError::bad("that computer was signed out"))?;
    let _ = r.db.bump("pairings", 1);
    let tokens = new_device(&r, user, &b.device)?;
    Ok(Json(json!({ "tokens": tokens, "host": { "id": host.id, "name": host.name, "pubkey": host.pubkey } })))
}

/// Base64url of 32 random bytes; for tests that need a well-formed device key.
pub fn random_pubkey() -> String {
    b64u(&rand::random::<[u8; 32]>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_claims_are_checked() {
        let ok = json!({"iss":"https://accounts.google.com","aud":"cid","exp":now()+60,"nonce":"n1","email_verified":true,"sub":"1","email":"a@b.c","name":"A"});
        assert!(google_claims(&ok, "cid", "n1").is_ok());
        for (k, v) in [
            ("aud", json!("other")),
            ("nonce", json!("n2")),
            ("email_verified", json!(false)),
            ("exp", json!(now() - 1)),
            ("iss", json!("evil")),
        ] {
            let mut bad = ok.clone();
            bad[k] = v;
            assert!(google_claims(&bad, "cid", "n1").is_err(), "{k}");
        }
    }

    #[test]
    fn redirects_are_allowlisted() {
        let r = Relay::new(crate::config::Config::local("https://agent.example"), crate::db::Db::memory().unwrap());
        assert!(redirect_allowed(&r, "neuralagent://auth"));
        assert!(redirect_allowed(&r, "http://127.0.0.1:53111/auth/callback"));
        assert!(redirect_allowed(&r, "https://agent.example/app/"));
        assert!(!redirect_allowed(&r, "https://evil.example/app/"));
        assert!(!redirect_allowed(&r, "http://127.0.0.1.evil.example/auth/callback"));
        assert!(!redirect_allowed(&r, "http://192.168.1.2:80/auth/callback"));
        assert!(!redirect_allowed(&r, "neuralagent://auth/../x"));
    }
}
