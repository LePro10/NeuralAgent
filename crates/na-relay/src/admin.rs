//! Admin API (`/api/admin`): an admin account (from `ADMIN_EMAILS`) plus a passkey check.
//! Requests, users, devices, sessions and anonymous statistics.

use std::sync::Arc;

use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::HeaderMap;
use axum::http::header::SET_COOKIE;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::db::Status;
use crate::util::{ApiError, ApiResult, hash, token};
use crate::{Authed, Relay, webauthn};

const COOKIE: &str = "na_admin";
const SESSION_TTL: i64 = 12 * 3600;

pub fn router() -> Router<Arc<Relay>> {
    Router::new()
        .route("/session", get(session))
        .route("/passkey/register/start", post(register_start))
        .route("/passkey/register/finish", post(register_finish))
        .route("/passkey/login/start", post(login_start))
        .route("/passkey/login/finish", post(login_finish))
        .route("/users", get(users))
        .route("/users/{id}", delete(delete_user))
        .route("/users/{id}/devices", get(user_devices))
        .route("/users/{id}/{action}", post(user_action))
        .route("/devices/{id}", delete(delete_device))
        .route("/stats", get(stats))
}

/// Signed in with an admin account (passkey not yet checked).
pub struct AdminUser(Authed);

impl FromRequestParts<Arc<Relay>> for AdminUser {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, r: &Arc<Relay>) -> Result<Self, ApiError> {
        let a = Authed::from_request_parts(parts, r).await?;
        if !a.user.is_admin {
            return Err(ApiError::forbidden("admins only"));
        }
        Ok(AdminUser(a))
    }
}

fn cookie(headers: &HeaderMap) -> Option<String> {
    headers.get_all("cookie").iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|c| {
        let (k, v) = c.trim().split_once('=')?;
        (k == COOKIE).then(|| v.to_string())
    })
}

fn verified(r: &Relay, headers: &HeaderMap, user_id: &str) -> bool {
    cookie(headers).and_then(|c| r.admin_sessions.get(&hash(&c))).is_some_and(|u| u == user_id)
}

/// Admin account plus a passkey check in this browser.
pub struct Admin(Authed);

impl FromRequestParts<Arc<Relay>> for Admin {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, r: &Arc<Relay>) -> Result<Self, ApiError> {
        let AdminUser(a) = AdminUser::from_request_parts(parts, r).await?;
        if !verified(r, &parts.headers, &a.user.id) {
            return Err(ApiError::forbidden("passkey required"));
        }
        Ok(Admin(a))
    }
}

fn start_session(r: &Relay, user_id: &str) -> Response {
    let t = token();
    r.admin_sessions.insert(hash(&t), user_id.to_string(), SESSION_TTL);
    let secure = if r.cfg.public_url.starts_with("https://") { "; Secure" } else { "" };
    let c = format!("{COOKIE}={t}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}{secure}");
    ([(SET_COOKIE, c)], Json(json!({ "ok": true }))).into_response()
}

async fn session(State(r): State<Arc<Relay>>, AdminUser(a): AdminUser, headers: HeaderMap) -> ApiResult<Json<Value>> {
    Ok(Json(json!({
        "user": a.user,
        "passkeys": r.db.passkeys(&a.user.id)?.len(),
        "verified": verified(&r, &headers, &a.user.id),
    })))
}

/// WebAuthn options; the page turns the base64url fields into ArrayBuffers.
async fn register_start(State(r): State<Arc<Relay>>, AdminUser(a): AdminUser, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let keys = r.db.passkeys(&a.user.id)?;
    // The first passkey needs only the admin sign-in; more need an existing passkey.
    if !keys.is_empty() && !verified(&r, &headers, &a.user.id) {
        return Err(ApiError::forbidden("passkey required"));
    }
    Ok(Json(json!({
        "challenge": webauthn::challenge(&r, &a.user.id, true),
        "rp": { "id": r.cfg.rp_id(), "name": "NeuralAgent Admin" },
        "user": { "id": crate::util::b64u(a.user.id.as_bytes()), "name": a.user.email, "displayName": a.user.name },
        "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
        "authenticatorSelection": { "residentKey": "preferred", "userVerification": "required" },
        "excludeCredentials": keys.iter().map(|k| json!({ "type": "public-key", "id": k.0 })).collect::<Vec<_>>(),
        "timeout": 120000,
        "attestation": "none",
    })))
}

#[derive(Deserialize)]
struct RegisterFinish {
    id: String,
    client_data: String,
    attestation: String,
}

async fn register_finish(
    State(r): State<Arc<Relay>>,
    AdminUser(a): AdminUser,
    headers: HeaderMap,
    Json(b): Json<RegisterFinish>,
) -> ApiResult<Response> {
    if !r.db.passkeys(&a.user.id)?.is_empty() && !verified(&r, &headers, &a.user.id) {
        return Err(ApiError::forbidden("passkey required"));
    }
    webauthn::register(&r, &a.user.id, &b.id, &b.client_data, &b.attestation)
        .map_err(|e| ApiError::bad(format!("passkey not accepted: {e}")))?;
    tracing::info!("admin passkey registered");
    Ok(start_session(&r, &a.user.id))
}

