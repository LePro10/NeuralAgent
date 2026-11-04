//! The bridge to the NeuralAgent browser extension (docs/notes/autopilot.md → Browser).
//!
//! A WebSocket on `/browser`, reachable only from `chrome-extension://` origins on 127.0.0.1. The
//! daemon's main port changes on every start, so the bridge listens on its own *stable* port
//! (47619, else the next free one up to +19; the port is remembered in `<home>/browser.json` and
//! the pairing code carries it: `NA-<port>-<code>`). `NEURALAGENT_BROWSER_PORT` overrides it.
//!
//! Protocol (JSON text frames): extension → `{t:"pair", code, browser}` → `{t:"paired", token, port}`;
//! later `{t:"hello", token, browser}` → `{t:"ok"}`. Daemon → `{t:"cmd", id, cmd, args}`,
//! extension → `{t:"res", id, ok, data?, error?}`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use axum::extract::State as AxState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use na_protocol::BrowserLink;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::core::Core;
use crate::paths::write_private;

pub const DEFAULT_PORT: u16 = 47619;
const PORT_TRIES: u16 = 20;
pub const PAIR_VALID: Duration = Duration::from_secs(600);
const MAX_ATTEMPTS: u32 = 5;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// A one-time pairing code: valid 10 minutes, five wrong guesses burn it.
#[derive(Default)]
pub struct Pairing {
    code: Option<(String, Instant)>,
    attempts: u32,
}

impl Pairing {
    pub fn issue(&mut self, now: Instant) -> String {
        let code: String = (0..8).map(|_| ALPHABET[(rand::random::<u8>() as usize) % ALPHABET.len()] as char).collect();
        self.code = Some((code.clone(), now));
        self.attempts = 0;
        code
    }

    /// `NA-<port>-<code>` or just `<code>`; case and spaces do not matter. Spends the code on success.
    pub fn verify(&mut self, input: &str, now: Instant) -> bool {
        let Some((code, at)) = self.code.clone() else { return false };
        if now.duration_since(at) > PAIR_VALID {
            self.code = None;
            return false;
        }
        let input = input.trim().to_ascii_uppercase();
        let given = input.rsplit('-').next().unwrap_or("");
        if crate::server::ct_eq(given.as_bytes(), code.as_bytes()) {
            self.code = None;
            return true;
        }
        self.attempts += 1;
        if self.attempts >= MAX_ATTEMPTS {
            self.code = None;
        }
        false
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    port: Option<u16>,
}

struct Conn {
    id: u64,
    tx: mpsc::UnboundedSender<String>,
    browser: String,
}

#[derive(Default)]
struct Inner {
    saved: Saved,
    pairing: Pairing,
    conn: Option<Conn>,
    port: u16,
    next_conn: u64,
}

type Waiting = Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>;

#[derive(Default)]
pub struct Bridge {
    inner: Mutex<Inner>,
    waiting: Waiting,
    next: std::sync::atomic::AtomicU64,
    tab_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

fn file(root: &Path) -> std::path::PathBuf {
    root.join("browser.json")
}

impl Bridge {
    pub fn connected(&self) -> bool {
        self.inner.lock().conn.is_some()
    }

    pub fn link(&self) -> BrowserLink {
        let g = self.inner.lock();
        BrowserLink { connected: g.conn.is_some(), browser: g.conn.as_ref().map(|c| c.browser.clone()) }
    }

    /// A fresh code for the extension popup, `NA-<port>-<code>`.
    pub fn pair_code(&self) -> String {
        let mut g = self.inner.lock();
        let code = g.pairing.issue(Instant::now());
        format!("NA-{}-{}", g.port, code)
    }

    /// Forget the extension: its token stops working and the connection closes.
    pub fn unpair(&self, root: &Path) {
        let mut g = self.inner.lock();
        g.saved.token = None;
        g.conn = None; // dropping the sender ends the socket
        let _ = write_private(&file(root), &serde_json::to_vec(&g.saved).unwrap_or_default());
    }

