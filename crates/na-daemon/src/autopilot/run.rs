//! The background loop: connector events into the inbox (with triage), polling, routines,
//! finished agents, and starting turns.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use na_protocol::{AttentionKind, Event, Id, InboxItem, ItemKind, ItemStatus, Pilot};
use serde_json::Value;

use super::SEEN;
use super::prompt::{self, Triage};
use super::sched;
use super::turn::{self, Trigger};
use crate::connectors::ConnEvent;
use crate::core::{Core, now_ms};
use crate::llm::{Ask, Msg};
use crate::neural::observe::clip;

/// New items wait this long so several arrive in one turn.
const BATCH: Duration = Duration::from_secs(12);

pub async fn run(core: Arc<Core>) {
    let mut events = core.connectors.take_events();
    let mut bus = core.subscribe(None).rx;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let mut n: u64 = 0;
    loop {
        tokio::select! {
            ev = async {
                match &mut events {
                    Some(r) => r.recv().await,
                    None => std::future::pending().await,
                }
            } => match ev {
                Some(e) => ingest(&core, e),
                None => events = None,
            },
            msg = bus.recv() => match msg {
                Ok((_, Event::Attention { session_id, kind, text })) => agent_wake(&core, session_id, kind, text),
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => return,
            },
            _ = tick.tick() => {
                n += 1;
                routines(&core);
                dispatch(&core);
                poll(&core);
                if n.is_multiple_of(5) {
                    core.autopilot_save();
                }
            }
        }
    }
}

// ───────────── events into the inbox ─────────────

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

fn ingest(core: &Arc<Core>, e: ConnEvent) {
    let Some(eid) = s(&e.event, "id") else { return };
    let text = s(&e.event, "text").unwrap_or_default();
    let title = s(&e.event, "title");
    if text.is_empty() && title.is_none() {
        return;
    }
    let pilots: Vec<Pilot> = core.read(|st| {
        st.autopilot
            .pilots
            .iter()
            .filter(|p| p.enabled && p.setup_done && p.playbook.sources.iter().any(|x| x.connector_id == e.connector && x.listen))
            .cloned()
            .collect()
    });
    for p in pilots {
        let key = format!("{}|{}|{}", p.id, e.connector, eid);
        {
            let mut x = core.autopilot.extra.lock();
            if x.seen.contains(&key) {
                continue;
            }
            x.seen.push_back(key);
            while x.seen.len() > SEEN {
                x.seen.pop_front();
            }
        }
        core.autopilot.dirty.store(true, Ordering::SeqCst);
        let mut original = clip(&text, 4000);
        if let Some(m) = e.event.get("meta").filter(|m| m.is_object()) {
            original.push_str(&format!("\n\n[details: {}]", clip(&m.to_string(), 400)));
        }
        let first = title.clone().unwrap_or_else(|| text.lines().find(|l| !l.trim().is_empty()).unwrap_or("New message").to_string());
        let now = now_ms();
        let item = InboxItem {
            id: core.autopilot.new_id("i"),
            pilot_id: p.id.clone(),
            source: e.connector.clone(),
            kind: ItemKind::Other,
            title: clip(&first, 80),
            summary: String::new(),
            original,
            author: s(&e.event, "author"),
            url: s(&e.event, "url"),
            status: ItemStatus::New,
            urgency: 1,
            steps: vec![],
            session_id: None,
            draft: None,
            created: now,
            updated: now,
        };
        let id = item.id.clone();
        core.autopilot_update(|a| a.items.insert(0, item));
        let (core2, src) = (core.clone(), e.connector.clone());
        let (t2, tx2) = (title.clone(), text.clone());
        tokio::spawn(async move { triage_item(core2, p.id, id, src, t2, tx2).await });
    }
}

async fn triage_item(core: Arc<Core>, pid: Id, id: Id, source: String, title: Option<String>, text: String) {
    let author = core.ap_item(&id).and_then(|i| i.author);
    let t = match core.autopilot.triage_slots.acquire().await {
        Ok(_permit) => ask_triage(&core, &source, author.as_deref(), title.as_deref(), &text).await,
        Err(_) => None,
    }
    .unwrap_or_else(|| prompt::fallback_triage(title.as_deref(), &text));
    let urgent = t.urgency >= 3;
    let name = t.title.clone();
    core.autopilot_update(|a| {
        if let Some(i) = a.items.iter_mut().find(|i| i.id == id) {
            i.kind = t.kind;
            i.title = t.title.clone();
            i.summary = t.summary.clone();
            i.urgency = t.urgency;
        }
    });
    if urgent {
        core.ap_notify(&pid, &id, AttentionKind::Waiting, &format!("Urgent: {name}"), true);
    } else {
        core.ap_notify(&pid, &id, AttentionKind::Done, &format!("New: {name}"), false);
    }
    core.autopilot.wake(&pid, Trigger::Events(vec![id]), BATCH);
}

async fn ask_triage(core: &Core, source: &str, author: Option<&str>, title: Option<&str>, text: &str) -> Option<Triage> {
    if !core.read(|s| s.orchestrator.ready) {
        return None;
    }
    let cfg = core.read(|s| s.settings.llm.clone());
    let key = core.llm_key(cfg.provider);
    let model = if cfg.call_model.trim().is_empty() { cfg.model.clone() } else { cfg.call_model.clone() };
    let msgs = [Msg::User(prompt::triage_message(source, author, title, text))];
    let ask = Ask { model: &model, key: key.as_deref(), system: prompt::TRIAGE_SYSTEM, context: "", msgs: &msgs, tools: &[], quick: true };
    let r = tokio::time::timeout(Duration::from_secs(40), core.autopilot.llm.turn(&cfg, ask, |_| {})).await.ok()?.ok()?;
    prompt::parse_triage(&r.text)
}

