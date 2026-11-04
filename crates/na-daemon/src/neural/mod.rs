//! Neural v2 (D61–D64, docs/notes/neural-v2.md): the state Neural keeps besides the conversation
//! (tasks, memory, observations, confirmations), the observer that turns daemon events into
//! observations and wake-ups, and the requests the UI sends. The turn engine (talking to
//! the model) stays in `orch.rs`.

pub mod guard;
pub mod history;
pub mod observe;
pub mod pulse;
pub mod tasks;
pub mod tools;
pub mod world;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use na_protocol::{
    AgentStatus, ApiError, AttentionKind, CvAction, ErrorCode, Event, Id, NeuralMode, NeuralNote, NeuralObs, NeuralState, NeuralTaskStatus,
    ObsKind, OrchRole, Request,
};
use parking_lot::Mutex;
use serde_json::{Value, json};

use crate::core::{Core, err, now_ms};
use crate::llm::Call;
use crate::orch::{Trigger, me};
use observe::clip;

const NOTES: usize = 40;

/// Runtime parts of Neural that are not shared state.
#[derive(Default)]
pub struct Runtime {
    pub pulse: Mutex<pulse::Pulse>,
    stuck: Mutex<observe::Stuck>,
    /// Serialises read-modify-write of `State.neural`.
    lock: Mutex<()>,
    next: AtomicU64,
    pub compacting: AtomicBool,
    /// Attentions Neural raised itself (the observer skips them).
    own: Mutex<HashSet<(Id, String)>>,
    /// Wake-ups per task since the user last wrote (caps follow-up loops).
    wakes: Mutex<HashMap<Id, u32>>,
}

/// Wake-ups about one task before Neural waits for the user to write again.
pub const TASK_WAKES: u32 = 6;

fn file(root: &Path) -> PathBuf {
    root.join("neural.json")
}

/// Neural's state from the last run. Confirmations do not survive a restart (the agents they
/// were about are gone or changed).
pub fn load(root: &Path) -> NeuralState {
    let mut n: NeuralState = std::fs::read_to_string(file(root))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .map(|mut v| {
            // Older versions wrote observations of the removed "team" kind: drop them instead of losing the whole file.
            if let Some(obs) = v.get_mut("observations").and_then(Value::as_array_mut) {
                obs.retain(|o| o.get("kind").and_then(Value::as_str) != Some("team"));
            }
            v
        })
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    n.pending.clear();
    n
}

impl Core {
    /// Changes Neural's state, saves it and tells every client.
    pub fn neural_update<R>(&self, f: impl FnOnce(&mut NeuralState) -> R) -> R {
        let _g = self.orch.neural.lock.lock();
        let mut n = self.read(|s| s.neural.clone());
        let r = f(&mut n);
        if self.read(|s| s.neural != n) {
            let data = serde_json::to_value(&n).unwrap_or(Value::Null);
            if let Ok(bytes) = serde_json::to_vec(&n)
                && let Err(e) = crate::paths::write_private(&file(&self.paths.root), &bytes)
            {
                tracing::warn!("neural.json: {e:#}");
            }
            self.emit(Event::HostNotice { topic: "neural".into(), data });
        }
        r
    }

    pub fn neural_id(&self, prefix: &str) -> Id {
        format!("{prefix}{}-{}", now_ms(), self.orch.neural.next.fetch_add(1, Ordering::Relaxed))
    }

    pub fn neural_note_add(&self, text: &str) -> Id {
        let text = clip(text, 300);
        self.neural_update(|n| {
            if let Some(x) = n.notes.iter().find(|x| x.text.eq_ignore_ascii_case(&text)) {
                return x.id.clone();
            }
            let max = n.notes.iter().filter_map(|x| x.id.strip_prefix('n')?.parse::<u32>().ok()).max().unwrap_or(0);
            let id = format!("n{}", max + 1);
            n.notes.push(NeuralNote { id: id.clone(), text, at: now_ms() });
            if n.notes.len() > NOTES {
                n.notes.remove(0);
            }
            id
        })
    }

    /// One push for an agent (phones that are not looking), raised by Neural itself.
    pub fn neural_attention(&self, sid: &Id, kind: AttentionKind, text: &str) {
        // Keyed by agent and text: a real event of the same agent is never mistaken for it.
        self.orch.neural.own.lock().insert((sid.clone(), text.to_string()));
        self.emit(Event::Attention { session_id: sid.clone(), kind, text: text.into() });
    }

