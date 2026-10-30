//! Neural, the orchestrator: a conversation with the user's own model that starts, prompts,
//! watches and stops agents on this computer.
//!
//! Neural acts as its own client (`ClientKind::Orchestrator`), so the same approval rules and
//! the audit log apply as for a phone. The model sees the computer's workspaces and agents
//! fresh on every step; tools do the rest.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use na_protocol::{
    AgentStatus, ApiError, ClientInfo, ClientKind, ErrorCode, Event, LlmCheck, LlmProvider, OrchMessage, OrchRole, Request, StartSession,
    State,
};
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::core::{Core, err, now_ms};
use crate::llm::{Ask, Call, Llm, Msg, Tool};

/// Messages kept in the shared state (and sent to the model as history).
const KEEP: usize = 60;
const HISTORY: usize = 30;
/// Model steps per user message (each step may run tools).
const MAX_STEPS: usize = 8;

#[derive(Default)]
pub struct Orch {
    llm: Llm,
    running: Mutex<Option<CancellationToken>>,
    next: AtomicU64,
}

/// Where an answer goes besides the chat: the call speaks it.
pub type Speech = mpsc::UnboundedSender<String>;

fn me() -> ClientInfo {
    ClientInfo { kind: ClientKind::Orchestrator, name: "Neural".into(), device_id: None }
}

fn provider_name(p: LlmProvider) -> &'static str {
    match p {
        LlmProvider::Neuralhub => "neuralhub",
        LlmProvider::Anthropic => "anthropic",
        LlmProvider::Openai => "openai",
        LlmProvider::Ollama => "ollama",
    }
}

const PROVIDERS: [LlmProvider; 4] = [LlmProvider::Neuralhub, LlmProvider::Anthropic, LlmProvider::Openai, LlmProvider::Ollama];