// ───────────── agents ─────────────

fn agent_wake(core: &Arc<Core>, sid: Id, kind: AttentionKind, text: String) {
    let mine = core.read(|s| s.autopilot.items.iter().any(|i| i.session_id.as_deref() == Some(sid.as_str())));
    if !mine {
        return;
    }
    let core = core.clone();
    tokio::spawn(async move {
        if kind == AttentionKind::Waiting {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let still = core.read(|s| s.sessions.get(&sid).is_some_and(|x| x.alive && x.status == na_protocol::AgentStatus::Waiting));
            if !still {
                return;
            }
        }
        let body = if kind == AttentionKind::Done { core.agent_final_text(&sid) } else { text };
        let pilots: Vec<Id> = core.read(|s| {
            s.autopilot.items.iter().filter(|i| i.session_id.as_deref() == Some(sid.as_str())).map(|i| i.pilot_id.clone()).collect()
        });
        for pid in pilots {
            core.autopilot.wake(&pid, Trigger::Agent { sid: sid.clone(), kind, text: body.clone() }, Duration::from_secs(1));
        }
    });
}

// ───────────── schedulers ─────────────

fn routines(core: &Arc<Core>) {
    let now = now_ms();
    let due: Vec<(Id, Id)> = core.read(|s| {
        s.autopilot
            .pilots
            .iter()
            .filter(|p| p.enabled && p.setup_done)
            .flat_map(|p| {
                p.playbook.routines.iter().filter(|r| r.enabled).filter_map(|r| {
                    let last = core.autopilot.routine_last(&r.id).unwrap_or(p.created);
                    sched::due(&r.schedule, last, now).then(|| (p.id.clone(), r.id.clone()))
                })
            })
            .collect()
    });
    for (pid, rid) in due {
        core.autopilot.set_routine_last(&rid, now);
        core.autopilot.wake(&pid, Trigger::Routine(rid), Duration::ZERO);
    }
}

/// Starts the turns whose time has come.
fn dispatch(core: &Arc<Core>) {
    let now = Instant::now();
    let ready: Vec<(Id, Vec<Trigger>)> = {
        let mut prt = core.autopilot.prt.lock();
        prt.iter_mut()
            .filter(|(_, r)| r.running.is_none() && !r.queue.is_empty() && r.wake_at.is_some_and(|t| t <= now))
            .map(|(pid, r)| {
                r.wake_at = None;
                (pid.clone(), std::mem::take(&mut r.queue))
            })
            .collect()
    };
    for (pid, mut ts) in ready {
        let Some(p) = core.pilot(&pid) else { continue };
        if !p.enabled {
            ts.retain(|t| matches!(t, Trigger::Chat | Trigger::Setup | Trigger::Resume(_)));
        }
        if ts.is_empty() {
            continue;
        }
        // Several reasons make one turn; new-item lists are merged.
        let mut ids: Vec<Id> = vec![];
        ts.retain(|t| match t {
            Trigger::Events(v) => {
                ids.extend(v.iter().cloned());
                false
            }
            _ => true,
        });
        if !ids.is_empty() {
            ts.push(Trigger::Events(ids));
        }
        tokio::spawn(turn::run(core.clone(), pid, ts));
    }
}

/// Calls the poll tool of connectors without push, while a pilot listens.
fn poll(core: &Arc<Core>) {
    let listened: Vec<Id> = core.read(|s| {
        s.autopilot
            .pilots
            .iter()
            .filter(|p| p.enabled && p.setup_done)
            .flat_map(|p| p.playbook.sources.iter().filter(|x| x.listen).map(|x| x.connector_id.clone()))
            .collect()
    });
    for c in core.connectors.list() {
        let Some(pl) = c.manifest.poll.clone() else { continue };
        if c.status != na_protocol::ConnectorStatus::Running || !listened.contains(&c.id) {
            continue;
        }
        let every = Duration::from_secs(60 * pl.minutes.max(1) as u64);
        if core.autopilot.polled.lock().get(&c.id).is_some_and(|t| t.elapsed() < every) {
            continue;
        }
        if !core.autopilot.polling.lock().insert(c.id.clone()) {
            continue;
        }
        core.autopilot.polled.lock().insert(c.id.clone(), Instant::now());
        let core = core.clone();
        tokio::spawn(async move {
            let r = core.connectors.call_tool(&core, &c.id, &pl.tool, serde_json::json!({}), Duration::from_secs(90)).await;
            match r {
                Ok(o) if !o.is_error => {
                    let v = o.json();
                    let list = v.get("events").cloned().unwrap_or(v);
                    for e in list.as_array().cloned().unwrap_or_default() {
                        core.connectors.inject(&c.id, e);
                    }
                }
                Ok(o) => tracing::debug!(connector = %c.id, "poll failed: {}", clip(&o.text, 200)),
                Err(e) => tracing::debug!(connector = %c.id, "poll failed: {e}"),
            }
            core.autopilot.polling.lock().remove(&c.id);
        });
    }
}