    /// Sends a command to the extension and waits for its answer (30 s).
    pub async fn command(&self, cmd: &str, args: Value) -> Result<Value, String> {
        // One command at a time per tab.
        let tab = args.get("tab").map(|t| t.to_string()).unwrap_or_default();
        let lock = self.tab_locks.lock().entry(tab).or_default().clone();
        let _g = lock.lock().await;
        let id = format!("c{}", self.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        let sent = {
            let g = self.inner.lock();
            let Some(c) = g.conn.as_ref() else { return Err("The browser extension is not connected".into()) };
            self.waiting.lock().insert(id.clone(), tx);
            c.tx.send(json!({ "t": "cmd", "id": id, "cmd": cmd, "args": args }).to_string()).is_ok()
        };
        if !sent {
            self.waiting.lock().remove(&id);
            return Err("The browser extension is not connected".into());
        }
        match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("The browser extension disconnected".into()),
            Err(_) => {
                self.waiting.lock().remove(&id);
                Err(format!("The browser did not answer `{cmd}` within {} s", COMMAND_TIMEOUT.as_secs()))
            }
        }
    }

    fn resolve(&self, id: &str, r: Result<Value, String>) {
        if let Some(tx) = self.waiting.lock().remove(id) {
            let _ = tx.send(r);
        }
    }

