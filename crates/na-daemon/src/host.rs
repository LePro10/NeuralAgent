//! The host as seen from remote devices (D42): voice models and update checks live in the
//! daemon (they work with the desktop app closed); what only the desktop app can do (voice
//! hotkey and wake word, installing an update) is forwarded to it while it is connected.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use na_protocol::{ApiError, ErrorCode, Event, HostUpdate, ModelInfo, ServerMsg};
use na_voice::download;
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::core::{Core, err};

type Reply = Result<Value, String>;

#[derive(Default)]
pub struct Host {
    /// The connected desktop app: connection id and its outgoing channel.
    ui: Mutex<Option<(u64, mpsc::Sender<ServerMsg>)>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next: AtomicU64,
    /// Downloads in progress (0..1) and the last failure per model.
    models: Mutex<HashMap<String, Result<f32, String>>>,
}

impl Host {
    pub fn register(&self, conn: u64, out: mpsc::Sender<ServerMsg>, on: bool) {
        let mut g = self.ui.lock();
        if on {
            *g = Some((conn, out));
        } else if g.as_ref().is_some_and(|(c, _)| *c == conn) {
            *g = None;
            // Calls waiting for the app that went away fail at once.
            self.pending.lock().clear();
        }
    }

    pub fn reply(&self, call: u64, r: Reply) {
        if let Some(tx) = self.pending.lock().remove(&call) {
            let _ = tx.send(r);
        }
    }

    pub fn ui_running(&self) -> bool {
        self.ui.lock().as_ref().is_some_and(|(_, tx)| !tx.is_closed())
    }

    /// Asks the desktop app to do `op`.
    pub async fn call(&self, op: &str, args: Option<Value>, wait: Duration) -> Result<Value, ApiError> {
        let out = self
            .ui
            .lock()
            .as_ref()
            .map(|(_, o)| o.clone())
            .ok_or_else(|| err(ErrorCode::Unavailable, "The NeuralAgent app is not open on the host computer"))?;
        let call = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(call, tx);
        if out.send(ServerMsg::HostCall { call, op: op.into(), args }).await.is_err() {
            self.pending.lock().remove(&call);
            return Err(err(ErrorCode::Unavailable, "The NeuralAgent app is not open on the host computer"));
        }
        match tokio::time::timeout(wait, rx).await {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(e))) => Err(err(ErrorCode::Unavailable, e)),
            Ok(Err(_)) => Err(err(ErrorCode::Unavailable, "The NeuralAgent app on the host closed")),
            Err(_) => {
                self.pending.lock().remove(&call);
                Err(err(ErrorCode::Unavailable, "The NeuralAgent app on the host did not answer"))
            }
        }
    }
}

impl Core {
    pub fn models_list(&self) -> Vec<ModelInfo> {
        let root = self.paths.root.join("models");
        let state = self.host_ctl.models.lock();
        download::SPECS
            .iter()
            .map(|s| {
                let (progress, error) = match state.get(s.id) {
                    Some(Ok(p)) => (Some(*p), None),
                    Some(Err(e)) => (None, Some(e.clone())),
                    None => (None, None),
                };
                ModelInfo {
                    id: s.id.into(),
                    name: s.name.into(),
                    purpose: s.purpose.into(),
                    size: s.size,
                    installed: download::path(&root, s.id).is_some(),
                    progress,
                    error,
                }
            })
            .collect()
    }

    fn models_notice(&self) {
        self.emit(Event::HostNotice { topic: "models".into(), data: json!(self.models_list()) });
    }

    pub fn model_download(self: &Arc<Self>, id: &str) -> Result<(), ApiError> {
        let spec = download::spec(id).ok_or_else(|| err(ErrorCode::NotFound, "unknown model"))?;
        let root = self.paths.root.join("models");
        if download::path(&root, id).is_some() {
            return Ok(());
        }
        {
            let mut models = self.host_ctl.models.lock();
            if matches!(models.get(id), Some(Ok(_))) {
                return Ok(()); // already running
            }
            models.insert(id.into(), Ok(0.0));
        }
        self.models_notice();
        let core = self.clone();
        std::thread::spawn(move || {
            let c = core.clone();
            let result = download::download(&root, spec, move |p| {
                c.host_ctl.models.lock().insert(spec.id.into(), Ok(p));
                c.models_notice();
            });
            match result {
                Ok(_) => {
                    core.host_ctl.models.lock().remove(spec.id);
                    core.call_reload();
                }
                Err(e) => {
                    tracing::warn!(model = spec.id, "model download failed: {e:#}");
                    core.host_ctl.models.lock().insert(spec.id.into(), Err(format!("{e:#}")));
                }
            }
            core.models_notice();
        });
        Ok(())
    }

    pub fn model_delete(&self, id: &str) -> Result<(), ApiError> {
        let spec = download::spec(id).ok_or_else(|| err(ErrorCode::NotFound, "unknown model"))?;
        if matches!(self.host_ctl.models.lock().get(id), Some(Ok(_))) {
            return Err(err(ErrorCode::Conflict, "The model is being downloaded"));
        }
        if self.calls.active.lock().is_some() {
            return Err(err(ErrorCode::Conflict, "A call is running"));
        }
        let p = self.paths.root.join("models").join(spec.folder);
        let r = if p.is_dir() { std::fs::remove_dir_all(&p) } else if p.exists() { std::fs::remove_file(&p) } else { Ok(()) };
        r.map_err(|e| err(ErrorCode::Internal, format!("could not delete: {e}")))?;
        self.host_ctl.models.lock().remove(id);
        self.call_reload();
        self.models_notice();
        Ok(())
    }

