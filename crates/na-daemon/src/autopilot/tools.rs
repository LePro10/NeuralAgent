//! The pilot's tools: its own (inbox, agents, notes, playbook proposals) and the tools of the
//! connectors it uses. Permissions are decided here, in code, by `perm`; the model cannot talk
//! its way around them.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use na_protocol::{
    Allow, AttentionKind, Draft, InboxItem, ItemKind, ItemStatus, Pilot, PilotPending, PilotSuggestion, Playbook, Request, ToolClass,
};
use serde_json::{Value, json};

use super::perm;
use crate::core::{Core, now_ms};
use crate::llm::Tool;
use crate::neural::observe::clip;
use crate::neural::world::short;
use crate::orch::me;

const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const RESULT_MAX: usize = 8000;

/// Tool names must live for the whole run (`llm::Tool` takes `&'static str`); the set is small.
fn intern(s: &str) -> &'static str {
    static NAMES: OnceLock<Mutex<HashMap<String, &'static str>>> = OnceLock::new();
    let mut m = NAMES.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    if let Some(v) = m.get(s) {
        return v;
    }
    let leaked: &'static str = Box::leak(s.to_string().into_boxed_str());
    m.insert(s.to_string(), leaked);
    leaked
}

/// What a tool name stands for.
#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    Builtin(&'static str),
    Conn { id: String, tool: String, class: ToolClass },
}

pub struct Offer {
    pub tools: Vec<Tool>,
    pub map: HashMap<String, Target>,
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": props, "required": required })
}

fn builtin_tools() -> Vec<Tool> {
    let kinds = json!({ "type": "string", "enum": ["bug", "question", "feedback", "idea", "task", "other"] });
    vec![
        Tool {
            name: "inbox_list",
            description: "List inbox items (id, title, status, summary). Optional filter by status.",
            params: obj(json!({ "status": { "type": "string", "enum": ["new", "working", "needs_you", "done", "dismissed"] } }), &[]),
        },
        Tool {
            name: "inbox_get",
            description: "One inbox item in full: the original text, your steps, the draft.",
            params: obj(json!({ "id": { "type": "string" } }), &["id"]),
        },
        Tool {
            name: "inbox_add",
            description: "Put something into the inbox yourself (a finding from a routine, a follow-up). Returns its id.",
            params: obj(
                json!({ "title": { "type": "string" }, "text": { "type": "string", "description": "What it is, in your own words" }, "kind": kinds, "urgency": { "type": "integer", "description": "0 low .. 3 urgent" }, "url": { "type": "string" } }),
                &["title", "text"],
            ),
        },
        Tool {
            name: "inbox_update",
            description: "Change an item: status (new, working, needs_you, done, dismissed), a short note of what you did, urgency. Use needs_you only when the owner has to act.",
            params: obj(
                json!({ "id": { "type": "string" }, "status": { "type": "string", "enum": ["new", "working", "needs_you", "done", "dismissed"] }, "note": { "type": "string" }, "urgency": { "type": "integer" } }),
                &["id"],
            ),
        },
        Tool {
            name: "draft_reply",
            description: "Write the answer to an item and name the connector tool that sends it (for example connector discord, tool reply, args {channel_id, message_id}). The owner reviews and sends it, unless the playbook lets that tool run alone. The text goes in `text`.",
            params: obj(
                json!({ "id": { "type": "string" }, "text": { "type": "string" }, "connector": { "type": "string" }, "tool": { "type": "string" }, "args": { "type": "object", "description": "Arguments of the tool besides text" } }),
                &["id", "text", "connector", "tool"],
            ),
        },
        Tool {
            name: "start_agent",
            description: "Start a coding agent in this project with a prompt (goal, context, what done means). Link it to an inbox item with `item`.",
            params: obj(
                json!({ "prompt": { "type": "string" }, "item": { "type": "string" }, "agent": { "type": "string", "description": "Agent type; omit for the default" }, "worktree": { "type": "boolean" } }),
                &["prompt"],
            ),
        },
        Tool {
            name: "send_to_agent",
            description: "Send a message to a running agent of this project (short id from <world> or the item).",
            params: obj(json!({ "agent": { "type": "string" }, "text": { "type": "string" } }), &["agent", "text"]),
        },
        Tool {
            name: "inspect_agent",
            description: "What an agent of this project did and said, and its open prompt.",
            params: obj(json!({ "agent": { "type": "string" } }), &["agent"]),
        },
        Tool {
            name: "agent_changes",
            description: "The files an agent changed and the start of the diff.",
            params: obj(json!({ "agent": { "type": "string" }, "path": { "type": "string" } }), &["agent"]),
        },
        Tool {
            name: "remember",
            description: "Keep a short fact for later turns (who is who, what the owner prefers). Never a secret.",
            params: obj(json!({ "text": { "type": "string" } }), &["text"]),
        },
        suggest_tool(),
    ]
    .into_iter()
    .chain(connector_tools())
    .collect()
}

