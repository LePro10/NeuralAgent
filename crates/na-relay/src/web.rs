//! Static web pages: landing (`/`), web remote (`/app`), admin (`/admin`), brand assets.
//! Built files come from `NA_RELAY_WEB`; without them a minimal landing page is served.

use std::sync::Arc;

use axum::Router;
use axum::response::Html;
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
}
