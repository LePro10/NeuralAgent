//! Small helpers: time, random tokens, hashing, short-lived in-memory maps, HTTP errors.

use std::collections::HashMap;
use std::hash::Hash;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// UTC date `days_ago` days back, as `YYYY-MM-DD`.
pub fn day(days_ago: u32) -> String {
    (chrono::Utc::now() - chrono::Duration::days(days_ago as i64)).format("%Y-%m-%d").to_string()
}

pub fn b64u(b: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(b)
}

pub fn unb64u(s: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).ok()
}

/// 256 random bits, URL-safe.
pub fn token() -> String {
    b64u(&rand::random::<[u8; 32]>())
}

/// What is stored instead of a token.
pub fn hash(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// PKCE S256 challenge of a verifier.
pub fn s256(verifier: &str) -> String {
    b64u(&Sha256::digest(verifier.as_bytes()))
}

pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A map whose entries expire; used for login flows, one-time codes and access tokens.
pub struct Ttl<K, V>(Mutex<HashMap<K, (i64, V)>>);

impl<K: Eq + Hash, V: Clone> Default for Ttl<K, V> {
    fn default() -> Self {
        Ttl(Mutex::new(HashMap::new()))
    }
}

impl<K: Eq + Hash, V: Clone> Ttl<K, V> {
    pub fn insert(&self, k: K, v: V, ttl_secs: i64) {
        let t = now();
        let mut m = self.0.lock();
        m.retain(|_, (exp, _)| *exp > t);
        m.insert(k, (t + ttl_secs, v));
    }

    /// Removes and returns a live entry (one-time use).
    pub fn take(&self, k: &K) -> Option<V> {
        self.0.lock().remove(k).filter(|(exp, _)| *exp > now()).map(|(_, v)| v)
    }

    pub fn get(&self, k: &K) -> Option<V> {
        self.0.lock().get(k).filter(|(exp, _)| *exp > now()).map(|(_, v)| v.clone())
    }

    pub fn remove_where(&self, f: impl Fn(&V) -> bool) {
        self.0.lock().retain(|_, (_, v)| !f(v));
    }
}

/// An HTTP error with a message for the client.
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn unauthorized() -> Self {
        ApiError(StatusCode::UNAUTHORIZED, "sign in again".into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::FORBIDDEN, msg.into())
    }
    pub fn not_found() -> Self {
        ApiError(StatusCode::NOT_FOUND, "not found".into())
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        tracing::error!("internal error: {e:#}");
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_s256_matches_rfc7636_example() {
        assert_eq!(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn ttl_take_is_one_time() {
        let t: Ttl<String, u8> = Ttl::default();
        t.insert("a".into(), 1, 60);
        assert_eq!(t.take(&"a".into()), Some(1));
        assert_eq!(t.take(&"a".into()), None);
        t.insert("b".into(), 2, -1);
        assert_eq!(t.get(&"b".into()), None);
    }
}