/// build_connector and connector_status: also offered while the setup interview is open.
fn connector_tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "build_connector",
            description: "Start a coding agent that builds a NEW connector (a source such as Discord servers, a forum, an API). Use it when the owner wants a source that is not in <world>. `request` is what it should do, in the owner's words plus the details you know. Returns at once; the build runs in the background and the owner sees its progress. Do not call it twice for the same wish.",
            params: obj(
                json!({ "name": { "type": "string", "description": "Short name, e.g. \"My Discord\"" }, "request": { "type": "string" } }),
                &["name", "request"],
            ),
        },
        Tool {
            name: "connector_status",
            description: "The current state of one connector from <world>: building, needs setup (what the owner still has to enter), running, error, warnings, and its tools.",
            params: obj(json!({ "id": { "type": "string" } }), &["id"]),
        },
    ]
}

fn suggest_tool() -> Tool {
    Tool {
        name: "suggest_playbook",
        description: "Propose the whole playbook (it replaces the current one, so start from the current one). This is also how a running connector becomes a source: add it to sources. The owner reviews it and decides; you cannot apply it yourself. Fields: mission, instructions, tone, routines [{task, schedule: {kind: every, minutes} | {kind: daily, at: \"09:00\"} | {kind: weekly, day: 0-6, at}, enabled}], sources [{connector_id, listen, scope}], rules [{connector_id (omit for your own tools), tool (or \"*\"), allow: auto|ask|never}], notify: all|needs_you|never.",
        params: obj(json!({ "reason": { "type": "string" }, "playbook": { "type": "object" } }), &["reason", "playbook"]),
    }
}

/// The tools offered to the model in this turn. While the setup is open: only the proposal.
pub fn offer(core: &Core, p: &Pilot) -> Offer {
    let mut tools = vec![];
    let mut map = HashMap::new();
    if !p.setup_done {
        map.insert("suggest_playbook".to_string(), Target::Builtin("suggest_playbook"));
        let mut tools = vec![suggest_tool()];
        for t in connector_tools() {
            map.insert(t.name.to_string(), Target::Builtin(t.name));
            tools.push(t);
        }
        return Offer { tools, map };
    }
    for t in builtin_tools() {
        if perm::resolve(&p.playbook, None, t.name, perm::builtin_class(t.name)) == Allow::Never {
            continue;
        }
        map.insert(t.name.to_string(), Target::Builtin(t.name));
        tools.push(t);
    }
    for s in &p.playbook.sources {
        let Some(c) = core.connectors.get(&s.connector_id) else { continue };
        if c.status != na_protocol::ConnectorStatus::Running {
            continue;
        }
        for t in &c.tools {
            if perm::resolve(&p.playbook, Some(&c.id), &t.name, t.class) == Allow::Never {
                continue;
            }
            // The poll tool belongs to the scheduler.
            if c.manifest.poll.as_ref().is_some_and(|x| x.tool == t.name) {
                continue;
            }
            let name: String = format!("{}__{}", c.id, t.name).chars().take(64).collect();
            map.insert(name.clone(), Target::Conn { id: c.id.clone(), tool: t.name.clone(), class: t.class });
            tools.push(Tool {
                name: intern(&name),
                description: intern(&format!("[{}] {}", c.manifest.name, clip(&t.description, 400))),
                params: core.connectors.tool_schema(&c.id, &t.name),
            });
        }
    }
    Offer { tools, map }
}