    /// Records an observation and queues a wake-up when it matters.
    fn neural_observe(&self, kind: ObsKind, sid: Option<&Id>, text: String) -> Id {
        self.neural_observe_for(kind, sid, None, text)
    }

    /// The same about a known task (the task may be finished by now).
    fn neural_observe_for(&self, kind: ObsKind, sid: Option<&Id>, task: Option<&str>, text: String) -> Id {
        let now = now_ms();
        let (id, wake, task) = self.neural_update(|n| {
            let t = match task {
                Some(id) => n.tasks.iter().find(|t| t.id == id),
                None => sid.and_then(|s| tasks::of_agent(n, s)),
            };
            let task = t.map(|t| t.id.clone());
            let wake = pulse::wakes(kind, task.is_some(), n.mode);
            let obs = NeuralObs {
                id: self.neural_id("o"),
                at: now,
                kind,
                session_id: sid.cloned(),
                task_id: task.clone(),
                text,
                seen: false,
                count: 1,
            };
            (observe::push(n, obs), wake, task)
        });
        // No endless follow-up loop: after a few wake-ups about one task Neural waits for the user.
        let capped = wake
            && task.as_ref().is_some_and(|t| {
                let mut w = self.orch.neural.wakes.lock();
                let c = w.entry(t.clone()).or_insert(0);
                *c += 1;
                *c > TASK_WAKES
            });
        if wake && !capped {
            self.orch.neural.pulse.lock().add(id.clone(), now);
        }
        id
    }

    /// A wake-up failed (no key, rate limit, timeout): nothing is posted in the chat, so the
    /// panel's "noticed" list says it once (no wake; a repeat only refreshes the row).
    pub fn neural_report_failed(&self, error: &str) {
        let text = format!("Neural could not report on its own: {}", clip(error, 200));
        self.neural_update(|n| {
            match n
                .observations
                .iter_mut()
                .rev()
                .find(|o| o.kind == ObsKind::Error && o.session_id.is_none() && o.text.starts_with("Neural could not"))
            {
                Some(o) if now_ms() - o.at < 3_600_000 => {
                    o.text = text;
                    o.at = now_ms();
                    o.count = o.count.max(1) + 1;
                }
                _ => {
                    let obs = NeuralObs {
                        id: self.neural_id("o"),
                        at: now_ms(),
                        kind: ObsKind::Error,
                        session_id: None,
                        task_id: None,
                        text,
                        seen: false,
                        count: 1,
                    };
                    observe::push(n, obs);
                }
            }
        });
    }

    /// The user wrote to Neural: follow-ups may wake it again.
    pub fn neural_user_wrote(&self) {
        self.orch.neural.wakes.lock().clear();
    }

    /// Requests from the UI about Neural's own state.
    pub async fn neural_handle(self: &Arc<Self>, req: Request) -> Result<Value, ApiError> {
        match req {
            Request::NeuralMode { mode } => {
                self.neural_update(|n| n.mode = mode);
                Ok(Value::Null)
            }
            Request::NeuralTaskEdit { id, status, remove } => {
                let found = self.neural_update(|n| {
                    if remove {
                        let before = n.tasks.len();
                        n.tasks.retain(|t| t.id != id);
                        return before != n.tasks.len();
                    }
                    match tasks::get_mut(n, &id) {
                        Some(t) => {
                            if let Some(s) = status {
                                t.status = s;
                                t.note = match s {
                                    NeuralTaskStatus::Done => "Marked done by you.".into(),
                                    NeuralTaskStatus::Failed => "Dropped by you.".into(),
                                    _ => t.note.clone(),
                                };
                            }
                            t.updated_at = now_ms();
                            true
                        }
                        None => false,
                    }
                });
                if found { Ok(Value::Null) } else { Err(err(ErrorCode::NotFound, "no such task")) }
            }
            Request::NeuralNoteAdd { text } => {
                let text = text.trim().to_string();
                if text.is_empty() {
                    return Err(err(ErrorCode::BadRequest, "nothing to remember"));
                }
                Ok(json!(self.neural_note_add(&text)))
            }
            Request::NeuralNoteRemove { id } => {
                self.neural_update(|n| n.notes.retain(|x| x.id != id));
                Ok(Value::Null)
            }
            Request::NeuralConfirm { id, allow } => self.neural_confirm(&id, allow).await.map(|_| Value::Null),
            _ => Err(err(ErrorCode::BadRequest, "not a Neural request")),
        }
    }

