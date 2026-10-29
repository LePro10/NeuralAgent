//! Agent hooks: `neuralagentd hook <event>` runs inside the agent's process tree and forwards
//! the hook JSON to the daemon. It must be fast and must never block or fail the agent.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State as AxState;
use axum::http::{HeaderMap, StatusCode};
use serde_json::Value;

use crate::server::App;

/// Client side. Always exits 0 and prints nothing, whatever happens. The payload comes on stdin,
/// or as an argument (Codex `notify` passes its JSON as the last argument).
pub fn client_main(event: &str, arg: Option<&str>) {
    let _ = send(event, arg);
}

fn send(event: &str, arg: Option<&str>) -> std::io::Result<()> {
    let (Ok(sid), Ok(token), Ok(port)) = (std::env::var("NEURALAGENT_SESSION"), std::env::var("NEURALAGENT_HOOK_TOKEN"), std::env::var("NEURALAGENT_PORT")) else {
        return Ok(());
    };
    let mut body = Vec::new();
    match arg {
        Some(a) => body.extend_from_slice(a.as_bytes()),
        None => {
            std::io::stdin().take(1 << 20).read_to_end(&mut body)?;
        }
    }
    if body.is_empty() {
        body = b"{}".to_vec();
    }
    let addr = format!("127.0.0.1:{port}").parse().map_err(std::io::Error::other)?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(500))?;
    s.set_write_timeout(Some(Duration::from_millis(1000)))?;
    s.set_read_timeout(Some(Duration::from_millis(1000)))?;
    let head = format!(
        "POST /hook HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nX-NeuralAgent-Session: {sid}\r\nX-NeuralAgent-Token: {token}\r\nX-NeuralAgent-Event: {event}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes())?;
    s.write_all(&body)?;
    let mut sink = [0u8; 256];
    let _ = s.read(&mut sink);
    Ok(())
}

/// Server side: `POST /hook`.
pub async fn receive(AxState(app): AxState<App>, headers: HeaderMap, body: axum::body::Bytes) -> StatusCode {
    let h = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (sid, token, event) = (h("x-neuralagent-session"), h("x-neuralagent-token"), h("x-neuralagent-event"));
    if !app.core.hook_token_ok(&sid, &token) {
        return StatusCode::UNAUTHORIZED;
    }
    let payload: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    on_hook(&app.core, &sid, &event, payload);
    StatusCode::NO_CONTENT
}

fn on_hook(core: &Arc<crate::core::Core>, sid: &String, event: &str, payload: Value) {
    tracing::debug!(%sid, %event, "hook");
    core.on_hook(sid, event, &payload);
}