impl Core {
    /// The key for the chosen provider. `NEURALAGENT_LLM_KEY` overrides (tests, servers).
    fn llm_key(&self, p: LlmProvider) -> Option<String> {
        std::env::var("NEURALAGENT_LLM_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| crate::secrets::get(&self.paths.root, &format!("llm:{}", provider_name(p))))
    }

    /// Recomputes whether Neural can answer (after a key or settings change).
    pub fn orch_status(&self) {
        let keys: Vec<LlmProvider> = PROVIDERS.into_iter().filter(|p| self.llm_key(*p).is_some()).collect();
        let provider = self.read(|s| s.settings.llm.provider);
        let ready = !crate::llm::needs_key(provider) || keys.contains(&provider);
        let busy = self.orch.running.lock().is_some();
        let cur = self.read(|s| (s.orchestrator.ready, s.orchestrator.keys.clone(), s.orchestrator.busy));
        if cur != (ready, keys.clone(), busy) {
            self.emit(Event::OrchStatus { ready, keys, busy });
        }
    }

    pub fn llm_key_set(&self, provider: LlmProvider, key: Option<String>) -> Result<(), ApiError> {
        let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
        crate::secrets::set(&self.paths.root, &format!("llm:{}", provider_name(provider)), key.as_deref())
            .map_err(|e| err(ErrorCode::Internal, format!("cannot store the key: {e:#}")))?;
        self.orch_status();
        Ok(())
    }

    pub async fn llm_test(&self) -> LlmCheck {
        let cfg = self.read(|s| s.settings.llm.clone());
        let key = self.llm_key(cfg.provider);
        let r = self
            .orch
            .llm
            .turn(
                &cfg,
                Ask {
                    model: &cfg.model,
                    key: key.as_deref(),
                    system: "Answer with one word.",
                    msgs: &[Msg::User("Say ok.".into())],
                    tools: &[],
                    quick: false,
                },
                |_| {},
            )
            .await;
        match r {
            Ok(t) => LlmCheck { ok: true, model: cfg.model, ms: t.first_ms.unwrap_or(0), error: None },
            Err(e) => LlmCheck { ok: false, model: cfg.model, ms: 0, error: Some(format!("{e:#}")) },
        }
    }

    fn orch_id(&self) -> String {
        format!("m{}-{}", now_ms(), self.orch.next.fetch_add(1, Ordering::Relaxed))
    }

    fn orch_post(&self, role: OrchRole, text: impl Into<String>, ok: Option<bool>, session_id: Option<String>) -> OrchMessage {
        let m = OrchMessage { id: self.orch_id(), role, text: text.into(), at: now_ms(), ok, session_id };
        self.emit(Event::OrchMessage { message: m.clone() });
        m
    }

    pub fn orch_stop(&self) {
        if let Some(t) = self.orch.running.lock().take() {
            t.cancel();
        }
        self.orch_status();
    }

    pub fn orch_clear(&self) {
        self.orch_stop();
        self.emit(Event::OrchCleared);
    }

    /// A user message from any client: answered in the background, the answer streams into
    /// the shared conversation. With `speech` each finished sentence is also sent there.
    pub fn orch_send(self: &Arc<Self>, text: String, speech: Option<Speech>, voice: bool) -> Result<(), ApiError> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err(err(ErrorCode::BadRequest, "nothing to send"));
        }
        if !self.read(|s| s.orchestrator.ready) {
            return Err(err(ErrorCode::Unavailable, "Neural has no model yet: add a key in Settings → Neural on the computer"));
        }
        // A new message interrupts the answer in progress, like in a conversation.
        let token = CancellationToken::new();
        if let Some(old) = self.orch.running.lock().replace(token.clone()) {
            old.cancel();
        }
        self.orch_status();
        self.orch_post(OrchRole::User, text, None, None);
        let core = self.clone();
        tokio::spawn(async move {
            let r = tokio::select! {
                r = core.orch_turn(speech, voice, &token) => r,
                _ = token.cancelled() => Ok(()),
            };
            if let Err(e) = r {
                tracing::warn!("neural: {e:#}");
                core.orch_post(OrchRole::Notice, format!("Neural could not answer: {e:#}"), Some(false), None);
            }
            {
                // Only clear the slot if no newer message replaced this answer.
                let mut run = core.orch.running.lock();
                if !token.is_cancelled() {
                    *run = None;
                }
            }
            core.orch_status();
        });
        Ok(())
    }

    async fn orch_turn(self: &Arc<Self>, speech: Option<Speech>, voice: bool, token: &CancellationToken) -> anyhow::Result<()> {
        let cfg = self.read(|s| s.settings.llm.clone());
        let model = if voice && !cfg.call_model.trim().is_empty() { cfg.call_model.clone() } else { cfg.model.clone() };
        let key = self.llm_key(cfg.provider);
        // Calls keep less history: a shorter prompt answers faster.
        let mut msgs = self.read(|s| history(s, if voice { HISTORY / 3 } else { HISTORY }));
        let tools = tools();
        // In calls the first words matter most: the first piece may end at a comma.
        let mut spoken = false;
        for _ in 0..MAX_STEPS {
            if token.is_cancelled() {
                return Ok(());
            }
            let system = self.read(|s| system_prompt(s, voice));
            let mut answer = self.orch_post(OrchRole::Assistant, "", None, None);
            let mut last_emit = Instant::now();
            let mut sentence = String::new();
            let started = Instant::now();
            let turn = self
                .orch
                .llm
                .turn(&cfg, Ask { model: &model, key: key.as_deref(), system: &system, msgs: &msgs, tools: &tools, quick: voice }, |t| {
                    answer.text.push_str(t);
                    if last_emit.elapsed() > Duration::from_millis(60) {
                        last_emit = Instant::now();
                        self.emit(Event::OrchMessage { message: answer.clone() });
                    }
                    if let Some(tx) = &speech {
                        sentence.push_str(t);
                        while let Some(i) = sentence_end(&sentence, !spoken) {
                            spoken = true;
                            let s: String = sentence.drain(..i).collect();
                            let _ = tx.send(s.trim().to_string());
                        }
                    }
                })
                .await?;
            if let Some(tx) = &speech
                && !sentence.trim().is_empty()
            {
                let _ = tx.send(sentence.trim().to_string());
            }
            tracing::info!(
                model,
                first_ms = turn.first_ms,
                total_ms = started.elapsed().as_millis() as u64,
                input = turn.input_tokens,
                output = turn.output_tokens,
                tools = turn.calls.len(),
                "neural step"
            );
            answer.text = turn.text.trim().to_string();
            answer.ok = Some(true);
            if answer.text.is_empty() {
                // Only tool calls: no empty bubble.
                answer.ok = Some(false);
                answer.text.clear();
            }
            self.emit(Event::OrchMessage { message: answer });
            msgs.push(Msg::Assistant { text: turn.text.clone(), calls: turn.calls.clone() });
            if turn.calls.is_empty() {
                return Ok(());
            }
            for call in &turn.calls {
                if token.is_cancelled() {
                    return Ok(());
                }
                let (content, label, ok, sid) = self.run_tool(call).await;
                tracing::info!(tool = call.name, args = %call.args, ok, "neural tool");
                if let Some(label) = label {
                    self.orch_post(OrchRole::Action, label, Some(ok), sid);
                }
                msgs.push(Msg::Tool { id: call.id.clone(), content });
            }
        }
        Ok(())
    }

    /// Runs one tool. Returns what the model sees, an optional line for the chat, success
    /// and the agent it was about.
    async fn run_tool(self: &Arc<Self>, call: &Call) -> (String, Option<String>, bool, Option<String>) {
        let a = &call.args;
        let s = |k: &str| a[k].as_str().map(str::trim).filter(|v| !v.is_empty()).map(str::to_string);
        match call.name.as_str() {
            "find_folder" => {
                let q = s("query").unwrap_or_default();
                let found = self.find_folders(&q);
                (json!({ "matches": found }).to_string(), None, true, None)
            }
            "start_agent" => {
                let Some(folder) = s("folder") else { return fail("folder is missing") };
                let ws = match self.resolve_workspace(&folder).await {
                    Ok(w) => w,
                    Err(e) => return fail(&e.message),
                };
                let profile =
                    s("agent").map(|p| self.resolve_profile(&p)).unwrap_or_else(|| Ok(self.read(|st| st.settings.default_profile.clone())));
                let profile = match profile {
                    Ok(p) => p,
                    Err(e) => return fail(&e.message),
                };
                let start = StartSession {
                    workspace_id: ws.0.clone(),
                    profile_id: profile.clone(),
                    prompt: s("prompt"),
                    pane_id: None,
                    cols: None,
                    rows: None,
                    resume: None,
                    cwd: None,
                    worktree: a["worktree"].as_bool(),
                };
                match self.handle(&me(), Request::SessionStart(start)).await {
                    Ok(v) => {
                        let sid = v["id"].as_str().unwrap_or("").to_string();
                        let pname = self.read(|st| st.profiles.iter().find(|p| p.id == profile).map(|p| p.name.clone())).unwrap_or(profile);
                        let label = format!("Started {pname} in {}", ws.1);
                        (json!({ "ok": true, "agent": short(&sid) }).to_string(), Some(label), true, Some(sid))
                    }
                    Err(e) => (
                        json!({ "ok": false, "error": e.message }).to_string(),
                        Some(format!("Could not start an agent in {}: {}", ws.1, e.message)),
                        false,
                        None,
                    ),
                }
            }
            "send_to_agent" => {
                let (Some(agent), Some(text)) = (s("agent"), s("text")) else { return fail("agent and text are needed") };
                let Some((sid, name)) = self.resolve_session(&agent) else { return fail("no such agent") };
                match self.handle(&me(), Request::SessionPrompt { id: sid.clone(), text }).await {
                    Ok(_) => (json!({ "ok": true }).to_string(), Some(format!("Prompted {name}")), true, Some(sid)),
                    Err(e) => (
                        json!({ "ok": false, "error": e.message }).to_string(),
                        Some(format!("Could not prompt {name}: {}", e.message)),
                        false,
                        Some(sid),
                    ),
                }
            }
            "read_agent" => {
                let Some(agent) = s("agent") else { return fail("agent is missing") };
                let Some((sid, _)) = self.resolve_session(&agent) else { return fail("no such agent") };
                let screen = self.pty(&sid).map(|p| p.screen_text()).unwrap_or_default();
                let last = self.read(|st| st.sessions.get(&sid).and_then(|x| x.last_message.clone()));
                (json!({ "screen": tail(&screen, 3500), "last_message": last }).to_string(), None, true, Some(sid))
            }
            "stop_agent" => {
                let Some(agent) = s("agent") else { return fail("agent is missing") };
                let Some((sid, name)) = self.resolve_session(&agent) else { return fail("no such agent") };
                match self.handle(&me(), Request::SessionStop { id: sid.clone() }).await {
                    Ok(_) => (json!({ "ok": true, "stopped": name }).to_string(), Some(format!("Stopped {name}")), true, Some(sid)),
                    Err(e) => (
                        json!({ "ok": false, "error": e.message }).to_string(),
                        Some(format!("Could not stop {name}: {}", e.message)),
                        false,
                        Some(sid),
                    ),
                }
            }
            other => fail(&format!("unknown tool {other}")),
        }
    }

    /// Workspace id and name for a workspace id, name or folder path; a folder that is not a
    /// workspace yet is added (and listed in the audit log).
    async fn resolve_workspace(self: &Arc<Self>, folder: &str) -> Result<(String, String), ApiError> {
        let norm = squash(folder);
        if let Some(w) = self.read(|s| {
            s.workspaces
                .iter()
                .find(|w| w.id == folder || w.path == folder || squash(&w.name) == norm)
                .map(|w| (w.id.clone(), w.name.clone()))
        }) {
            return Ok(w);
        }
        let path = std::path::Path::new(folder);
        if !path.is_absolute() || !path.is_dir() {
            return Err(err(ErrorCode::NotFound, format!("no workspace or folder \"{folder}\"; use find_folder")));
        }
        let v = self.handle(&me(), Request::WorkspaceAdd { path: folder.to_string(), name: None }).await?;
        Ok((v["id"].as_str().unwrap_or("").to_string(), v["name"].as_str().unwrap_or(folder).to_string()))
    }

    fn resolve_profile(&self, p: &str) -> Result<String, ApiError> {
        let n = squash(p);
        self.read(|s| {
            s.profiles
                .iter()
                .filter(|x| !x.id.starts_with(crate::profiles::INSTALL_PREFIX))
                .find(|x| x.id == p || squash(&x.name) == n || squash(&x.engine) == n)
                .or_else(|| s.profiles.iter().find(|x| squash(&x.name).starts_with(&n) || squash(&x.engine).starts_with(&n)))
                .map(|x| x.id.clone())
        })
        .ok_or_else(|| err(ErrorCode::NotFound, format!("no agent type \"{p}\"")))
    }

    /// Session id and "Workspace — Title" for a short id, full id or title.
    fn resolve_session(&self, agent: &str) -> Option<(String, String)> {
        let n = squash(agent);
        self.read(|s| {
            let label = |x: &na_protocol::Session| {
                let ws = s.workspaces.iter().find(|w| w.id == x.workspace_id).map(|w| w.name.as_str()).unwrap_or("?");
                format!("{ws} — {}", x.title)
            };
            let mut all: Vec<_> = s.sessions.values().filter(|x| x.alive).collect();
            all.sort_by_key(|x| std::cmp::Reverse(x.started_at));
            all.iter()
                .find(|x| x.id == agent || short(&x.id) == agent)
                .or_else(|| all.iter().find(|x| squash(&label(x)) == n || squash(&x.title) == n))
                .or_else(|| all.iter().find(|x| squash(&label(x)).contains(&n)))
                .map(|x| (x.id.clone(), label(x)))
        })
    }

    /// Workspaces and folders whose name matches what the user said ("Japan Map").
    fn find_folders(&self, query: &str) -> Vec<Value> {
        let q = squash(query);
        if q.is_empty() {
            return vec![];
        }
        let mut out: Vec<(f32, Value)> = self.read(|s| {
            s.workspaces
                .iter()
                .filter_map(|w| {
                    let score = similarity(&q, &squash(&w.name)).max(similarity(&q, &squash(last_part(&w.path))));
                    (score > 0.5)
                        .then(|| (score + 0.2, json!({ "workspace": w.id, "name": w.name, "path": w.path, "approved": w.approved })))
                })
                .collect()
        });
        let known: Vec<String> = self.read(|s| s.workspaces.iter().map(|w| w.path.clone()).collect());
        for dir in candidate_dirs(&self.env.home) {
            let name = last_part(&dir.to_string_lossy()).to_string();
            let score = similarity(&q, &squash(&name));
            let path = dir.to_string_lossy().into_owned();
            if score > 0.6 && !known.contains(&path) {
                out.push((score, json!({ "name": name, "path": path, "workspace": null })));
            }
        }
        out.sort_by(|a, b| b.0.total_cmp(&a.0));
        out.into_iter().take(6).map(|x| x.1).collect()
    }
}

