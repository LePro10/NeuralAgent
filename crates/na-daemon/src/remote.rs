//! Remote access: sign-in with the relay, the connection to it, and phones/browsers of the same
//! account served exactly like local clients — the same protocol, sealed end to end
//! (`na-crypto`). The relay only sees opaque envelopes.
//!
//! Sign-in runs in the system browser and comes back to this daemon's loopback port
//! (`/auth/callback`, RFC 8252). Tokens and this computer's device key are kept in the OS
//! keychain (release builds on macOS/Windows) or a file readable only by the user.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Query, State as AxState};
use axum::response::Html;
use futures_util::{SinkExt, StreamExt};
use na_crypto::{StaticKey, b64, fingerprint, host_accept, unb64};
use na_protocol::*;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::{Notify, mpsc};
use tokio_tungstenite::tungstenite::Message;

use crate::core::{Core, err};

pub const DEFAULT_RELAY: &str = "https://agent.neuralhub.dev";
const KEYCHAIN_SERVICE: &str = "dev.neuralhub.neuralagent.remote";

/// What this computer needs to talk to the relay. Secret: never part of the shared state.
#[derive(Clone, Serialize, Deserialize)]
struct Creds {
    relay: String,
    device_id: String,
    refresh: String,
    /// X25519 device key (base64url).
    key: String,
}

struct SignIn {
    verifier: String,
    redirect: String,
    message: Option<String>,
    started: Instant,
}

#[derive(Default)]
pub struct Remote {
    creds: Mutex<Option<Creds>>,
    flows: Mutex<HashMap<String, SignIn>>,
    access: Mutex<Option<(String, Instant)>>,
    /// Rotating refresh tokens must never be used twice at once.
    refreshing: tokio::sync::Mutex<()>,
    /// Restarts the connection loop (signed in/out, switched on/off).
    wake: Notify,
    http: reqwest::Client,
    /// Public keys of the account's devices, from the relay (device id → key).
    keys: Mutex<HashMap<String, (String, String, String)>>,
}

fn relay_default() -> String {
    std::env::var("NEURALAGENT_RELAY")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_RELAY.into())
        .trim_end_matches('/')
        .to_string()
}

fn platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux",
    }
}

fn off_flag(core: &Core) -> std::path::PathBuf {
    core.paths.root.join("remote-off")
}

// ───────────── credential storage ─────────────

#[cfg(all(not(debug_assertions), any(target_os = "macos", target_os = "windows")))]
mod store {
    pub fn get(_: &std::path::Path) -> Option<String> {
        keyring::Entry::new(super::KEYCHAIN_SERVICE, "device").ok()?.get_password().ok()
    }
    pub fn set(_: &std::path::Path, v: Option<&str>) -> anyhow::Result<()> {
        let e = keyring::Entry::new(super::KEYCHAIN_SERVICE, "device")?;
        match v {
            Some(v) => e.set_password(v)?,
            None => {
                let _ = e.delete_credential();
            }
        }
        Ok(())
    }
}

#[cfg(not(all(not(debug_assertions), any(target_os = "macos", target_os = "windows"))))]
mod store {
    //! Development builds and Linux: a file only the user can read (keychain prompts would
    //! appear after every rebuild of an unsigned binary).
    fn path(root: &std::path::Path) -> std::path::PathBuf {
        root.join("remote-credentials.json")
    }
    pub fn get(root: &std::path::Path) -> Option<String> {
        let _ = super::KEYCHAIN_SERVICE;
        std::fs::read_to_string(path(root)).ok()
    }
    pub fn set(root: &std::path::Path, v: Option<&str>) -> anyhow::Result<()> {
        match v {
            Some(v) => crate::paths::write_private(&path(root), v.as_bytes()),
            None => {
                let _ = std::fs::remove_file(path(root));
                Ok(())
            }
        }
    }
}

