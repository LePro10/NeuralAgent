//! Connectors (D87, docs/notes/autopilot.md): registry of built-in and user connectors, the
//! supervisor that keeps their MCP servers running, the stdio MCP client, the browser bridge, the
//! conformance check and the builder. The autopilot only talks to the [`Hub`].

pub mod browser;
pub mod builder;
pub mod check;
pub mod embedded;
pub mod log;
pub mod manifest;
pub mod mcp_client;
pub mod store;
pub mod supervisor;
pub mod virt;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use na_protocol::{Connector, ConnectorManifest, ConnectorStatus, ConnectorTool, ErrorCode, FieldKind, Id};
use parking_lot::Mutex;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::core::{Core, err};
use log::Log;
use mcp_client::{McpClient, ToolOutput};
use store::{Saved, SavedMap, Secrets};
use supervisor::LaunchSpec;

/// An event a connector reported (push) or returned from its poll tool.
#[derive(Debug, Clone)]
pub struct ConnEvent {
    pub connector: Id,
    pub event: Value,
}

struct Def {
    manifest: ConnectorManifest,
    builtin: bool,
    /// Runs inside the daemon (browser, reddit).
    virt: bool,
    dir: PathBuf,
    /// connector.json could not be read: shown as an error.
    broken: Option<String>,
}

pub struct Rt {
    pub status: ConnectorStatus,
    pub error: Option<String>,
    pub tools: Vec<ConnectorTool>,
    pub schemas: BTreeMap<String, Value>,
    pub client: Option<Arc<McpClient>>,
    cancel: Option<CancellationToken>,
    log: Arc<Log>,
    /// The last build or change did not pass the check (what was wrong).
    pub build_failed: Option<String>,
}

impl Default for Rt {
    fn default() -> Self {
        Rt {
            status: ConnectorStatus::Off,
            error: None,
            tools: vec![],
            schemas: BTreeMap::new(),
            client: None,
            cancel: None,
            log: Default::default(),
            build_failed: None,
        }
    }
}

struct Entry {
    def: Def,
    saved: Saved,
    rt: Rt,
}

#[derive(Default)]
struct Inner {
    entries: BTreeMap<Id, Entry>,
    secrets: Secrets,
}

pub struct Hub {
    inner: Mutex<Inner>,
    tx: mpsc::UnboundedSender<ConnEvent>,
    rx: Mutex<Option<mpsc::UnboundedReceiver<ConnEvent>>>,
    pub bridge: browser::Bridge,
}

impl Default for Hub {
    fn default() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Hub { inner: Default::default(), tx, rx: Mutex::new(Some(rx)), bridge: Default::default() }
    }
}

fn builtin_dir(root: &Path, id: &str) -> PathBuf {
    root.join("connectors").join("builtin").join(id)
}

/// All connector definitions on disk and embedded.
fn scan(root: &Path) -> BTreeMap<Id, Def> {
    let mut out = BTreeMap::new();
    for b in embedded::JS {
        let text = b.files.iter().find(|(p, _)| *p == "connector.json").map(|(_, c)| *c).unwrap_or("{}");
        match manifest::parse(text) {
            Ok(m) => {
                out.insert(b.id.to_string(), Def { manifest: m, builtin: true, virt: false, dir: builtin_dir(root, b.id), broken: None });
            }
            Err(e) => tracing::error!("built-in connector {}: {e:#}", b.id),
        }
    }
    for (id, text) in embedded::VIRTUAL {
        if let Ok(m) = manifest::parse(text) {
            out.insert(id.to_string(), Def { manifest: m, builtin: true, virt: true, dir: builtin_dir(root, id), broken: None });
        }
    }
    if let Ok(rd) = std::fs::read_dir(root.join("connectors")) {
        for e in rd.flatten() {
            let id = e.file_name().to_string_lossy().into_owned();
            let dir = e.path();
            if !dir.is_dir() || !store::valid_id(&id) || out.contains_key(&id) {
                continue;
            }
            let file = dir.join("connector.json");
            let Ok(text) = std::fs::read_to_string(&file) else { continue };
            let def = match manifest::parse(&text) {
                Ok(m) => Def { manifest: m, builtin: false, virt: false, dir, broken: None },
                Err(e) => Def {
                    manifest: ConnectorManifest { name: id.clone(), ..Default::default() },
                    builtin: false,
                    virt: false,
                    dir,
                    broken: Some(format!("{e:#}")),
                },
            };
            out.insert(id, def);
        }
    }
    out
}

