//! Whole account flow against a real server on a local port, with the test sign-in:
//! request → admin mail → approve → live unlock → pairing → routing, and that a
//! second account can see and reach nothing of the first.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

use crate::config::Config;
use crate::db::Db;
use crate::util::{s256, token};
use crate::{Relay, router};

struct T {
    base: String,
    relay: Arc<Relay>,
    http: reqwest::Client,
}

struct Signed {
    access: String,
    refresh: String,
    device: String,
    user: Value,
}

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

impl T {
    async fn start() -> T {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mut cfg = Config::local(&base);
        cfg.admins = vec!["boss@example.com".into()];
        let relay = Relay::new(cfg, Db::memory().unwrap());
        let app = router(relay.clone()).into_make_service_with_connect_info::<SocketAddr>();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
        T { base, relay, http }
    }

    async fn sign_in(&self, email: &str, kind: &str, message: Option<&str>) -> Signed {
        let verifier = token();
        let redirect = "http://127.0.0.1:4999/auth/callback";
        let res = self
            .http
            .get(format!("{}/auth/test/start", self.base))
            .query(&[("redirect_uri", redirect), ("state", "st"), ("code_challenge", &s256(&verifier)), ("email", email)])
            .send()
            .await
            .unwrap();
        let loc = url::Url::parse(res.headers()["location"].to_str().unwrap()).unwrap();
        let q: std::collections::HashMap<_, _> = loc.query_pairs().into_owned().collect();
        assert_eq!(q["state"], "st");
        // A wrong verifier is refused, and the code is gone afterwards.
        let body = |v: &str| {
            json!({ "code": q["code"], "verifier": v, "redirect_uri": redirect, "message": message,
            "device": { "name": format!("{email} {kind}"), "platform": if kind == "host" { "macos" } else { "android" }, "kind": kind, "pubkey": crate::auth::random_pubkey() } })
        };
        let bad = self.http.post(format!("{}/api/auth/exchange", self.base)).json(&body("nope")).send().await.unwrap();
        assert_eq!(bad.status(), 400);
        // The code was consumed by the failed attempt: sign in again for real.
        let res = self
            .http
            .get(format!("{}/auth/test/start", self.base))
            .query(&[("redirect_uri", redirect), ("state", "st"), ("code_challenge", &s256(&verifier)), ("email", email)])
            .send()
            .await
            .unwrap();
        let loc = url::Url::parse(res.headers()["location"].to_str().unwrap()).unwrap();
        let q: std::collections::HashMap<_, _> = loc.query_pairs().into_owned().collect();
        let body = json!({ "code": q["code"], "verifier": verifier, "redirect_uri": redirect, "message": message,
            "device": { "name": format!("{email} {kind}"), "platform": if kind == "host" { "macos" } else { "android" }, "kind": kind, "pubkey": crate::auth::random_pubkey() } });
        let v: Value = self.http.post(format!("{}/api/auth/exchange", self.base)).json(&body).send().await.unwrap().json().await.unwrap();
        Signed {
            access: v["access"].as_str().unwrap().into(),
            refresh: v["refresh"].as_str().unwrap().into(),
            device: v["device_id"].as_str().unwrap().into(),
            user: v["user"].clone(),
        }
    }

    async fn call(&self, method: reqwest::Method, path: &str, s: &Signed, body: Option<Value>) -> (u16, Value) {
        let mut req = self.http.request(method, format!("{}{path}", self.base)).bearer_auth(&s.access);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    async fn ws(&self, s: &Signed) -> Ws {
        let (mut ws, _) = tokio_tungstenite::connect_async(format!("{}/ws", self.base.replace("http", "ws"))).await.unwrap();
        ws.send(Message::Text(json!({ "t": "auth", "token": s.access }).to_string().into())).await.unwrap();
        let ready = next(&mut ws, "ready").await;
        assert_eq!(ready["device"], s.device.as_str());
        ws
    }
}

/// Next frame of a given type (skipping others), or panics after 3 s.
async fn next(ws: &mut Ws, t: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(m))) => {
                    let v: Value = serde_json::from_str(&m).unwrap();
                    if v["t"] == t {
                        return v;
                    }
                }
                Some(Ok(_)) => {}
                other => panic!("socket ended while waiting for {t}: {other:?}"),
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("no {t} frame"))
}