fn save(core: &Core, creds: Option<Creds>) {
    let text = creds.as_ref().and_then(|c| serde_json::to_string(c).ok());
    if let Err(e) = store::set(&core.paths.root, text.as_deref()) {
        tracing::error!("saving remote credentials: {e:#}");
    }
    if creds.is_none() {
        *core.remote.access.lock() = None;
    }
    *core.remote.creds.lock() = creds;
    core.remote.wake.notify_one();
}

/// Loads saved credentials and starts the connection loop.
pub fn start(core: &Arc<Core>) {
    let creds: Option<Creds> = store::get(&core.paths.root).and_then(|s| serde_json::from_str(&s).ok());
    let fp = creds.as_ref().and_then(|c| device_key(c).ok()).map(|k| fingerprint(&k.public()));
    *core.remote.creds.lock() = creds.clone();
    update(core, |r| {
        r.relay = creds.as_ref().map(|c| c.relay.clone()).unwrap_or_else(relay_default);
        r.fingerprint = fp;
        r.status = if creds.is_some() { RemoteStatus::Connecting } else { RemoteStatus::SignedOut };
    });
    tokio::spawn(run(core.clone()));
}

fn device_key(c: &Creds) -> anyhow::Result<StaticKey> {
    let b: [u8; 32] = unb64(&c.key)?.try_into().map_err(|_| anyhow::anyhow!("bad key"))?;
    Ok(StaticKey::from_bytes(b))
}

fn update(core: &Core, f: impl FnOnce(&mut RemoteState)) {
    let mut r = core.read(|s| s.remote.clone());
    let before = r.clone();
    f(&mut r);
    if r != before {
        core.emit(Event::RemoteSet { remote: r });
    }
}

/// Status from the account as the relay reports it.
fn account_status(core: &Core, user: &Value) {
    let status = match (user["status"].as_str(), user["remote"].as_bool()) {
        (Some("approved"), Some(false)) => RemoteStatus::Off,
        (Some("approved"), _) => RemoteStatus::Online,
        (Some("denied"), _) => RemoteStatus::Denied,
        (Some("blocked"), _) => RemoteStatus::Blocked,
        _ => RemoteStatus::Pending,
    };
    update(core, |r| {
        r.status = status;
        r.error = (user["remote"].as_bool() == Some(false)).then(|| "Remote access was switched off for this account.".into());
        r.account = Some(RemoteAccount {
            email: user["email"].as_str().unwrap_or_default().into(),
            name: user["name"].as_str().unwrap_or_default().into(),
            avatar: user["avatar"].as_str().map(str::to_string),
        });
    });
}

// ───────────── relay REST ─────────────

enum Fail {
    /// The relay no longer knows this device: signed out.
    SignedOut,
    Blocked,
    Other(String),
}

async fn refresh(core: &Arc<Core>) -> Result<String, Fail> {
    let _guard = core.remote.refreshing.lock().await;
    if let Some((t, exp)) = core.remote.access.lock().clone()
        && exp > Instant::now()
    {
        return Ok(t);
    }
    let Some(c) = core.remote.creds.lock().clone() else { return Err(Fail::SignedOut) };
    let res = core
        .remote
        .http
        .post(format!("{}/api/auth/refresh", c.relay))
        .json(&json!({ "refresh": c.refresh }))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| Fail::Other(format!("relay unreachable ({})", e.without_url())))?;
    match res.status().as_u16() {
        200 => {}
        401 => return Err(Fail::SignedOut),
        403 => return Err(Fail::Blocked),
        s => return Err(Fail::Other(format!("relay answered {s}"))),
    }
    let v: Value = res.json().await.map_err(|e| Fail::Other(e.to_string()))?;
    let (Some(access), Some(new_refresh)) = (v["access"].as_str(), v["refresh"].as_str()) else {
        return Err(Fail::Other("unexpected answer from relay".into()));
    };
    let exp = Instant::now() + Duration::from_secs(v["expires_in"].as_u64().unwrap_or(900).saturating_sub(60));
    save(core, Some(Creds { refresh: new_refresh.into(), ..c }));
    *core.remote.access.lock() = Some((access.into(), exp));
    account_status(core, &v["user"]);
    Ok(access.into())
}

