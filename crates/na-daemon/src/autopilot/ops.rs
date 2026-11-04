//! `Request::Autopilot { op }`: every operation of the pilots and the connectors.

use std::sync::Arc;
use std::time::Duration;

use na_protocol::{ApiError, AutopilotOp as Op, ClientInfo, ErrorCode, FieldOption, ItemStatus, Pilot, PilotRole, PilotStatus, Playbook};
use serde_json::{Value, json};

use super::tools::{self, Target};
use super::turn::Trigger;
use crate::connectors::{builder, check};
use crate::core::{Core, err, now_ms};
use crate::neural::observe::clip;

type R = Result<Value, ApiError>;

fn bad(msg: impl Into<String>) -> ApiError {
    err(ErrorCode::BadRequest, msg)
}

fn gone(what: &str) -> ApiError {
    err(ErrorCode::NotFound, format!("no such {what}"))
}

fn val<T: serde::Serialize>(v: &T) -> R {
    Ok(serde_json::to_value(v).unwrap_or(Value::Null))
}

pub async fn handle(core: &Arc<Core>, client: &ClientInfo, op: Op) -> R {
    match op {
        Op::PilotCreate { workspace_id } => pilot_create(core, &workspace_id),
        Op::PilotUpdate { id, name, enabled, playbook } => pilot_update(core, &id, name, enabled, playbook),
        Op::PilotRemove { id } => {
            stop(core, &id);
            core.autopilot_update(|a| {
                a.pilots.retain(|p| p.id != id);
                a.items.retain(|i| i.pilot_id != id);
                a.messages.retain(|m| m.pilot_id != id);
                a.pending.retain(|x| x.pilot_id != id);
                a.suggestions.retain(|x| x.pilot_id != id);
            });
            core.autopilot.prt.lock().remove(&id);
            core.autopilot.extra.lock().notes.remove(&id);
            core.audit.note("autopilot_remove", Some(id), true, None);
            Ok(Value::Null)
        }
        Op::PilotSend { id, text } => {
            let text = text.trim();
            if text.is_empty() {
                return Err(bad("the message is empty"));
            }
            core.pilot(&id).ok_or_else(|| gone("pilot"))?;
            core.ap_message(&id, PilotRole::User, &clip(text, 8000), None, false, vec![]);
            core.autopilot.wake(&id, Trigger::Chat, Duration::ZERO);
            Ok(Value::Null)
        }
        Op::PilotRun { id, routine_id } => {
            let p = core.pilot(&id).ok_or_else(|| gone("pilot"))?;
            let t = match routine_id {
                Some(r) if p.playbook.routines.iter().any(|x| x.id == r) => {
                    core.autopilot.set_routine_last(&r, now_ms());
                    Trigger::Routine(r)
                }
                Some(_) => return Err(gone("routine")),
                None => Trigger::Check,
            };
            if !p.setup_done {
                return Err(bad("finish the setup first"));
            }
            core.autopilot.wake(&id, t, Duration::ZERO);
            Ok(Value::Null)
        }
        Op::PilotStop { id } => {
            stop(core, &id);
            Ok(Value::Null)
        }
        Op::ItemUpdate { id, status, draft } => item_update(core, &id, status, draft),
        Op::ItemSend { id } => {
            let r = tools::send_draft(core, &id).await;
            core.audit.note("autopilot_item_send", Some(id), r.is_ok(), r.as_ref().err().cloned());
            r.map(|_| Value::Null).map_err(|e| err(ErrorCode::Unavailable, e))
        }
        Op::Confirm { id, allow } => confirm(core, client, &id, allow).await,
        Op::SuggestionDecide { id, accept } => {
            let sg = core.read(|s| s.autopilot.suggestions.iter().find(|x| x.id == id).cloned()).ok_or_else(|| gone("suggestion"))?;
            if accept {
                tools::validate_playbook(&sg.playbook).map_err(bad)?;
            }
            core.autopilot_update(|a| {
                a.suggestions.retain(|x| x.id != id);
                if accept && let Some(p) = a.pilots.iter_mut().find(|p| p.id == sg.pilot_id) {
                    p.playbook = sg.playbook.clone();
                    p.setup_done = true;
                }
            });
            if accept {
                core.ap_message(
                    &sg.pilot_id,
                    PilotRole::Pilot,
                    "The playbook is applied. I will work by it from now on.",
                    None,
                    false,
                    vec![],
                );
            }
            core.audit.note("autopilot_suggestion", Some(id), true, None);
            Ok(Value::Null)
        }
        Op::ConnectorCreate { name, description } => builder::create(core, name, description).await.and_then(|c| val(&c)),
        Op::ConnectorChange { id, request } => builder::change(core, &id, request).await.and_then(|c| val(&c)),
        Op::ConnectorImport { path } => builder::import(core, path).await.and_then(|c| val(&c)),
        Op::ConnectorConfigure { id, config, secrets } => core.connectors.configure(core, &id, config, secrets).and_then(|c| val(&c)),
        Op::ConnectorEnable { id, enabled } => {
            core.connectors.enable(core, &id, enabled)?;
            val(&core.connectors.get(&id))
        }
        Op::ConnectorTest { id } => {
            if !core.connectors.exists(&id) {
                return Err(gone("connector"));
            }
            val(&check::test(core, &id).await)
        }
        Op::ConnectorOptions { id, field } => options(core, &id, &field).await,
        Op::ConnectorLogs { id } => {
            if !core.connectors.exists(&id) {
                return Err(gone("connector"));
            }
            val(&core.connectors.logs(&id))
        }
        Op::ConnectorRemove { id } => {
            core.connectors.remove(core, &id)?;
            core.autopilot_update(|a| {
                for p in &mut a.pilots {
                    p.playbook.sources.retain(|s| s.connector_id != id);
                    p.playbook.rules.retain(|r| r.connector_id.as_deref() != Some(id.as_str()));
                }
            });
            Ok(Value::Null)
        }
        Op::BrowserPair => {
            let code = core.connectors.bridge.pair_code();
            core.audit.note("autopilot_browser_pair", None, true, None);
            Ok(json!(code))
        }
        Op::BrowserUnpair => {
            core.connectors.bridge.unpair(&core.paths.root);
            core.connectors.publish(core);
            core.audit.note("autopilot_browser_unpair", None, true, None);
            Ok(Value::Null)
        }
    }
}