/// Words for the owner: "Read Discord messages".
pub fn step_text(core: &Core, t: &Target, args: &Value) -> String {
    match t {
        Target::Builtin(n) => match *n {
            "inbox_list" | "inbox_get" => "Looked at the inbox".into(),
            "inbox_add" => "Added an item".into(),
            "inbox_update" => "Updated an item".into(),
            "draft_reply" => "Wrote a reply".into(),
            "start_agent" => "Started an agent".into(),
            "send_to_agent" => "Messaged an agent".into(),
            "inspect_agent" | "agent_changes" => "Checked an agent".into(),
            "remember" => "Made a note".into(),
            "suggest_playbook" => "Proposed changes to the playbook".into(),
            "build_connector" => "Started building a connector".into(),
            "connector_status" => "Checked a connector".into(),
            n => n.to_string(),
        },
        Target::Conn { id, tool, .. } => {
            let name = core.connectors.manifest(id).map(|m| m.name).unwrap_or_else(|| id.clone());
            let _ = args;
            format!("{name}: {}", tool.replace('_', " "))
        }
    }
}

fn ok(v: Value) -> String {
    v.to_string()
}

fn fail(msg: impl AsRef<str>) -> String {
    json!({ "ok": false, "error": msg.as_ref() }).to_string()
}

fn wrap(source: &str, text: &str) -> String {
    format!("<untrusted source=\"{source}\">\n{}\n</untrusted>", clip(text, RESULT_MAX).replace("</untrusted>", ""))
}

fn compact(args: &Value) -> String {
    clip(&args.to_string(), 200)
}

pub fn item_status(s: &str) -> Option<ItemStatus> {
    Some(match s.trim() {
        "new" => ItemStatus::New,
        "working" => ItemStatus::Working,
        "needs_you" => ItemStatus::NeedsYou,
        "done" => ItemStatus::Done,
        "dismissed" => ItemStatus::Dismissed,
        _ => return None,
    })
}

fn kind_of(s: &str) -> ItemKind {
    serde_json::from_value(Value::String(s.trim().to_lowercase())).unwrap_or(ItemKind::Other)
}

/// Runs one call of the model. Returns the text for the model.
pub async fn call(core: &Arc<Core>, pid: &str, item_hint: Option<&str>, t: &Target, args: Value) -> String {
    let Some(p) = core.pilot(pid) else { return fail("this pilot no longer exists") };
    let (conn, name, class) = match t {
        Target::Builtin(n) => (None, n.to_string(), perm::builtin_class(n)),
        Target::Conn { id, tool, class } => (Some(id.clone()), tool.clone(), *class),
    };
    let allow = if p.setup_done || matches!(name.as_str(), "suggest_playbook" | "build_connector" | "connector_status") {
        perm::resolve(&p.playbook, conn.as_deref(), &name, class)
    } else {
        Allow::Never
    };
    match allow {
        Allow::Never => fail("this tool is not available"),
        Allow::Ask => {
            let summary = match t {
                Target::Conn { id, .. } => {
                    let cname = core.connectors.manifest(id).map(|m| m.name).unwrap_or_else(|| id.clone());
                    match args.get("text").and_then(Value::as_str) {
                        Some(x) => format!("{cname}: {} - {}", name.replace('_', " "), clip(x, 160)),
                        None => format!("{cname}: {} {}", name.replace('_', " "), compact(&args)),
                    }
                }
                Target::Builtin(n) => format!("{}: {}", n.replace('_', " "), compact(&args)),
            };
            let pend = PilotPending {
                id: core.autopilot.new_id("c"),
                pilot_id: pid.to_string(),
                item_id: item_hint.map(str::to_string).or_else(|| args.get("item").and_then(Value::as_str).map(str::to_string)),
                connector_id: conn,
                tool: name,
                summary: summary.clone(),
                args,
                created: now_ms(),
            };
            let (iid, id) = (pend.item_id.clone(), pend.id.clone());
            core.autopilot_update(|a| a.pending.push(pend));
            core.ap_notify(pid, &id, AttentionKind::Waiting, &format!("Needs your OK: {summary}"), true);
            if let Some(i) = iid {
                core.ap_step(&i, &format!("Waiting for the owner's OK: {summary}"), true);
            }
            ok(
                json!({ "ok": false, "waiting_for_owner": true, "note": "The owner has to confirm this first. Carry on with something else." }),
            )
        }
        Allow::Auto => run(core, &p, t, args, item_hint).await,
    }
}