async fn api(core: &Arc<Core>, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, ApiError> {
    let relay = core.remote.creds.lock().as_ref().map(|c| c.relay.clone()).ok_or_else(|| err(ErrorCode::BadRequest, "not signed in"))?;
    let access = match refresh(core).await {
        Ok(a) => a,
        Err(f) => return Err(fail(core, f)),
    };
    let mut req = core.remote.http.request(method, format!("{relay}{path}")).bearer_auth(access).timeout(Duration::from_secs(15));
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| err(ErrorCode::Unavailable, format!("relay unreachable ({})", e.without_url())))?;
    let status = res.status();
    let v: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(err(ErrorCode::BadRequest, v["error"].as_str().unwrap_or("the relay refused this").to_string()));
    }
    Ok(v)
}

fn fail(core: &Core, f: Fail) -> ApiError {
    match f {
        Fail::SignedOut => {
            save(core, None);
            update(core, |r| {
                r.status = RemoteStatus::SignedOut;
                r.devices.clear();
                r.account = None;
                r.error = Some("Signed out. Sign in again to use remote access.".into());
            });
            err(ErrorCode::BadRequest, "signed out")
        }
        Fail::Blocked => {
            update(core, |r| r.status = RemoteStatus::Blocked);
            err(ErrorCode::Forbidden, "this account is blocked")
        }
        Fail::Other(m) => err(ErrorCode::Unavailable, m),
    }
}

// ───────────── requests from the desktop ─────────────

pub async fn handle(core: &Arc<Core>, req: Request) -> Result<Value, ApiError> {
    match req {
        Request::RemoteSignIn { provider, message } => {
            if !["github", "google", "test"].contains(&provider.as_str()) {
                return Err(err(ErrorCode::BadRequest, "unknown sign-in provider"));
            }
            let relay = relay_default();
            let port = *core.port.lock();
            let redirect = format!("http://127.0.0.1:{port}/auth/callback");
            let verifier = b64(&rand::random::<[u8; 32]>());
            let state = b64(&rand::random::<[u8; 24]>());
            let challenge = b64(&Sha256::digest(verifier.as_bytes()));
            let mut url =
                url::Url::parse(&format!("{relay}/auth/{provider}/start")).map_err(|e| err(ErrorCode::BadRequest, e.to_string()))?;
            url.query_pairs_mut()
                .append_pair("redirect_uri", &redirect)
                .append_pair("state", &state)
                .append_pair("code_challenge", &challenge)
                .append_pair("code_challenge_method", "S256");
            let mut flows = core.remote.flows.lock();
            flows.retain(|_, f| f.started.elapsed() < Duration::from_secs(600));
            flows.insert(state, SignIn { verifier, redirect, message: message.filter(|m| !m.trim().is_empty()), started: Instant::now() });
            update(core, |r| {
                r.relay = relay;
                r.error = None;
            });
            Ok(json!({ "url": url.as_str() }))
        }
        Request::RemoteSignOut => {
            let _ = api(core, reqwest::Method::POST, "/api/auth/logout", None).await;
            signed_out(core);
            Ok(Value::Null)
        }
        Request::RemoteSignOutEverywhere => {
            api(core, reqwest::Method::POST, "/api/devices/signout-all", None).await?;
            signed_out(core);
            Ok(Value::Null)
        }
        Request::RemoteEnable { enabled } => {
            let flag = off_flag(core);
            if enabled {
                let _ = std::fs::remove_file(&flag);
            } else {
                std::fs::write(&flag, b"").map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
            }
            tracing::info!(enabled, "remote access switched");
            // A phone that pulled the switch still gets its answer before the line drops.
            let core = core.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(if enabled { 0 } else { 300 })).await;
                core.remote.wake.notify_one();
            });
            Ok(Value::Null)
        }
        Request::RemotePair => {
            let v = api(core, reqwest::Method::POST, "/api/pair", None).await?;
            let creds = core.remote.creds.lock().clone().ok_or_else(|| err(ErrorCode::BadRequest, "not signed in"))?;
            let fp = device_key(&creds).map(|k| fingerprint(&k.public())).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
            let code = v["code"].as_str().unwrap_or_default();
            let url = format!("{}/app/pair#c={code}&h={}&f={fp}", creds.relay, creds.device_id);
            Ok(json!(RemotePairCode { url, expires_in: v["expires_in"].as_u64().unwrap_or(120) as u32 }))
        }
        Request::RemoteRevoke { device_id } => {
            api(core, reqwest::Method::DELETE, &format!("/api/devices/{device_id}"), None).await?;
            Ok(Value::Null)
        }
        _ => Err(err(ErrorCode::BadRequest, "not a remote request")),
    }
}

