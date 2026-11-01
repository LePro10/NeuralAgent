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
const ALLOWED_ORIGINS: &[&str] =
    &["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420"];

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
        .route(
            "/health",
            get(|| async { axum::Json(json!({"ok": true, "version": env!("CARGO_PKG_VERSION"), "protocol": PROTOCOL_VERSION})) }),
        )
        .route("/ws", get(ws_upgrade))
        .route("/hook", post(crate::hooks::receive))
        .route("/swarm", post(crate::swarm::receive))
        .route("/auth/callback", get(crate::remote::callback))
        .with_state(app)
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_upgrade(AxState(app): AxState<App>, Query(q): Query<WsQuery>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if let Some(origin) = headers.get("origin").and_then(|o| o.to_str().ok())
        && !ALLOWED_ORIGINS.contains(&origin)
        && !(cfg!(debug_assertions) && std::env::var("NEURALAGENT_DEV_ORIGIN").is_ok_and(|o| o == origin))
    {
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
    let client = match tokio::time::timeout(Duration::from_secs(10), next_msg(&mut stream, &out)).await {
        Ok(Some(ClientMsg::Hello { v, client })) if v == PROTOCOL_VERSION => client,
        _ => {
            writer.abort();
            return;
        }
    };
    tracing::info!(kind = ?client.kind, name = %client.name, "client connected");
    let _ = out
        .send(ServerMsg::HelloOk {
            v: PROTOCOL_VERSION,
            daemon_version: env!("CARGO_PKG_VERSION").into(),
            host: core.host.clone(),
            features: na_protocol::daemon_features(),
        })
        .await;
    run_client(core, client, out, &mut stream).await;
    writer.abort();
}

async fn next_msg(
    stream: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin),
    out: &mpsc::Sender<ServerMsg>,
) -> Option<ClientMsg> {
    while let Some(Ok(m)) = stream.next().await {
        match m {
            Message::Text(t) => match serde_json::from_str(&t) {
                Ok(m) => return Some(m),
                Err(e) => {
                    // Log only what kind of message it was: serde's text can quote field values.
                    let (kind, id) = not_understood(&t);
                    tracing::warn!(kind = %kind, line = e.line(), col = e.column(), "client message not understood: skipped");
                    // A request still gets its answer, so the client does not wait forever.
                    if let Some(id) = id {
                        let _ = out.send(not_understood_res(&kind, id)).await;
                    }
                }
            },
            Message::Close(_) => return None,
            _ => {}
        }
    }
    None
}

/// Transport-independent client loop; the relay client reuses it for remote devices.
pub async fn run_client(
    core: Arc<Core>,
    client: ClientInfo,
    out: mpsc::Sender<ServerMsg>,
    stream: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin),
) {
    let mut conn = Conn {
        core,
        client,
        out,
        state_task: None,
        attached: Arc::new(Mutex::new(HashMap::new())),
        cv: Arc::new(Mutex::new(HashMap::new())),
        call: None,
        id: next_conn_id(),
    };
    while let Some(msg) = next_msg(stream, &conn.out).await {
        conn.on_msg(msg).await;
    }
    conn.close();
}

/// The same loop for clients that arrive over another channel (remote devices via the relay).
pub async fn run_channel(core: Arc<Core>, client: ClientInfo, out: mpsc::Sender<ServerMsg>, rx: &mut mpsc::Receiver<ClientMsg>) {
    match client.kind {
        ClientKind::Android => core.telemetry.count("remote_sessions.android", 1),
        ClientKind::Web => core.telemetry.count("remote_sessions.web", 1),
        _ => {}
    }
    let mut conn = Conn {
        core,
        client,
        out,
        state_task: None,
        attached: Arc::new(Mutex::new(HashMap::new())),
        cv: Arc::new(Mutex::new(HashMap::new())),
        call: None,
        id: next_conn_id(),
    };
    while let Some(msg) = rx.recv().await {
        conn.on_msg(msg).await;
    }
    conn.close();
}