fn stop(core: &Core, pid: &str) {
    core.autopilot.with_prt(pid, |r| {
        r.queue.clear();
        r.wake_at = None;
        if let Some(t) = &r.running {
            t.cancel();
        }
    });
    core.autopilot_update(|_| {});
}

fn pilot_create(core: &Arc<Core>, ws: &str) -> R {
    let name = core.read(|s| s.workspaces.iter().find(|w| w.id == ws).map(|w| w.name.clone())).ok_or_else(|| gone("workspace"))?;
    if core.read(|s| s.autopilot.pilots.iter().any(|p| p.workspace_id == ws)) {
        return Err(bad("this project already has an autopilot"));
    }
    let p = Pilot {
        id: core.autopilot.new_id("p"),
        workspace_id: ws.to_string(),
        name,
        enabled: true,
        status: PilotStatus::Idle,
        activity: None,
        playbook: Playbook::default(),
        setup_done: false,
        last_run: None,
        next_run: None,
        created: now_ms(),
    };
    let id = p.id.clone();
    core.autopilot_update(|a| a.pilots.push(p));
    core.audit.note("autopilot_create", Some(id.clone()), true, None);
    core.autopilot.wake(&id, Trigger::Setup, Duration::ZERO);
    val(&core.pilot(&id))
}

fn pilot_update(core: &Arc<Core>, id: &str, name: Option<String>, enabled: Option<bool>, playbook: Option<Playbook>) -> R {
    core.pilot(id).ok_or_else(|| gone("pilot"))?;
    if let Some(pb) = &playbook {
        tools::validate_playbook(pb).map_err(bad)?;
    }
    if enabled == Some(false) {
        stop(core, id);
    }
    // Routines that are new start counting now, not at the pilot's creation.
    if let Some(pb) = &playbook {
        for r in &pb.routines {
            if core.autopilot.routine_last(&r.id).is_none() {
                core.autopilot.set_routine_last(&r.id, now_ms());
            }
        }
    }
    core.autopilot_update(|a| {
        if let Some(p) = a.pilots.iter_mut().find(|p| p.id == id) {
            if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
                p.name = clip(n.trim(), 80);
            }
            if let Some(e) = enabled {
                p.enabled = e;
            }
            if let Some(pb) = playbook {
                p.playbook = pb;
                p.setup_done = true;
            }
        }
        if enabled == Some(false) {
            a.pending.retain(|x| x.pilot_id != id);
        }
    });
    core.audit.note("autopilot_update", Some(id.to_string()), true, None);
    val(&core.pilot(id))
}