fn signed_out(core: &Core) {
    save(core, None);
    update(core, |r| {
        r.status = RemoteStatus::SignedOut;
        r.account = None;
        r.devices.clear();
        r.fingerprint = None;
        r.error = None;
    });
}

// ───────────── browser comes back from sign-in ─────────────

#[derive(Deserialize)]
pub struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn page(title: &str, text: &str) -> Html<String> {
    Html(format!(
        "<!doctype html><meta charset=utf-8><title>NeuralAgent</title><body style='font-family:system-ui;display:grid;place-items:center;height:90vh;margin:0'>\
         <main style='text-align:center;max-width:28rem'><h2 style='font-weight:500'>{title}</h2><p>{text}</p></main>"
    ))
}

pub async fn callback(AxState(app): AxState<crate::server::App>, Query(q): Query<Callback>) -> Html<String> {
    let core = app.core;
    let flow = q.state.as_ref().and_then(|s| core.remote.flows.lock().remove(s));
    let Some(flow) = flow else {
        return page("This sign-in link expired", "Start again from NeuralAgent → Remote.");
    };
    if let Some(e) = q.error {
        update(&core, |r| r.error = Some(format!("Sign-in failed: {e}")));
        return page("Sign-in did not finish", "You can close this tab and try again in NeuralAgent.");
    }
    let Some(code) = q.code else { return page("Sign-in did not finish", "No code came back.") };
    match exchange(&core, &code, flow).await {
        Ok(()) => page("You're signed in", "You can close this tab and go back to NeuralAgent."),
        Err(e) => {
            tracing::warn!("sign-in exchange failed: {e}");
            update(&core, |r| r.error = Some(format!("Sign-in failed: {e}")));
            page("Sign-in failed", "You can close this tab and try again in NeuralAgent.")
        }
    }
}

async fn exchange(core: &Arc<Core>, code: &str, flow: SignIn) -> Result<(), String> {
    let relay = relay_default();
    // Keep the key of an earlier sign-in so phones paired before still trust this computer.
    let key = core.remote.creds.lock().as_ref().and_then(|c| device_key(c).ok()).unwrap_or_else(StaticKey::generate);
    let body = json!({
        "code": code,
        "verifier": flow.verifier,
        "redirect_uri": flow.redirect,
        "message": flow.message,
        "device": { "name": core.host.name, "platform": platform(), "kind": "host", "pubkey": b64(&key.public()) },
    });
    let res =
        core.remote.http.post(format!("{relay}/api/auth/exchange")).json(&body).send().await.map_err(|e| e.without_url().to_string())?;
    let ok = res.status().is_success();
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    if !ok {
        return Err(v["error"].as_str().unwrap_or("refused").to_string());
    }
    let (Some(access), Some(refresh), Some(device)) = (v["access"].as_str(), v["refresh"].as_str(), v["device_id"].as_str()) else {
        return Err("unexpected answer".into());
    };
    save(core, Some(Creds { relay: relay.clone(), device_id: device.into(), refresh: refresh.into(), key: b64(&key.to_bytes()) }));
    *core.remote.access.lock() = Some((access.into(), Instant::now() + Duration::from_secs(840)));
    update(core, |r| {
        r.relay = relay;
        r.fingerprint = Some(fingerprint(&key.public()));
        r.error = None;
    });
    account_status(core, &v["user"]);
    tracing::info!("signed in to the relay");
    Ok(())
}

