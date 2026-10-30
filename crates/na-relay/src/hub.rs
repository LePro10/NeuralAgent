//! WebSocket hub: routes opaque end-to-end envelopes between online devices of the same account,
//! tells devices who is online, and pushes account changes (approval, block) live.
//!
//! Client → relay: `{"t":"auth","token"}` (first frame), `{"t":"route","to","env"}`,
//! `{"t":"visible","v"}` (clients), `{"t":"notify","kind","sid"}` (computers, see push.rs).
//! Relay → client: `ready`, `presence`, `route{from,env}`, `undeliverable{to}`, `account{user}`,
//! `revoked{reason}`.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::Relay;
use crate::db::User;

/// Largest envelope (a terminal snapshot with scrollback fits easily).
const MAX_FRAME: usize = 16 << 20;
/// Per connection: more than this many bytes within 10 s closes it (never reached by normal use).
const BURST_BYTES: usize = 256 << 20;
/// Connections one account may have open at once.
const MAX_CONNS: usize = 32;

enum Out {
    Text(String),
    Close(String),
}

#[derive(Clone)]
struct Peer {
    conn: u64,
    user: String,
    tx: mpsc::Sender<Out>,
    /// Account may route (approved and remote on); updated live.
    routable: bool,
    /// The app is on screen (clients say so); no push then.
    visible: bool,
}

#[derive(Default)]
pub struct Hub {
    peers: Mutex<HashMap<String, Peer>>,
    next: AtomicU64,
}

impl Hub {
    /// Connected and showing the app: it sees attention itself.
    pub fn on_screen(&self, device: &str) -> bool {
        self.peers.lock().get(device).is_some_and(|p| p.visible)
    }

    pub fn online(&self, device: &str) -> bool {
        self.peers.lock().contains_key(device)
    }

    fn send(&self, device: &str, text: String) -> bool {
        let mut peers = self.peers.lock();
        let Some(p) = peers.get(device) else { return false };
        match p.tx.try_send(Out::Text(text)) {
            Ok(()) => true,
            Err(_) => {
                // Too slow to keep up (or gone): drop it; it reconnects and resyncs.
                let _ = p.tx.try_send(Out::Close("too slow".into()));
                peers.remove(device);
                false
            }
        }
    }

    fn to_user(&self, user: &str, text: &str) {
        let ids: Vec<String> = self.peers.lock().iter().filter(|(_, p)| p.user == user).map(|(id, _)| id.clone()).collect();
        for id in ids {
            self.send(&id, text.to_string());
        }
    }

    pub fn kick_device(&self, device: &str, reason: &str) {
        if let Some(p) = self.peers.lock().remove(device) {
            let _ = p.tx.try_send(Out::Close(reason.into()));
        }
    }

    pub fn kick_user(&self, user: &str, reason: &str) {
        self.peers.lock().retain(|_, p| {
            if p.user == user {
                let _ = p.tx.try_send(Out::Close(reason.into()));
                false
            } else {
                true
            }
        });
    }

    /// Live account update (approved, denied, remote on/off).
    pub fn user_changed(&self, user: &User) {
        for p in self.peers.lock().values_mut().filter(|p| p.user == user.id) {
            p.routable = user.can_route();
        }
        self.to_user(&user.id, &json!({ "t": "account", "user": user }).to_string());
    }

    /// The account's devices with their online state (and keys, so hosts can check clients).
    pub fn device_list(&self, relay: &Relay, user: &str) -> Vec<Value> {
        relay
            .db
            .devices(user)
            .unwrap_or_default()
            .into_iter()
            .map(|d| {
                let online = self.online(&d.id);
                let mut v = serde_json::to_value(&d).unwrap_or_default();
                v["online"] = online.into();
                v
            })
            .collect()
    }

    pub fn presence(&self, relay: &Relay, user: &str) {
        let msg = json!({ "t": "presence", "devices": self.device_list(relay, user) }).to_string();
        self.to_user(user, &msg);
    }

    pub fn connections(&self) -> usize {
        self.peers.lock().len()
    }

    pub fn online_by_user(&self) -> HashMap<String, usize> {
        let mut m = HashMap::new();
        for p in self.peers.lock().values() {
            *m.entry(p.user.clone()).or_default() += 1;
        }
        m
    }
}