impl Hub {
    /// Writes the embedded connectors, reads what is on disk and starts what is ready.
    pub fn init(&self, core: &Arc<Core>) {
        let root = &core.paths.root;
        if let Err(e) = embedded::install(root) {
            tracing::warn!("connectors: cannot write the built-in ones: {e:#}");
        }
        {
            let mut g = self.inner.lock();
            g.secrets = store::load_secrets(root);
        }
        self.reload(core, store::load_saved(root));
        // A build agent from before the restart is gone.
        let ids: Vec<Id> = self.inner.lock().entries.keys().cloned().collect();
        for id in ids {
            let sid = self.inner.lock().entries.get(&id).and_then(|e| e.saved.build_session.clone());
            if let Some(sid) = sid
                && !core.read(|s| s.sessions.get(&sid).is_some_and(|x| x.alive))
            {
                self.mutate_saved(core, &id, |s| s.build_session = None);
            }
        }
        self.start_all(core);
        self.publish(core);
        browser::start(core);
    }

    /// Re-reads the folders; keeps saved values and running connectors.
    pub fn reload(&self, core: &Core, saved: SavedMap) {
        let defs = scan(&core.paths.root);
        let mut g = self.inner.lock();
        let mut old = std::mem::take(&mut g.entries);
        for (id, def) in defs {
            let entry = match old.remove(&id) {
                Some(mut e) => {
                    e.def = def;
                    e
                }
                None => {
                    let s = saved.get(&id).cloned().unwrap_or(Saved { enabled: def.virt, ..Default::default() });
                    Entry { def, saved: s, rt: Rt::default() }
                }
            };
            g.entries.insert(id, entry);
        }
        // Entries whose folder is gone stop.
        for (_, e) in old {
            if let Some(c) = e.rt.cancel {
                c.cancel();
            }
        }
    }

    pub fn rescan(&self, core: &Arc<Core>) {
        let saved = self.saved_map();
        self.reload(core, saved);
        self.start_all(core);
        self.publish(core);
    }

    fn saved_map(&self) -> SavedMap {
        self.inner.lock().entries.iter().map(|(k, e)| (k.clone(), e.saved.clone())).collect()
    }

    fn persist(&self, root: &Path) {
        if let Err(e) = store::save_saved(root, &self.saved_map()) {
            tracing::warn!("connectors.json: {e:#}");
        }
    }

    fn mutate_saved(&self, core: &Core, id: &str, f: impl FnOnce(&mut Saved)) {
        if let Some(e) = self.inner.lock().entries.get_mut(id) {
            f(&mut e.saved);
        }
        self.persist(&core.paths.root);
    }

    pub fn set_build_session(&self, core: &Arc<Core>, id: &str, sid: Option<Id>) {
        self.mutate_saved(core, id, |s| s.build_session = sid);
        self.publish(core);
    }

    pub fn set_build_failed(&self, core: &Arc<Core>, id: &str, why: Option<String>) {
        if let Some(e) = self.inner.lock().entries.get_mut(id) {
            e.rt.build_failed = why;
        }
        self.publish(core);
    }

    pub fn build_session(&self, id: &str) -> Option<Id> {
        self.inner.lock().entries.get(id).and_then(|e| e.saved.build_session.clone())
    }

    fn secrets_set(g: &Inner, id: &str) -> Vec<String> {
        g.secrets.get(id).map(|m| m.iter().filter(|(_, v)| !v.is_empty()).map(|(k, _)| k.clone()).collect()).unwrap_or_default()
    }

    fn status_of(&self, g: &Inner, id: &str, e: &Entry) -> (ConnectorStatus, Option<String>) {
        if e.def.broken.is_some() {
            return (ConnectorStatus::Error, e.def.broken.clone());
        }
        if e.saved.build_session.is_some() {
            return (ConnectorStatus::Building, None);
        }
        if let Some(f) = &e.rt.build_failed {
            return (ConnectorStatus::Error, Some(f.clone()));
        }
        let missing = manifest::missing(&e.def.manifest, &e.saved.config, &Self::secrets_set(g, id));
        if !missing.is_empty() {
            return (ConnectorStatus::NeedsSetup, Some(format!("Still needed: {}", missing.join(", "))));
        }
        if !e.saved.enabled {
            return (ConnectorStatus::Off, None);
        }
        if e.def.virt {
            return match (id, self.bridge.connected()) {
                ("browser" | "reddit", true) => (ConnectorStatus::Running, None),
                _ => {
                    (ConnectorStatus::NeedsSetup, Some("The browser extension is not connected. Pair it on the Browser connector.".into()))
                }
            };
        }
        (e.rt.status, e.rt.error.clone())
    }

