//! NeuralAgent relay: Google/GitHub sign-in with admin approval, devices, QR pairing, admin
//! area with passkeys, and routing of end-to-end encrypted envelopes between the devices of one
//! account. The relay never sees what is inside an envelope.

pub mod admin;
pub mod auth;
pub mod config;
pub mod db;
pub mod hub;
pub mod mail;
pub mod util;
pub mod web;
pub mod webauthn;

#[cfg(all(test, feature = "test-login"))]
mod tests;

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::Router;
use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use axum::routing::{delete, get, post, put};
use parking_lot::Mutex;

use crate::config::Config;
use crate::db::{Db, Device, Status, User};
use crate::util::{ApiError, Ttl, hash, now};

/// Access tokens live 15 minutes; refresh tokens rotate on every use.
pub const ACCESS_TTL: i64 = 15 * 60;
/// "Add phone" codes: one-time, two minutes.
pub const PAIR_TTL: i64 = 120;

/// A provider sign-in in progress (between our redirect and the provider's callback).
#[derive(Clone)]
pub struct Flow {
    pub provider: String,
    pub redirect_uri: String,
    pub client_state: String,
    pub client_challenge: String,
    pub verifier: String,
    pub nonce: String,
}

/// One-time code handed back to the app after sign-in; exchanged with the PKCE verifier.
#[derive(Clone)]
pub struct Code {
    pub user_id: String,
    pub challenge: String,
    pub redirect_uri: String,
}

#[derive(Clone)]
pub struct Access {
    pub user_id: String,
    pub device_id: String,
}

#[derive(Clone)]
pub struct Pair {
    pub user_id: String,
    pub host_device: String,
}

pub struct Relay {
    pub cfg: Config,
    pub db: Db,
    pub mail: mail::Mailer,
    pub hub: hub::Hub,
    pub http: reqwest::Client,
    pub flows: Ttl<String, Flow>,
    pub codes: Ttl<String, Code>,
    /// Keyed by the hash of the access token.
    pub access: Ttl<String, Access>,
    pub pairs: Ttl<String, Pair>,
    pub challenges: Ttl<String, webauthn::Challenge>,
    /// Admin sessions after a passkey check, keyed by token hash → user id.
    pub admin_sessions: Ttl<String, String>,
    limiter: Mutex<HashMap<IpAddr, (i64, u32)>>,
}

impl Relay {
    pub fn new(cfg: Config, db: Db) -> Arc<Relay> {
        Arc::new(Relay {
            mail: mail::Mailer::new(&cfg),
            http: reqwest::Client::builder()
                .user_agent("NeuralAgent-Relay")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("http client"),
            cfg,
            db,
            hub: hub::Hub::default(),
            flows: Ttl::default(),
            codes: Ttl::default(),
            access: Ttl::default(),
            pairs: Ttl::default(),
            challenges: Ttl::default(),
            admin_sessions: Ttl::default(),
            limiter: Mutex::new(HashMap::new()),
        })
    }

    /// Per-IP budget for sign-in and token endpoints: 60 per minute is never hit by a person.
    pub fn limit(&self, ip: IpAddr) -> Result<(), ApiError> {
        let minute = now() / 60;
        let mut m = self.limiter.lock();
        if m.len() > 10_000 {
            m.retain(|_, (w, _)| *w == minute);
        }
        let e = m.entry(ip).or_insert((minute, 0));
        if e.0 != minute {
            *e = (minute, 0);
        }
        e.1 += 1;
        if e.1 > 60 {
            return Err(ApiError(axum::http::StatusCode::TOO_MANY_REQUESTS, "too many requests, try again in a minute".into()));
        }
        Ok(())
    }

    /// Forgets a device's access tokens and closes its connection.
    pub fn sign_out_device(&self, device_id: &str, reason: &str) {
        let _ = self.db.revoke_device(device_id);
        self.access.remove_where(|a| a.device_id == device_id);
        self.hub.kick_device(device_id, reason);
    }

