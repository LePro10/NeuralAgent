//! Local WebSocket server (127.0.0.1 only, token + Origin check).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State as AxState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use na_protocol::*;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use crate::core::Core;

/// Origins of our own webviews. Requests without an Origin come from native code.
const ALLOWED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
];

pub fn random_token() -> String {
    let bytes: [u8; 32] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[derive(Clone)]
pub struct App {
    pub core: Arc<Core>,
    pub token: Arc<String>,
}

pub fn router(app: App) -> Router {
    Router::new()
        .route("/health", get(|| async { axum::Json(json!({"ok": true, "version": env!("CARGO_PKG_VERSION"), "protocol": PROTOCOL_VERSION})) }))
        .route("/ws", get(ws_upgrade))
        .route("/hook", post(crate::hooks::receive))
        .with_state(app)
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_upgrade(AxState(app): AxState<App>, Query(q): Query<WsQuery>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if let Some(origin) = headers.get("origin").and_then(|o| o.to_str().ok())
        && !ALLOWED_ORIGINS.contains(&origin) {
            return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
        }
    if !ct_eq(q.token.as_bytes(), app.token.as_bytes()) {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    ws.max_message_size(16 << 20).on_upgrade(move |socket| serve_socket(app.core, socket))
}

async fn serve_socket(core: Arc<Core>, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (out, mut out_rx) = mpsc::channel::<ServerMsg>(512);
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            let Ok(text) = serde_json::to_string(&m) else { continue };
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // Hello first.
    let client = match tokio::time::timeout(Duration::from_secs(10), next_msg(&mut stream)).await {
        Ok(Some(ClientMsg::Hello { v, client })) if v == PROTOCOL_VERSION => client,
        _ => {
            writer.abort();
            return;
        }
    };
    tracing::info!(kind = ?client.kind, name = %client.name, "client connected");
    let _ = out.send(ServerMsg::HelloOk { v: PROTOCOL_VERSION, daemon_version: env!("CARGO_PKG_VERSION").into(), host: core.host.clone() }).await;
    run_client(core, client, out, &mut stream).await;
    writer.abort();
}

async fn next_msg(stream: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin)) -> Option<ClientMsg> {
    while let Some(Ok(m)) = stream.next().await {
        match m {
            Message::Text(t) => match serde_json::from_str(&t) {
                Ok(m) => return Some(m),
                Err(e) => tracing::warn!("bad client message: {e}"),
            },
            Message::Close(_) => return None,
            _ => {}
        }
    }
    None
}

/// Transport-independent client loop; the relay client reuses it for remote devices.
pub async fn run_client(core: Arc<Core>, client: ClientInfo, out: mpsc::Sender<ServerMsg>, stream: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin)) {
    let mut conn = Conn { core, client, out, state_task: None, attached: Arc::new(Mutex::new(HashMap::new())) };
    while let Some(msg) = next_msg(stream).await {
        conn.on_msg(msg).await;
    }
    conn.close();
}

pub struct Conn {
    pub core: Arc<Core>,
    pub client: ClientInfo,
    pub out: mpsc::Sender<ServerMsg>,
    state_task: Option<JoinHandle<()>>,
    attached: Arc<Mutex<HashMap<Id, JoinHandle<()>>>>,
}

impl Conn {
    pub async fn on_msg(&mut self, msg: ClientMsg) {
        match msg {
            ClientMsg::Hello { .. } => {}
            ClientMsg::Ping { at } => {
                let _ = self.out.send(ServerMsg::Pong { at }).await;
            }
            ClientMsg::Sub { since } => {
                if let Some(t) = self.state_task.take() {
                    t.abort();
                }
                let sub = self.core.subscribe(since);
                if matches!(sub.first, ServerMsg::Snapshot { .. }) {
                    let _ = self.out.send(sub.first).await;
                }
                for m in sub.replay {
                    let _ = self.out.send(m).await;
                }
                self.state_task = Some(tokio::spawn(forward_state(self.core.clone(), sub.rx, self.out.clone())));
            }
            ClientMsg::Req { id, req } => match req {
                Request::TermAttach { sid } => {
                    let res = match self.core.pty(&sid) {
                        Ok(pty) => {
                            let (snapshot, seq, (cols, rows), rx) = pty.attach();
                            let _ = self.out.send(ServerMsg::Res { id, ok: true, r: Some(json!(AttachResult { snapshot, seq, cols, rows })), err: None }).await;
                            let task = tokio::spawn(forward_term(sid.clone(), pty, rx, self.out.clone()));
                            if let Some(old) = self.attached.lock().insert(sid, task) {
                                old.abort();
                            }
                            return;
                        }
                        Err(e) => e,
                    };
                    let _ = self.out.send(ServerMsg::Res { id, ok: false, r: None, err: Some(res) }).await;
                }
                Request::TermDetach { sid } => {
                    if let Some(t) = self.attached.lock().remove(&sid) {
                        t.abort();
                    }
                    let _ = self.out.send(ServerMsg::Res { id, ok: true, r: None, err: None }).await;
                }
                req => {
                    let core = self.core.clone();
                    let client = self.client.clone();
                    let out = self.out.clone();
                    tokio::spawn(async move {
                        let msg = match core.handle(&client, req).await {
                            Ok(r) => ServerMsg::Res { id, ok: true, r: Some(r), err: None },
                            Err(e) => ServerMsg::Res { id, ok: false, r: None, err: Some(e) },
                        };
                        let _ = out.send(msg).await;
                    });
                }
            },
        }
    }

    pub fn close(&mut self) {
        if let Some(t) = self.state_task.take() {
            t.abort();
        }
        for (_, t) in self.attached.lock().drain() {
            t.abort();
        }
    }
}

async fn forward_state(core: Arc<Core>, mut rx: broadcast::Receiver<(u64, Event)>, out: mpsc::Sender<ServerMsg>) {
    loop {
        match rx.recv().await {
            Ok((seq, ev)) => {
                if out.send(ServerMsg::Ev { seq, ev }).await.is_err() {
                    return;
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {
                let sub = core.subscribe(None);
                rx = sub.rx;
                if out.send(sub.first).await.is_err() {
                    return;
                }
            }
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

async fn forward_term(sid: Id, pty: Arc<crate::pty::Pty>, mut rx: broadcast::Receiver<crate::pty::Chunk>, out: mpsc::Sender<ServerMsg>) {
    let b64 = base64::engine::general_purpose::STANDARD;
    loop {
        let first = match rx.recv().await {
            Ok(c) => c,
            Err(broadcast::error::RecvError::Lagged(_)) => {
                // Too slow to keep up: start over from a fresh snapshot.
                let (snapshot, seq, (cols, rows), new_rx) = pty.attach();
                rx = new_rx;
                if out.send(ServerMsg::TermReset { sid: sid.clone(), snapshot, seq, cols, rows }).await.is_err() {
                    return;
                }
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => return,
        };
        // Coalesce whatever else is already queued into one frame.
        let mut buf = first.data.to_vec();
        let mut seq = first.seq;
        let mut lagged = false;
        while buf.len() < 256 * 1024 {
            match rx.try_recv() {
                Ok(c) => {
                    buf.extend_from_slice(&c.data);
                    seq = c.seq;
                }
                Err(broadcast::error::TryRecvError::Lagged(_)) => {
                    lagged = true;
                    break;
                }
                Err(_) => break,
            }
        }
        if out.send(ServerMsg::Term { sid: sid.clone(), seq, d: b64.encode(&buf) }).await.is_err() {
            return;
        }
        if lagged {
            let (snapshot, seq, (cols, rows), new_rx) = pty.attach();
            rx = new_rx;
            if out.send(ServerMsg::TermReset { sid: sid.clone(), snapshot, seq, cols, rows }).await.is_err() {
                return;
            }
        }
    }
}
