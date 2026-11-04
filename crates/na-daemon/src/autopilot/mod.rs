//! Autopilot (D87, docs/notes/autopilot.md): one project agent per workspace. This module keeps
//! the state (`<home>/autopilot.json`, live as host notice topic "autopilot"), runs turns on the
//! same model settings as Neural, wakes pilots on chat, routines, events and finished agents, and
//! answers `Request::Autopilot`.

pub mod ops;
pub mod perm;
pub mod prompt;
pub mod run;
pub mod sched;
pub mod tools;
pub mod turn;

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use na_protocol::{
    AttentionKind, AutopilotState, Event, Id, InboxItem, ItemStatus, Millis, NotifyLevel, Pilot, PilotMessage, PilotRole, PilotStatus,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::core::{Core, now_ms};
use crate::llm::Llm;
use crate::neural::observe::clip;
use turn::Trigger;

/// Items and chat messages kept per pilot.
pub const KEEP: usize = 200;
const NOTES: usize = 40;
const SEEN: usize = 3000;

/// What is saved besides the shared state.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Extra {
    /// routine id → when it last ran.
    #[serde(default)]
    pub routine_last: BTreeMap<String, Millis>,
    /// pilot id → short facts (`remember`).
    #[serde(default)]
    pub notes: BTreeMap<Id, Vec<String>>,
    /// "connector:event id" already ingested.
    #[serde(default)]
    pub seen: VecDeque<String>,
    /// Counter behind ids (i12, m40, p3, …).
    #[serde(default)]
    pub next: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct File {
    #[serde(default)]
    state: AutopilotState,
    #[serde(default)]
    extra: Extra,
}

/// Runtime state of one pilot (not shared).
#[derive(Default)]
pub struct PRt {
    pub running: Option<CancellationToken>,
    pub activity: Option<String>,
    pub error: Option<String>,
    pub queue: Vec<Trigger>,
    pub wake_at: Option<Instant>,
}

pub struct Runtime {
    lock: Mutex<()>,
    pub extra: Mutex<Extra>,
    pub prt: Mutex<HashMap<Id, PRt>>,
    pub llm: Llm,
    pub triage_slots: tokio::sync::Semaphore,
    dirty: AtomicBool,
    /// connector id → last poll.
    pub polled: Mutex<HashMap<Id, Instant>>,
    pub polling: Mutex<HashSet<Id>>,
    /// (session, kind) → when it was last reported, against doubles.
    pub reported: Mutex<HashMap<(Id, &'static str), Instant>>,
}

impl Default for Runtime {
    fn default() -> Self {
        Runtime {
            lock: Mutex::new(()),
            extra: Mutex::new(Extra::default()),
            prt: Mutex::new(HashMap::new()),
            llm: Llm::default(),
            triage_slots: tokio::sync::Semaphore::new(3),
            dirty: AtomicBool::new(false),
            polled: Mutex::new(HashMap::new()),
            polling: Mutex::new(HashSet::new()),
            reported: Mutex::new(HashMap::new()),
        }
    }
}

fn file(root: &Path) -> PathBuf {
    root.join("autopilot.json")
}

/// The saved state. Confirmations do not survive a restart (the situation they were about is
/// gone); connectors and the browser link are filled in at start.
pub fn load(root: &Path) -> (AutopilotState, Extra) {
    let f: File = std::fs::read_to_string(file(root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut st = f.state;
    st.pending.clear();
    st.connectors.clear();
    st.browser = Default::default();
    for p in &mut st.pilots {
        p.status = if p.enabled { PilotStatus::Idle } else { PilotStatus::Off };
        p.activity = None;
    }
    // An item that waited for an answer only a pending confirmation could give is open again.
    (st, f.extra)
}

impl Runtime {
    pub fn with_extra(extra: Extra) -> Self {
        let r = Runtime::default();
        *r.extra.lock() = extra;
        r
    }

    pub fn new_id(&self, prefix: &str) -> Id {
        let mut e = self.extra.lock();
        e.next += 1;
        format!("{prefix}{}", e.next)
    }

    pub fn with_prt<R>(&self, pid: &str, f: impl FnOnce(&mut PRt) -> R) -> R {
        f(self.prt.lock().entry(pid.to_string()).or_default())
    }

    /// Queues a reason to take a turn; `delay` batches (events wait, a chat message does not).
    pub fn wake(&self, pid: &str, t: Trigger, delay: std::time::Duration) {
        self.with_prt(pid, |r| {
            r.queue.push(t);
            let at = Instant::now() + delay;
            r.wake_at = Some(r.wake_at.map_or(at, |old| old.min(at)));
        });
    }

    pub fn notes(&self, pid: &str) -> Vec<String> {
        self.extra.lock().notes.get(pid).cloned().unwrap_or_default()
    }

    pub fn note_add(&self, pid: &str, text: &str) {
        let mut e = self.extra.lock();
        let n = e.notes.entry(pid.to_string()).or_default();
        if !n.iter().any(|x| x.eq_ignore_ascii_case(text)) {
            n.push(text.to_string());
            if n.len() > NOTES {
                n.remove(0);
            }
        }
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub fn routine_last(&self, id: &str) -> Option<Millis> {
        self.extra.lock().routine_last.get(id).copied()
    }

    pub fn set_routine_last(&self, id: &str, at: Millis) {
        self.extra.lock().routine_last.insert(id.to_string(), at);
        self.dirty.store(true, Ordering::SeqCst);
    }

    /// Statuses, activity and next run follow from the rest of the state.
    fn recompute(&self, a: &mut AutopilotState) {
        let prt = self.prt.lock();
        let extra = self.extra.lock();
        let AutopilotState { pilots, items, pending, .. } = a;
        for p in pilots.iter_mut() {
            let r = prt.get(&p.id);
            let running = r.is_some_and(|r| r.running.is_some());
            let error = r.and_then(|r| r.error.clone());
            let needs =
                items.iter().any(|i| i.pilot_id == p.id && i.status == ItemStatus::NeedsYou) || pending.iter().any(|x| x.pilot_id == p.id);
            p.status = if running {
                PilotStatus::Working
            } else if error.is_some() {
                PilotStatus::Error
            } else if !p.enabled {
                PilotStatus::Off
            } else if needs {
                PilotStatus::NeedsYou
            } else {
                PilotStatus::Idle
            };
            p.activity = if running { r.and_then(|r| r.activity.clone()).or(Some("Working".into())) } else { error };
            p.next_run = if p.enabled && p.setup_done {
                p.playbook
                    .routines
                    .iter()
                    .filter(|x| x.enabled)
                    .filter_map(|x| sched::next_due(&x.schedule, extra.routine_last.get(&x.id).copied().unwrap_or(p.created)))
                    .min()
            } else {
                None
            };
        }
    }
}

/// Keeps only the newest `KEEP` items and messages of each pilot.
fn trim(a: &mut AutopilotState) {
    for p in &a.pilots {
        let n = a.items.iter().filter(|i| i.pilot_id == p.id).count();
        if n > KEEP {
            // Items are newest first: drop the oldest finished ones first.
            let mut drop = n - KEEP;
            let mut keep = vec![];
            for i in a.items.drain(..).rev().collect::<Vec<_>>() {
                if drop > 0 && i.pilot_id == p.id && matches!(i.status, ItemStatus::Done | ItemStatus::Dismissed) {
                    drop -= 1;
                } else {
                    keep.push(i);
                }
            }
            keep.reverse();
            a.items = keep;
        }
        let m = a.messages.iter().filter(|x| x.pilot_id == p.id).count();
        if m > KEEP {
            let mut drop = m - KEEP;
            a.messages.retain(|x| {
                if drop > 0 && x.pilot_id == p.id {
                    drop -= 1;
                    false
                } else {
                    true
                }
            });
        }
    }
}

impl Core {
    /// Changes the autopilot state, saves it and tells every client.
    pub fn autopilot_update<R>(&self, f: impl FnOnce(&mut AutopilotState) -> R) -> R {
        self.ap_update(true, f)
    }

    /// The same without saving (streamed chat text; the final update saves).
    pub fn autopilot_update_live<R>(&self, f: impl FnOnce(&mut AutopilotState) -> R) -> R {
        self.ap_update(false, f)
    }

    fn ap_update<R>(&self, save: bool, f: impl FnOnce(&mut AutopilotState) -> R) -> R {
        let _g = self.autopilot.lock.lock();
        let mut a = self.read(|s| s.autopilot.clone());
        let r = f(&mut a);
        self.autopilot.recompute(&mut a);
        trim(&mut a);
        if self.read(|s| s.autopilot != a) {
            if save {
                self.autopilot.dirty.store(true, Ordering::SeqCst);
            }
            let data = serde_json::to_value(&a).unwrap_or(Value::Null);
            self.emit(Event::HostNotice { topic: "autopilot".into(), data });
        }
        r
    }

    /// Writes `autopilot.json` when something changed (called by the tick and at shutdown).
    pub fn autopilot_save(&self) {
        if !self.autopilot.dirty.swap(false, Ordering::SeqCst) {
            return;
        }
        let mut state = self.read(|s| s.autopilot.clone());
        state.connectors.clear();
        state.browser = Default::default();
        state.pending.clear();
        let f = File { state, extra: self.autopilot.extra.lock().clone() };
        match serde_json::to_vec(&f) {
            Ok(bytes) => {
                if let Err(e) = crate::paths::write_private(&file(&self.paths.root), &bytes) {
                    tracing::warn!("autopilot.json: {e:#}");
                    self.autopilot.dirty.store(true, Ordering::SeqCst);
                }
            }
            Err(e) => tracing::warn!("autopilot.json: {e}"),
        }
    }

    pub fn pilot(&self, id: &str) -> Option<Pilot> {
        self.read(|s| s.autopilot.pilots.iter().find(|p| p.id == id).cloned())
    }
}

/// Starts the schedulers and the connector hub.
pub fn start(core: &std::sync::Arc<Core>) {
    core.connectors.init(core);
    tokio::spawn(run::run(core.clone()));
}

impl Core {
    /// Adds a chat message of a pilot; returns its id.
    pub fn ap_message(&self, pid: &str, role: PilotRole, text: &str, item: Option<&str>, proactive: bool, steps: Vec<String>) -> Id {
        let id = self.autopilot.new_id("m");
        let m = PilotMessage {
            id: id.clone(),
            pilot_id: pid.to_string(),
            role,
            text: text.to_string(),
            at: now_ms(),
            item_id: item.map(str::to_string),
            proactive,
            steps,
        };
        self.autopilot_update(|a| a.messages.push(m));
        id
    }

    /// Writes down what happened to an item.
    pub fn ap_step(&self, item: &str, text: &str, ok: bool) {
        let now = now_ms();
        let step = na_protocol::ItemStep { at: now, text: clip(text, 300), ok };
        self.autopilot_update(|a| {
            if let Some(i) = a.items.iter_mut().find(|i| i.id == item) {
                i.steps.push(step);
                i.updated = now;
            }
        });
    }

    pub fn ap_item(&self, id: &str) -> Option<InboxItem> {
        self.read(|s| s.autopilot.items.iter().find(|i| i.id == id).cloned())
    }

    /// A push for the owner's phones, by the pilot's notify level. `needs_you`: the owner has to act.
    pub fn ap_notify(&self, pid: &str, id: &str, kind: AttentionKind, text: &str, needs_you: bool) {
        let level = self.pilot(pid).map(|p| p.playbook.notify).unwrap_or_default();
        let send = match level {
            NotifyLevel::All => true,
            NotifyLevel::NeedsYou => needs_you,
            NotifyLevel::Never => false,
        };
        if !send {
            return;
        }
        let kind_key: &'static str = match kind {
            AttentionKind::Waiting => "waiting",
            AttentionKind::Done => "done",
            AttentionKind::Error => "error",
        };
        {
            let mut r = self.autopilot.reported.lock();
            let key = (id.to_string(), kind_key);
            if r.get(&key).is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(60)) {
                return;
            }
            r.insert(key, Instant::now());
        }
        self.neural_attention(&id.to_string(), kind, &clip(text, 140));
    }
}
