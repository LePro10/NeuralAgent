//! One turn of a pilot: build the prompt, let the model call tools until it answers, post the
//! answer. Turns of one pilot never overlap (`PRt.running`).

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Local;
use na_protocol::{AttentionKind, Id, PilotRole};
use tokio_util::sync::CancellationToken;

use super::{prompt, tools};
use crate::core::{Core, now_ms};
use crate::llm::{Ask, Msg};
use crate::neural::observe::clip;
use crate::neural::world::short;

const CHAT_STEPS: usize = 10;
const WAKE_STEPS: usize = 8;
const HISTORY: usize = 30;

#[derive(Debug, Clone)]
pub enum Trigger {
    /// The pilot was just created: start the interview.
    Setup,
    /// The owner wrote (the message is in the chat already).
    Chat,
    Routine(Id),
    /// "Check everything now".
    Check,
    /// New inbox items.
    Events(Vec<Id>),
    /// A coding agent finished, waits or failed.
    Agent {
        sid: Id,
        kind: AttentionKind,
        text: String,
    },
    /// A confirmation was answered; carry on.
    Resume(String),
}

fn trigger_text(core: &Core, p: &na_protocol::Pilot, ts: &[Trigger]) -> String {
    let mut parts: Vec<String> = vec![];
    for t in ts {
        match t {
            Trigger::Setup => {
                parts.push("(system) The owner just created you. Greet them in one sentence and ask your first question.".into())
            }
            Trigger::Chat => {}
            Trigger::Routine(rid) => {
                if let Some(r) = p.playbook.routines.iter().find(|r| &r.id == rid) {
                    parts.push(format!(
                        "(system) Routine: {}\nDo it now, by the playbook. When nothing needs the owner, answer exactly: (quiet)",
                        r.task
                    ));
                }
            }
            Trigger::Check => parts.push(
                "(system) The owner asked you to check everything now: read your sources, handle what is new, then report in a few words."
                    .into(),
            ),
            Trigger::Events(ids) => {
                let items =
                    core.read(|s| ids.iter().filter_map(|id| s.autopilot.items.iter().find(|i| &i.id == id).cloned()).collect::<Vec<_>>());
                if !items.is_empty() {
                    let refs: Vec<&_> = items.iter().collect();
                    parts.push(prompt::events_message(&refs));
                }
            }
            Trigger::Agent { sid, kind, text } => {
                let item =
                    core.read(|s| s.autopilot.items.iter().find(|i| i.session_id.as_deref() == Some(sid) && i.pilot_id == p.id).cloned());
                let what = match kind {
                    AttentionKind::Done => "finished",
                    AttentionKind::Waiting => "is waiting for an answer",
                    AttentionKind::Error => "failed",
                };
                let title = item.as_ref().map(|i| i.title.clone()).unwrap_or_else(|| "a task".into());
                parts.push(format!(
                    "(system) The agent {} for \"{}\"{} {what}.\n<untrusted source=\"agent\">\n{}\n</untrusted>\nReview it (inspect_agent, agent_changes), update the item, then tell the owner or draft the reply. When it only waits for a yes/no you can judge, answer it with send_to_agent.",
                    short(sid),
                    title,
                    item.map(|i| format!(" (item {})", i.id)).unwrap_or_default(),
                    clip(text, 3000).replace("</untrusted>", "")
                ));
            }
            Trigger::Resume(t) => parts.push(format!("(system) {t}")),
        }
    }
    parts.join("\n\n")
}

fn push(msgs: &mut Vec<Msg>, user: bool, text: String) {
    match (msgs.last_mut(), user) {
        (Some(Msg::User(t)), true) => {
            t.push_str("\n\n");
            t.push_str(&text);
        }
        (Some(Msg::Assistant { text: t, calls }), false) if calls.is_empty() => {
            t.push_str("\n\n");
            t.push_str(&text);
        }
        (_, true) => msgs.push(Msg::User(text)),
        (_, false) => msgs.push(Msg::Assistant { text, calls: vec![] }),
    }
}