async fn login_start(State(r): State<Arc<Relay>>, AdminUser(a): AdminUser) -> ApiResult<Json<Value>> {
    let keys = r.db.passkeys(&a.user.id)?;
    if keys.is_empty() {
        return Err(ApiError::bad("no passkey yet: create one first"));
    }
    Ok(Json(json!({
        "challenge": webauthn::challenge(&r, &a.user.id, false),
        "rpId": r.cfg.rp_id(),
        "allowCredentials": keys.iter().map(|k| json!({ "type": "public-key", "id": k.0 })).collect::<Vec<_>>(),
        "userVerification": "required",
        "timeout": 120000,
    })))
}

#[derive(Deserialize)]
struct LoginFinish {
    id: String,
    client_data: String,
    authenticator_data: String,
    signature: String,
}

async fn login_finish(State(r): State<Arc<Relay>>, AdminUser(a): AdminUser, Json(b): Json<LoginFinish>) -> ApiResult<Response> {
    webauthn::verify(&r, &a.user.id, &b.id, &b.client_data, &b.authenticator_data, &b.signature).map_err(|e| {
        tracing::warn!("admin passkey check failed: {e:#}");
        ApiError::forbidden("passkey check failed")
    })?;
    Ok(start_session(&r, &a.user.id))
}

async fn users(State(r): State<Arc<Relay>>, _: Admin) -> ApiResult<Json<Value>> {
    let online = r.hub.online_by_user();
    let list: Vec<Value> =
        r.db.users()?
            .into_iter()
            .map(|u| {
                let devices = r.db.devices(&u.id).unwrap_or_default();
                let mut v = serde_json::to_value(&u).unwrap_or_default();
                v["devices"] = devices.len().into();
                v["online"] = online.get(&u.id).copied().unwrap_or(0).into();
                v["bytes"] = devices.iter().map(|d| d.bytes).sum::<i64>().into();
                v["last_seen"] = devices.iter().map(|d| d.last_seen).max().into();
                v
            })
            .collect();
    Ok(Json(json!({ "users": list })))
}

async fn user_action(State(r): State<Arc<Relay>>, Admin(a): Admin, Path((id, action)): Path<(String, String)>) -> ApiResult<Json<Value>> {
    let before = r.db.user(&id)?.ok_or_else(ApiError::not_found)?;
    if before.id == a.user.id && matches!(action.as_str(), "deny" | "block" | "remote_off") {
        return Err(ApiError::bad("you cannot lock yourself out"));
    }
    let user = match action.as_str() {
        "approve" | "unblock" => r.db.set_status(&id, Status::Approved)?,
        "deny" => r.db.set_status(&id, Status::Denied)?,
        "block" => r.db.set_status(&id, Status::Blocked)?,
        "remote_on" => r.db.set_remote(&id, true)?,
        "remote_off" => r.db.set_remote(&id, false)?,
        _ => return Err(ApiError::not_found()),
    }
    .ok_or_else(ApiError::not_found)?;
    tracing::info!(action, "admin changed an account");
    r.account_changed(&user);
    // Mails only for a decision on an open request.
    if before.status == Status::Pending {
        let (r2, u) = (r.clone(), user.clone());
        match action.as_str() {
            "approve" => drop(tokio::spawn(async move { r2.mail.approved(&u).await })),
            "deny" => drop(tokio::spawn(async move { r2.mail.denied(&u).await })),
            _ => {}
        }
    }
    Ok(Json(json!({ "user": user })))
}

async fn delete_user(State(r): State<Arc<Relay>>, Admin(a): Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    if id == a.user.id {
        return Err(ApiError::bad("you cannot delete yourself"));
    }
    r.db.user(&id)?.ok_or_else(ApiError::not_found)?;
    r.access.remove_where(|x| x.user_id == id);
    r.hub.kick_user(&id, "account deleted");
    r.db.delete_user(&id)?;
    tracing::info!("admin deleted an account");
    Ok(Json(json!({ "ok": true })))
}

async fn user_devices(State(r): State<Arc<Relay>>, _: Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "devices": r.hub.device_list(&r, &id) })))
}

async fn delete_device(State(r): State<Arc<Relay>>, _: Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let d = r.db.device(&id)?.ok_or_else(ApiError::not_found)?;
    r.sign_out_device(&id, "signed out by the admin");
    r.hub.presence(&r, &d.user_id);
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct StatsQuery {
    days: Option<u32>,
}

async fn stats(State(r): State<Arc<Relay>>, _: Admin, Query(q): Query<StatsQuery>) -> ApiResult<Json<Value>> {
    let mut s = r.db.stats(q.days.unwrap_or(30).clamp(1, 365))?;
    s["online"] = r.hub.connections().into();
    Ok(Json(s))
}