fn item_update(core: &Core, id: &str, status: Option<ItemStatus>, draft: Option<String>) -> R {
    let it = core.ap_item(id).ok_or_else(|| gone("item"))?;
    if draft.is_some() && it.draft.is_none() {
        return Err(bad("this item has no draft"));
    }
    let now = now_ms();
    core.autopilot_update(|a| {
        if let Some(i) = a.items.iter_mut().find(|i| i.id == id) {
            if let Some(s) = status {
                i.status = s;
            }
            if let (Some(t), Some(d)) = (draft.as_ref(), i.draft.as_mut()) {
                d.text = clip(t, 4000);
            }
            i.updated = now;
        }
    });
    val(&core.ap_item(id))
}

async fn confirm(core: &Arc<Core>, client: &ClientInfo, id: &str, allow: bool) -> R {
    let pend = core.read(|s| s.autopilot.pending.iter().find(|x| x.id == id).cloned()).ok_or_else(|| gone("confirmation"))?;
    core.autopilot_update(|a| a.pending.retain(|x| x.id != id));
    let who = format!("{:?}", client.kind).to_lowercase();
    let note;
    if allow {
        let p = core.pilot(&pend.pilot_id).ok_or_else(|| gone("pilot"))?;
        let Some(t) = tools::target_of(core, &pend) else {
            return Err(err(ErrorCode::NotFound, "that tool is gone"));
        };
        let out = tools::run(core, &p, &t, pend.args.clone(), pend.item_id.as_deref()).await;
        let okay = serde_json::from_str::<Value>(&out).map(|v| v["ok"] != json!(false)).unwrap_or(true);
        core.audit.note("autopilot_confirm", Some(format!("{}: {}", who, pend.summary)), okay, None);
        if let Some(i) = &pend.item_id {
            core.ap_step(i, &format!("{}: {}", if okay { "Done after OK" } else { "Failed after OK" }, pend.summary), okay);
        }
        note = format!("The owner allowed: {}. Result: {}", pend.summary, clip(&out, 1500));
        let _ = matches!(t, Target::Builtin(_));
    } else {
        core.audit.note("autopilot_deny", Some(format!("{}: {}", who, pend.summary)), true, None);
        if let Some(i) = &pend.item_id {
            core.ap_step(i, &format!("The owner said no: {}", pend.summary), true);
        }
        note = format!("The owner declined: {}. Do not try it again.", pend.summary);
    }
    core.autopilot.wake(&pend.pilot_id, Trigger::Resume(note), Duration::from_secs(1));
    Ok(Value::Null)
}

async fn options(core: &Arc<Core>, id: &str, field: &str) -> R {
    let c = core.connectors.get(id).ok_or_else(|| gone("connector"))?;
    let f = c.manifest.setup.iter().find(|f| f.key == field).ok_or_else(|| bad("no such field"))?;
    let Some(from) = &f.from else { return val(&f.options) };
    let args: serde_json::Map<String, Value> = c.config.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let out = core
        .connectors
        .call_tool(core, id, from, Value::Object(args), Duration::from_secs(30))
        .await
        .map_err(|e| err(ErrorCode::Unavailable, e))?;
    if out.is_error {
        return Err(err(ErrorCode::Unavailable, clip(&out.text, 300)));
    }
    let v = out.json();
    let list = v.get("options").cloned().unwrap_or(v);
    let opts: Vec<FieldOption> = list
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| match x {
                    Value::String(s) => Some(FieldOption { value: s.clone(), label: s.clone() }),
                    Value::Object(_) => {
                        let value = x["value"].as_str().map(str::to_string).or_else(|| x["id"].as_str().map(str::to_string))?;
                        let label = x["label"].as_str().or_else(|| x["name"].as_str()).unwrap_or(&value).to_string();
                        Some(FieldOption { value, label })
                    }
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    val(&opts)
}
