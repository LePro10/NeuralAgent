//! Neural, the orchestrator: a conversation with the user's own model that starts, prompts,
//! reviews and follows up agents on this computer (D61–D64, docs/notes/neural-v2.md).
//!
//! Every model step sees three things: static instructions, a fresh `<world>` block (tasks,
//! agents, what is new, memory; `neural::world`) and the conversation with the user only
//! (`neural::history`). Agent events never enter the conversation; the observer in `neural`
//! wakes Neural when something matters, and what it says on its own is marked `proactive`.
//!
//! Neural acts as its own client (`ClientKind::Orchestrator`), so the same approval rules and
//! the audit log apply as for a phone.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use na_protocol::{
    AgentStatus, ApiError, ClientInfo, ClientKind, ErrorCode, Event, Id, LlmCheck, LlmProvider, OrchMessage, OrchRole, Request, State,
};
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::core::{Core, err, now_ms};
use crate::llm::{Ask, Llm, Msg};
use crate::neural::{history, tools, world};

/// Messages kept in the shared state (older ones live on in `neural.summary`).
const KEEP: usize = 100;
const HISTORY: usize = 30;
/// Model steps per user message (each step may run tools), and per wake-up.
const MAX_STEPS: usize = 8;
const WAKE_STEPS: usize = 4;

#[derive(Default)]
pub struct Orch {
    llm: Llm,
    /// The turn in progress.
    running: Mutex<Option<CancellationToken>>,
    next: AtomicU64,
    pub neural: crate::neural::Runtime,
}

/// Where an answer goes besides the chat: the call speaks it.
pub type Speech = mpsc::UnboundedSender<String>;

/// Why Neural takes a turn.
#[derive(Debug, Clone)]
pub enum Trigger {
    /// The user wrote (the message is already in the conversation).
    User,
    /// The observer: these new observations may matter.
    Wake(Vec<Id>),
    /// The user confirmed an action; carry on.
    Resume(String),
}