    /// The user allowed or denied an action Neural asked about: run exactly that call.
    async fn neural_confirm(self: &Arc<Self>, id: &str, allow: bool) -> Result<(), ApiError> {
        let p = self.neural_update(|n| {
            let i = n.pending.iter().position(|p| p.id == id)?;
            Some(n.pending.remove(i))
        });
        let Some(p) = p else { return Err(err(ErrorCode::NotFound, "already answered")) };
        self.audit.note(
            if allow { "neural_allow" } else { "neural_deny" },
            Some(clip(&format!("{}: {}", p.title, p.detail), 200)),
            true,
            None,
        );
        if !allow {
            self.orch_post(OrchRole::Action, format!("You declined: {}", p.title), Some(false), p.session_id.clone());
            return Ok(());
        }
        let call = Call { id: p.id.clone(), name: p.action["name"].as_str().unwrap_or("").to_string(), args: p.action["args"].clone() };
        let o = self.neural_tool(&call, true).await;
        if let Some(l) = &o.label {
            self.orch_post(OrchRole::Action, l.clone(), Some(o.ok), o.sid.clone());
        }
        // Neural carries on from there (only if it has a model).
        if self.read(|s| s.orchestrator.ready) {
            let note = format!("The user allowed: {} ({}). Result: {}", p.title, clip(&p.detail, 200), clip(&o.content, 600));
            self.orch_wake(Trigger::Resume(note));
        }
        Ok(())
    }

    /// A waiting agent of Neural's: allow a safe permission prompt right away.
    async fn auto_allow(self: &Arc<Self>, sid: &Id) -> bool {
        let Some(p) = self.cv_current_prompt(sid) else { return false };
        if p.kind.as_deref() != Some("permission") {
            return false;
        }
        let Some(t) = p.tool.as_ref().filter(|t| guard::safe_permission(&t.name, &t.input)) else { return false };
        // A plain yes for this one call, never "yes, and don't ask again" (that would outlast the check).
        let once =
            |l: &str| l.starts_with("yes") && !["don't ask", "dont ask", "do not ask", "always", "all "].iter().any(|w| l.contains(w));
        let Some(yes) = p.options.iter().find(|o| once(&o.label.to_lowercase())) else { return false };
        let action = CvAction::Answer { n: yes.n.clone(), nav: None, text: None, prompt_id: p.id.clone() };
        let ok = self.handle(&me(), Request::CvAction { sid: sid.clone(), action }).await.is_ok();
        let what = observe::describe_prompt(&p);
        self.audit.note("neural_allow", Some(clip(&format!("{}: {what}", observe::label(&self.read(|s| s.clone()), sid)), 200)), ok, None);
        if ok {
            let label = self.read(|s| observe::label(s, sid));
            let detail = what.strip_prefix("wants to use ").unwrap_or(&what).to_string();
            let _ = t;
            self.neural_update(|n| {
                let task = tasks::of_agent(n, sid).map(|t| t.id.clone());
                let obs = NeuralObs {
                    id: self.neural_id("o"),
                    at: now_ms(),
                    kind: ObsKind::Allowed,
                    session_id: Some(sid.clone()),
                    task_id: task,
                    text: format!("{label}: allowed {detail}"),
                    seen: false,
                    count: 1,
                };
                observe::push(n, obs);
            });
        }
        ok
    }

    /// An agent finished, waits or failed.
    async fn on_attention(self: &Arc<Self>, sid: Id, kind: AttentionKind, text: String) {
        if kind == AttentionKind::Waiting {
            // The prompt shows on the screen a moment after the hook.
            tokio::time::sleep(Duration::from_millis(1200)).await;
            let still = self.read(|s| s.sessions.get(&sid).is_some_and(|x| x.alive && x.status == AgentStatus::Waiting));
            if !still {
                return;
            }
            let mine = self.read(|s| tasks::of_agent(&s.neural, &sid).is_some() && s.neural.mode != NeuralMode::Off);
            if mine && self.auto_allow(&sid).await {
                return;
            }
        }
        let st = self.read(|s| s.clone());
        let label = observe::label(&st, &sid);
        let (k, detail) = match kind {
            AttentionKind::Done => (ObsKind::Done, text),
            AttentionKind::Waiting => {
                (ObsKind::Waiting, self.cv_current_prompt(&sid).map(|p| observe::describe_prompt(&p)).unwrap_or(text))
            }
            AttentionKind::Error => (ObsKind::Error, text),
        };
        self.neural_observe(k, Some(&sid), observe::agent_text(&label, k, &detail));
        self.neural_update(|n| tasks::on_agent(n, &sid, k, now_ms()));
    }
}