    fn view(&self, g: &Inner, id: &str, e: &Entry) -> Connector {
        let (status, error) = self.status_of(g, id, e);
        let tools: Vec<ConnectorTool> = if e.def.virt || e.rt.tools.is_empty() {
            let mut t: Vec<ConnectorTool> = e
                .def
                .manifest
                .tools
                .iter()
                .map(|(n, c)| ConnectorTool { name: n.clone(), description: String::new(), class: *c })
                .collect();
            if !e.def.virt {
                // Not running yet: the manifest's list is what we know.
                t.sort_by(|a, b| a.name.cmp(&b.name));
            }
            t
        } else {
            e.rt.tools.clone()
        };
        Connector {
            id: id.to_string(),
            manifest: e.def.manifest.clone(),
            builtin: e.def.builtin,
            enabled: e.saved.enabled,
            status,
            error,
            config: e.saved.config.clone(),
            secrets_set: Self::secrets_set(g, id),
            tools,
            build_session: e.saved.build_session.clone(),
            path: e.def.dir.to_string_lossy().into_owned(),
        }
    }

    pub fn list(&self) -> Vec<Connector> {
        let g = self.inner.lock();
        // Built-in first (in the order of the notes), then the user's.
        let order = ["discord", "github", "browser", "reddit", "feed", "web-api"];
        let mut v: Vec<Connector> = g.entries.iter().map(|(id, e)| self.view(&g, id, e)).collect();
        v.sort_by_key(|c| (!c.builtin, order.iter().position(|o| *o == c.id).unwrap_or(99), c.id.clone()));
        v
    }

    pub fn get(&self, id: &str) -> Option<Connector> {
        let g = self.inner.lock();
        g.entries.get(id).map(|e| self.view(&g, id, e))
    }

    pub fn manifest(&self, id: &str) -> Option<ConnectorManifest> {
        self.inner.lock().entries.get(id).map(|e| e.def.manifest.clone())
    }

    pub fn exists(&self, id: &str) -> bool {
        self.inner.lock().entries.contains_key(id)
    }

    /// Pushes the connector list and the browser link into the autopilot state (clients get a
    /// notice when something changed).
    pub fn publish(&self, core: &Core) {
        let list = self.list();
        let link = self.bridge.link();
        core.autopilot_update(|a| {
            a.connectors = list;
            a.browser = link;
        });
    }

    pub fn set_rt(&self, core: &Core, id: &str, f: impl FnOnce(&mut Rt)) {
        if let Some(e) = self.inner.lock().entries.get_mut(id) {
            f(&mut e.rt);
        }
        self.publish(core);
    }

    pub fn log(&self, id: &str) -> Option<Arc<Log>> {
        self.inner.lock().entries.get(id).map(|e| e.rt.log.clone())
    }

    pub fn logs(&self, id: &str) -> Vec<String> {
        self.log(id).map(|l| l.lines()).unwrap_or_default()
    }

    /// The launch description of a connector, with its log.
    pub fn spec(&self, root: &Path, id: &str) -> Option<(LaunchSpec, Arc<Log>)> {
        let g = self.inner.lock();
        let e = g.entries.get(id)?;
        let spec = LaunchSpec {
            id: id.to_string(),
            dir: e.def.dir.clone(),
            state_dir: root.join("connector-state").join(id),
            manifest: e.def.manifest.clone(),
            config: e.saved.config.clone(),
            secrets: g.secrets.get(id).cloned().unwrap_or_default(),
        };
        Some((spec, e.rt.log.clone()))
    }

    /// Takes the receiver of connector events (once; the autopilot runtime does).
    pub fn take_events(&self) -> Option<mpsc::UnboundedReceiver<ConnEvent>> {
        self.rx.lock().take()
    }

