//! Public endpoints that feed the admin area (docs/notes/insights.md):
//! - `POST /api/telemetry`: the anonymous daily usage ping of an app (can be turned off in the app).
//! - `POST /api/reports`: a problem report the user wrote and looked at before sending.
//! - `POST /api/hit`: a cookieless page view of the website (no id, no cookie, no IP stored).
//!
//! The IP address is used only for the rate limit and to look up the country; it is not stored.

use std::sync::Arc;

use axum::extract::{FromRequestParts, State};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use axum::{Json, extract::ConnectInfo};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::Relay;
use crate::insights::{NewReport, Ping};
use crate::util::{ApiError, ApiResult, hash};

/// Where a request came from: the IP (rate limit only) and its country.
pub struct Visitor {
    pub ip: std::net::IpAddr,
    pub country: String,
}

impl FromRequestParts<Arc<Relay>> for Visitor {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, r: &Arc<Relay>) -> Result<Self, ApiError> {
        let peer = parts
            .extensions
            .get::<ConnectInfo<std::net::SocketAddr>>()
            .map(|c| c.0)
            .unwrap_or_else(|| std::net::SocketAddr::from(([127, 0, 0, 1], 0)));
        let ip = crate::client_ip(peer, &parts.headers);
        Ok(Visitor { ip, country: r.country(peer, ip, &parts.headers) })
    }
}

const APPS: [&str; 3] = ["desktop", "android", "web"];
const OSES: [&str; 6] = ["macos", "windows", "linux", "android", "ios", "other"];

/// Short free text: trimmed, at most `max` characters, no control characters.
pub fn clean(s: &str, max: usize) -> String {
    s.trim().chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect()
}

fn token_like(s: &str, max: usize) -> Option<String> {
    let s = s.trim();
    (!s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-+ ".contains(c))).then(|| s.to_string())
}

fn counter_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 48 && k.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_.-".contains(c))
}

#[derive(Deserialize)]
pub struct PingBody {
    /// Random id the app made up (never tied to an account); only its hash is stored.
    install: String,
    app: String,
    version: String,
    os: String,
    os_version: Option<String>,
    arch: Option<String>,
    locale: Option<String>,
    #[serde(default)]
    counts: serde_json::Map<String, Value>,
}