    /// Pushes a changed account to its open connections; blocked accounts are disconnected.
    pub fn account_changed(&self, user: &User) {
        if user.status == Status::Blocked {
            self.access.remove_where(|a| a.user_id == user.id);
            self.hub.kick_user(&user.id, "account blocked");
        } else {
            self.hub.user_changed(user);
        }
    }
}

/// The client's address; behind the reverse proxy (a private address) its header is used.
pub fn client_ip(peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
    let private = match peer.ip() {
        IpAddr::V4(v) => v.is_private() || v.is_loopback(),
        IpAddr::V6(v) => v.is_loopback() || v.to_ipv4_mapped().is_some_and(|m| m.is_private() || m.is_loopback()),
    };
    if private {
        let h = |k: &str| headers.get(k).and_then(|v| v.to_str().ok());
        if let Some(ip) = h("x-real-ip").and_then(|v| v.trim().parse().ok()) {
            return ip;
        }
        if let Some(ip) = h("x-forwarded-for").and_then(|v| v.rsplit(',').next()).and_then(|v| v.trim().parse().ok()) {
            return ip;
        }
    }
    peer.ip()
}

/// A request with a valid access token: the account and the device it came from.
pub struct Authed {
    pub user: User,
    pub device: Device,
}

pub fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get("authorization")?.to_str().ok()?.strip_prefix("Bearer ")
}

impl Relay {
    pub fn authenticate(&self, token: &str) -> Result<Authed, ApiError> {
        let a = self.access.get(&hash(token)).ok_or_else(ApiError::unauthorized)?;
        let device = self.db.device(&a.device_id)?.ok_or_else(ApiError::unauthorized)?;
        let user = self.db.user(&a.user_id)?.ok_or_else(ApiError::unauthorized)?;
        if user.status == Status::Blocked {
            return Err(ApiError::forbidden("account blocked"));
        }
        Ok(Authed { user, device })
    }
}

impl FromRequestParts<Arc<Relay>> for Authed {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, relay: &Arc<Relay>) -> Result<Self, Self::Rejection> {
        let token = bearer(&parts.headers).ok_or_else(ApiError::unauthorized)?;
        relay.authenticate(token)
    }
}

/// The caller's IP, for rate limits.
pub struct Ip(pub IpAddr);

impl FromRequestParts<Arc<Relay>> for Ip {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _: &Arc<Relay>) -> Result<Self, Self::Rejection> {
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0).unwrap_or_else(|| SocketAddr::from(([127, 0, 0, 1], 0)));
        Ok(Ip(client_ip(peer, &parts.headers)))
    }
}

pub fn router(relay: Arc<Relay>) -> Router {
    let api = Router::new()
        .route("/health", get(|| async { axum::Json(serde_json::json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })) }))
        .route("/config", get(auth::config))
        .route("/auth/exchange", post(auth::exchange))
        .route("/auth/refresh", post(auth::refresh))
        .route("/auth/logout", post(auth::logout))
        .route("/me", get(auth::me))
        .route("/me/device", put(auth::update_device))
        .route("/devices", get(auth::devices))
        .route("/devices/{id}", delete(auth::delete_device))
        .route("/devices/signout-all", post(auth::sign_out_all))
        .route("/pair", post(auth::pair_create))
        .route("/pair/redeem", post(auth::pair_redeem))
        .nest("/admin", admin::router());
    Router::new()
        .nest("/api", api)
        .route("/auth/{provider}/start", get(auth::start))
        .route("/auth/{provider}/callback", get(auth::callback))
        .route("/ws", get(hub::upgrade))
        .merge(web::router(&relay.cfg))
        .with_state(relay)
}

/// Runs the relay until the process is stopped.
pub async fn serve(cfg: Config) -> anyhow::Result<()> {
    let db = Db::open(&cfg.db)?;
    let bind = cfg.bind;
    let relay = Relay::new(cfg, db);
    tracing::info!(%bind, providers = ?relay.cfg.providers(), mail = relay.cfg.smtp.is_some(), "relay listening");
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, router(relay).into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}