// ───────────── the relay connection ─────────────

enum End {
    /// Something changed locally (switched off, signed out): look again right away.
    Wake,
    Retry(String),
    /// Stop until something changes locally.
    Park,
}

async fn run(core: Arc<Core>) {
    let mut backoff = 1u64;
    loop {
        let wake = core.remote.wake.notified();
        tokio::pin!(wake);
        wake.as_mut().enable();
        let creds = core.remote.creds.lock().clone();
        let end = match creds {
            None => End::Park,
            Some(_) if off_flag(&core).exists() => {
                update(&core, |r| {
                    r.status = RemoteStatus::Off;
                    r.devices.iter_mut().for_each(|d| d.online = false);
                });
                End::Park
            }
            Some(c) => connect(&core, &c, wake.as_mut()).await,
        };
        match end {
            End::Wake => backoff = 1,
            End::Park => {
                wake.await;
                backoff = 1;
            }
            End::Retry(why) => {
                tracing::info!("relay connection: {why}; retrying in {backoff}s");
                update(&core, |r| {
                    if matches!(r.status, RemoteStatus::Online | RemoteStatus::Connecting | RemoteStatus::Offline) {
                        r.status = RemoteStatus::Offline;
                        r.error = Some(why.clone());
                    }
                });
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
                    _ = wake => {}
                }
                backoff = (backoff * 2).min(30);
            }
        }
    }
}