fn activity(core: &Core, pid: &str, text: &str) {
    core.autopilot.with_prt(pid, |r| r.activity = Some(text.to_string()));
    core.autopilot_update(|_| {});
}

/// Takes one turn for the queued reasons. Posts the result; errors show on the pilot.
pub async fn run(core: Arc<Core>, pid: Id, triggers: Vec<Trigger>) {
    let token = CancellationToken::new();
    let started = core.autopilot.with_prt(&pid, |r| {
        if r.running.is_some() {
            r.queue.extend(triggers.iter().cloned());
            r.wake_at.get_or_insert(Instant::now() + Duration::from_secs(2));
            false
        } else {
            r.running = Some(token.clone());
            r.activity = Some("Thinking".into());
            true
        }
    });
    if !started {
        return;
    }
    core.autopilot_update(|_| {});
    let result = tokio::select! {
        r = turn(&core, &pid, &triggers) => r,
        _ = token.cancelled() => Ok(()),
    };
    let now = now_ms();
    core.autopilot.with_prt(&pid, |r| {
        r.running = None;
        r.activity = None;
        r.error = result.as_ref().err().cloned();
    });
    core.autopilot_update(|a| {
        if let Some(p) = a.pilots.iter_mut().find(|p| p.id == pid) {
            p.last_run = Some(now);
        }
    });
    if let Err(e) = result {
        tracing::warn!(pilot = %pid, "autopilot turn failed: {e}");
        core.ap_notify(&pid, &pid, AttentionKind::Error, &format!("Autopilot stopped: {}", clip(&e, 100)), true);
    }
}