/// Runs a tool without asking (the permission was settled by the caller or by the owner's OK).
pub async fn run(core: &Arc<Core>, p: &Pilot, t: &Target, args: Value, item_hint: Option<&str>) -> String {
    match t {
        Target::Conn { id, tool, .. } => {
            let r = core.connectors.call_tool(core, id, tool, args.clone(), CALL_TIMEOUT).await;
            core.audit.note("autopilot_tool", Some(format!("{id}.{tool}")), r.is_ok(), r.as_ref().err().cloned());
            match r {
                Ok(o) if !o.is_error => wrap(id, &o.text),
                Ok(o) => fail(clip(&o.text, 500)),
                Err(e) => fail(e),
            }
        }
        Target::Builtin(n) => builtin(core, p, n, args, item_hint).await,
    }
}

fn own_item(core: &Core, pid: &str, id: &str) -> Result<InboxItem, String> {
    core.ap_item(id).filter(|i| i.pilot_id == pid).ok_or_else(|| format!("no inbox item \"{id}\""))
}

fn agent_of(core: &Core, p: &Pilot, agent: &str) -> Result<String, String> {
    let (sid, _) = core.resolve_session(agent).ok_or("no agent matches that id")?;
    let ws = core.read(|s| s.sessions.get(&sid).map(|x| x.workspace_id.clone()));
    if ws.as_deref() != Some(p.workspace_id.as_str()) {
        return Err("that agent works in another project".into());
    }
    Ok(sid)
}

fn item_json(i: &InboxItem) -> Value {
    json!({ "id": i.id, "title": i.title, "status": i.status, "kind": i.kind, "urgency": i.urgency, "source": i.source,
        "summary": i.summary, "agent": i.session_id.as_deref().map(short), "has_draft": i.draft.is_some() })
}