pub async fn ping(State(r): State<Arc<Relay>>, v: Visitor, Json(b): Json<PingBody>) -> ApiResult<Json<Value>> {
    r.limit(v.ip)?;
    if !(16..=64).contains(&b.install.len()) || !APPS.contains(&b.app.as_str()) {
        return Err(ApiError::bad("bad install or app"));
    }
    let version = token_like(&b.version, 32).ok_or_else(|| ApiError::bad("bad version"))?;
    let os = if OSES.contains(&b.os.as_str()) { b.os.clone() } else { "other".into() };
    let counts = b
        .counts
        .iter()
        .filter(|(k, _)| counter_key(k))
        .filter_map(|(k, v)| Some((k.clone(), v.as_i64()?.clamp(0, 100_000))))
        .filter(|(_, n)| *n > 0)
        .take(64)
        .collect();
    let p = Ping {
        id: hash(&format!("install:{}", b.install)),
        app: b.app,
        version,
        os,
        os_version: b.os_version.as_deref().and_then(|s| token_like(s, 32)),
        arch: b.arch.as_deref().and_then(|s| token_like(s, 16)),
        locale: b.locale.as_deref().and_then(|s| token_like(s, 16)),
        country: v.country,
        counts,
    };
    r.db.install_ping(&p)?;
    let _ = r.db.prune();
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct ReportBody {
    app: String,
    version: String,
    os: String,
    summary: String,
    #[serde(default)]
    details: String,
    /// Where the admin may answer (prefilled with the account's email when signed in).
    contact: Option<String>,
    /// What the app collected; the user saw it before sending.
    #[serde(default)]
    diagnostics: Value,
}

/// At most this much diagnostics JSON per report.
const MAX_DIAGNOSTICS: usize = 512 * 1024;

pub async fn report(State(r): State<Arc<Relay>>, v: Visitor, headers: HeaderMap, Json(b): Json<ReportBody>) -> ApiResult<Json<Value>> {
    r.limit(v.ip)?;
    r.limit(v.ip)?; // reports count double: they are rare and large
    let summary = clean(&b.summary, 200);
    if summary.is_empty() || !APPS.contains(&b.app.as_str()) {
        return Err(ApiError::bad("a short summary is needed"));
    }
    let diagnostics = serde_json::to_string(&b.diagnostics).unwrap_or_default();
    if diagnostics.len() > MAX_DIAGNOSTICS {
        return Err(ApiError::bad("diagnostics too large"));
    }
    // Signed in: the report belongs to the account (the admin can see who it is).
    let account = crate::bearer(&headers).and_then(|t| r.authenticate(t).ok());
    let contact = b.contact.as_deref().map(|c| clean(c, 200)).filter(|c| c.contains('@'));
    let email = contact.or_else(|| account.as_ref().map(|a| a.user.email.clone()));
    let rep = NewReport {
        user_id: account.as_ref().map(|a| a.user.id.clone()),
        email,
        app: b.app,
        version: token_like(&b.version, 32).unwrap_or_else(|| "?".into()),
        os: if OSES.contains(&b.os.as_str()) { b.os } else { "other".into() },
        country: v.country,
        summary,
        details: clean(&b.details, 8000),
        diagnostics,
    };
    let id = r.db.add_report(&rep)?;
    let _ = r.db.bump("reports", 1);
    tracing::info!(%id, "problem report received");
    let r2 = r.clone();
    let (id2, summary) = (id.clone(), rep.summary.clone());
    tokio::spawn(async move {
        r2.mail.report_received(&r2.cfg.admins, &id2, &summary, rep.email.as_deref()).await;
        r2.push.notify_admins(&r2, "report", &format!("Problem report {id2}"), &summary).await;
    });
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
pub struct HitBody {
    path: String,
    /// `document.referrer`; only its host is kept.
    #[serde(default)]
    referrer: String,
    /// `download:<key>` when a download button was pressed.
    #[serde(default)]
    event: String,
}

/// Pages of the website that are counted; anything else counts as `other`.
const PAGES: [&str; 9] = ["/", "/demo/", "/download/", "/changelog/", "/privacy/", "/imprint/", "/terms/", "/404", "/app/"];

pub async fn hit(State(r): State<Arc<Relay>>, v: Visitor, headers: HeaderMap, Json(b): Json<HitBody>) -> ApiResult<Json<Value>> {
    r.limit(v.ip)?;
    // Do Not Track / Global Privacy Control: not even an anonymous count.
    if headers.get("dnt").is_some_and(|h| h == "1") || headers.get("sec-gpc").is_some_and(|h| h == "1") {
        return Ok(Json(json!({ "ok": true })));
    }
    if let Some(key) = b.event.strip_prefix("download:").filter(|k| counter_key(k)) {
        let _ = r.db.bump(&format!("dlclick:{key}"), 1);
        return Ok(Json(json!({ "ok": true })));
    }
    let path = if b.path.ends_with(".html") { b.path.trim_end_matches("index.html").to_string() } else { b.path.clone() };
    let page = PAGES.iter().find(|p| **p == path || (p.len() > 1 && path == p.trim_end_matches('/'))).copied().unwrap_or("other");
    let _ = r.db.bump(&format!("page:{page}"), 1);
    let _ = r.db.bump(&format!("visit_cc:{}", v.country), 1);
    let own = url::Url::parse(&r.cfg.public_url).ok().and_then(|u| u.host_str().map(str::to_string));
    if let Some(host) = url::Url::parse(&b.referrer).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        && Some(&host) != own.as_ref()
        && host.len() <= 64
    {
        let _ = r.db.bump(&format!("ref:{host}"), 1);
    }
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(clean("  a\u{7}b\nc  ", 10), "ab\nc");
        assert_eq!(clean("abcdef", 3), "abc");
        assert!(counter_key("agent.claude") && !counter_key("Agent") && !counter_key("a/b"));
        assert_eq!(token_like("0.4.1", 32).as_deref(), Some("0.4.1"));
        assert!(token_like("<script>", 32).is_none());
    }
}