    /// Asks the update server (like the desktop app does) whether a newer app exists.
    pub async fn update_check(&self) -> Result<HostUpdate, ApiError> {
        let service = env!("CARGO_PKG_VERSION").to_string();
        let app_running = self.host_ctl.ui_running();
        let current = if app_running {
            match self.host_ctl.call("update.versions", None, Duration::from_secs(3)).await {
                Ok(v) => v.get("app").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| service.clone()),
                Err(_) => service.clone(),
            }
        } else {
            service.clone()
        };
        let base = std::env::var("NEURALAGENT_UPDATE_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| "https://agent.neuralhub.dev".into());
        let target = match std::env::consts::OS {
            "macos" => "darwin",
            o => o,
        };
        let arch = std::env::consts::ARCH;
        let url = format!("{}/api/update/{target}/{arch}/{current}", base.trim_end_matches('/'));
        let res = reqwest::Client::new()
            .get(url)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| err(ErrorCode::Unavailable, format!("update server not reachable: {e}")))?;
        let mut out = HostUpdate { available: None, notes: None, current, service, app_running };
        if res.status() == reqwest::StatusCode::OK {
            let v: Value = res.json().await.map_err(|e| err(ErrorCode::Unavailable, format!("bad answer: {e}")))?;
            out.available = v.get("version").and_then(Value::as_str).map(str::to_string);
            out.notes = v.get("notes").and_then(Value::as_str).map(str::to_string);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn forwards_to_the_ui_and_fails_without_one() {
        let h = Host::default();
        let e = h.call("voice.status", None, Duration::from_millis(50)).await.unwrap_err();
        assert!(e.message.contains("not open"));

        let (tx, mut rx) = mpsc::channel(4);
        h.register(1, tx, true);
        assert!(h.ui_running());
        let h = Arc::new(h);
        let h2 = h.clone();
        let t = tokio::spawn(async move { h2.call("update.install", Some(json!({"a": 1})), Duration::from_secs(2)).await });
        let Some(ServerMsg::HostCall { call, op, args }) = rx.recv().await else { panic!("no call") };
        assert_eq!(op, "update.install");
        assert_eq!(args, Some(json!({"a": 1})));
        h.reply(call, Ok(json!("done")));
        assert_eq!(t.await.unwrap().unwrap(), json!("done"));

        // A reply from the app failing is passed on; unregistering another connection changes nothing.
        let h2 = h.clone();
        let t = tokio::spawn(async move { h2.call("x", None, Duration::from_secs(2)).await });
        let Some(ServerMsg::HostCall { call, .. }) = rx.recv().await else { panic!() };
        h.register(2, mpsc::channel(1).0, false);
        assert!(h.ui_running());
        h.reply(call, Err("nope".into()));
        assert_eq!(t.await.unwrap().unwrap_err().message, "nope");
        h.register(1, mpsc::channel(1).0, false);
        assert!(!h.ui_running());
    }
}

#[cfg(test)]
mod core_tests {
    use super::*;
    use na_protocol::{ClientInfo, ClientKind, Request};

    fn core() -> Arc<Core> {
        let root = std::env::temp_dir().join(format!("na-host-test-{}-{}", std::process::id(), rand::random::<u32>()));
        std::fs::create_dir_all(&root).unwrap();
        let env = crate::env::LoginEnv { vars: Default::default(), shell: "/bin/sh".into(), home: root.clone() };
        Core::load(crate::paths::Paths { root }, env)
    }

    fn client(kind: ClientKind) -> ClientInfo {
        ClientInfo { kind, name: "t".into(), device_id: None }
    }

    #[tokio::test]
    async fn owner_devices_manage_models_and_neural_may_not() {
        let core = core();
        let list = core.handle(&client(ClientKind::Web), Request::HostModels).await.unwrap();
        assert_eq!(list.as_array().unwrap().len(), download::SPECS.len());
        assert!(list.as_array().unwrap().iter().all(|m| m["installed"] == false));

        // An installed model can be deleted from a phone; unknown ids are refused.
        let dir = core.paths.root.join("models").join(download::spec("vad").unwrap().folder);
        std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
        std::fs::write(&dir, b"x").unwrap();
        assert_eq!(core.models_list().iter().find(|m| m.id == "vad").unwrap().installed, true);
        core.handle(&client(ClientKind::Android), Request::HostModelDelete { id: "vad".into() }).await.unwrap();
        assert!(!dir.exists());
        let e = core.handle(&client(ClientKind::Web), Request::HostModelDelete { id: "nope".into() }).await.unwrap_err();
        assert_eq!(e.code, ErrorCode::NotFound);

        for r in [Request::HostModels, Request::HostUi { op: "update.install".into(), args: None }, Request::HostUpdateCheck] {
            let e = core.handle(&client(ClientKind::Orchestrator), r).await.unwrap_err();
            assert_eq!(e.code, ErrorCode::Forbidden);
        }
        // Without the desktop app the app-only operations fail clearly, not silently.
        let e = core.handle(&client(ClientKind::Web), Request::HostUi { op: "voice.status".into(), args: None }).await.unwrap_err();
        assert!(e.message.contains("not open"));
        // Only the desktop may report host notices.
        let n = Request::HostNotice { topic: "voice".into(), data: json!({}) };
        assert_eq!(core.handle(&client(ClientKind::Web), n.clone()).await.unwrap_err().code, ErrorCode::Forbidden);
        core.handle(&client(ClientKind::Desktop), n).await.unwrap();
    }
}