impl Core {
    /// Once at start: tasks still "working" whose agents did not survive the restart are marked
    /// cut off, and one observation tells the user (it does not wake Neural).
    fn neural_after_restart(&self, alive: &HashMap<Id, bool>) {
        let titles = self.neural_update(|n| tasks::interrupted(n, |sid| alive.get(sid).copied().unwrap_or(false), now_ms()));
        if titles.is_empty() {
            return;
        }
        let names = titles.iter().map(|t| format!("“{}”", clip(t, 60))).collect::<Vec<_>>().join(", ");
        let text = match titles.len() {
            1 => format!("NeuralAgent restarted while {names} was running; its agents stopped. Ask Neural to start it again, or drop it."),
            n => format!(
                "NeuralAgent restarted while {n} tasks were running ({names}); their agents stopped. Ask Neural to start them again, or drop them."
            ),
        };
        tracing::info!(tasks = titles.len(), "Neural tasks cut off by the restart");
        self.neural_observe(ObsKind::Exited, None, text);
    }
}

/// The observer: agent events become observations, the pulse wakes Neural.
pub async fn watch(core: Arc<Core>) {
    let mut rx = core.subscribe(None).rx;
    let mut alive: HashMap<Id, bool> = core.read(|s| s.sessions.values().map(|x| (x.id.clone(), x.alive)).collect());
    core.neural_after_restart(&alive);
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    let mut n_tick = 0u64;
    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok((_, Event::Attention { session_id, kind, text })) => {
                    if core.orch.neural.own.lock().remove(&(session_id.clone(), text.clone())) {
                        continue;
                    }
                    if let Some((ws, title)) = core.read(|s| {
                        s.sessions.get(&session_id).map(|x| (observe::workspace_name(s, &x.workspace_id).to_string(), x.title.clone()))
                    }) {
                        core.call_news(kind, ws, title);
                    }
                    let c = core.clone();
                    tokio::spawn(async move { c.on_attention(session_id, kind, text).await });
                }
                Ok((_, Event::SessionUpsert { session })) => {
                    let was = alive.insert(session.id.clone(), session.alive);
                    // A clean exit raises no attention: tell the task about it.
                    if was == Some(true) && !session.alive && session.status == AgentStatus::Exited {
                        let tracked = core.read(|s| tasks::of_agent(&s.neural, &session.id).is_some());
                        if tracked {
                            let label = core.read(|s| observe::label(s, &session.id));
                            core.neural_observe(ObsKind::Exited, Some(&session.id), observe::agent_text(&label, ObsKind::Exited, ""));
                            core.neural_update(|n| tasks::on_agent(n, &session.id, ObsKind::Exited, now_ms()));
                        }
                    }
                }
                Ok((_, Event::SessionRemoved { id })) => {
                    alive.remove(&id);
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => return,
            },
            _ = tick.tick() => {
                n_tick += 1;
                let now = now_ms();
                // Reasons a user turn has shown in the meantime are not news any more.
                let unseen: HashSet<Id> = core.read(|s| s.neural.observations.iter().filter(|o| !o.seen).map(|o| o.id.clone()).collect());
                let busy = core.read(|s| s.orchestrator.busy);
                let ready = core.read(|s| s.orchestrator.ready);
                let due = {
                    let mut p = core.orch.neural.pulse.lock();
                    p.retain(|id| unseen.contains(id));
                    if ready { p.due(now, busy) } else { None }
                };
                if let Some(batch) = due
                    && !core.orch_wake(Trigger::Wake(batch.clone()))
                {
                    // A turn started in between: try again soon.
                    let mut p = core.orch.neural.pulse.lock();
                    for id in batch {
                        p.add(id, now);
                    }
                }
                if n_tick.is_multiple_of(30) {
                    let stuck = { let st = core.read(|s| s.sessions.clone()); core.orch.neural.stuck.lock().check(st.values(), now) };
                    for sid in stuck {
                        let (label, tracked) = core.read(|s| (observe::label(s, &sid), tasks::of_agent(&s.neural, &sid).is_some()));
                        let mins = observe::STUCK_MS / 60_000;
                        core.neural_observe(ObsKind::Stuck, Some(&sid), observe::agent_text(&label, ObsKind::Stuck, &format!("working for a long time without visible progress ({mins}+ min)")));
                        if tracked {
                            core.neural_attention(&sid, AttentionKind::Waiting, "Seems stuck");
                        }
                    }
                }
            }
        }
    }
}