fn fail(msg: &str) -> (String, Option<String>, bool, Option<String>) {
    (json!({ "ok": false, "error": msg }).to_string(), None, false, None)
}

/// First 6 characters of an id: what the model uses to name agents.
fn short(id: &str) -> String {
    id.chars().take(6).collect()
}

fn tail(s: &str, max: usize) -> String {
    let t = s.trim_end();
    let lines: Vec<&str> = t.lines().map(str::trim_end).filter(|l| !l.is_empty()).collect();
    let mut out = String::new();
    for l in lines.iter().rev() {
        if out.len() + l.len() + 1 > max {
            break;
        }
        out.insert_str(0, &format!("{l}\n"));
    }
    out
}

fn last_part(path: &str) -> &str {
    path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Lowercase letters and digits only: "Japan-Map" and "japan map" are the same.
fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// 1.0 for equal, high for one containing the other, else a bigram overlap (Dice).
fn similarity(a: &str, b: &str) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    if b.contains(a) || a.contains(b) {
        return 0.85 * a.len().min(b.len()) as f32 / a.len().max(b.len()) as f32 + 0.1;
    }
    let grams = |s: &str| -> Vec<(char, char)> {
        let c: Vec<char> = s.chars().collect();
        c.windows(2).map(|w| (w[0], w[1])).collect()
    };
    let (ga, mut gb) = (grams(a), grams(b));
    let total = ga.len() + gb.len();
    let mut hits = 0;
    for g in ga {
        if let Some(i) = gb.iter().position(|x| *x == g) {
            gb.swap_remove(i);
            hits += 1;
        }
    }
    if total == 0 { 0.0 } else { 2.0 * hits as f32 / total as f32 }
}