    /// Called by the supervisor for each event notification.
    pub fn forward(&self, id: &str, event: Value) {
        let _ = self.tx.send(ConnEvent { connector: id.to_string(), event });
    }

    pub fn inject(&self, id: &str, event: Value) {
        self.forward(id, event);
    }

    // ───────────── running ─────────────

    fn should_run(&self, g: &Inner, id: &str, e: &Entry) -> bool {
        !e.def.virt
            && e.def.broken.is_none()
            && e.saved.enabled
            && e.saved.build_session.is_none()
            && manifest::missing(&e.def.manifest, &e.saved.config, &Self::secrets_set(g, id)).is_empty()
            && e.def
                .dir
                .join(match &e.def.manifest.run {
                    Some(_) => "connector.json",
                    None => "index.mjs",
                })
                .exists()
    }

    pub fn start_all(&self, core: &Arc<Core>) {
        let ids: Vec<Id> = self.inner.lock().entries.keys().cloned().collect();
        for id in ids {
            self.sync_one(core, &id);
        }
    }

    /// Starts or stops one connector to match its state (no restart of a running one).
    pub fn sync_one(&self, core: &Arc<Core>, id: &str) {
        let mut g = self.inner.lock();
        let run = match g.entries.get(id) {
            Some(e) => self.should_run(&g, id, e),
            None => return,
        };
        let Some(e) = g.entries.get_mut(id) else { return };
        let running = e.rt.cancel.as_ref().is_some_and(|c| !c.is_cancelled());
        // An Error state ends its supervision loop; starting again needs a fresh token.
        let dead = matches!(e.rt.status, ConnectorStatus::Error);
        if run && (!running || dead) {
            if let Some(c) = e.rt.cancel.take() {
                c.cancel();
            }
            let token = CancellationToken::new();
            e.rt.cancel = Some(token.clone());
            e.rt.status = ConnectorStatus::Starting;
            e.rt.error = None;
            tokio::spawn(supervisor::supervise(core.clone(), id.to_string(), token));
        } else if !run && let Some(c) = e.rt.cancel.take() {
            c.cancel();
            e.rt.status = ConnectorStatus::Off;
            e.rt.error = None;
            e.rt.client = None;
            e.rt.tools.clear();
        }
    }

    /// Stops and starts it again (new setup values, a changed file).
    pub fn restart(&self, core: &Arc<Core>, id: &str) {
        if let Some(e) = self.inner.lock().entries.get_mut(id)
            && let Some(c) = e.rt.cancel.take()
        {
            c.cancel();
            e.rt.client = None;
            e.rt.tools.clear();
            e.rt.schemas.clear();
            e.rt.status = ConnectorStatus::Off;
        }
        self.sync_one(core, id);
        self.publish(core);
    }

    pub fn stop_all(&self) {
        for e in self.inner.lock().entries.values_mut() {
            if let Some(c) = e.rt.cancel.take() {
                c.cancel();
            }
        }
    }

    // ───────────── requests ─────────────

    pub fn configure(
        &self,
        core: &Arc<Core>,
        id: &str,
        config: BTreeMap<String, Value>,
        secrets: BTreeMap<String, String>,
    ) -> Result<Connector, na_protocol::ApiError> {
        let Some(m) = self.manifest(id) else { return Err(err(ErrorCode::NotFound, "no such connector")) };
        for k in config.keys() {
            if !m.setup.iter().any(|f| &f.key == k && f.kind != FieldKind::Secret) {
                return Err(err(ErrorCode::BadRequest, format!("\"{k}\" is not a setup field of {}", m.name)));
            }
        }
        for k in secrets.keys() {
            if !m.setup.iter().any(|f| &f.key == k && f.kind == FieldKind::Secret) {
                return Err(err(ErrorCode::BadRequest, format!("\"{k}\" is not a secret field of {}", m.name)));
            }
        }
        {
            let mut g = self.inner.lock();
            for (k, v) in secrets {
                let m = g.secrets.entry(id.to_string()).or_default();
                if v.is_empty() {
                    m.remove(&k);
                } else {
                    m.insert(k, v);
                }
            }
            if let Err(e) = store::save_secrets(&core.paths.root, &g.secrets) {
                return Err(err(ErrorCode::Internal, format!("cannot store the secrets: {e:#}")));
            }
        }
        let was_ready = {
            let g = self.inner.lock();
            g.entries.get(id).map(|e| manifest::missing(&e.def.manifest, &e.saved.config, &Self::secrets_set(&g, id)).is_empty())
        };
        self.mutate_saved(core, id, |s| {
            for (k, v) in config {
                if v.is_null() || v.as_str().is_some_and(str::is_empty) {
                    s.config.remove(&k);
                } else {
                    s.config.insert(k, v);
                }
            }
        });
        // The first time everything required is there, switch it on.
        let ready = {
            let g = self.inner.lock();
            g.entries.get(id).map(|e| manifest::missing(&e.def.manifest, &e.saved.config, &Self::secrets_set(&g, id)).is_empty())
        };
        if was_ready == Some(false) && ready == Some(true) {
            self.mutate_saved(core, id, |s| s.enabled = true);
        }
        self.restart(core, id);
        self.get(id).ok_or_else(|| err(ErrorCode::NotFound, "no such connector"))
    }