async fn builtin(core: &Arc<Core>, p: &Pilot, name: &str, a: Value, item_hint: Option<&str>) -> String {
    let s = |k: &str| a.get(k).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string);
    let pid = p.id.as_str();
    match name {
        "inbox_list" => {
            let want = s("status").and_then(|x| item_status(&x));
            let v: Vec<Value> = core.read(|st| {
                st.autopilot
                    .items
                    .iter()
                    .filter(|i| i.pilot_id == pid && want.is_none_or(|w| i.status == w))
                    .take(40)
                    .map(item_json)
                    .collect()
            });
            ok(json!({ "ok": true, "items": v }))
        }
        "inbox_get" => match s("id").ok_or("id is missing".to_string()).and_then(|id| own_item(core, pid, &id)) {
            Ok(i) => {
                let mut v = item_json(&i);
                v["original"] = Value::String(wrap(&i.source, &i.original));
                v["steps"] = json!(i.steps.iter().map(|x| x.text.clone()).collect::<Vec<_>>());
                v["draft"] = json!(i.draft.as_ref().map(|d| d.text.clone()));
                v["author"] = json!(i.author);
                v["url"] = json!(i.url);
                ok(json!({ "ok": true, "item": v }))
            }
            Err(e) => fail(e),
        },
        "inbox_add" => {
            let (Some(title), Some(text)) = (s("title"), s("text")) else { return fail("title and text are needed") };
            let id = core.autopilot.new_id("i");
            let now = now_ms();
            let item = InboxItem {
                id: id.clone(),
                pilot_id: pid.to_string(),
                source: "pilot".into(),
                kind: s("kind").map(|k| kind_of(&k)).unwrap_or(ItemKind::Other),
                title: clip(&title, 80),
                summary: clip(&text, 300),
                original: String::new(),
                author: None,
                url: s("url"),
                status: ItemStatus::New,
                urgency: a.get("urgency").and_then(Value::as_u64).unwrap_or(1).min(3) as u8,
                steps: vec![],
                session_id: None,
                draft: None,
                created: now,
                updated: now,
            };
            core.autopilot_update(|st| st.items.insert(0, item));
            ok(json!({ "ok": true, "id": id }))
        }
        "inbox_update" => {
            let i = match s("id").ok_or("id is missing".to_string()).and_then(|id| own_item(core, pid, &id)) {
                Ok(i) => i,
                Err(e) => return fail(e),
            };
            let status = s("status").and_then(|x| item_status(&x));
            let note = s("note");
            let urg = a.get("urgency").and_then(Value::as_u64).map(|u| u.min(3) as u8);
            let now = now_ms();
            core.autopilot_update(|st| {
                if let Some(x) = st.items.iter_mut().find(|x| x.id == i.id) {
                    if let Some(s) = status {
                        x.status = s;
                    }
                    if let Some(u) = urg {
                        x.urgency = u;
                    }
                    x.updated = now;
                }
            });
            if let Some(n) = note {
                core.ap_step(&i.id, &n, true);
            }
            if status == Some(ItemStatus::NeedsYou) {
                core.ap_notify(pid, &i.id, AttentionKind::Waiting, &format!("Needs you: {}", i.title), true);
            }
            ok(json!({ "ok": true }))
        }
        "draft_reply" => {
            let i = match s("id").ok_or("id is missing".to_string()).and_then(|id| own_item(core, pid, &id)) {
                Ok(i) => i,
                Err(e) => return fail(e),
            };
            let (Some(text), Some(cid), Some(tool)) = (s("text"), s("connector"), s("tool")) else {
                return fail("text, connector and tool are needed");
            };
            let Some(m) = core.connectors.manifest(&cid) else { return fail("no such connector") };
            if !m.tools.contains_key(&tool) {
                return fail(format!("{} has no tool \"{tool}\"", m.name));
            }
            let args: BTreeMap<String, Value> = a
                .get("args")
                .and_then(Value::as_object)
                .map(|o| o.iter().filter(|(k, _)| *k != "text").map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default();
            let draft = Draft { text: clip(&text, 4000), connector_id: cid.clone(), tool: tool.clone(), args };
            core.autopilot_update(|st| {
                if let Some(x) = st.items.iter_mut().find(|x| x.id == i.id) {
                    x.draft = Some(draft);
                    x.status = ItemStatus::NeedsYou;
                    x.updated = now_ms();
                }
            });
            if perm::explicit_auto(&p.playbook, Some(&cid), &tool) {
                return match send_draft(core, &i.id).await {
                    Ok(_) => ok(json!({ "ok": true, "sent": true })),
                    Err(e) => fail(e),
                };
            }
            core.ap_notify(pid, &i.id, AttentionKind::Waiting, &format!("Reply ready: {}", i.title), true);
            ok(json!({ "ok": true, "sent": false, "note": "The owner reviews and sends the draft." }))
        }
        "start_agent" => {
            let Some(prompt) = s("prompt") else { return fail("prompt is missing") };
            let item = s("item").or_else(|| item_hint.map(str::to_string));
            let profile = match s("agent").map(|x| core.resolve_profile(&x)) {
                Some(Ok(x)) => x,
                Some(Err(e)) => return fail(e.message),
                None => core.read(|st| st.settings.default_profile.clone()),
            };
            let sid = match core.start_agent_raw(&p.workspace_id, &profile, Some(prompt.clone()), a["worktree"].as_bool()).await {
                Ok(x) => x,
                Err(e) => return fail(e.message),
            };
            core.audit.note("autopilot_start_agent", Some(short(&sid)), true, None);
            if let Some(iid) = item {
                let now = now_ms();
                core.autopilot_update(|st| {
                    if let Some(x) = st.items.iter_mut().find(|x| x.id == iid && x.pilot_id == pid) {
                        x.session_id = Some(sid.clone());
                        x.status = ItemStatus::Working;
                        x.updated = now;
                    }
                });
                core.ap_step(&iid, &format!("Started an agent: {}", clip(&prompt, 120)), true);
            }
            ok(json!({ "ok": true, "agent": short(&sid) }))
        }
        "send_to_agent" => {
            let (Some(agent), Some(text)) = (s("agent"), s("text")) else { return fail("agent and text are needed") };
            let sid = match agent_of(core, p, &agent) {
                Ok(x) => x,
                Err(e) => return fail(e),
            };
            match core.handle(&me(), Request::SessionPrompt { id: sid, text }).await {
                Ok(_) => ok(json!({ "ok": true })),
                Err(e) => fail(e.message),
            }
        }
        "inspect_agent" | "agent_changes" => {
            let Some(agent) = s("agent") else { return fail("agent is missing") };
            let sid = match agent_of(core, p, &agent) {
                Ok(x) => x,
                Err(e) => return fail(e),
            };
            let v = if name == "inspect_agent" { core.agent_report(&sid) } else { core.agent_changes(&sid, s("path")).await };
            ok(json!({ "ok": true, "report": wrap("agent", &v.to_string()) }))
        }
        "remember" => {
            let Some(t) = s("text") else { return fail("text is missing") };
            if crate::connectors::check::looks_secret(&t) {
                return fail("that looks like a secret; not kept");
            }
            core.autopilot.note_add(pid, &clip(&t, 300));
            ok(json!({ "ok": true }))
        }
        "suggest_playbook" => suggest(core, p, &a),
        "build_connector" => {
            let (Some(name), Some(request)) = (s("name"), s("request")) else { return fail("name and request are needed") };
            if core.connectors.list().iter().any(|c| c.status == na_protocol::ConnectorStatus::Building && c.manifest.name == name) {
                return fail("a connector with that name is already being built; use connector_status");
            }
            let profile = core.read(|st| st.settings.default_profile.clone());
            match super::super::connectors::builder::create(core, name, request, Some(profile)).await {
                Ok(c) => {
                    core.audit.note("autopilot_build_connector", Some(c.id.clone()), true, None);
                    ok(json!({ "ok": true, "connector_id": c.id, "status": "building",
                        "note": "A coding agent is building it now. The owner sees the progress and the setup form in the chat. Tell them in one sentence; check later with connector_status." }))
                }
                Err(e) => fail(e.message),
            }
        }
        "connector_status" => {
            let Some(id) = s("id") else { return fail("id is missing") };
            let Some(c) = core.connectors.get(&id) else { return fail(format!("no connector \"{id}\"")) };
            ok(json!({ "ok": true, "connector_id": c.id, "name": c.manifest.name, "state": super::prompt::status_words(&c),
                "running": c.status == na_protocol::ConnectorStatus::Running, "error": c.error, "warnings": c.warnings,
                "attached": p.playbook.sources.iter().any(|x| x.connector_id == c.id),
                "tools": c.tools.iter().map(|t| t.name.clone()).collect::<Vec<_>>() }))
        }
        other => fail(format!("unknown tool {other}")),
    }
}