/// Project folders people usually keep: two levels below the usual places in the home folder.
fn candidate_dirs(home: &std::path::Path) -> Vec<std::path::PathBuf> {
    const ROOTS: &[&str] =
        &["Documents", "Developer", "Projects", "projects", "Code", "code", "dev", "src", "repos", "git", "GitHub", "Desktop", "work"];
    let mut out = vec![];
    let list = |d: &std::path::Path| -> Vec<std::path::PathBuf> {
        std::fs::read_dir(d)
            .map(|r| {
                r.flatten()
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                    .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    .map(|e| e.path())
                    .take(400)
                    .collect()
            })
            .unwrap_or_default()
    };
    for r in ROOTS {
        let root = home.join(r);
        for d in list(&root) {
            out.extend(
                list(&d).into_iter().filter(|x| !["node_modules", "target", "build", "dist"].contains(&last_part(&x.to_string_lossy()))),
            );
            out.push(d);
        }
    }
    out
}

/// Where a spoken sentence ends (after ". ", "? ", "! " or a newline), as a byte index. With
/// `eager` a longer clause ending in ", " counts too.
fn sentence_end(s: &str, eager: bool) -> Option<usize> {
    let b = s.as_bytes();
    (1..b.len())
        .find(|&i| {
            let end = matches!(b[i - 1], b'.' | b'?' | b'!' | b':' | b';') && i > 12;
            let clause = eager && b[i - 1] == b',' && i > 24;
            ((end || clause) && b[i] == b' ') || b[i] == b'\n'
        })
        .map(|i| i + 1)
}