    pub fn enable(&self, core: &Arc<Core>, id: &str, enabled: bool) -> Result<(), na_protocol::ApiError> {
        if !self.exists(id) {
            return Err(err(ErrorCode::NotFound, "no such connector"));
        }
        self.mutate_saved(core, id, |s| s.enabled = enabled);
        self.restart(core, id);
        Ok(())
    }

    pub fn remove(&self, core: &Arc<Core>, id: &str) -> Result<(), na_protocol::ApiError> {
        let (builtin, dir) = match self.inner.lock().entries.get(id) {
            Some(e) => (e.def.builtin, e.def.dir.clone()),
            None => return Err(err(ErrorCode::NotFound, "no such connector")),
        };
        if builtin {
            return Err(err(ErrorCode::BadRequest, "built-in connectors cannot be removed, only switched off"));
        }
        if let Some(mut e) = self.inner.lock().entries.remove(id)
            && let Some(c) = e.rt.cancel.take()
        {
            c.cancel();
        }
        {
            let mut g = self.inner.lock();
            g.secrets.remove(id);
            let _ = store::save_secrets(&core.paths.root, &g.secrets);
        }
        // Only a folder inside our own connectors folder is deleted.
        if dir.starts_with(core.paths.root.join("connectors")) {
            let _ = std::fs::remove_dir_all(&dir);
        }
        let _ = std::fs::remove_dir_all(core.paths.root.join("connector-state").join(id));
        self.persist(&core.paths.root);
        self.publish(core);
        Ok(())
    }

    /// Calls a tool of a running connector (or of a built-in virtual one).
    pub async fn call_tool(&self, core: &Arc<Core>, id: &str, tool: &str, args: Value, timeout: Duration) -> Result<ToolOutput, String> {
        let (virt, client, status, name) = {
            let g = self.inner.lock();
            let e = g.entries.get(id).ok_or_else(|| format!("no connector \"{id}\""))?;
            let (st, er) = self.status_of(&g, id, e);
            (e.def.virt, e.rt.client.clone(), (st, er), e.def.manifest.name.clone())
        };
        if virt {
            if status.0 != ConnectorStatus::Running {
                return Err(status.1.unwrap_or_else(|| format!("{name} is not ready")));
            }
            return virt::call(core, id, tool, args).await;
        }
        match client {
            Some(c) if !c.is_closed() && status.0 == ConnectorStatus::Running => c.call_tool(tool, args, timeout).await,
            _ => Err(match status {
                (ConnectorStatus::NeedsSetup, Some(e)) => format!("{name} is not set up yet. {e}"),
                (ConnectorStatus::Off, _) => format!("{name} is switched off"),
                (ConnectorStatus::Building, _) => format!("{name} is being built right now"),
                (_, Some(e)) => format!("{name} is not running: {e}"),
                _ => format!("{name} is not running"),
            }),
        }
    }

    /// JSON schema of a tool's arguments (what the running server reported).
    pub fn tool_schema(&self, id: &str, tool: &str) -> Value {
        let g = self.inner.lock();
        match g.entries.get(id) {
            Some(e) if e.def.virt => virt::schema(id, tool),
            Some(e) => {
                e.rt.schemas
                    .get(tool)
                    .filter(|v| v.is_object())
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "type": "object", "properties": {} }))
            }
            None => Value::Null,
        }
    }
}
