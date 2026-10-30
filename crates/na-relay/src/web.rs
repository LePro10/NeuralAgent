//! Static web pages: landing (`/`), web remote (`/app`), admin (`/admin`), changelog, brand assets.
//! Built files come from `NA_RELAY_WEB`; without them a minimal landing page is served.
//!
//! Caching: Vite's hashed bundles under `/assets/` never change, so browsers keep them for a
//! year. Everything else (HTML, `version.json`, `changelog.json`, `sw.js`, images) is `no-cache`:
//! the browser revalidates (a cheap 304 via Last-Modified), so a deploy is picked up on the next
//! load. The web remote polls `/version.json` to offer "Reload to update" (`apps/web/vite.config.ts`);
//! the desktop app reads `/changelog.json` for its update dialog (CORS open for both).

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderValue, Request};
use axum::middleware::{self, Next};
use axum::response::{Html, Response};
use axum::routing::get;
use tower_http::services::{ServeDir, ServeFile};

use crate::Relay;
use crate::config::Config;

const FALLBACK: &str = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>\
<title>NeuralAgent</title><body style='font-family:system-ui;background:#0b0b0c;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0'>\
<main style='text-align:center'><h1 style='font-weight:500'>NeuralAgent</h1><p>Your AI agents, on every screen.</p></main>";

pub fn router(cfg: &Config) -> Router<Arc<Relay>> {
    let Some(dir) = cfg.web.clone().filter(|d| d.join("index.html").exists()) else {
        return Router::new().route("/", get(|| async { Html(FALLBACK) }));
    };
    // Single-page apps: unknown paths below /app and /admin load their index.html.
    let spa = |sub: &str| ServeDir::new(dir.join(sub)).fallback(ServeFile::new(dir.join(sub).join("index.html")));
    Router::new()
        .nest_service("/app", spa("app"))
        .nest_service("/admin", spa("admin"))
        .fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("404.html"))))
        .layer(middleware::from_fn(cache_control))
}

/// Only for the static files: the layer also wraps the routes merged next to this router, so API,
/// auth, socket and download answers are left as their handlers made them.
async fn cache_control(req: Request<Body>, next: Next) -> Response {
    let path = req.uri().path();
    if ["/api/", "/auth/", "/ws", "/download/"].iter().any(|p| path.starts_with(p)) {
        return next.run(req).await;
    }
    let hashed = path.starts_with("/assets/");
    // Public release data; the desktop app (origin tauri://localhost) fetches the changelog.
    let open = path == "/changelog.json" || path == "/version.json";
    let mut res = next.run(req).await;
    if open {
        res.headers_mut().insert(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    }
    // A missing asset gets the 404 page (as 200, from the fallback): never keep that for a year.
    let page = res.headers().get(axum::http::header::CONTENT_TYPE).is_some_and(|t| t.as_bytes().starts_with(b"text/html"));
    let value = if hashed && res.status().is_success() && !page { "public, max-age=31536000, immutable" } else { "no-cache" };
    res.headers_mut().entry(CACHE_CONTROL).or_insert(HeaderValue::from_static(value));
    res
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn hashed_assets_are_immutable_and_the_rest_revalidates() {
        let dir = std::env::temp_dir().join(format!("na-web-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::create_dir_all(dir.join("app")).unwrap();
        for (f, body) in [
            ("index.html", "home"),
            ("404.html", "gone"),
            ("version.json", "{\"build\":\"b1\"}"),
            ("assets/x-1a2b.js", "js"),
            ("app/index.html", "app"),
        ] {
            std::fs::write(dir.join(f), body).unwrap();
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mut cfg = crate::config::Config::local(&base);
        cfg.web = Some(dir.clone());
        let app = crate::router(crate::Relay::new(cfg, crate::db::Db::memory().unwrap()))
            .into_make_service_with_connect_info::<std::net::SocketAddr>();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let http = reqwest::Client::new();
        let get = |p: &str| http.get(format!("{base}{p}")).send();

        let v = get("/version.json").await.unwrap();
        assert_eq!(v.headers()["cache-control"], "no-cache");
        assert_eq!(v.headers()["access-control-allow-origin"], "*");
        assert_eq!(v.text().await.unwrap(), "{\"build\":\"b1\"}");
        assert_eq!(get("/assets/x-1a2b.js").await.unwrap().headers()["cache-control"], "public, max-age=31536000, immutable");
        assert_eq!(get("/").await.unwrap().headers()["cache-control"], "no-cache");
        let app = get("/app/some/route").await.unwrap();
        assert_eq!(app.headers()["cache-control"], "no-cache");
        assert_eq!(app.text().await.unwrap(), "app");
        assert_eq!(get("/assets/missing.js").await.unwrap().headers()["cache-control"], "no-cache");
        // API answers keep their own policy.
        assert!(get("/api/health").await.unwrap().headers().get("cache-control").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