/// The conversation as the model sees it: user and assistant turns, with what Neural did and
/// what happened written as `[log]` notes.
fn history(s: &State, keep: usize) -> Vec<Msg> {
    let msgs = &s.orchestrator.messages;
    let from = msgs.len().saturating_sub(keep);
    let mut out: Vec<Msg> = vec![];
    for m in &msgs[from..] {
        match m.role {
            OrchRole::User => out.push(Msg::User(m.text.clone())),
            OrchRole::Assistant if !m.text.is_empty() => out.push(Msg::Assistant { text: m.text.clone(), calls: vec![] }),
            // With the agent's short id, so "stop it again" knows which one.
            OrchRole::Action | OrchRole::Notice => out.push(Msg::User(match &m.session_id {
                Some(sid) => format!("[log] {} [{}]", m.text, short(sid)),
                None => format!("[log] {}", m.text),
            })),
            _ => {}
        }
    }
    // The model must not start with its own turn.
    while matches!(out.first(), Some(Msg::Assistant { .. })) {
        out.remove(0);
    }
    out
}

pub fn system_prompt(s: &State, voice: bool) -> String {
    let now = chrono::Local::now().format("%A %Y-%m-%d %H:%M");
    let mut ctx = String::new();
    ctx.push_str("Workspaces (folders agents may work in):\n");
    for w in &s.workspaces {
        ctx.push_str(&format!(
            "- {} ({}){}\n",
            w.name,
            w.path,
            if w.approved { "" } else { " — not approved: ask the user to approve it on the computer" }
        ));
    }
    if s.workspaces.is_empty() {
        ctx.push_str("- none yet\n");
    }
    ctx.push_str("\nAgents:\n");
    let mut sessions: Vec<_> = s.sessions.values().filter(|x| x.alive || x.status == AgentStatus::Exited).collect();
    sessions.sort_by_key(|x| std::cmp::Reverse(x.started_at));
    let mut n = 0;
    for x in sessions.iter().filter(|x| x.alive).chain(sessions.iter().filter(|x| !x.alive).take(5)) {
        let ws = s.workspaces.iter().find(|w| w.id == x.workspace_id).map(|w| w.name.as_str()).unwrap_or("?");
        let mins = (now_ms() - x.status_since) / 60000;
        let status = format!("{:?}", x.status).to_lowercase();
        let last = x
            .last_message
            .as_deref()
            .or(x.last_line.as_deref())
            .map(|l| format!(" — last: {}", l.chars().take(160).collect::<String>()))
            .unwrap_or_default();
        ctx.push_str(&format!("- [{}] {ws} — {} ({}), {status} for {mins} min{last}\n", short(&x.id), x.title, x.profile_id));
        n += 1;
    }
    if n == 0 {
        ctx.push_str("- none running\n");
    }
    let types: Vec<String> = s
        .profiles
        .iter()
        .filter(|p| !p.id.starts_with(crate::profiles::INSTALL_PREFIX) && p.id != "shell")
        .filter(|p| !p.builtin || s.catalog.is_empty() || s.catalog.iter().any(|c| c.id == p.engine && c.installed))
        .map(|p| format!("{} (id {})", p.name, p.id))
        .collect();
    ctx.push_str(&format!("\nAgent types installed: {}. Default: {}.\n", types.join(", "), s.settings.default_profile));

    // Long German histories pull answers to German; say plainly what the latest message is in.
    let latest = s.orchestrator.messages.iter().rev().find(|m| m.role == OrchRole::User).map(|m| m.text.as_str()).unwrap_or("");
    let lang = match crate::call::lang_of(latest, "") {
        "de" => " The user's latest message is in German: answer in German.",
        "en" => " The user's latest message is in English: answer in English.",
        _ => "",
    };
    let style = if voice {
        "You are on a phone call. Speak like a competent colleague on the phone: one or two short, natural \
         sentences, at most about 30 words, unless the user asks for details. Never use lists, markdown, code, file \
         paths, quotes or ids out loud; say folder and agent names naturally. The call already plays a short \
         acknowledgment when the user stops talking, so do not start with \"Okay\" or \"Sure\". Before a tool call \
         say a few words of what you do (\"Ich schau kurz nach.\"); after it, say the result in one sentence and \
         trust what the tool returned."
    } else {
        "You are in a chat. Keep answers short and plain; a short list is fine when it helps. No headings."
    };
    format!(
        "You are Neural, the orchestrator inside NeuralAgent on the computer \"{host}\". The user runs AI coding \
         agents (Claude Code, Codex and others) in terminal panes on this computer, and talks to you from the desktop \
         or their phone. You start, prompt, watch, summarise and stop those agents for them.\n\n\
         {style}\n\n\
         Rules:\n\
         - Answer in the language of the user's latest message, even if earlier ones were in another language \
         (German or English; they mix technical English words into German). \
         In German use the informal \"du\".\n\
         - Find folders from everyday names (\"Japan Map\" → the Japan Map workspace). If the workspace list does not \
         clearly match, call find_folder; if two match, ask which one in a few words.\n\
         - Turn the user's half sentence into a good prompt for the agent: clear goal, the context they gave, what \
         \"done\" means. Before starting or prompting, say in one short sentence what you are sending, then call the \
         tool in the same answer.\n\
         - For status questions use the agent list below; call read_agent only when you need to know what an agent \
         is doing in detail. Summarise; never read terminal output out.\n\
         - Lines starting with [log] are records of what happened (your actions, agents finishing). Do not write \
         [log] lines yourself.\n\
         - Agents may only be started in approved workspaces; if a tool says something needs confirmation on the \
         computer, tell the user plainly.\n\
         - Agent references in tools: the short id in brackets. Never show ids to the user; name agents by \
         workspace and title. \"it\" or \"the agent\" usually means the one you last started or talked about; \
         the [log] lines carry its id.\n\
         - The agent list below is live: it already includes agents you just started.\n\
         - Trust tool results. Do not correct, revisit or repeat earlier answers unless the user asks.\n\n\
         Now: {now}.{lang}\n\n{ctx}",
        host = s.remote.devices.iter().find(|d| d.this).map(|d| d.name.as_str()).unwrap_or("this computer"),
    )
}

fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "find_folder",
            description: "Find workspaces and project folders on this computer whose name matches what the user said.",
            params: json!({ "type": "object", "properties": { "query": { "type": "string", "description": "Folder name as the user said it" } }, "required": ["query"] }),
        },
        Tool {
            name: "start_agent",
            description: "Start an agent in a workspace (name or id) or a folder path from find_folder, optionally with a first prompt. It opens as a new pane on the computer.",
            params: json!({ "type": "object", "properties": {
                "folder": { "type": "string", "description": "Workspace name, or folder path from find_folder" },
                "agent": { "type": "string", "description": "Agent type id, e.g. claude or codex; omit for the default" },
                "prompt": { "type": "string", "description": "The task, written as a good prompt for a coding agent" },
                "worktree": { "type": "boolean", "description": "Work in a separate git worktree (only when asked)" }
            }, "required": ["folder"] }),
        },
        Tool {
            name: "send_to_agent",
            description: "Send a prompt or an answer to a running agent.",
            params: json!({ "type": "object", "properties": { "agent": { "type": "string", "description": "Short id" }, "text": { "type": "string" } }, "required": ["agent", "text"] }),
        },
        Tool {
            name: "read_agent",
            description: "Read the agent's current screen and last message to see what it is doing or asking.",
            params: json!({ "type": "object", "properties": { "agent": { "type": "string", "description": "Short id" } }, "required": ["agent"] }),
        },
        Tool {
            name: "stop_agent",
            description: "Stop (interrupt) a running agent.",
            params: json!({ "type": "object", "properties": { "agent": { "type": "string", "description": "Short id" } }, "required": ["agent"] }),
        },
    ]
}