async fn route(ws: &mut Ws, to: &str, env: &str) {
    ws.send(Message::Text(json!({ "t": "route", "to": to, "env": env }).to_string().into())).await.unwrap();
}

use reqwest::Method;

#[tokio::test]
async fn account_flow_and_isolation() {
    let t = T::start().await;
    let boss = t.sign_in("boss@example.com", "client", None).await;
    assert_eq!(boss.user["status"], "approved");
    assert_eq!(boss.user["is_admin"], true);

    // A request: pending, the admin gets exactly one mail.
    let ann = t.sign_in("ann@example.com", "host", Some("I want my agents on my phone")).await;
    assert_eq!(ann.user["status"], "pending");
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mails = t.relay.mail.sent.lock().clone();
    assert_eq!(mails.iter().filter(|(to, s)| to == "boss@example.com" && s.starts_with("Access request")).count(), 1);

    // Pending: may connect and wait, but cannot pair or route.
    let mut ann_ws = t.ws(&ann).await;
    assert_eq!(t.call(Method::POST, "/api/pair", &ann, None).await.0, 403);
    route(&mut ann_ws, &boss.device, "x").await;
    assert_eq!(next(&mut ann_ws, "undeliverable").await["to"], boss.device.as_str());

    // Admin API: admin accounts only.
    let users = format!("/api/admin/users/{}/approve", ann.user["id"].as_str().unwrap());
    assert_eq!(t.call(Method::GET, "/api/admin/session", &ann, None).await.0, 403);
    assert_eq!(t.call(Method::POST, &users, &ann, None).await.0, 403);
    assert_eq!(t.call(Method::GET, "/api/admin/session", &boss, None).await.0, 200);

    // Approve: Ann's open connection is unlocked live and she gets the "You're in" mail.
    let (st, _) = t.call(Method::POST, &users, &boss, None).await;
    assert_eq!(st, 200);
    let acc = next(&mut ann_ws, "account").await;
    assert_eq!(acc["user"]["status"], "approved");
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(t.relay.mail.sent.lock().iter().any(|(to, s)| to == "ann@example.com" && s.starts_with("You're in")));

    // Add phone: one-time code for Ann's account only.
    let (st, pair) = t.call(Method::POST, "/api/pair", &ann, None).await;
    assert_eq!(st, 200);
    let phone = json!({ "name": "Ann's phone", "platform": "android", "kind": "client", "pubkey": crate::auth::random_pubkey() });
    let redeem = |code: &str| json!({ "code": code, "device": phone });
    let res: Value = t
        .http
        .post(format!("{}/api/pair/redeem", t.base))
        .json(&redeem(pair["code"].as_str().unwrap()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(res["host"]["id"], ann.device.as_str());
    let ann_phone = Signed {
        access: res["tokens"]["access"].as_str().unwrap().into(),
        refresh: res["tokens"]["refresh"].as_str().unwrap().into(),
        device: res["tokens"]["device_id"].as_str().unwrap().into(),
        user: res["tokens"]["user"].clone(),
    };
    assert_eq!(ann_phone.user["email"], "ann@example.com");
    let again = t.http.post(format!("{}/api/pair/redeem", t.base)).json(&redeem(pair["code"].as_str().unwrap())).send().await.unwrap();
    assert_eq!(again.status(), 400, "a code works once");

    // A second, approved user.
    let bob = t.sign_in("bob@example.com", "client", None).await;
    t.call(Method::POST, &format!("/api/admin/users/{}/approve", bob.user["id"].as_str().unwrap()), &boss, None).await;
    // Bob cannot use Ann's code while signed in as Bob.
    let (_, pair2) = t.call(Method::POST, "/api/pair", &ann, None).await;
    let res = t
        .http
        .post(format!("{}/api/pair/redeem", t.base))
        .bearer_auth(&bob.access)
        .json(&redeem(pair2["code"].as_str().unwrap()))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);

    // Routing: Ann's phone reaches Ann's desktop; Bob reaches nothing of Ann.
    let mut phone_ws = t.ws(&ann_phone).await;
    route(&mut phone_ws, &ann.device, "sealed-hello").await;
    let got = next(&mut ann_ws, "route").await;
    assert_eq!((got["from"].as_str().unwrap(), got["env"].as_str().unwrap()), (ann_phone.device.as_str(), "sealed-hello"));
    let mut bob_ws = t.ws(&bob).await;
    let pres = next(&mut bob_ws, "presence").await;
    assert!(pres["devices"].as_array().unwrap().iter().all(|d| d["name"].as_str().unwrap().starts_with("bob")));
    route(&mut bob_ws, &ann.device, "evil").await;
    assert_eq!(next(&mut bob_ws, "undeliverable").await["to"], ann.device.as_str());
    let (_, devs) = t.call(Method::GET, "/api/devices", &bob, None).await;
    assert_eq!(devs["devices"].as_array().unwrap().len(), 1);
    assert_eq!(t.call(Method::DELETE, &format!("/api/devices/{}", ann.device), &bob, None).await.0, 404);

    // Refresh rotates; reusing the old refresh token signs the device out.
    let fresh: Value = t
        .http
        .post(format!("{}/api/auth/refresh", t.base))
        .json(&json!({ "refresh": bob.refresh }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(fresh["refresh"].is_string());
    let reuse = t.http.post(format!("{}/api/auth/refresh", t.base)).json(&json!({ "refresh": bob.refresh })).send().await.unwrap();
    assert_eq!(reuse.status(), 401);
    assert_eq!(next(&mut bob_ws, "revoked").await["reason"].as_str().unwrap(), "signed out: this sign-in was used elsewhere");

    // Block works at once: open connections close, tokens stop working.
    t.call(Method::POST, &format!("/api/admin/users/{}/block", ann.user["id"].as_str().unwrap()), &boss, None).await;
    assert_eq!(next(&mut phone_ws, "revoked").await["reason"], "account blocked");
    assert_eq!(next(&mut ann_ws, "revoked").await["reason"], "account blocked");
    assert_eq!(t.call(Method::GET, "/api/me", &ann_phone, None).await.0, 401);
    let r = t.http.post(format!("{}/api/auth/refresh", t.base)).json(&json!({ "refresh": ann.refresh })).send().await.unwrap();
    assert_eq!(r.status(), 403);

    // Anonymous stats for the dashboard.
    let (_, s) = t.call(Method::GET, "/api/admin/stats", &boss, None).await;
    assert_eq!(s["users"], 2); // boss + bob (ann is blocked)
    assert!(s["days"][0]["connections"].as_i64().unwrap() >= 3);
}

#[tokio::test]
async fn heartbeat_and_slow_peers_are_closed() {
    let t = T::start().await;
    let host = t.sign_in("boss@example.com", "host", None).await;
    let phone = t.sign_in("boss@example.com", "client", None).await;
    let mut host_ws = t.ws(&host).await;
    let mut phone_ws = t.ws(&phone).await;

    // Heartbeat: answered at once, so a client can tell a dead socket from a quiet one.
    phone_ws.send(Message::Text(json!({ "t": "ping" }).to_string().into())).await.unwrap();
    next(&mut phone_ws, "pong").await;

    // The phone stops reading while the computer keeps sending: once its queue is full the relay
    // closes the connection for real (it used to stay open but unrouted, looking alive).
    let env = "x".repeat(32 << 10);
    for _ in 0..3000 {
        route(&mut host_ws, &phone.device, &env).await;
        if !t.relay.hub.online(&phone.device) {
            break;
        }
    }
    assert!(!t.relay.hub.online(&phone.device), "slow peer dropped from routing");
    let ended = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match phone_ws.next().await {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(_)) => {}
            }
        }
    })
    .await;
    assert!(ended.is_ok(), "the slow peer's socket is closed");
}