/// One end-to-end session with a phone or browser.
struct Sess {
    e2e: Arc<Mutex<na_crypto::Session>>,
    tx: mpsc::Sender<ClientMsg>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Sess {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn connect(core: &Arc<Core>, c: &Creds, mut wake: std::pin::Pin<&mut tokio::sync::futures::Notified<'_>>) -> End {
    update(core, |r| {
        if !matches!(r.status, RemoteStatus::Pending | RemoteStatus::Denied) {
            r.status = RemoteStatus::Connecting;
        }
    });
    let access = match refresh(core).await {
        Ok(a) => a,
        Err(Fail::Other(m)) => return End::Retry(m),
        Err(f) => {
            fail(core, f);
            return End::Park;
        }
    };
    let Ok(key) = device_key(c) else { return End::Park };
    let ws_url = format!("{}/ws", c.relay.replacen("http", "ws", 1));
    let (ws, _) = match tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(&ws_url)).await {
        Ok(Ok(x)) => x,
        Ok(Err(e)) => return End::Retry(format!("relay unreachable ({e})")),
        Err(_) => return End::Retry("relay did not answer".into()),
    };
    let (mut sink, mut stream) = ws.split();
    if sink.send(Message::Text(json!({ "t": "auth", "token": access }).to_string().into())).await.is_err() {
        return End::Retry("connection closed".into());
    }
    let (out_tx, mut out_rx) = mpsc::channel::<String>(1024);
    let mut sessions: HashMap<String, Sess> = HashMap::new();
    let mut ping = tokio::time::interval(Duration::from_secs(30));
    let end = loop {
        tokio::select! {
            _ = &mut wake => break End::Wake,
            _ = ping.tick() => if sink.send(Message::Ping(Default::default())).await.is_err() { break End::Retry("connection lost".into()) },
            Some(text) = out_rx.recv() => if sink.send(Message::Text(text.into())).await.is_err() { break End::Retry("connection lost".into()) },
            m = tokio::time::timeout(Duration::from_secs(90), stream.next()) => {
                let text = match m {
                    Ok(Some(Ok(Message::Text(t)))) => t,
                    Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => break End::Retry("connection closed".into()),
                    Ok(Some(Ok(_))) => continue,
                    Err(_) => break End::Retry("relay went quiet".into()),
                };
                let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                match v["t"].as_str() {
                    Some("ready") | Some("account") => {
                        account_status(core, &v["user"]);
                        if v["user"]["status"] == "approved" && v["user"]["remote"] == true {
                            update(core, |r| r.error = None);
                        } else {
                            sessions.clear();
                        }
                    }
                    Some("presence") => presence(core, c, &v["devices"], &mut sessions),
                    Some("route") => {
                        let (Some(from), Some(env)) = (v["from"].as_str(), v["env"].as_str()) else { continue };
                        envelope(core, &key, from, env, &mut sessions, &out_tx).await;
                    }
                    Some("revoked") => {
                        let reason = v["reason"].as_str().unwrap_or_default().to_string();
                        tracing::info!(reason, "relay closed the connection");
                        if reason.contains("blocked") {
                            update(core, |r| r.status = RemoteStatus::Blocked);
                            break End::Park;
                        }
                        if reason.contains("signed out") || reason.contains("deleted") || reason == "sign in again" {
                            fail(core, Fail::SignedOut);
                            break End::Park;
                        }
                        break End::Retry(reason);
                    }
                    _ => {}
                }
            }
        }
    };
    let _ = sink.send(Message::Close(None)).await;
    end
}

fn presence(core: &Core, c: &Creds, devices: &Value, sessions: &mut HashMap<String, Sess>) {
    let list = devices.as_array().cloned().unwrap_or_default();
    let mut keys = HashMap::new();
    let mut out = vec![];
    for d in &list {
        let id = d["id"].as_str().unwrap_or_default().to_string();
        let platform = d["platform"].as_str().unwrap_or_default().to_string();
        let name = d["name"].as_str().unwrap_or_default().to_string();
        if d["online"] == true
            && let Some(k) = d["pubkey"].as_str()
        {
            keys.insert(id.clone(), (k.to_string(), platform.clone(), name.clone()));
        }
        out.push(RemoteDevice {
            this: id == c.device_id,
            id,
            name,
            platform,
            online: d["online"] == true,
            last_seen: d["last_seen"].as_i64().unwrap_or(0),
        });
    }
    // Sessions of devices that went away (offline or signed out) end here too.
    sessions.retain(|k, _| k.split_once(':').is_some_and(|(dev, _)| keys.contains_key(dev)));
    *core.remote.keys.lock() = keys;
    update(core, |r| r.devices = out);
}

fn route(to: &str, env: Value) -> String {
    json!({ "t": "route", "to": to, "env": env.to_string() }).to_string()
}

async fn envelope(
    core: &Arc<Core>,
    key: &StaticKey,
    from: &str,
    env: &str,
    sessions: &mut HashMap<String, Sess>,
    out: &mpsc::Sender<String>,
) {
    let Ok(e) = serde_json::from_str::<Value>(env) else { return };
    let Some(sid) = e["sid"].as_str().filter(|s| !s.is_empty() && s.len() <= 64) else { return };
    let skey = format!("{from}:{sid}");
    match e["k"].as_str() {
        Some("hs1") => {
            // The client's key must be the one this account registered for that device.
            let Some((pubkey, platform, name)) = core.remote.keys.lock().get(from).cloned() else { return };
            if e["c"].as_str() != Some(pubkey.as_str()) {
                tracing::warn!(device = from, "handshake with a key that is not this device's: refused");
                return;
            }
            let (Some(ep), Some(cp)) = (e["e"].as_str().and_then(|s| unb64(s).ok()), unb64(&pubkey).ok()) else { return };
            let (Ok(ep), Ok(cp)) = (<[u8; 32]>::try_from(ep), <[u8; 32]>::try_from(cp)) else { return };
            let Ok((f, session)) = host_accept(key, ep, cp) else { return };
            if sessions.len() >= 64 {
                return;
            }
            let client = ClientInfo {
                kind: if platform == "android" { ClientKind::Android } else { ClientKind::Web },
                name,
                device_id: Some(from.to_string()),
            };
            let e2e = Arc::new(Mutex::new(session));
            let (tx, rx) = mpsc::channel::<ClientMsg>(256);
            let task = tokio::spawn(serve_session(core.clone(), client, rx, e2e.clone(), from.to_string(), sid.to_string(), out.clone()));
            sessions.insert(skey, Sess { e2e, tx, task });
            let _ = out.send(route(from, json!({ "k": "hs2", "sid": sid, "f": b64(&f) }))).await;
            tracing::info!(device = from, "remote client connected (end-to-end)");
        }
        Some("d") => {
            let Some(s) = sessions.get(&skey) else {
                let _ = out.send(route(from, json!({ "k": "bye", "sid": sid }))).await;
                return;
            };
            let opened = e["ct"].as_str().and_then(|c| unb64(c).ok()).map(|frame| s.e2e.lock().open(&frame));
            let msg = match opened {
                Some(Ok(pt)) => serde_json::from_slice::<ClientMsg>(&pt).ok(),
                _ => None,
            };
            match msg {
                Some(m) => {
                    if s.tx.send(m).await.is_err() {
                        sessions.remove(&skey);
                    }
                }
                None => {
                    tracing::warn!(device = from, "undecryptable or invalid frame: session closed");
                    sessions.remove(&skey);
                    let _ = out.send(route(from, json!({ "k": "bye", "sid": sid }))).await;
                }
            }
        }
        Some("bye") => {
            sessions.remove(&skey);
        }
        _ => {}
    }
}

/// Runs one remote client like a local one: hello first, then the normal client loop. The
/// client's kind comes from its device on the relay, never from what it claims.
async fn serve_session(
    core: Arc<Core>,
    client: ClientInfo,
    mut rx: mpsc::Receiver<ClientMsg>,
    e2e: Arc<Mutex<na_crypto::Session>>,
    to: String,
    sid: String,
    relay: mpsc::Sender<String>,
) {
    let (out, mut out_rx) = mpsc::channel::<ServerMsg>(512);
    let writer = {
        let (e2e, to, sid) = (e2e.clone(), to.clone(), sid.clone());
        tokio::spawn(async move {
            while let Some(m) = out_rx.recv().await {
                let Ok(pt) = serde_json::to_vec(&m) else { continue };
                let frame = e2e.lock().seal(&pt);
                if relay.send(route(&to, json!({ "k": "d", "sid": sid, "ct": b64(&frame) }))).await.is_err() {
                    break;
                }
            }
        })
    };
    match tokio::time::timeout(Duration::from_secs(15), rx.recv()).await {
        Ok(Some(ClientMsg::Hello { v, .. })) if v == PROTOCOL_VERSION => {
            let _ = out
                .send(ServerMsg::HelloOk { v: PROTOCOL_VERSION, daemon_version: env!("CARGO_PKG_VERSION").into(), host: core.host.clone() })
                .await;
            crate::server::run_channel(core, client, out, &mut rx).await;
        }
        _ => tracing::info!(device = %to, "remote client sent no valid hello"),
    }
    writer.abort();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_from_account() {
        let v = |s: &str, remote: bool| json!({ "status": s, "remote": remote, "email": "a@b.c", "name": "A" });
        let cases = [
            (v("pending", true), RemoteStatus::Pending),
            (v("approved", true), RemoteStatus::Online),
            (v("approved", false), RemoteStatus::Off),
            (v("denied", true), RemoteStatus::Denied),
            (v("blocked", true), RemoteStatus::Blocked),
        ];
        for (user, want) in cases {
            let status = match (user["status"].as_str(), user["remote"].as_bool()) {
                (Some("approved"), Some(false)) => RemoteStatus::Off,
                (Some("approved"), _) => RemoteStatus::Online,
                (Some("denied"), _) => RemoteStatus::Denied,
                (Some("blocked"), _) => RemoteStatus::Blocked,
                _ => RemoteStatus::Pending,
            };
            assert_eq!(status, want);
        }
    }
}