/// Agents that finish, fail or wait become notices in the conversation, so Neural knows and the
/// chat shows it.
pub async fn watch(core: Arc<Core>) {
    let mut rx = core.subscribe(None).rx;
    loop {
        match rx.recv().await {
            Ok((_, Event::Attention { session_id, kind, text })) => {
                let Some(label) = core
                    .resolve_session(&session_id)
                    .map(|x| x.1)
                    .or_else(|| core.read(|s| s.sessions.get(&session_id).map(|x| x.title.clone())))
                else {
                    continue;
                };
                let what = match kind {
                    na_protocol::AttentionKind::Done => "finished",
                    na_protocol::AttentionKind::Waiting => "needs input",
                    na_protocol::AttentionKind::Error => "stopped with an error",
                };
                let detail =
                    if text.trim().is_empty() { String::new() } else { format!(": {}", text.chars().take(200).collect::<String>()) };
                core.orch_post(OrchRole::Notice, format!("{label} {what}{detail}"), None, Some(session_id.clone()));
                if let Some((ws, title)) = core.read(|s| {
                    s.sessions.get(&session_id).map(|x| {
                        let ws = s.workspaces.iter().find(|w| w.id == x.workspace_id).map(|w| w.name.clone()).unwrap_or_default();
                        (ws, x.title.clone())
                    })
                }) {
                    core.call_news(kind, ws, title);
                }
            }
            Ok(_) => {}
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
            Err(_) => return,
        }
    }
}

