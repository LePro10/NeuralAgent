//! The daemon's state and everything that changes it.
//!
//! All mutations go through [`Core::emit`]: the event is applied to the state, numbered, kept in
//! a ring buffer for reconnecting clients and broadcast. Clients apply the same events to their
//! copy (see `packages/protocol/src/apply.ts`), so every window, phone and the orchestrator see
//! the same thing.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use na_protocol::*;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::env::{LoginEnv, STRIP};
use crate::layout;
use crate::paths::{Paths, write_private};
use crate::pty::{Pty, PtyNote, Spawn};

const RING: usize = 2048;

pub fn now_ms() -> Millis {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn err(code: ErrorCode, message: impl Into<String>) -> ApiError {
    ApiError { code, message: message.into() }
}

type ApiResult = std::result::Result<Value, ApiError>;

#[derive(Default, Serialize, Deserialize)]
struct Persisted {
    workspaces: Vec<Workspace>,
    layouts: BTreeMap<Id, WorkspaceLayout>,
    sessions: BTreeMap<Id, Session>,
    /// User-defined profiles only; built-ins are added at startup.
    profiles: Vec<Profile>,
    settings: Settings,
    #[serde(default)]
    mcp: Vec<McpServer>,
    #[serde(default)]
    limits: Vec<UsageLimit>,
    /// Agent working time per local day (`YYYY-MM-DD` → ms), for the usage page.
    #[serde(default)]
    busy_days: BTreeMap<String, i64>,
    /// The conversation with Neural.
    #[serde(default)]
    orchestrator: Vec<OrchMessage>,
    #[serde(default)]
    swarms: Vec<Swarm>,
    #[serde(default)]
    swarm_messages: Vec<SwarmMessage>,
}

/// Runtime data of a live session that is not part of the shared state.
struct Live {
    pty: Arc<Pty>,
    hook_token: String,
    last_output: Option<Instant>,
    working_since: Option<Instant>,
    prompted: bool,
    /// Stopped on request: its exit code is not an error.
    stopped: bool,
}

struct Inner {
    state: State,
    seq: u64,
    ring: VecDeque<(u64, Event)>,
    dirty: bool,
    busy_days: BTreeMap<String, i64>,
}

pub struct Core {
    inner: Mutex<Inner>,
    events: broadcast::Sender<(u64, Event)>,
    live: Mutex<HashMap<Id, Live>>,
    pub env: LoginEnv,
    pub paths: Paths,
    pub host: HostInfo,
    pub port: Mutex<u16>,
    /// Sessions that were running when the previous daemon stopped (for `resume_on_start`).
    was_running: Mutex<Vec<Id>>,
    /// Set while shutting down: exits caused by the shutdown are not saved, so the next start
    /// still knows what was running.
    closing: std::sync::atomic::AtomicBool,
    history: crate::history::History,
    /// Serialises changes to the MCP list and its secrets file.
    mcp_lock: Mutex<()>,
    usage: crate::usage::Usage,
    pub remote: crate::remote::Remote,
    pub audit: crate::audit::Audit,
    pub orch: crate::orch::Orch,
    pub calls: crate::call::Calls,
    pub outbox: crate::swarm::Outbox,
    pub cv: crate::claude_view::ClaudeView,
    pub host_ctl: crate::host::Host,
}

pub struct Subscription {
    pub first: ServerMsg,
    pub replay: Vec<ServerMsg>,
    pub rx: broadcast::Receiver<(u64, Event)>,
}

impl Core {
    pub fn load(paths: Paths, env: LoginEnv) -> Arc<Core> {
        let persisted: Persisted = std::fs::read_to_string(paths.state())
            .ok()
            .and_then(|s| serde_json::from_str(&s).map_err(|e| tracing::error!("state.json unreadable: {e}")).ok())
            .unwrap_or_default();
        let mut state = State {
            workspaces: persisted.workspaces,
            layouts: persisted.layouts,
            sessions: persisted.sessions,
            profiles: crate::profiles::builtin(),
            catalog: vec![],
            settings: persisted.settings,
            mcp: persisted.mcp,
            limits: persisted.limits,
            remote: Default::default(),
            orchestrator: OrchState { messages: persisted.orchestrator, ..Default::default() },
            // Their agents stopped with the previous daemon.
            swarms: persisted.swarms.into_iter().map(|w| Swarm { ended: true, ..w }).collect(),
            swarm_messages: persisted.swarm_messages,
        };
        state.profiles.extend(persisted.profiles.into_iter().filter(|p| !p.builtin));
        // Processes from a previous daemon run are gone (reboot / crash).
        let mut was_running = vec![];
        for s in state.sessions.values_mut() {
            if s.alive {
                was_running.push(s.id.clone());
                s.alive = false;
                s.status = AgentStatus::Exited;
                s.status_since = now_ms();
            }
        }
        let host = HostInfo {
            host_id: host_id(&paths),
            name: host_name(&hostname::get().map(|h| h.to_string_lossy().into_owned()).unwrap_or_default()),
            os: std::env::consts::OS.into(),
            home: env.home.to_string_lossy().into_owned(),
        };
        let (events, _) = broadcast::channel(4096);
        let audit = crate::audit::Audit::new(paths.root.join("audit.jsonl"));
        Arc::new(Core {
            inner: Mutex::new(Inner { state, seq: 0, ring: VecDeque::new(), dirty: false, busy_days: persisted.busy_days }),
            events,
            live: Mutex::new(HashMap::new()),
            env,
            paths,
            host,
            port: Mutex::new(0),
            was_running: Mutex::new(was_running),
            closing: std::sync::atomic::AtomicBool::new(false),
            history: Default::default(),
            mcp_lock: Mutex::new(()),
            usage: Default::default(),
            remote: Default::default(),
            audit,
            orch: Default::default(),
            calls: Default::default(),
            outbox: Default::default(),
            cv: Default::default(),
            host_ctl: Default::default(),
        })
    }

    /// Restarts what ran before the daemon stopped (setting `resume_on_start`). Agents with a
    /// known conversation id continue that conversation; others start fresh in the same pane.
    pub fn resume_after_restart(self: &Arc<Self>) {
        let ids = std::mem::take(&mut *self.was_running.lock());
        if ids.is_empty() || !self.read(|s| s.settings.resume_on_start) {
            return;
        }
        for id in ids {
            let Some(s) = self.read(|st| st.sessions.get(&id).cloned()) else { continue };
            if s.profile_id.starts_with(crate::profiles::INSTALL_PREFIX) {
                continue; // an install finished or failed; running it again is not wanted
            }
            match self.spawn_into(s, None) {
                Ok(s) => tracing::info!(session = %s.id, resumed = s.engine_session.is_some(), "restarted after daemon restart"),
                Err(e) => tracing::warn!(session = %id, "could not restart: {}", e.message),
            }
        }
    }

    // ───────────── state plumbing ─────────────

    pub fn emit(&self, ev: Event) {
        let mut g = self.inner.lock();
        apply(&mut g.state, &ev);
        g.seq += 1;
        let seq = g.seq;
        g.ring.push_back((seq, ev.clone()));
        if g.ring.len() > RING {
            g.ring.pop_front();
        }
        if !matches!(ev, Event::Attention { .. } | Event::HostNotice { .. }) {
            g.dirty = true;
        }
        let _ = self.events.send((seq, ev));
    }

    pub fn subscribe(&self, since: Option<u64>) -> Subscription {
        let g = self.inner.lock();
        let rx = self.events.subscribe();
        if let Some(since) = since {
            let oldest = g.ring.front().map(|(s, _)| *s).unwrap_or(g.seq + 1);
            if since <= g.seq && since + 1 >= oldest {
                let replay =
                    g.ring.iter().filter(|(s, _)| *s > since).map(|(seq, ev)| ServerMsg::Ev { seq: *seq, ev: ev.clone() }).collect();
                return Subscription { first: ServerMsg::Pong { at: now_ms() }, replay, rx };
            }
        }
        Subscription { first: ServerMsg::Snapshot { seq: g.seq, state: g.state.clone() }, replay: vec![], rx }
    }

    pub fn read<R>(&self, f: impl FnOnce(&State) -> R) -> R {
        f(&self.inner.lock().state)
    }

    pub fn save_if_dirty(&self) -> Result<()> {
        let data = {
            let mut g = self.inner.lock();
            if !g.dirty || self.closing.load(std::sync::atomic::Ordering::SeqCst) {
                return Ok(());
            }
            g.dirty = false;
            let s = &g.state;
            serde_json::to_vec_pretty(&Persisted {
                workspaces: s.workspaces.clone(),
                layouts: s.layouts.clone(),
                sessions: s.sessions.clone(),
                profiles: s.profiles.iter().filter(|p| !p.builtin).cloned().collect(),
                settings: s.settings.clone(),
                mcp: s.mcp.clone(),
                limits: s.limits.clone(),
                busy_days: g.busy_days.clone(),
                orchestrator: s.orchestrator.messages.iter().filter(|m| !m.text.is_empty()).cloned().collect(),
                swarms: s.swarms.clone(),
                swarm_messages: s.swarm_messages.clone(),
            })?
        };
        write_private(&self.paths.state(), &data)
    }

    /// A profile by id, including the `install:<agent>` pseudo profiles.
    fn profile(&self, id: &str) -> Option<Profile> {
        match id.strip_prefix(crate::profiles::INSTALL_PREFIX) {
            Some(agent) => crate::profiles::install_profile(agent),
            None => self.read(|s| s.profiles.iter().find(|p| p.id == id).cloned()),
        }
    }

    fn session(&self, id: &Id) -> std::result::Result<Session, ApiError> {
        self.read(|s| s.sessions.get(id).cloned()).ok_or_else(|| err(ErrorCode::NotFound, "no such session"))
    }

    pub(crate) fn update_session(&self, id: &Id, f: impl FnOnce(&mut Session)) {
        let updated = {
            let g = self.inner.lock();
            g.state.sessions.get(id).cloned()
        };
        if let Some(mut s) = updated {
            f(&mut s);
            self.emit(Event::SessionUpsert { session: s });
        }
    }

    pub fn pty(&self, id: &Id) -> std::result::Result<Arc<Pty>, ApiError> {
        self.live.lock().get(id).map(|l| l.pty.clone()).ok_or_else(|| err(ErrorCode::NotFound, "session is not running"))
    }

    pub fn hook_token_ok(&self, sid: &Id, token: &str) -> bool {
        self.live.lock().get(sid).is_some_and(|l| crate::server::ct_eq(l.hook_token.as_bytes(), token.as_bytes()))
    }

    // ───────────── requests ─────────────

    pub async fn handle(self: &Arc<Self>, client: &ClientInfo, req: Request) -> ApiResult {
        if client.kind == ClientKind::Desktop {
            return self.handle_checked(client, req).await;
        }
        let logged = req.clone();
        let r = self.handle_checked(client, req).await;
        self.audit.record(self, client, &logged, r.as_ref().map(|_| ()));
        r
    }

    async fn handle_checked(self: &Arc<Self>, client: &ClientInfo, req: Request) -> ApiResult {
        crate::policy::check(self, client, &req)?;
        match req {
            Request::SwarmStart { workspace_id, goal, members } => Ok(json!(self.swarm_start(workspace_id, goal, members)?)),
            Request::SwarmSend { swarm_id, to, text } => {
                self.swarm_send(&swarm_id, crate::swarm::YOU, &to, &text)?;
                Ok(Value::Null)
            }
            Request::SwarmStop { swarm_id } => {
                self.swarm_stop(&swarm_id);
                Ok(Value::Null)
            }
            Request::SwarmRemove { swarm_id } => {
                self.swarm_remove(&swarm_id);
                Ok(Value::Null)
            }
            Request::OrchSend { text } => self.orch_send(text, None, false).map(|_| json!(null)),
            Request::OrchStop => {
                self.orch_stop();
                Ok(json!(null))
            }
            Request::OrchClear => {
                self.orch_clear();
                Ok(json!(null))
            }
            Request::LlmKeySet { provider, key } => self.llm_key_set(provider, key).map(|_| json!(null)),
            Request::LlmTest => Ok(json!(self.llm_test().await)),
            Request::CallPreview { voice, speed, lang } => {
                let core = self.clone();
                let d = blocking(move || core.call_preview(voice, speed, &lang).map_err(|e| err(ErrorCode::Unavailable, format!("{e:#}"))))
                    .await?;
                Ok(json!(CallPreviewAudio { d, rate: crate::call::OUT_RATE }))
            }
            Request::HostModels => Ok(json!(self.models_list())),
            Request::HostModelDownload { id } => self.model_download(&id).map(|_| Value::Null),
            Request::HostModelDelete { id } => self.model_delete(&id).map(|_| Value::Null),
            Request::HostUpdateCheck => Ok(json!(self.update_check().await?)),
            Request::HostUi { op, args } => {
                // Installing waits for the download; the reply comes when the app is about to restart.
                let wait = std::time::Duration::from_secs(if op == "update.install" { 1800 } else { 130 });
                self.host_ctl.call(&op, args, wait).await
            }
            Request::HostNotice { topic, data } => {
                self.emit(Event::HostNotice { topic, data });
                Ok(Value::Null)
            }
            Request::AuditList { limit } => Ok(json!(self.audit.list(limit.unwrap_or(200).min(2000) as usize))),
            r @ (Request::RemoteSignIn { .. }
            | Request::RemoteSignOut
            | Request::RemoteSignOutEverywhere
            | Request::RemoteEnable { .. }
            | Request::RemotePair
            | Request::RemoteRevoke { .. }) => crate::remote::handle(self, r).await,
            Request::WorkspaceAdd { path, name } => self.workspace_add(path, name),
            Request::WorkspaceUpdate { id, name, approved, pinned, order } => {
                let mut ws = self
                    .read(|s| s.workspaces.iter().find(|w| w.id == id).cloned())
                    .ok_or_else(|| err(ErrorCode::NotFound, "no such workspace"))?;
                if let Some(v) = name {
                    ws.name = v;
                }
                if let Some(v) = approved {
                    ws.approved = v;
                }
                if let Some(v) = pinned {
                    ws.pinned = v;
                }
                if let Some(v) = order {
                    ws.order = v;
                }
                self.emit(Event::WorkspaceUpsert { workspace: ws.clone() });
                Ok(json!(ws))
            }
            Request::WorkspaceRemove { id } => {
                let sids: Vec<Id> = self.read(|s| s.sessions.values().filter(|x| x.workspace_id == id).map(|x| x.id.clone()).collect());
                for sid in sids {
                    self.session_close(&sid);
                }
                self.emit(Event::WorkspaceRemoved { id });
                Ok(Value::Null)
            }
            Request::LayoutSet { workspace_id, layout } => {
                if !self.read(|s| s.workspaces.iter().any(|w| w.id == workspace_id)) {
                    return Err(err(ErrorCode::NotFound, "no such workspace"));
                }
                self.emit(Event::LayoutSet { workspace_id, layout });
                Ok(Value::Null)
            }
            Request::SessionStart(start) if start.worktree == Some(true) => {
                // `git worktree add` checks out files; keep that off the async threads.
                let me = self.clone();
                blocking(move || me.session_start(start)).await.map(|s| json!(s))
            }
            Request::SessionStart(start) => self.session_start(start).map(|s| json!(s)),
            Request::SessionStop { id } => {
                self.pty(&id)?;
                self.session_kill(&id);
                Ok(Value::Null)
            }
            Request::SessionClose { id } => {
                self.session(&id)?;
                self.session_close(&id);
                Ok(Value::Null)
            }
            Request::SessionRestart { id } => {
                let old = self.session(&id)?;
                if let Ok(p) = self.pty(&id) {
                    p.kill();
                }
                self.live.lock().remove(&id);
                self.spawn_into(old, None).map(|s| json!(s))
            }
            Request::SessionRename { id, title } => {
                self.session(&id)?;
                self.update_session(&id, |s| s.title = title);
                Ok(Value::Null)
            }
            Request::SessionPrompt { id, text } => {
                self.send_prompt(&id, &text)?;
                Ok(Value::Null)
            }
            Request::TermWrite { sid, data } => {
                self.pty(&sid)?.write(data.as_bytes()).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
                Ok(Value::Null)
            }
            Request::TermResize { sid, cols, rows } => {
                let pty = self.pty(&sid)?;
                pty.resize(cols, rows).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
                let (c, r) = pty.size();
                self.update_session(&sid, |s| {
                    s.cols = c;
                    s.rows = r;
                });
                Ok(Value::Null)
            }
            // attach/detach are connection-scoped and handled in `server`
            r @ (Request::CvHistory { .. }
            | Request::CvCommands { .. }
            | Request::CvFiles { .. }
            | Request::Upload { .. }
            | Request::Transcribe { .. }) => self.cv_handle(r).await.unwrap_or(Ok(Value::Null)),
            Request::CvAttach { .. } | Request::CvDetach { .. } | Request::TermAttach { .. } | Request::TermDetach { .. } => Err(err(ErrorCode::BadRequest, "connection-scoped")),
            Request::ProfileSave { mut profile } => {
                if profile.builtin || self.read(|s| s.profiles.iter().any(|p| p.id == profile.id && p.builtin)) {
                    return Err(err(ErrorCode::Forbidden, "built-in profiles cannot be changed; duplicate it"));
                }
                if profile.id.is_empty() {
                    profile.id = layout::new_id();
                }
                let mut list = self.read(|s| s.profiles.clone());
                match list.iter_mut().find(|p| p.id == profile.id) {
                    Some(p) => *p = profile.clone(),
                    None => list.push(profile.clone()),
                }
                self.emit(Event::ProfilesSet { profiles: list });
                Ok(json!(profile))
            }
            Request::ProfileDelete { id } => {
                let mut list = self.read(|s| s.profiles.clone());
                let before = list.len();
                list.retain(|p| p.id != id || p.builtin);
                if list.len() == before {
                    return Err(err(ErrorCode::NotFound, "no such custom profile"));
                }
                self.emit(Event::ProfilesSet { profiles: list });
                Ok(Value::Null)
            }
            Request::CatalogRefresh => {
                let core = self.clone();
                let catalog = tokio::task::spawn_blocking(move || core.refresh_catalog())
                    .await
                    .map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
                Ok(json!(catalog))
            }
            Request::SettingsSet { settings } => {
                let voice_changed = self.read(|s| s.settings.call != settings.call);
                self.emit(Event::SettingsSet { settings });
                if voice_changed {
                    self.call_reload();
                }
                self.orch_status();
                Ok(Value::Null)
            }
            Request::FsList { path } => crate::fsbrowse::list(&self.env.home, client, &path),
            Request::FsRoots => Ok(crate::fsbrowse::roots(&self.env.home)),
            Request::FsMkdir { path, name } => crate::fsbrowse::mkdir(&self.env.home, client, &path, &name),
            Request::GitChanges { workspace_id, session_id } => {
                let (dir, base) = self.git_target(&workspace_id, session_id.as_ref())?;
                blocking(move || crate::git::changes(Path::new(&dir), base.as_deref()).map_err(git_err)).await.map(|c| json!(c))
            }
            Request::GitDiff { workspace_id, session_id, path } => {
                let (dir, base) = self.git_target(&workspace_id, session_id.as_ref())?;
                blocking(move || crate::git::diff(Path::new(&dir), base.as_deref(), path.as_deref()).map_err(git_err))
                    .await
                    .map(|d| json!(d))
            }
            Request::WorktreeMerge { session_id } => {
                let (s, wt, repo) = self.worktree_of(&session_id)?;
                if let Ok(p) = self.pty(&session_id) {
                    p.kill();
                }
                let message = format!("{} (NeuralAgent)", s.title);
                let msg = blocking(move || crate::git::worktree_merge(Path::new(&repo), &wt, &message).map_err(git_err)).await?;
                self.session_close(&session_id);
                self.refresh_git();
                Ok(json!(msg))
            }
            Request::WorktreeDiscard { session_id } => {
                let (_, wt, repo) = self.worktree_of(&session_id)?;
                if let Ok(p) = self.pty(&session_id) {
                    p.kill();
                }
                blocking(move || crate::git::worktree_remove(Path::new(&repo), &wt).map_err(git_err)).await?;
                self.session_close(&session_id);
                Ok(Value::Null)
            }
            Request::McpSave { server, values } => {
                if !crate::mcp::valid_id(&server.id) {
                    return Err(err(ErrorCode::BadRequest, "use letters, digits, - and _ for the name (up to 48)"));
                }
                if let Some(bad) = server.secrets.iter().find(|n| n.is_empty() || n.contains(['=', '\0', '\n'])) {
                    return Err(err(ErrorCode::BadRequest, format!("{bad:?} is not a valid name")));
                }
                let _guard = self.mcp_lock.lock();
                let mut secrets = crate::mcp::load_secrets(&self.paths.root);
                let vals = secrets.entry(server.id.clone()).or_default();
                vals.extend(values);
                vals.retain(|k, _| server.secrets.contains(k));
                crate::mcp::save_secrets(&self.paths.root, &secrets).map_err(|e| err(ErrorCode::Internal, format!("{e:#}")))?;
                let mut list = self.read(|s| s.mcp.clone());
                match list.iter_mut().find(|s| s.id == server.id) {
                    Some(s) => *s = server,
                    None => list.push(server),
                }
                self.emit(Event::McpSet { servers: list });
                Ok(Value::Null)
            }
            Request::McpDelete { id } => {
                let _guard = self.mcp_lock.lock();
                let mut secrets = crate::mcp::load_secrets(&self.paths.root);
                if secrets.remove(&id).is_some() {
                    crate::mcp::save_secrets(&self.paths.root, &secrets).map_err(|e| err(ErrorCode::Internal, format!("{e:#}")))?;
                }
                let list: Vec<McpServer> = self.read(|s| s.mcp.iter().filter(|x| x.id != id).cloned().collect());
                self.emit(Event::McpSet { servers: list });
                Ok(Value::Null)
            }
            Request::McpImport => {
                let home = self.env.home.clone();
                let codex_home = self.env.vars.get("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".codex"));
                let found = blocking(move || Ok(crate::mcp::import(&home, &codex_home))).await?;
                let _guard = self.mcp_lock.lock();
                let mut list = self.read(|s| s.mcp.clone());
                let mut secrets = crate::mcp::load_secrets(&self.paths.root);
                let mut added = 0;
                for (server, vals) in found {
                    if list.iter().any(|s| s.id == server.id) {
                        continue;
                    }
                    if !vals.is_empty() {
                        secrets.insert(server.id.clone(), vals);
                    }
                    list.push(server);
                    added += 1;
                }
                crate::mcp::save_secrets(&self.paths.root, &secrets).map_err(|e| err(ErrorCode::Internal, format!("{e:#}")))?;
                self.emit(Event::McpSet { servers: list });
                Ok(json!(added))
            }
            Request::UsageReport { days } => {
                let since = crate::usage::since_day(days.clamp(1, 400));
                let me = self.clone();
                tokio::task::spawn_blocking(move || {
                    me.usage.refresh(&me.env.home);
                    let ws = me.read(|s| s.workspaces.iter().map(|w| (w.id.clone(), w.path.clone())).collect::<Vec<_>>());
                    // the workspace with the longest path containing the folder (worktrees are inside theirs)
                    let workspace = |cwd: &str| {
                        ws.iter().filter(|(_, p)| Path::new(cwd).starts_with(p)).max_by_key(|(_, p)| p.len()).map(|(id, _)| id.clone())
                    };
                    let rows = me.usage.rows(&since, workspace);
                    let busy_ms: BTreeMap<String, i64> =
                        me.inner.lock().busy_days.range(since.clone()..).map(|(k, v)| (k.clone(), *v)).collect();
                    json!(UsageReport { rows, busy_ms })
                })
                .await
                .map_err(|e| err(ErrorCode::Internal, e.to_string()))
            }
            Request::HistorySearch { query, limit } => {
                // Phones and the orchestrator only see conversations from approved workspaces.
                let approved: Option<Vec<String>> = (client.kind != ClientKind::Desktop)
                    .then(|| self.read(|s| s.workspaces.iter().filter(|w| w.approved).map(|w| w.path.clone()).collect()));
                let allow = move |cwd: &str| approved.as_ref().is_none_or(|ws| ws.iter().any(|w| Path::new(cwd).starts_with(w)));
                // The first search reads every transcript once; keep that off the async threads.
                let me = self.clone();
                let limit = limit.unwrap_or(50).min(200) as usize;
                tokio::task::spawn_blocking(move || me.history.search(&me.env.home, &query, limit, allow))
                    .await
                    .map(|hits| json!(hits))
                    .map_err(|e| err(ErrorCode::Internal, e.to_string()))
            }
        }
    }

    /// Folder and base commit to compare: the workspace against HEAD, or an agent's worktree
    /// against the commit it started from.
    fn git_target(&self, ws: &Id, session: Option<&Id>) -> std::result::Result<(String, Option<String>), ApiError> {
        match session {
            Some(sid) => {
                let s = self.session(sid)?;
                if &s.workspace_id != ws {
                    return Err(err(ErrorCode::BadRequest, "that agent is in another workspace"));
                }
                match s.worktree {
                    Some(wt) => Ok((wt.path, Some(wt.base))),
                    None => self.git_target(&s.workspace_id, None),
                }
            }
            None => self
                .read(|s| s.workspaces.iter().find(|w| &w.id == ws).map(|w| (w.path.clone(), None)))
                .ok_or_else(|| err(ErrorCode::NotFound, "no such workspace")),
        }
    }

    fn worktree_of(&self, sid: &Id) -> std::result::Result<(Session, WorktreeInfo, String), ApiError> {
        let s = self.session(sid)?;
        let wt = s.worktree.clone().ok_or_else(|| err(ErrorCode::BadRequest, "this agent does not have its own worktree"))?;
        let repo = self
            .read(|st| st.workspaces.iter().find(|w| w.id == s.workspace_id).map(|w| w.path.clone()))
            .ok_or_else(|| err(ErrorCode::NotFound, "no such workspace"))?;
        Ok((s, wt, repo))
    }

    /// Updates the branch / changed-files summary of every workspace (runs every few seconds).
    pub fn refresh_git(&self) {
        static BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if BUSY.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        for w in self.read(|s| s.workspaces.clone()) {
            let git = crate::git::summary(Path::new(&w.path));
            let same = match (&git, &w.git) {
                (Some(a), Some(b)) => a.branch == b.branch && a.changed == b.changed && a.ahead == b.ahead && a.behind == b.behind,
                (None, None) => true,
                _ => false,
            };
            if !same {
                self.emit(Event::WorkspaceUpsert { workspace: Workspace { git, ..w } });
            }
        }
        BUSY.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    /// Reads new transcript lines: usage of running agents and the Codex limits.
    pub fn refresh_usage(&self) {
        static BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if BUSY.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        self.usage.refresh(&self.env.home);
        let codex = self.usage.codex_limits();
        if !codex.is_empty() {
            self.set_limits("codex", codex);
        }
        let running: Vec<(Id, String, Option<SessionUsage>)> = self.read(|s| {
            s.sessions
                .values()
                .filter(|x| x.alive)
                .filter_map(|x| Some((x.id.clone(), x.engine_session.clone()?, x.usage.clone())))
                .collect()
        });
        for (id, conv, old) in running {
            let new = self.usage.conversation(&conv);
            if new.is_some() && new != old {
                self.update_session(&id, |x| x.usage = new);
            }
        }
        BUSY.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    /// Replaces one engine's limits; emits only when something other than the time changed,
    /// or the last report is over a minute old.
    fn set_limits(&self, engine: &str, new: Vec<UsageLimit>) {
        let all = self.read(|s| s.limits.clone());
        let old: Vec<&UsageLimit> = all.iter().filter(|l| l.engine == engine).collect();
        let key = |l: &UsageLimit| (l.window.clone(), l.used_percent.to_bits(), l.resets_at);
        let same = old.len() == new.len() && old.iter().zip(&new).all(|(a, b)| key(a) == key(b) && b.updated_at - a.updated_at < 60_000);
        if same {
            return;
        }
        let mut limits: Vec<UsageLimit> = all.into_iter().filter(|l| l.engine != engine).collect();
        limits.extend(new);
        self.emit(Event::LimitsSet { limits });
    }

    fn workspace_add(&self, path: String, name: Option<String>) -> ApiResult {
        let p = std::path::Path::new(&path);
        let path = crate::fsbrowse::expand(&self.env.home, p);
        if !path.is_dir() {
            return Err(err(ErrorCode::NotFound, format!("{} is not a folder", path.display())));
        }
        let path_s = path.to_string_lossy().into_owned();
        if let Some(ws) = self.read(|s| s.workspaces.iter().find(|w| w.path == path_s).cloned()) {
            return Ok(json!(ws));
        }
        let order = self.read(|s| s.workspaces.iter().map(|w| w.order).max().unwrap_or(0) + 1);
        let ws = Workspace {
            id: layout::new_id(),
            name: name.unwrap_or_else(|| path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path_s.clone())),
            path: path_s,
            approved: true,
            pinned: false,
            order,
            created_at: now_ms(),
            git: crate::git::summary(&path),
        };
        self.emit(Event::WorkspaceUpsert { workspace: ws.clone() });
        self.emit(Event::LayoutSet { workspace_id: ws.id.clone(), layout: layout::default_layout() });
        Ok(json!(ws))
    }

    /// Stops the process; its exit is not an error.
    pub(crate) fn session_kill(&self, id: &Id) {
        let pty = {
            let mut live = self.live.lock();
            let Some(l) = live.get_mut(id) else { return };
            l.stopped = true;
            l.pty.clone()
        };
        pty.kill();
    }

    pub fn session_start(self: &Arc<Self>, start: StartSession) -> std::result::Result<Session, ApiError> {
        self.session_start_as(start, None)
    }

    /// `id`: chosen by the caller (a swarm knows its members before they start).
    pub(crate) fn session_start_as(self: &Arc<Self>, start: StartSession, id: Option<Id>) -> std::result::Result<Session, ApiError> {
        let ws = self
            .read(|s| s.workspaces.iter().find(|w| w.id == start.workspace_id).cloned())
            .ok_or_else(|| err(ErrorCode::NotFound, "no such workspace"))?;
        let profile = self.profile(&start.profile_id).ok_or_else(|| err(ErrorCode::NotFound, "no such profile"))?;
        let mut cwd = match &start.cwd {
            Some(c) if Path::new(c).starts_with(&ws.path) && Path::new(c).is_dir() => c.clone(),
            Some(_) => return Err(err(ErrorCode::BadRequest, "that folder is not inside the workspace")),
            None => ws.path.clone(),
        };
        let id = id.unwrap_or_else(layout::new_id);
        // Its own branch and folder, so parallel agents do not edit the same files.
        let worktree = match start.worktree {
            Some(true) => {
                let name = format!("{}-{}", slug(&profile.name), &id[..id.len().min(6)]);
                let wt = crate::git::worktree_create(Path::new(&ws.path), &name).map_err(git_err)?;
                // Same subfolder inside the worktree, if one was asked for.
                let sub = Path::new(&cwd)
                    .strip_prefix(&ws.path)
                    .ok()
                    .filter(|r| !r.as_os_str().is_empty())
                    .map(|r| Path::new(&wt.path).join(r))
                    .filter(|p| p.is_dir());
                cwd = sub.map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| wt.path.clone());
                Some(wt)
            }
            _ => None,
        };
        let now = now_ms();
        let session = Session {
            id,
            workspace_id: ws.id.clone(),
            profile_id: profile.id.clone(),
            title: profile.name.clone(),
            cwd,
            status: AgentStatus::Starting,
            status_since: now,
            started_at: now,
            busy_ms: 0,
            cols: start.cols.unwrap_or(120),
            rows: start.rows.unwrap_or(32),
            alive: true,
            exit_code: None,
            engine_session: start.resume.clone(),
            last_line: None,
            last_message: None,
            prompt: start.prompt.as_ref().map(|p| p.chars().take(300).collect()),
            worktree,
            preview_url: None,
            usage: None,
            status_source: StatusSource::Output,
        };
        let s = self.spawn_into(session, start.prompt)?;
        // show it somewhere
        let mut l = self.read(|st| st.layouts.get(&ws.id).cloned()).unwrap_or_else(layout::default_layout);
        if !layout::sessions_in(&l).contains(&s.id) {
            layout::place_session(&mut l, &s.id, start.pane_id.as_ref());
            self.emit(Event::LayoutSet { workspace_id: ws.id.clone(), layout: l });
        }
        Ok(s)
    }

    /// Starts (or restarts) the process for `session` and publishes it.
    fn spawn_into(self: &Arc<Self>, mut session: Session, prompt: Option<String>) -> std::result::Result<Session, ApiError> {
        let profile = self.profile(&session.profile_id).ok_or_else(|| err(ErrorCode::NotFound, "profile was deleted"))?;
        // A dev server from the previous run is gone.
        session.preview_url = None;
        let exe = std::env::current_exe().map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
        let mut secrets = crate::mcp::load_secrets(&self.paths.root);
        let hook_token = crate::server::random_token();
        let port = *self.port.lock();
        let mut servers = self.read(|s| s.mcp.clone());
        let in_swarm = self.swarm_of(&session.id).is_some();
        if in_swarm {
            servers.retain(|s| s.id != crate::swarm::SERVER_ID);
            servers.push(crate::swarm::server(&exe));
            secrets.insert(crate::swarm::SERVER_ID.into(), crate::swarm::bridge_env(&session.id, &hook_token, port));
        }
        let mut mcp = crate::mcp::for_engine(&profile.engine, &servers, &secrets);
        if in_swarm && profile.engine == "claude" {
            // Talking to the team needs no permission prompt.
            mcp.args.extend(["--allowedTools".into(), format!("mcp__{}", crate::swarm::SERVER_ID)]);
        }
        let launch = crate::profiles::launch(&self.env, &profile, prompt.as_deref(), session.engine_session.as_deref(), &exe, &mcp.args)?;
        let mut env: Vec<(String, String)> = self.env.vars.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        env.extend(
            [
                ("TERM", "xterm-256color".to_string()),
                ("COLORTERM", "truecolor".into()),
                ("TERM_PROGRAM", "NeuralAgent".into()),
                ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION").into()),
                ("NEURALAGENT_SESSION", session.id.clone()),
                ("NEURALAGENT_HOOK_TOKEN", hook_token.clone()),
                ("NEURALAGENT_PORT", port.to_string()),
            ]
            .map(|(k, v)| (k.to_string(), v)),
        );
        if !self.env.vars.contains_key("LANG") && !cfg!(windows) {
            env.push(("LANG".into(), "en_US.UTF-8".into()));
        }
        env.extend(mcp.env);
        env.extend(profile.env.iter().map(|(k, v)| (k.clone(), v.clone())));
        env.extend(launch.env);

        let sid = session.id.clone();
        let weak = Arc::downgrade(self);
        let pty = Pty::spawn(
            Spawn {
                program: launch.program,
                args: launch.args,
                cwd: session.cwd.clone(),
                env,
                env_remove: STRIP.iter().map(|s| s.to_string()).filter(|k| !k.starts_with("NEURALAGENT_")).collect(),
                cols: session.cols,
                rows: session.rows,
            },
            move |note| {
                if let Some(core) = weak.upgrade() {
                    core.on_note(&sid, note);
                }
            },
        )
        .map_err(|e| err(ErrorCode::Internal, format!("could not start {}: {e:#}", profile.name)))?;

        let now = now_ms();
        session.alive = true;
        session.exit_code = None;
        session.status = AgentStatus::Starting;
        session.status_since = now;
        session.started_at = now;
        self.live.lock().insert(
            session.id.clone(),
            Live {
                pty: pty.clone(),
                hook_token,
                last_output: None,
                working_since: None,
                prompted: launch.prompt_in_args && prompt.is_some(),
                stopped: false,
            },
        );
        self.emit(Event::SessionUpsert { session: session.clone() });

        if let (Some(p), false) = (prompt, launch.prompt_in_args) {
            // CLIs without a prompt argument: type it once the TUI is up.
            let core = self.clone();
            let id = session.id.clone();
            tokio::spawn(async move {
                core.wait_quiet(&id, Duration::from_millis(800), Duration::from_secs(20)).await;
                let _ = core.send_prompt(&id, &p);
            });
        }
        Ok(session)
    }

    /// Waits until the session printed something and then was quiet for `quiet`.
    async fn wait_quiet(&self, id: &Id, quiet: Duration, max: Duration) {
        let start = Instant::now();
        while start.elapsed() < max {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let last = self.live.lock().get(id).and_then(|l| l.last_output);
            if last.is_some_and(|t| t.elapsed() >= quiet) {
                return;
            }
        }
    }

    pub fn send_prompt(&self, id: &Id, text: &str) -> std::result::Result<(), ApiError> {
        let pty = self.pty(id)?;
        // Bracketed paste keeps multi-line prompts in one message; Enter is sent separately so
        // TUIs see it as a key press.
        let body = format!("\x1b[200~{}\x1b[201~", text.replace("\x1b", ""));
        pty.write(body.as_bytes()).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
        std::thread::sleep(Duration::from_millis(60));
        pty.write(b"\r").map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
        if let Some(l) = self.live.lock().get_mut(id) {
            l.prompted = true;
        }
        self.update_session(id, |s| {
            if s.prompt.is_none() {
                s.prompt = Some(text.chars().take(300).collect());
            }
        });
        Ok(())
    }

    fn session_close(self: &Arc<Self>, id: &Id) {
        if let Some(l) = self.live.lock().remove(id) {
            l.pty.kill();
            // Installers often end with a question ("Start now?"); closing the pane still counts.
            if self.read(|s| s.sessions.get(id).is_some_and(|x| x.profile_id.starts_with(crate::profiles::INSTALL_PREFIX))) {
                let core = self.clone();
                std::thread::spawn(move || core.refresh_catalog());
            }
        }
        // A worktree the agent never changed is just clutter; one with changes is kept until it
        // is merged or discarded.
        if let Some((wt, repo)) = self.read(|s| {
            let x = s.sessions.get(id)?;
            Some((x.worktree.clone()?, s.workspaces.iter().find(|w| w.id == x.workspace_id)?.path.clone()))
        }) {
            std::thread::spawn(move || {
                if !crate::git::worktree_dirty(&wt)
                    && let Err(e) = crate::git::worktree_remove(Path::new(&repo), &wt)
                {
                    tracing::warn!("removing unused worktree {}: {e:#}", wt.path);
                }
            });
        }
        let ws = self.read(|s| s.sessions.get(id).map(|x| x.workspace_id.clone()));
        if let Some(ws) = ws
            && let Some(mut l) = self.read(|s| s.layouts.get(&ws).cloned())
            && layout::clear_session(&mut l, id)
        {
            self.emit(Event::LayoutSet { workspace_id: ws, layout: l });
        }
        self.cv_forget(id);
        self.emit(Event::SessionRemoved { id: id.clone() });
    }

    // ───────────── process notes & status ─────────────

    fn on_note(self: &Arc<Self>, sid: &Id, note: PtyNote) {
        match note {
            PtyNote::Output { bytes } => {
                let mut live = self.live.lock();
                if let Some(l) = live.get_mut(sid) {
                    let echo = bytes < 64 && l.pty.last_input.lock().is_some_and(|t| t.elapsed() < Duration::from_millis(120));
                    if !echo {
                        l.last_output = Some(Instant::now());
                    }
                }
            }
            PtyNote::Title(title) => {
                let is_shell = self.read(|s| s.sessions.get(sid).map(|x| x.profile_id == "shell")).unwrap_or(false);
                if is_shell && !title.trim().is_empty() {
                    self.update_session(sid, |s| s.title = title.trim().chars().take(80).collect());
                }
            }
            PtyNote::Bell => {}
            PtyNote::Url(url) => {
                if self.read(|s| s.sessions.get(sid).is_some_and(|x| x.preview_url.as_deref() != Some(url.as_str()))) {
                    self.update_session(sid, |s| s.preview_url = Some(url));
                }
            }
            PtyNote::Exited(code) => {
                let Some(live) = self.live.lock().remove(sid) else {
                    return; // closed or restarted on purpose
                };
                let failed = code.unwrap_or(0) != 0 && !live.stopped;
                self.update_session(sid, |s| {
                    s.alive = false;
                    s.exit_code = code;
                    s.status = if failed { AgentStatus::Error } else { AgentStatus::Exited };
                    s.status_since = now_ms();
                });
                let installer =
                    self.read(|s| s.sessions.get(sid).is_some_and(|x| x.profile_id.starts_with(crate::profiles::INSTALL_PREFIX)));
                if installer {
                    // A CLI may have appeared: look again.
                    let core = self.clone();
                    std::thread::spawn(move || core.refresh_catalog());
                }
                if failed {
                    self.emit(Event::Attention {
                        session_id: sid.clone(),
                        kind: AttentionKind::Error,
                        text: format!("exited with code {}", code.unwrap_or(-1)),
                    });
                }
            }
        }
    }

    /// Moves a session to `next`, keeping busy time and raising attention for done/waiting/error.
    pub(crate) fn transition(&self, id: &Id, next: AgentStatus, attention: Option<String>, extra: impl FnOnce(&mut Session)) {
        let Some(cur) = self.read(|st| st.sessions.get(id).map(|s| s.status)) else { return };
        let mut busy_add = 0i64;
        if next != cur
            && let Some(l) = self.live.lock().get_mut(id)
        {
            if next == AgentStatus::Working {
                l.working_since.get_or_insert_with(Instant::now);
            } else if let Some(t) = l.working_since.take() {
                busy_add = t.elapsed().as_millis() as i64;
            }
            if next == AgentStatus::Done {
                l.prompted = false;
            }
        }
        self.update_session(id, |x| {
            if x.status != next {
                x.status = next;
                x.status_since = now_ms();
            }
            x.busy_ms += busy_add;
            extra(x);
        });
        if busy_add > 0 {
            let mut g = self.inner.lock();
            *g.busy_days.entry(crate::usage::today()).or_default() += busy_add;
            // a little over a year is enough for the usage page
            while g.busy_days.len() > 400 {
                g.busy_days.pop_first();
            }
            g.dirty = true;
        }
        let kind = match next {
            AgentStatus::Done => Some(AttentionKind::Done),
            AgentStatus::Waiting => Some(AttentionKind::Waiting),
            AgentStatus::Error => Some(AttentionKind::Error),
            _ => None,
        };
        // A swarm member's finished turn is part of the team's work; the team reports itself.
        let kind = kind.filter(|k| *k != AttentionKind::Done || self.swarm_of(id).is_none());
        if let (Some(kind), true) = (kind, next != cur) {
            self.emit(Event::Attention { session_id: id.clone(), kind, text: attention.unwrap_or_default() });
        }
    }

    /// Output-based status for sessions without hooks, plus `last_line` refresh. Runs ~3×/s.
    pub fn tick(&self) {
        self.cv_tick();
        let ids: Vec<(Id, Option<Instant>, bool, Arc<Pty>)> =
            self.live.lock().iter().map(|(id, l)| (id.clone(), l.last_output, l.prompted, l.pty.clone())).collect();
        for (id, last_output, prompted, pty) in ids {
            let Some(s) = self.read(|st| st.sessions.get(&id).cloned()) else { continue };
            let line = pty.last_line();
            let active = last_output.is_some_and(|t| t.elapsed() < Duration::from_millis(1200));
            let quiet = last_output.is_some_and(|t| t.elapsed() > Duration::from_millis(2500));
            let shell = s.profile_id == "shell" || s.profile_id.starts_with(crate::profiles::INSTALL_PREFIX);
            let next = match s.status_source {
                // Hooks own the status; output only ends the start phase.
                StatusSource::Hooks => match s.status {
                    AgentStatus::Starting if quiet => AgentStatus::Idle,
                    st => st,
                },
                _ => match (s.status, active) {
                    (AgentStatus::Starting, false) if last_output.is_some() => AgentStatus::Idle,
                    // Busy from the first second on (a shell running a loop): working, not starting.
                    (AgentStatus::Starting, true) if (prompted || shell) && now_ms().saturating_sub(s.started_at) > 4000 => {
                        AgentStatus::Working
                    }
                    (AgentStatus::Starting, _) => AgentStatus::Starting,
                    (_, true) if prompted || shell => AgentStatus::Working,
                    (AgentStatus::Working, false) if quiet => {
                        if shell {
                            AgentStatus::Idle
                        } else {
                            AgentStatus::Done
                        }
                    }
                    (st, _) => st,
                },
            };
            if next != s.status {
                self.transition(&id, next, line.clone(), |x| x.last_line = line.clone());
            } else if line != s.last_line {
                self.update_session(&id, |x| x.last_line = line.clone());
            }
        }
    }

    /// Status from agent hooks (see `profiles::CLAUDE_EVENTS` and the Codex `notify` call).
    pub fn on_hook(&self, sid: &Id, event: &str, payload: &Value) {
        tracing::debug!(%sid, event, "hook");
        let text = |k: &str| payload.get(k).and_then(Value::as_str).map(|s| s.chars().take(2000).collect::<String>());
        let engine_session = text("session_id").or_else(|| text("thread-id"));
        if let Some(p) = payload.get("transcript_path").and_then(Value::as_str) {
            self.cv_note_path(sid, p);
        }
        let mark = |x: &mut Session| {
            x.status_source = StatusSource::Hooks;
            if let Some(e) = &engine_session {
                x.engine_session = Some(e.clone());
            }
        };
        if event == "statusline" {
            // Claude Code's statusline input: subscription limits, nothing about the status.
            let limits = crate::usage::claude_limits(payload, now_ms());
            if !limits.is_empty() {
                self.set_limits("claude", limits);
            }
            return;
        }
        match event {
            "SessionStart" => {
                let cur = self.read(|st| st.sessions.get(sid).map(|s| s.status));
                let next = if cur == Some(AgentStatus::Starting) { AgentStatus::Idle } else { cur.unwrap_or(AgentStatus::Idle) };
                self.transition(sid, next, None, mark);
            }
            "UserPromptSubmit" => {
                let prompt = text("prompt");
                self.transition(sid, AgentStatus::Working, None, |x| {
                    mark(x);
                    if let Some(p) = prompt {
                        x.prompt = Some(p.chars().take(300).collect());
                    }
                });
            }
            "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => self.transition(sid, AgentStatus::Working, None, mark),
            "PermissionRequest" => {
                let tool = text("tool_name").unwrap_or_else(|| "a tool".into());
                self.transition(sid, AgentStatus::Waiting, Some(format!("Wants to use {tool}")), mark);
            }
            "Notification" => {
                // Permission prompts need the user; "idle" reminders do not change anything.
                let kind = text("notification_type").unwrap_or_default();
                let msg = text("message").unwrap_or_default();
                if kind == "permission_prompt" || (kind.is_empty() && msg.to_lowercase().contains("permission")) {
                    self.transition(sid, AgentStatus::Waiting, Some(msg), mark);
                } else {
                    self.update_session(sid, mark);
                }
            }
            "Stop" | "codex-notify" => {
                let msg = text("last_assistant_message")
                    .or_else(|| text("last-assistant-message"))
                    .or_else(|| text("transcript_path").and_then(|p| last_assistant_text(Path::new(&p))));
                let summary = msg.as_deref().map(first_line);
                self.transition(sid, AgentStatus::Done, summary.clone(), |x| {
                    mark(x);
                    if msg.is_some() {
                        x.last_message = msg.clone();
                    }
                });
            }
            "StopFailure" => {
                // Claude also reports failed background requests after a turn already ended with
                // Stop; only a turn that is still running fails.
                let cur = self.read(|st| st.sessions.get(sid).map(|s| s.status));
                let failed = text("transcript_path").and_then(|p| turn_failed(Path::new(&p))).unwrap_or(true);
                if cur == Some(AgentStatus::Done) || !failed {
                    self.update_session(sid, mark);
                } else {
                    let msg = text("error").or_else(|| text("message"));
                    self.transition(sid, AgentStatus::Error, msg, mark);
                }
            }
            _ => self.update_session(sid, mark),
        }
    }

    pub fn refresh_catalog(&self) -> Vec<CatalogEntry> {
        let catalog = crate::catalog::detect(&self.env);
        self.emit(Event::CatalogSet { catalog: catalog.clone() });
        catalog
    }

    pub fn shutdown(&self) {
        // Save first, while sessions still count as running, then stop them.
        let _ = self.save_if_dirty();
        self.closing.store(true, std::sync::atomic::Ordering::SeqCst);
        for (_, l) in self.live.lock().drain() {
            l.pty.kill();
        }
    }
}

/// The last assistant text in a Claude Code transcript (JSONL), read from the end of the file.
/// The last 256 KB of a transcript, newest entry first.
fn transcript_tail(path: &Path) -> Option<Vec<Value>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(256 * 1024);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = String::new();
    f.take(256 * 1024).read_to_string(&mut buf).ok()?;
    Some(buf.lines().rev().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect())
}

/// Whether the transcript's last answer is an API error. Claude also sends StopFailure for failed
/// side requests (titles, suggestions) while the turn itself goes on.
fn turn_failed(path: &Path) -> Option<bool> {
    let tail = transcript_tail(path)?;
    let last = tail.iter().find(|v| v.get("type").and_then(Value::as_str) == Some("assistant"))?;
    Some(last.get("isApiErrorMessage").and_then(Value::as_bool) == Some(true))
}

fn last_assistant_text(path: &Path) -> Option<String> {
    transcript_tail(path)?.into_iter().find_map(|v| {
        if v.get("type")?.as_str()? != "assistant" {
            return None;
        }
        let parts = v.pointer("/message/content")?.as_array()?;
        let text: Vec<&str> = parts
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text")?.as_str())
            .collect();
        (!text.is_empty()).then(|| text.join("\n").chars().take(2000).collect())
    })
}

fn first_line(s: &str) -> String {
    s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(160).collect()
}

/// Applies an event to a state. Mirrored in TypeScript; keep both in sync.
pub fn apply(s: &mut State, ev: &Event) {
    match ev {
        Event::RemoteSet { remote } => s.remote = remote.clone(),
        Event::WorkspaceUpsert { workspace } => match s.workspaces.iter_mut().find(|w| w.id == workspace.id) {
            Some(w) => *w = workspace.clone(),
            None => s.workspaces.push(workspace.clone()),
        },
        Event::WorkspaceRemoved { id } => {
            s.workspaces.retain(|w| &w.id != id);
            s.layouts.remove(id);
            s.sessions.retain(|_, x| &x.workspace_id != id);
        }
        Event::LayoutSet { workspace_id, layout } => {
            s.layouts.insert(workspace_id.clone(), layout.clone());
        }
        Event::SessionUpsert { session } => {
            s.sessions.insert(session.id.clone(), session.clone());
        }
        Event::SessionRemoved { id } => {
            s.sessions.remove(id);
        }
        Event::ProfilesSet { profiles } => s.profiles = profiles.clone(),
        Event::McpSet { servers } => s.mcp = servers.clone(),
        Event::LimitsSet { limits } => s.limits = limits.clone(),
        Event::CatalogSet { catalog } => s.catalog = catalog.clone(),
        Event::SettingsSet { settings } => s.settings = settings.clone(),
        Event::Attention { .. } | Event::HostNotice { .. } => {}
        Event::OrchMessage { message } => {
            let msgs = &mut s.orchestrator.messages;
            match msgs.iter_mut().rev().find(|m| m.id == message.id) {
                Some(m) => *m = message.clone(),
                None => msgs.push(message.clone()),
            }
            crate::orch::trim(msgs);
        }
        Event::OrchStatus { ready, keys, busy } => {
            s.orchestrator.ready = *ready;
            s.orchestrator.keys = keys.clone();
            s.orchestrator.busy = *busy;
        }
        Event::OrchCleared => s.orchestrator.messages.clear(),
        Event::SwarmUpsert { swarm } => match s.swarms.iter_mut().find(|w| w.id == swarm.id) {
            Some(w) => *w = swarm.clone(),
            None => s.swarms.push(swarm.clone()),
        },
        Event::SwarmRemoved { id } => {
            s.swarms.retain(|w| &w.id != id);
            s.swarm_messages.retain(|m| &m.swarm_id != id);
        }
        Event::SwarmMessage { message } => {
            match s.swarm_messages.iter_mut().rev().find(|m| m.id == message.id) {
                Some(m) => *m = message.clone(),
                None => s.swarm_messages.push(message.clone()),
            }
            crate::swarm::trim(&mut s.swarm_messages, &message.swarm_id);
        }
    }
}

/// `Leas-MacBook.local` → `Leas-MacBook`; at most 64 characters (what the relay accepts).
fn host_name(raw: &str) -> String {
    let name: String = raw.split('.').next().unwrap_or("").trim().chars().take(64).collect();
    if name.is_empty() { "Computer".into() } else { name }
}

fn host_id(paths: &Paths) -> Id {
    let p = paths.root.join("host_id");
    if let Ok(s) = std::fs::read_to_string(&p) {
        let s = s.trim().to_string();
        if !s.is_empty() {
            return s;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = write_private(&p, id.as_bytes());
    id
}

fn git_err(e: anyhow::Error) -> ApiError {
    err(ErrorCode::BadRequest, format!("{e:#}"))
}

/// Runs blocking work (git, file scans) off the async threads.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> std::result::Result<T, ApiError> + Send + 'static,
) -> std::result::Result<T, ApiError> {
    tokio::task::spawn_blocking(f).await.map_err(|e| err(ErrorCode::Internal, e.to_string()))?
}

/// `Claude (Haiku)` → `claude-haiku`, for worktree folder and branch names.
fn slug(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "agent".into() } else { s.chars().take(24).collect() }
}

#[cfg(test)]
mod tests {
    #[test]
    fn host_names_fit_the_relay() {
        assert_eq!(super::host_name("Leas-MacBook.local"), "Leas-MacBook");
        assert_eq!(super::host_name(""), "Computer");
        assert_eq!(super::host_name(&"a".repeat(80)).len(), 64);
    }

    #[test]
    fn only_an_api_error_fails_a_turn() {
        let dir = std::env::temp_dir().join(format!("na-turn-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let ok = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}"#;
        let err = r#"{"type":"assistant","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"API Error"}]}}"#;
        std::fs::write(&path, format!("{ok}\n{{\"type\":\"system\"}}\n")).unwrap();
        assert_eq!(super::turn_failed(&path), Some(false));
        std::fs::write(&path, format!("{ok}\n{err}\n")).unwrap();
        assert_eq!(super::turn_failed(&path), Some(true));
        assert_eq!(super::turn_failed(&dir.join("missing")), None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