    fn fail_all(&self) {
        for (_, tx) in self.waiting.lock().drain() {
            let _ = tx.send(Err("The browser extension disconnected".into()));
        }
    }
}

/// Binds the bridge port and serves `/browser`.
pub fn start(core: &Arc<Core>) {
    let core = core.clone();
    tokio::spawn(async move {
        let root = core.paths.root.clone();
        let saved: Saved = std::fs::read_to_string(file(&root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let wanted: Vec<u16> = match std::env::var("NEURALAGENT_BROWSER_PORT").ok().and_then(|p| p.parse().ok()) {
            Some(p) => vec![p],
            None => saved.port.into_iter().chain((0..PORT_TRIES).map(|i| DEFAULT_PORT + i)).collect(),
        };
        let mut bound = None;
        for p in wanted {
            if let Ok(l) = tokio::net::TcpListener::bind(("127.0.0.1", p)).await {
                bound = Some(l);
                break;
            }
        }
        let Some(listener) = bound else {
            tracing::warn!("browser bridge: no free port");
            return;
        };
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
        {
            let mut g = core.connectors.bridge.inner.lock();
            g.port = port;
            g.saved = Saved { token: saved.token, port: Some(port) };
            let _ = write_private(&file(&root), &serde_json::to_vec(&g.saved).unwrap_or_default());
        }
        tracing::info!(port, "browser bridge listening");
        let app = Router::new().route("/browser", get(upgrade)).with_state(core.clone());
        let _ = axum::serve(listener, app).await;
    });
}

async fn upgrade(AxState(core): AxState<Arc<Core>>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let origin = headers.get("origin").and_then(|o| o.to_str().ok()).unwrap_or("");
    if !origin.starts_with("chrome-extension://") {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    ws.max_message_size(8 << 20).on_upgrade(move |s| serve(core, s))
}

async fn serve(core: Arc<Core>, socket: WebSocket) {
    let bridge = &core.connectors.bridge;
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(t) = rx.recv().await {
            if sink.send(Message::Text(t.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });
    let reply = |v: Value| {
        let _ = tx.send(v.to_string());
    };
    // First frame: pair or hello.
    let first = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(Ok(m)) = stream.next().await {
            if let Message::Text(t) = m {
                return serde_json::from_str::<Value>(&t).ok();
            }
        }
        None
    })
    .await
    .ok()
    .flatten();
    let Some(first) = first else {
        writer.abort();
        return;
    };
    let browser = first["browser"].as_str().unwrap_or("Chrome").chars().take(80).collect::<String>();
    let ok = match first["t"].as_str() {
        Some("pair") => {
            let good = bridge.inner.lock().pairing.verify(first["code"].as_str().unwrap_or(""), Instant::now());
            if good {
                let token = crate::server::random_token();
                let port = {
                    let mut g = bridge.inner.lock();
                    g.saved.token = Some(token.clone());
                    let _ = write_private(&file(&core.paths.root), &serde_json::to_vec(&g.saved).unwrap_or_default());
                    g.port
                };
                reply(json!({ "t": "paired", "token": token, "port": port }));
                core.audit.note("browser_paired", Some(browser.clone()), true, None);
                true
            } else {
                reply(json!({ "t": "error", "error": "That code is wrong or expired. Press Pair browser in NeuralAgent for a new one." }));
                false
            }
        }
        Some("hello") => {
            let good = {
                let g = bridge.inner.lock();
                g.saved.token.as_ref().is_some_and(|t| crate::server::ct_eq(t.as_bytes(), first["token"].as_str().unwrap_or("").as_bytes()))
            };
            if good {
                reply(json!({ "t": "ok" }));
            } else {
                reply(json!({ "t": "error", "error": "Not paired. Pair this browser again." }));
            }
            good
        }
        _ => false,
    };
    if !ok {
        tokio::time::sleep(Duration::from_millis(200)).await;
        writer.abort();
        return;
    }
    let conn_id = {
        let mut g = bridge.inner.lock();
        g.next_conn += 1;
        let id = g.next_conn;
        // A second browser replaces the first.
        g.conn = Some(Conn { id, tx: tx.clone(), browser });
        id
    };
    core.connectors.publish(&core);
    while let Some(Ok(m)) = stream.next().await {
        let Message::Text(t) = m else {
            if matches!(m, Message::Close(_)) {
                break;
            }
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&t) else { continue };
        if v["t"] == "ping" {
            let _ = tx.send(json!({ "t": "pong" }).to_string());
            continue;
        }
        if v["t"] == "res"
            && let Some(id) = v["id"].as_str()
        {
            let r = if v["ok"].as_bool().unwrap_or(false) {
                Ok(v.get("data").cloned().unwrap_or(Value::Null))
            } else {
                Err(v["error"].as_str().unwrap_or("the browser could not do that").to_string())
            };
            bridge.resolve(id, r);
        }
    }
    {
        let mut g = bridge.inner.lock();
        if g.conn.as_ref().is_some_and(|c| c.id == conn_id) {
            g.conn = None;
        }
    }
    bridge.fail_all();
    writer.abort();
    core.connectors.publish(&core);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_is_one_time_and_expires() {
        let mut p = Pairing::default();
        let t0 = Instant::now();
        let code = p.issue(t0);
        assert_eq!(code.len(), 8);
        // Typed as the full code, lower case, with spaces.
        assert!(p.verify(&format!(" na-47619-{} ", code.to_lowercase()), t0 + Duration::from_secs(5)));
        assert!(!p.verify(&code, t0 + Duration::from_secs(6)), "spent");
        let code = p.issue(t0);
        assert!(!p.verify(&code, t0 + PAIR_VALID + Duration::from_secs(1)), "expired");
    }

    #[test]
    fn wrong_guesses_burn_the_code() {
        let mut p = Pairing::default();
        let t0 = Instant::now();
        let code = p.issue(t0);
        for _ in 0..MAX_ATTEMPTS {
            assert!(!p.verify("WRONGWRG", t0));
        }
        assert!(!p.verify(&code, t0));
    }

    #[test]
    fn pair_code_carries_the_port() {
        let b = Bridge::default();
        b.inner.lock().port = 47620;
        let c = b.pair_code();
        assert!(c.starts_with("NA-47620-") && c.len() == "NA-47620-".len() + 8);
        assert!(!b.connected());
    }

    #[tokio::test]
    async fn commands_need_a_connection_and_get_answers() {
        let b = Arc::new(Bridge::default());
        assert!(b.command("open", json!({ "url": "https://x" })).await.unwrap_err().contains("not connected"));
        let (tx, mut rx) = mpsc::unbounded_channel();
        b.inner.lock().conn = Some(Conn { id: 1, tx, browser: "Test".into() });
        assert_eq!(b.link(), BrowserLink { connected: true, browser: Some("Test".into()) });
        let b2 = b.clone();
        let call = tokio::spawn(async move { b2.command("read", json!({ "tab": 3 })).await });
        let sent: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
        assert_eq!(sent["cmd"], "read");
        assert_eq!(sent["args"]["tab"], 3);
        b.resolve(sent["id"].as_str().unwrap(), Ok(json!({ "title": "T" })));
        assert_eq!(call.await.unwrap().unwrap()["title"], "T");
        // Disconnect fails what is waiting.
        let b2 = b.clone();
        let call = tokio::spawn(async move { b2.command("read", json!({ "tab": 4 })).await });
        let _ = rx.recv().await;
        b.fail_all();
        assert!(call.await.unwrap().unwrap_err().contains("disconnected"));
    }
}