/// Fills in what a model leaves out of routines, then reads the playbook.
pub fn parse_playbook(v: &Value) -> Result<Playbook, String> {
    let mut v = v.clone();
    if let Some(rs) = v.get_mut("routines").and_then(Value::as_array_mut) {
        for (n, r) in rs.iter_mut().enumerate() {
            if let Some(o) = r.as_object_mut() {
                o.entry("id").or_insert_with(|| Value::String(format!("r{}", n + 1)));
                o.entry("enabled").or_insert(Value::Bool(true));
            }
        }
    }
    if let Some(ss) = v.get_mut("sources").and_then(Value::as_array_mut) {
        for s in ss.iter_mut() {
            if let Some(o) = s.as_object_mut() {
                o.entry("listen").or_insert(Value::Bool(true));
            }
        }
    }
    let p: Playbook = serde_json::from_value(v).map_err(|e| format!("not a playbook: {e}"))?;
    validate_playbook(&p)?;
    Ok(p)
}

pub fn validate_playbook(p: &Playbook) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    for r in &p.routines {
        super::sched::validate(&r.schedule)?;
        if r.id.trim().is_empty() || !ids.insert(r.id.clone()) {
            return Err("routines need distinct ids".into());
        }
    }
    Ok(())
}

fn suggest(core: &Core, p: &Pilot, a: &Value) -> String {
    let pb = match parse_playbook(&a["playbook"]) {
        Ok(x) => x,
        Err(e) => return fail(e),
    };
    let reason = a["reason"].as_str().unwrap_or("").trim();
    let sg = PilotSuggestion {
        id: core.autopilot.new_id("s"),
        pilot_id: p.id.clone(),
        reason: clip(reason, 300),
        playbook: pb,
        created: now_ms(),
    };
    let id = sg.id.clone();
    core.autopilot_update(|st| {
        st.suggestions.retain(|x| x.pilot_id != p.id);
        st.suggestions.push(sg);
    });
    core.ap_notify(&p.id, &id, AttentionKind::Waiting, "Playbook proposal is ready", true);
    ok(json!({ "ok": true, "note": "Proposed. Only the owner can apply it." }))
}