pub async fn upgrade(State(r): State<Arc<Relay>>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(MAX_FRAME).on_upgrade(move |s| serve(r, s))
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum In {
    Auth {
        token: String,
    },
    Route {
        to: String,
        env: String,
    },
    /// Client: the app went to the background (false) or came back (true).
    Visible {
        v: bool,
    },
    /// Host: a session needs attention; the relay wakes the account's other devices.
    Notify(crate::push::Notice),
}

async fn serve(r: Arc<Relay>, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let first = tokio::time::timeout(Duration::from_secs(10), stream.next()).await;
    let auth = match first {
        Ok(Some(Ok(Message::Text(t)))) => match serde_json::from_str::<In>(&t) {
            Ok(In::Auth { token }) => r.authenticate(&token),
            _ => return,
        },
        _ => return,
    };
    let a = match auth {
        Ok(a) => a,
        Err(e) => {
            let _ = sink.send(Message::Text(json!({ "t": "revoked", "reason": e.1 }).to_string().into())).await;
            let _ = sink.send(Message::Close(None)).await;
            return;
        }
    };
    let (device, user) = (a.device.id.clone(), a.user.id.clone());
    let (tx, mut rx) = mpsc::channel::<Out>(1024);
    let conn = r.hub.next.fetch_add(1, Ordering::Relaxed);
    let full = {
        let mut peers = r.hub.peers.lock();
        let full = peers.values().filter(|p| p.user == user).count() >= MAX_CONNS && !peers.contains_key(&device);
        if !full
            && let Some(old) = peers.insert(
                device.clone(),
                Peer { conn, user: user.clone(), tx: tx.clone(), routable: a.user.can_route(), visible: a.device.kind == "client" },
            )
        {
            let _ = old.tx.try_send(Out::Close("signed in again elsewhere".into()));
        }
        full
    };
    if full {
        let _ = sink.send(Message::Text(json!({ "t": "revoked", "reason": "too many connections" }).to_string().into())).await;
        let _ = sink.send(Message::Close(None)).await;
        return;
    }
    let _ = r.db.bump("connections", 1);
    let _ = r.db.seen(&device, 0);
    let _ = tx.try_send(Out::Text(json!({ "t": "ready", "device": device, "user": a.user }).to_string()));
    r.hub.presence(&r, &user);

    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(Duration::from_secs(25));
        loop {
            tokio::select! {
                m = rx.recv() => match m {
                    Some(Out::Text(t)) => if sink.send(Message::Text(t.into())).await.is_err() { break },
                    Some(Out::Close(reason)) => {
                        let _ = sink.send(Message::Text(json!({ "t": "revoked", "reason": reason }).to_string().into())).await;
                        let _ = sink.send(Message::Close(None)).await;
                        break;
                    }
                    None => break,
                },
                _ = ping.tick() => if sink.send(Message::Ping(Default::default())).await.is_err() { break },
            }
        }
    });

    let mut bytes: i64 = 0;
    let (mut window, mut in_window) = (Instant::now(), 0usize);
    loop {
        let msg = match tokio::time::timeout(Duration::from_secs(90), stream.next()).await {
            Ok(Some(Ok(m))) => m,
            _ => break,
        };
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        if window.elapsed() > Duration::from_secs(10) {
            (window, in_window) = (Instant::now(), 0);
        }
        in_window += text.len();
        bytes += text.len() as i64;
        if in_window > BURST_BYTES {
            let _ = tx.try_send(Out::Close("too much traffic".into()));
            break;
        }
        let (to, env) = match serde_json::from_str::<In>(&text) {
            Ok(In::Route { to, env }) => (to, env),
            Ok(In::Visible { v }) => {
                if let Some(p) = r.hub.peers.lock().get_mut(&device).filter(|p| p.conn == conn) {
                    p.visible = v;
                }
                continue;
            }
            Ok(In::Notify(mut n)) => {
                let routable = r.hub.peers.lock().get(&device).is_some_and(|p| p.conn == conn && p.routable);
                if a.device.kind == "host" && routable && n.valid() {
                    n.host = device.clone();
                    let (r, user) = (r.clone(), user.clone());
                    tokio::spawn(async move {
                        if let Err(e) = r.push.notify(&r, &user, &n).await {
                            tracing::warn!("push: {e:#}");
                        }
                    });
                }
                continue;
            }
            _ => continue,
        };
        let target = {
            let peers = r.hub.peers.lock();
            let me = peers.get(&device).filter(|p| p.conn == conn);
            match me {
                None => break, // replaced or kicked
                Some(me) if !me.routable => None,
                Some(_) => peers.get(&to).filter(|p| p.user == user).map(|_| to.clone()),
            }
        };
        let delivered = target.is_some_and(|to| r.hub.send(&to, json!({ "t": "route", "from": device, "env": env }).to_string()));
        if !delivered {
            let _ = tx.try_send(Out::Text(json!({ "t": "undeliverable", "to": to }).to_string()));
        }
    }

    {
        let mut peers = r.hub.peers.lock();
        if peers.get(&device).is_some_and(|p| p.conn == conn) {
            peers.remove(&device);
        }
    }
    drop(tx);
    let _ = writer.await;
    let _ = r.db.seen(&device, bytes);
    r.hub.presence(&r, &user);
}