async fn turn(core: &Arc<Core>, pid: &str, triggers: &[Trigger]) -> Result<(), String> {
    let p = core.pilot(pid).ok_or("pilot is gone")?;
    let cfg = core.read(|s| s.settings.llm.clone());
    if !core.read(|s| s.orchestrator.ready) {
        return Err("No model key yet. Add one in Settings.".into());
    }
    let key = core.llm_key(cfg.provider);
    let user_facing = triggers.iter().any(|t| matches!(t, Trigger::Chat | Trigger::Setup));
    let project =
        core.read(|s| s.workspaces.iter().find(|w| w.id == p.workspace_id).map(|w| w.name.clone())).unwrap_or_else(|| p.name.clone());
    let system = if p.setup_done { prompt::system(&p) } else { prompt::setup_system(&project) };
    // The chat so far, then the reason for this turn.
    let mut msgs: Vec<Msg> = vec![];
    let hist: Vec<(PilotRole, String)> = core.read(|s| {
        let mine: Vec<_> = s.autopilot.messages.iter().filter(|m| m.pilot_id == pid).collect();
        mine.iter().skip(mine.len().saturating_sub(HISTORY)).map(|m| (m.role, m.text.clone())).collect()
    });
    for (role, text) in hist {
        push(&mut msgs, role == PilotRole::User, text);
    }
    let extra = trigger_text(core, &p, triggers);
    if !extra.is_empty() {
        push(&mut msgs, true, extra);
    }
    if !matches!(msgs.last(), Some(Msg::User(_))) {
        return Ok(());
    }
    let item_hint = triggers.iter().find_map(|t| match t {
        Trigger::Agent { sid, .. } => {
            core.read(|s| s.autopilot.items.iter().find(|i| i.session_id.as_deref() == Some(sid)).map(|i| i.id.clone()))
        }
        _ => None,
    });
    let mut said: Vec<String> = vec![];
    let mut steps: Vec<String> = vec![];
    let mut mid: Option<Id> = None;
    let max = if user_facing { CHAT_STEPS } else { WAKE_STEPS };
    for _ in 0..max {
        let offer = tools::offer(core, &p);
        let p_now = core.pilot(pid).unwrap_or_else(|| p.clone());
        let context = core.read(|s| {
            let label = |sid: &str| s.sessions.get(sid).map(|x| format!("{}, {:?}", short(sid), x.status).to_lowercase());
            let notes = core.autopilot.notes(pid);
            prompt::world(&s.autopilot, &p_now, &project, &label, &notes, Local::now())
        });
        let mut cur = String::new();
        let mut last_emit = Instant::now();
        let ask = Ask {
            model: &cfg.model,
            key: key.as_deref(),
            system: &system,
            context: &context,
            msgs: &msgs,
            tools: &offer.tools,
            quick: false,
        };
        let t = core
            .autopilot
            .llm
            .turn(&cfg, ask, |piece| {
                cur.push_str(piece);
                if user_facing && last_emit.elapsed() > Duration::from_millis(80) {
                    last_emit = Instant::now();
                    let text = joined(&said, &cur);
                    mid = Some(show(core, pid, mid.take(), &text, &steps, false));
                }
            })
            .await
            .map_err(|e| format!("{e:#}"))?;
        let text = if t.text.trim().is_empty() { cur } else { t.text.clone() };
        if !text.trim().is_empty() {
            said.push(text.trim().to_string());
        }
        if user_facing && !said.is_empty() {
            mid = Some(show(core, pid, mid.take(), &said.join("\n\n"), &steps, false));
        }
        if t.calls.is_empty() {
            break;
        }
        msgs.push(Msg::Assistant { text: text.clone(), calls: t.calls.clone() });
        for c in &t.calls {
            let Some(target) = offer.map.get(&c.name).cloned() else {
                msgs.push(Msg::Tool { id: c.id.clone(), content: r#"{"ok":false,"error":"unknown tool"}"#.into() });
                continue;
            };
            let words = tools::step_text(core, &target, &c.args);
            activity(core, pid, &words);
            steps.push(words);
            let out = tools::call(core, pid, item_hint.as_deref(), &target, c.args.clone()).await;
            msgs.push(Msg::Tool { id: c.id.clone(), content: out });
        }
        if user_facing && let Some(id) = &mid {
            let text = said.join("\n\n");
            mid = Some(show(core, pid, Some(id.clone()), &text, &steps, false));
        }
    }
    let full = said.join("\n\n");
    let quiet = full.trim().is_empty() || full.trim().to_lowercase().starts_with("(quiet)");
    if user_facing {
        if quiet && !steps.is_empty() && mid.is_none() {
            core.ap_message(pid, PilotRole::Pilot, "Done.", None, false, steps);
        } else if let Some(id) = mid {
            show(core, pid, Some(id), &full, &steps, true);
        }
    } else if !quiet {
        core.ap_message(pid, PilotRole::Pilot, full.trim(), item_hint.as_deref(), true, steps);
        core.ap_notify(pid, &format!("{pid}-say"), AttentionKind::Done, &clip(full.trim(), 120), false);
    }
    Ok(())
}

fn joined(said: &[String], cur: &str) -> String {
    let mut v: Vec<&str> = said.iter().map(String::as_str).collect();
    if !cur.trim().is_empty() {
        v.push(cur.trim());
    }
    v.join("\n\n")
}

/// Creates or updates the pilot's message; streamed updates are not saved.
fn show(core: &Core, pid: &str, id: Option<Id>, text: &str, steps: &[String], last: bool) -> Id {
    let id = id.unwrap_or_else(|| core.autopilot.new_id("m"));
    let m = na_protocol::PilotMessage {
        id: id.clone(),
        pilot_id: pid.to_string(),
        role: PilotRole::Pilot,
        text: text.to_string(),
        at: now_ms(),
        item_id: None,
        proactive: false,
        steps: steps.to_vec(),
    };
    let f = |a: &mut na_protocol::AutopilotState| match a.messages.iter_mut().rev().find(|x| x.id == m.id) {
        Some(x) => {
            x.text = m.text.clone();
            x.steps = m.steps.clone();
        }
        None => a.messages.push(m.clone()),
    };
    if last {
        core.autopilot_update(f);
    } else {
        core.autopilot_update_live(f);
    }
    id
}