/// Claude view streams by (session, subagent).
type CvStreams = HashMap<(Id, Option<String>), JoinHandle<()>>;

pub struct Conn {
    pub core: Arc<Core>,
    pub client: ClientInfo,
    pub out: mpsc::Sender<ServerMsg>,
    state_task: Option<JoinHandle<()>>,
    attached: Arc<Mutex<HashMap<Id, JoinHandle<()>>>>,
    /// Claude view streams by (session, subagent).
    cv: Arc<Mutex<CvStreams>>,
    call: Option<crate::call::CallHandle>,
    id: u64,
}

fn next_conn_id() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

impl Conn {
    pub async fn on_msg(&mut self, msg: ClientMsg) {
        match msg {
            ClientMsg::Hello { .. } => {}
            ClientMsg::CallStart => {
                if self.client.kind == ClientKind::Orchestrator {
                    return;
                }
                self.call = None;
                self.call = Some(self.core.call_start(self.out.clone()));
            }
            ClientMsg::CallAudio { d } => {
                if let Some(c) = &self.call {
                    c.audio(&d);
                }
            }
            ClientMsg::CallWarm => {
                if self.client.kind != ClientKind::Orchestrator {
                    self.core.call_warm();
                }
            }
            ClientMsg::CallEnd => self.call = None,
            ClientMsg::HostUiRegister { on } => {
                if self.client.kind == ClientKind::Desktop {
                    self.core.host_ctl.register(self.id, self.out.clone(), on);
                }
            }
            ClientMsg::HostUiReply { call, ok, r, error } => {
                if self.client.kind == ClientKind::Desktop {
                    let reply = if ok { Ok(r.unwrap_or(serde_json::Value::Null)) } else { Err(error.unwrap_or_else(|| "failed".into())) };
                    self.core.host_ctl.reply(call, reply);
                }
            }
            ClientMsg::Ping { at } => {
                let _ = self.out.send(ServerMsg::Pong { at }).await;
            }
            ClientMsg::Sub { since } => {
                if let Some(t) = self.state_task.take() {
                    t.abort();
                }
                let sub = self.core.subscribe(since);
                // A snapshot, or (resuming with nothing to replay) a pong after the replay: either
                // tells the client it is live again. Without it a quiet daemon left the client
                // "reconnecting" until the next event.
                let pong = match sub.first {
                    snap @ ServerMsg::Snapshot { .. } => {
                        let _ = self.out.send(snap).await;
                        None
                    }
                    other => Some(other),
                };
                for m in sub.replay {
                    let _ = self.out.send(m).await;
                }
                if let Some(p) = pong {
                    let _ = self.out.send(p).await;
                }
                self.state_task = Some(tokio::spawn(forward_state(self.core.clone(), sub.rx, self.out.clone())));
            }
            ClientMsg::Req { id, req } => match req {
                Request::TermAttach { sid } => {
                    let res = match self.core.pty(&sid) {
                        Ok(pty) => {
                            let (snapshot, seq, (cols, rows), rx) = pty.attach();
                            let _ = self
                                .out
                                .send(ServerMsg::Res {
                                    id,
                                    ok: true,
                                    r: Some(json!(AttachResult { snapshot, seq, cols, rows })),
                                    err: None,
                                })
                                .await;
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
                Request::CvAttach { sid, agent, features } => {
                    // Reading the transcript is file IO: off the async workers.
                    let attached = {
                        let (core, sid, agent) = (self.core.clone(), sid.clone(), agent.clone());
                        tokio::task::spawn_blocking(move || core.cv_attach(&sid, agent.as_deref())).await
                    };
                    let attached = attached.unwrap_or_else(|e| Err(crate::core::err(ErrorCode::Internal, e.to_string())));
                    let msg = match attached {
                        Ok((res, rx)) => {
                            let tasks = features.iter().any(|f| f == "tasks");
                            let task = tokio::spawn(forward_cv(self.core.clone(), sid.clone(), agent.clone(), rx, self.out.clone(), tasks));
                            if let Some(old) = self.cv.lock().insert((sid, agent), task) {
                                old.abort();
                            }
                            ServerMsg::Res { id, ok: true, r: Some(json!(res)), err: None }
                        }
                        Err(e) => ServerMsg::Res { id, ok: false, r: None, err: Some(e) },
                    };
                    let _ = self.out.send(msg).await;
                }
                Request::CvDetach { sid, agent } => {
                    if let Some(t) = self.cv.lock().remove(&(sid, agent)) {
                        t.abort();
                    }
                    let _ = self.out.send(ServerMsg::Res { id, ok: true, r: None, err: None }).await;
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
        self.call = None;
        self.core.host_ctl.register(self.id, self.out.clone(), false);
        if let Some(t) = self.state_task.take() {
            t.abort();
        }
        for (_, t) in self.attached.lock().drain() {
            t.abort();
        }
        for (_, t) in self.cv.lock().drain() {
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

/// Claude view events of one session. A client that falls behind gets a fresh attach result as a
/// reset (plus the prompt and the task list). `tasks`: the client announced the `tasks` event (an
/// older web remote would break on an event kind it does not know).
async fn forward_cv(
    core: Arc<Core>,
    sid: Id,
    agent: Option<String>,
    mut rx: broadcast::Receiver<CvEvent>,
    out: mpsc::Sender<ServerMsg>,
    tasks: bool,
) {
    loop {
        let evs = match rx.recv().await {
            Ok(ev) => vec![ev],
            Err(broadcast::error::RecvError::Lagged(_)) => {
                let (c, s, a) = (core.clone(), sid.clone(), agent.clone());
                match tokio::task::spawn_blocking(move || c.cv_attach(&s, a.as_deref())).await {
                    Ok(Ok((res, new_rx))) => {
                        rx = new_rx;
                        let mut evs = vec![CvEvent::Reset { messages: res.messages, more: res.more, meta: res.meta }];
                        if agent.is_none() {
                            evs.push(CvEvent::Prompt { prompt: res.prompt });
                            evs.push(CvEvent::Tasks { tasks: res.tasks });
                        }
                        evs
                    }
                    _ => return,
                }
            }
            Err(broadcast::error::RecvError::Closed) => return,
        };
        for ev in evs {
            if matches!(ev, CvEvent::Tasks { .. }) && !tasks {
                continue;
            }
            if out.send(ServerMsg::Cv { sid: sid.clone(), ev, agent: agent.clone() }).await.is_err() {
                return;
            }
        }
    }
}

/// The kind of a message that did not parse (`t`, plus the request method for `req`) and, for a
/// request, its id. Only these names are taken (short, plain characters), never field values.
/// The error answer for a request this daemon cannot parse (a newer client), so it never waits.
pub(crate) fn not_understood_res(kind: &str, id: u64) -> ServerMsg {
    let message = format!("This NeuralAgent does not understand the request \"{kind}\" (update NeuralAgent).");
    ServerMsg::Res { id, ok: false, r: None, err: Some(ApiError { code: ErrorCode::BadRequest, message }) }
}

pub(crate) fn not_understood(text: &str) -> (String, Option<u64>) {
    let v: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
    let name = |x: &serde_json::Value| {
        x.as_str().map(|s| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(40).collect::<String>())
    };
    let t = name(&v["t"]).unwrap_or_else(|| "?".into());
    match name(&v["req"]["m"]) {
        Some(m) if t == "req" => (m, v["id"].as_u64()),
        _ => (t, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_messages_are_named_by_kind_only() {
        let (kind, id) = not_understood(r#"{"t":"req","id":7,"req":{"m":"session_start","p":{"cwd":"/secret/path"}}}"#);
        assert_eq!((kind.as_str(), id), ("session_start", Some(7)));
        assert_eq!(not_understood(r#"{"t":"term_in","sid":"x","data":"hunter2"}"#), ("term_in".into(), None));
        assert_eq!(not_understood("not json at all"), ("?".into(), None));
        assert_eq!(not_understood(r#"{"t":"a\"b c<d>"}"#).0, "abcd", "only plain characters");
    }
}