pub(crate) fn me() -> ClientInfo {
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

    /// Moves keys an older version kept in the macOS keychain into the key file, once
    /// (secrets.rs). Runs off the startup path; afterwards the status is computed again.
    pub fn migrate_keys(&self) {
        let accounts: Vec<String> = PROVIDERS.iter().map(|p| format!("llm:{}", provider_name(*p))).collect();
        if crate::secrets::migrate(&self.paths.root, &accounts) {
            self.orch_status();
        }
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
                    context: "",
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

    pub(crate) fn orch_post(&self, role: OrchRole, text: impl Into<String>, ok: Option<bool>, session_id: Option<String>) -> OrchMessage {
        let m = OrchMessage { id: self.orch_id(), role, text: text.into(), at: now_ms(), ok, session_id, proactive: false };
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
        // A fresh conversation: the summary of the old one goes too. Tasks and memory stay.
        self.neural_update(|n| {
            n.summary.clear();
            n.summary_upto = 0;
            for o in &mut n.observations {
                o.seen = true;
            }
        });
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
        // A new message interrupts the answer (or report) in progress, like in a conversation.
        let token = CancellationToken::new();
        if let Some(old) = self.orch.running.lock().replace(token.clone()) {
            old.cancel();
        }
        self.orch_status();
        self.neural_user_wrote();
        self.orch_post(OrchRole::User, text, None, None);
        self.orch_spawn(Trigger::User, speech, voice, token);
        Ok(())
    }

    /// Neural takes a turn on its own. Never interrupts the user: false when a turn is running.
    pub fn orch_wake(self: &Arc<Self>, trigger: Trigger) -> bool {
        if !self.read(|s| s.orchestrator.ready) {
            return false;
        }
        let token = CancellationToken::new();
        {
            let mut run = self.orch.running.lock();
            if run.is_some() {
                return false;
            }
            *run = Some(token.clone());
        }
        self.orch_status();
        self.orch_spawn(trigger, None, false, token);
        true
    }

    fn orch_spawn(self: &Arc<Self>, trigger: Trigger, speech: Option<Speech>, voice: bool, token: CancellationToken) {
        let core = self.clone();
        tokio::spawn(async move {
            let user = matches!(trigger, Trigger::User);
            let r = tokio::select! {
                r = core.orch_turn(trigger, speech, voice, &token) => r,
                _ = token.cancelled() => Ok(()),
            };
            if let Err(e) = r {
                tracing::warn!("neural: {e:#}");
                // A failed report is not worth a message; a failed answer is.
                if user {
                    core.orch_post(OrchRole::Notice, format!("Neural could not answer: {e:#}"), Some(false), None);
                } else {
                    core.neural_report_failed(&format!("{e:#}"));
                }
            }
            {
                // Only clear the slot if no newer message replaced this answer.
                let mut run = core.orch.running.lock();
                if !token.is_cancelled() {
                    *run = None;
                }
            }
            core.orch_status();
            core.orch_compact();
        });
    }

    /// Open prompts of waiting agents, for the world block.
    fn waiting_prompts(&self) -> HashMap<Id, na_protocol::CvPrompt> {
        let waiting: Vec<Id> =
            self.read(|s| s.sessions.values().filter(|x| x.alive && x.status == AgentStatus::Waiting).map(|x| x.id.clone()).collect());
        waiting.into_iter().filter_map(|sid| self.cv_current_prompt(&sid).map(|p| (sid, p))).collect()
    }

    /// The `<world>` block plus the language hint, and the observations it showed as new.
    fn orch_context(&self) -> (String, Vec<Id>) {
        let prompts = self.waiting_prompts();
        self.read(|s| {
            let cx = world::Ctx {
                now: now_ms(),
                clock: chrono::Local::now().format("%A %Y-%m-%d %H:%M").to_string(),
                host: s.remote.devices.iter().find(|d| d.this).map(|d| d.name.clone()).unwrap_or_else(|| "this computer".into()),
                prompts: &prompts,
            };
            let mut ctx = world::render(s, &cx);
            ctx.push_str(lang_hint(s));
            let new = s.neural.observations.iter().filter(|o| !o.seen).map(|o| o.id.clone()).collect();
            (ctx, new)
        })
    }

    async fn orch_turn(
        self: &Arc<Self>,
        trigger: Trigger,
        speech: Option<Speech>,
        voice: bool,
        token: &CancellationToken,
    ) -> anyhow::Result<()> {
        let cfg = self.read(|s| s.settings.llm.clone());
        let model = if voice && !cfg.call_model.trim().is_empty() { cfg.call_model.clone() } else { cfg.model.clone() };
        let key = self.llm_key(cfg.provider);
        // Calls keep less history: a shorter prompt answers faster.
        let mut msgs = self.read(|s| history::build(&s.orchestrator.messages, &s.neural, if voice { HISTORY / 3 } else { HISTORY }));
        let user = matches!(trigger, Trigger::User);
        match &trigger {
            Trigger::User => {}
            Trigger::Wake(ids) => push_user(
                &mut msgs,
                format!(
                    "(system) Wake-up: {} new observation(s), see \"New since your last turn\" in <world>. The user did \
                     not write. Act if it helps (review, check, follow up, answer an agent). Then either write the user a \
                     short note worth their attention, or answer exactly (quiet).",
                    ids.len()
                ),
            ),
            Trigger::Resume(note) => {
                push_user(&mut msgs, format!("(system) {note}\nCarry on from there and tell the user the outcome briefly."))
            }
        }
        let system = system_prompt(voice);
        let tools = tools::list();
        let mut shown: HashSet<Id> = HashSet::new();
        let mut said: Vec<String> = vec![];
        // In calls the first words matter most: the first piece may end at a comma.
        let mut spoken = false;
        for _ in 0..if user { MAX_STEPS } else { WAKE_STEPS } {
            if token.is_cancelled() {
                return Ok(());
            }
            let (context, new) = self.orch_context();
            shown.extend(new);
            let mut answer = OrchMessage {
                id: self.orch_id(),
                role: OrchRole::Assistant,
                text: String::new(),
                at: now_ms(),
                ok: None,
                session_id: None,
                proactive: !user,
            };
            let mut last_emit = Instant::now();
            let mut sentence = String::new();
            let started = Instant::now();
            let ask =
                Ask { model: &model, key: key.as_deref(), system: &system, context: &context, msgs: &msgs, tools: &tools, quick: voice };
            let turn = self
                .orch
                .llm
                .turn(&cfg, ask, |t| {
                    // Reports are posted whole (they may turn out to be "(quiet)").
                    if !user {
                        return;
                    }
                    answer.text.push_str(t);
                    if last_emit.elapsed() > Duration::from_millis(60) && !answer.text.trim().is_empty() {
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
                user,
                "neural step"
            );
            let ids: Vec<String> = self.read(|s| s.sessions.keys().map(|k| world::short(k)).collect());
            let text = scrub_ids(&clean_answer(&turn.text), &ids);
            if token.is_cancelled() {
                return Ok(());
            }
            if !text.is_empty() && !is_quiet(&text) {
                answer.text = text.clone();
                answer.ok = Some(true);
                self.emit(Event::OrchMessage { message: answer });
                said.push(text);
            } else if user && !answer.text.is_empty() {
                // Streamed something that turned out empty: blank the bubble.
                answer.text.clear();
                answer.ok = Some(false);
                self.emit(Event::OrchMessage { message: answer });
            }
            msgs.push(Msg::Assistant { text: turn.text.clone(), calls: turn.calls.clone() });
            if turn.calls.is_empty() {
                break;
            }
            for call in &turn.calls {
                if token.is_cancelled() {
                    return Ok(());
                }
                let o = self.neural_tool(call, false).await;
                tracing::info!(tool = call.name, ok = o.ok, "neural tool");
                if let Some(label) = o.label {
                    self.orch_post(OrchRole::Action, label, Some(o.ok), o.sid);
                }
                msgs.push(Msg::Tool { id: call.id.clone(), content: o.content });
            }
        }
        // What this turn showed as new is known now.
        if !shown.is_empty() {
            self.neural_update(|n| {
                for o in n.observations.iter_mut().filter(|o| shown.contains(&o.id)) {
                    o.seen = true;
                }
            });
        }
        if !user && !said.is_empty() {
            tracing::info!(words = said.iter().map(|s| s.split_whitespace().count()).sum::<usize>(), "neural reported");
        }
        Ok(())
    }

    /// Folds older turns into `neural.summary` once the conversation is long (in the background).
    fn orch_compact(self: &Arc<Self>) {
        let job = self.read(|s| {
            history::compaction(&s.orchestrator.messages, &s.neural)
                .map(|(old, upto)| (history::compaction_prompt(&s.neural.summary, &old), upto))
        });
        let Some((prompt, upto)) = job else { return };
        if self.orch.neural.compacting.swap(true, Ordering::SeqCst) {
            return;
        }
        let core = self.clone();
        tokio::spawn(async move {
            let cfg = core.read(|s| s.settings.llm.clone());
            let key = core.llm_key(cfg.provider);
            let model = if cfg.call_model.trim().is_empty() { cfg.model.clone() } else { cfg.call_model.clone() };
            let ask = Ask {
                model: &model,
                key: key.as_deref(),
                system: "You write short, factual summaries.",
                context: "",
                msgs: &[Msg::User(prompt)],
                tools: &[],
                quick: true,
            };
            match core.orch.llm.turn(&cfg, ask, |_| {}).await {
                Ok(t) if !t.text.trim().is_empty() => {
                    let text = crate::neural::observe::clip(t.text.trim(), 1200);
                    core.neural_update(|n| {
                        n.summary = text;
                        n.summary_upto = upto;
                    });
                    tracing::info!("neural: conversation compacted");
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("neural compaction: {e:#}"),
            }
            core.orch.neural.compacting.store(false, Ordering::SeqCst);
        });
    }

    /// Workspace id and name for a workspace id, name or folder path; a folder that is not a
    /// workspace yet is added (and listed in the audit log).
    pub(crate) async fn resolve_workspace(self: &Arc<Self>, folder: &str) -> Result<(String, String), ApiError> {
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
        // A folder macOS guards is not even looked at here; WorkspaceAdd says why (permissions).
        if !path.is_absolute() || (self.folder_ok(path) && !path.is_dir()) {
            return Err(err(ErrorCode::NotFound, format!("no workspace or folder \"{folder}\"; use find_folder")));
        }
        let v = self.handle(&me(), Request::WorkspaceAdd { path: folder.to_string(), name: None }).await?;
        Ok((v["id"].as_str().unwrap_or("").to_string(), v["name"].as_str().unwrap_or(folder).to_string()))
    }

    pub(crate) fn resolve_profile(&self, p: &str) -> Result<String, ApiError> {
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
    pub(crate) fn resolve_session(&self, agent: &str) -> Option<(String, String)> {
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
    pub(crate) fn find_folders(&self, query: &str) -> Vec<Value> {
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
        for dir in candidate_dirs(&self.env.home, |p| self.folder_ok(p)) {
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

/// First 6 characters of an id: what the model uses to name agents.
fn short(id: &str) -> String {
    id.chars().take(6).collect()
}

pub(crate) fn last_part(path: &str) -> &str {
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
/// `ok`: may this folder be read now (macOS privacy, see permissions.rs)?
fn candidate_dirs(home: &std::path::Path, ok: impl Fn(&std::path::Path) -> bool) -> Vec<std::path::PathBuf> {
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
        if !ok(&root) {
            continue;
        }
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

/// Adds a user-side line, merged into the last user message if there is one.
fn push_user(msgs: &mut Vec<Msg>, text: String) {
    match msgs.last_mut() {
        Some(Msg::User(t)) => {
            t.push_str("\n\n");
            t.push_str(&text);
        }
        _ => msgs.push(Msg::User(text)),
    }
}

/// The model sometimes copies the history's markers; the chat shows them differently.
fn clean_answer(text: &str) -> String {
    let t = text.trim();
    t.strip_prefix("(on your own)").unwrap_or(t).trim().to_string()
}

/// Agent short ids are for tools only; models still write them now and then ("Agent (27f4ab)").
fn scrub_ids(text: &str, ids: &[String]) -> String {
    let mut t = text.to_string();
    for id in ids.iter().filter(|i| i.len() == 6) {
        for pat in [format!(" ({id})"), format!(" [{id}]"), format!("({id})"), format!("[{id}]")] {
            t = t.replace(&pat, "");
        }
    }
    t
}

/// "(quiet)": nothing worth telling the user.
fn is_quiet(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    t.starts_with("(quiet)") || t.trim_matches(|c: char| !c.is_alphanumeric()) == "quiet"
}

/// Long German histories pull answers to German; say plainly what the latest message is in.
fn lang_hint(s: &State) -> &'static str {
    let latest = s.orchestrator.messages.iter().rev().find(|m| m.role == OrchRole::User).map(|m| m.text.as_str()).unwrap_or("");
    match crate::call::lang_of(latest, "") {
        "de" => "\nThe user's latest message is in German: write in German.",
        "en" => "\nThe user's latest message is in English: write in English.",
        _ => "",
    }
}

/// The instructions: the same every turn (cacheable). Everything that changes is in `<world>`.
pub fn system_prompt(voice: bool) -> String {
    let style = if voice {
        "You are on a phone call. Speak like a competent colleague on the phone: one or two short, natural \
         sentences, at most about 30 words, unless the user asks for details. Never use lists, markdown, code, file \
         paths, quotes or ids out loud; say folder and agent names naturally. The call already plays a short \
         acknowledgment when the user stops talking, so do not start with \"Okay\" or \"Sure\". Before a tool call \
         say a few words of what you do (\"Ich schau kurz nach.\"); after it, say the result in one sentence and \
         trust what the tool returned."
    } else {
        "You are in a chat. Keep answers short and plain; a short list is fine when it helps. No headings, no \
         greetings, no sign-off."
    };
    format!(
        "You are Neural, the user's chief of staff for their AI coding agents inside NeuralAgent. The user runs \
         agents (Claude Code, Codex and others) in terminal panes on their computer and talks to you from the \
         desktop or their phone. Launching agents is the easy part; your job is that the work gets done: you own \
         the tasks the user gives you and follow them up until they are really finished.\n\n\
         {style}\n\n\
         What you see:\n\
         - Every turn starts with a fresh <world> block: your tasks, the agents, what is new since your last turn, \
         confirmations waiting for the user, your memory and a summary of older conversation. It is the truth \
         right now. Use it; never recite it back. The conversation itself is only what you and the user said; \
         \"(did: …)\" lines record your own actions.\n\
         - Messages starting with \"(system)\" come from NeuralAgent, not from the user.\n\n\
         How you work:\n\
         - Turn the user's half sentence into a good prompt for the agent: clear goal, the context they gave, what \
         \"done\" means. Start work with start_agent and give it a task (or use track_task) so you can follow it \
         up; add a check command (tests, build) when the project has an obvious one.\n\
         - Find folders from everyday names (\"Japan Map\" → the Japan Map workspace); call find_folder when the \
         workspace list does not clearly match; if two match, ask which one in a few words.\n\
         - When an agent of yours finishes, do not just say \"done\". Look at what it said and changed \
         (inspect_agent, agent_changes) and run the task's check (run_check). Then report in two or three \
         sentences: what changed, whether the check passed, what is left. If it is not done, send the agent a \
         precise follow-up (send_to_agent) and keep the task open; mark it done (update_task) only when it is.\n\
         - When an agent asks something: answer it yourself (answer_agent) when the answer clearly follows from \
         the task and is safe; otherwise ask the user in one sentence with the options.\n\
         - Teams (start_team), only when the user asks or a change is big or risky: \"race\" lets 2 to 4 agents \
         try the same goal in separate worktrees; you compare the attempts and recommend one, the user picks. \
         \"review\" pairs a builder with a reviewer who loops until it approves. A team runs its own steps \
         (checks, the reviewer, feedback to the builder): do not prompt team agents yourself unless the team \
         is blocked; report its result when it is in.\n\
         - Memory: remember stable facts and preferences the user tells you (remember), in one short line each; \
         forget what turns out wrong. Do not store anything secret.\n\
         - Safety: never instruct agents to delete data, force push, reset, publish or deploy on your own. Tools \
         that need the user's OK return needs_confirmation: then tell the user in one sentence what is waiting \
         for their OK.\n\
         - In tools, agents are the short id in brackets and tasks their id (t1). Never show ids to the user; name \
         agents by workspace and title and tasks by their title.\n\
         - Trust tool results. Do not repeat or correct earlier answers unless the user asks.\n\n\
         Wake-ups: when something new happened while the user was not talking to you, you get a \"(system) \
         Wake-up\". Act if it helps. Then write to the user only if it is worth their attention: a task that is \
         finished and checked, a failure, a question only they can answer, an agent that is stuck. One to three \
         sentences, the news first. If nothing is worth saying, answer exactly (quiet).\n\n\
         Language: answer in the language of the user's latest message, even if earlier ones were in another \
         language (German or English; they mix technical English words into German). In German use the \
         informal \"du\"."
    )
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
    fn quiet_reports_stay_quiet() {
        assert!(is_quiet("(quiet)"));
        assert!(is_quiet(" quiet. "));
        assert!(is_quiet("(quiet) nothing new"));
        assert!(!is_quiet("Japan Map is done; the tests pass."));
        assert_eq!(clean_answer("(on your own) Fertig."), "Fertig.");
        assert_eq!(scrub_ids("Ich habe einen Agent (27f4ab) gestartet [27f4ab].", &["27f4ab".into()]), "Ich habe einen Agent gestartet.");
    }

    #[test]
    fn wake_notes_merge_into_the_last_user_message() {
        let mut m = vec![Msg::User("hi".into())];
        push_user(&mut m, "(system) Wake-up".into());
        assert_eq!(m.len(), 1);
        m.push(Msg::Assistant { text: "x".into(), calls: vec![] });
        push_user(&mut m, "(system) Wake-up".into());
        assert_eq!(m.len(), 3);
    }

    #[test]
    fn the_instructions_do_not_change_between_turns() {
        assert_eq!(system_prompt(false), system_prompt(false));
        assert!(system_prompt(true).contains("phone call"));
    }
}