/// Sends the item's draft through its connector (the owner's OK, or a rule that allows it).
pub async fn send_draft(core: &Arc<Core>, item: &str) -> Result<String, String> {
    let i = core.ap_item(item).ok_or("no such item")?;
    let d = i.draft.clone().ok_or("this item has no draft")?;
    let mut args: serde_json::Map<String, Value> = d.args.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    args.insert("text".into(), Value::String(d.text.clone()));
    let r = core.connectors.call_tool(core, &d.connector_id, &d.tool, Value::Object(args), CALL_TIMEOUT).await;
    core.audit.note(
        "autopilot_send",
        Some(format!("{}.{}", d.connector_id, d.tool)),
        r.is_ok() && r.as_ref().is_ok_and(|o| !o.is_error),
        None,
    );
    match r {
        Ok(o) if !o.is_error => {
            core.autopilot_update(|st| {
                if let Some(x) = st.items.iter_mut().find(|x| x.id == i.id) {
                    x.draft = None;
                    x.status = ItemStatus::Done;
                    x.updated = now_ms();
                }
            });
            core.ap_step(&i.id, &format!("Sent: {}", clip(&d.text, 160)), true);
            Ok(clip(&o.text, 300))
        }
        Ok(o) => {
            core.ap_step(&i.id, &format!("Could not send: {}", clip(&o.text, 160)), false);
            Err(clip(&o.text, 300))
        }
        Err(e) => {
            core.ap_step(&i.id, &format!("Could not send: {}", clip(&e, 160)), false);
            Err(e)
        }
    }
}

/// Finds the target of a stored confirmation again (the connector may have changed).
pub fn target_of(core: &Core, pend: &PilotPending) -> Option<Target> {
    match &pend.connector_id {
        None => builtin_tools().into_iter().find(|t| t.name == pend.tool).map(|t| Target::Builtin(t.name)),
        Some(c) => {
            let class = core.connectors.get(c)?.tools.iter().find(|t| t.name == pend.tool).map(|t| t.class).unwrap_or(ToolClass::External);
            Some(Target::Conn { id: c.clone(), tool: pend.tool.clone(), class })
        }
    }
}