pub fn trim(messages: &mut Vec<OrchMessage>) {
    if messages.len() > KEEP {
        messages.drain(..messages.len() - KEEP);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_match_loosely() {
        assert!(similarity(&squash("Japan Map"), &squash("japan-map")) > 0.99);
        assert!(similarity(&squash("japan map"), &squash("JapanMapApp")) > 0.6);
        assert!(similarity(&squash("japan map"), &squash("NeuralAgent")) < 0.4);
        assert!(similarity(&squash("neural agent"), &squash("NeuralAgent")) > 0.99);
    }

    #[test]
    fn sentences_split_for_speech() {
        let s = "Okay, moment please. I am starting it now";
        let i = sentence_end(s, false).unwrap();
        assert_eq!(&s[..i], "Okay, moment please. ");
        assert_eq!(sentence_end("Ok. Fine", false), None, "very short pieces wait for more");
        let s = "Der Agent in Japan Map arbeitet noch, er schreibt gerade Tests";
        assert_eq!(&s[..sentence_end(s, true).unwrap()], "Der Agent in Japan Map arbeitet noch, ");
        assert_eq!(sentence_end(s, false), None);
    }

    #[test]
    fn tail_keeps_the_last_lines() {
        assert_eq!(tail("a\nb\n\nc\n", 4), "b\nc\n");
    }
}
