//! Swarms: a team of agents on one goal that hand work to each other.
//!
//! Every member gets one extra MCP server, `neuralagentd swarm-mcp` (stdio), with three tools:
//! `send_message`, `team` and `messages`. It forwards the calls to the daemon (`POST /swarm`,
//! authenticated with the session's hook token). A message is typed into the recipient's
//! terminal as a prompt as soon as it has finished its turn, so it works with every CLI that
//! speaks MCP, without the agents polling. The user sees the whole conversation and can write
//! into it ("You").

use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State as AxState;
use axum::http::{HeaderMap, StatusCode};
use na_protocol::{
    AgentStatus, ApiError, AttentionKind, ErrorCode, Event, Id, McpServer, McpTransport, Session, StartSession, State, StatusSource, Swarm,
    SwarmMember, SwarmMessage, SwarmRole,
};
use parking_lot::Mutex;
use serde_json::{Value, json};

use crate::core::{Core, err, now_ms};

/// Name of the MCP server; Claude Code calls its tools `mcp__neuralagent-swarm__…`.
pub const SERVER_ID: &str = "neuralagent-swarm";
/// The user, as sender and recipient.
pub const YOU: &str = "You";
/// Messages kept per swarm.
const KEEP: usize = 300;
const MAX_MEMBERS: usize = 8;
/// What the agent's process environment has to pass to the bridge (Codex only passes what it is told).
const BRIDGE_ENV: [&str; 3] = ["NEURALAGENT_SESSION", "NEURALAGENT_HOOK_TOKEN", "NEURALAGENT_PORT"];

/// Messages still to be typed into a terminal: session → message ids, oldest first.
#[derive(Default)]
pub struct Outbox(Mutex<HashMap<Id, Vec<Id>>>);

pub fn default_team(profile: &str) -> Vec<SwarmRole> {
    ["Coordinator", "Scout", "Builder", "Reviewer"].map(|r| SwarmRole { role: r.into(), profile_id: profile.into() }).into()
}

fn part(role: &str) -> &'static str {
    match role.to_lowercase().as_str() {
        "coordinator" => {
            "You lead. Split the goal into small tasks and hand each one to the member who fits it best. \
             Do not do the work yourself; decide what happens next when members report back."
        }
        "scout" => {
            "You find things out: read the code, the docs and the web, and report facts with file paths. \
             You do not change files."
        }
        "builder" => "You write and change the code, run it and fix what breaks. Hand finished work to the Reviewer.",
        "reviewer" => {
            "You check the Builder's work: read the diff, run the tests, try it. Report concrete problems \
             to the Builder, or tell the Coordinator that it is good."
        }
        _ => "Your part is what your role name says.",
    }
}

/// The first prompt of a member.
pub fn brief(role: &str, goal: &str, team: &[String], lead: &str) -> String {
    let others: Vec<&str> = team.iter().map(String::as_str).filter(|r| *r != role).collect();
    let mut s = format!(
        "You are the {role} in a team of AI agents working together in this folder.\n\
         Goal: {goal}\n\
         Team: {role} (you), {}.\n\
         {}\n\n\
         Talk to the team only with the send_message tool of the {SERVER_ID} MCP server (to a role, \"all\", or \"you\" for the user). \
         Messages to you arrive in this terminal. Keep them short: what you did, where, what is open. \
         Only send a message that moves the work on (a task, a result, a question); never send acknowledgements, \
         thanks or status pings, and do not answer messages that need nothing from you.\n",
        others.join(", "),
        part(role),
    );
    if role == lead {
        s.push_str("Start now: send the first tasks. When the goal is reached, send one short summary to \"you\" and stop.");
    } else {
        s.push_str(&format!(
            "Do not send anything yet and do not start on your own: wait for a task from the {lead}. When a task is \
             done, report the result to the {lead} or hand it straight to the member who continues."
        ));
    }
    s
}

/// How a message reaches an agent's terminal.
fn as_prompt(msgs: &[SwarmMessage]) -> String {
    let mut s = String::new();
    for m in msgs {
        let to_all = if m.to == "all" { " (to everyone)" } else { "" };
        s.push_str(&format!("Message from {}{to_all}:\n{}\n\n", m.from, m.text.trim()));
    }
    s.push_str(
        "(If this hands you work, report the result with send_message when you are done. If it needs nothing from you, do not reply.)",
    );
    s
}

/// `to` as a canonical recipient: a member's role, "all" or `YOU`.
fn recipient(swarm: &Swarm, to: &str) -> Option<String> {
    let t = to.trim();
    if t.eq_ignore_ascii_case("all") || t.eq_ignore_ascii_case("everyone") || t.eq_ignore_ascii_case("team") {
        return Some("all".into());
    }
    if t.eq_ignore_ascii_case("you") || t.eq_ignore_ascii_case("user") {
        return Some(YOU.into());
    }
    let t = t.trim_start_matches("the ").trim_start_matches("The ");
    swarm.members.iter().find(|m| m.role.eq_ignore_ascii_case(t)).map(|m| m.role.clone())
}

fn valid_role(r: &str) -> bool {
    let r = r.trim();
    !r.is_empty()
        && r.chars().count() <= 24
        && r.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '-')
        && !["all", "you", "user", "everyone", "team"].contains(&r.to_lowercase().as_str())
}

/// Ready for the next prompt: finished its turn (not waiting on a permission prompt). Agents
/// with hooks must have reported once: before that a dialog may be up (Claude Code's folder trust
/// prompt, where Enter means "No, exit").
fn ready(st: &State, s: &Session) -> bool {
    let hooks = st
        .profiles
        .iter()
        .find(|p| p.id == s.profile_id)
        .and_then(|p| crate::catalog::agent(&p.engine))
        .is_some_and(|a| a.hooks != crate::catalog::Hooks::None);
    s.alive && matches!(s.status, AgentStatus::Done | AgentStatus::Idle) && (!hooks || s.status_source == StatusSource::Hooks)
}

/// The extra MCP server for a member (merged with the user's servers).
pub fn server(exe: &std::path::Path) -> McpServer {
    McpServer {
        id: SERVER_ID.into(),
        enabled: true,
        transport: McpTransport::Stdio { command: exe.to_string_lossy().into_owned(), args: vec!["swarm-mcp".into()] },
        secrets: BRIDGE_ENV.map(String::from).into(),
    }
}

/// Values for [`server`]'s "secrets": they are in the agent's environment anyway; listing them
/// makes every CLI pass them on to the bridge.
pub fn bridge_env(sid: &str, token: &str, port: u16) -> std::collections::BTreeMap<String, String> {
    [(BRIDGE_ENV[0], sid.to_string()), (BRIDGE_ENV[1], token.to_string()), (BRIDGE_ENV[2], port.to_string())]
        .map(|(k, v)| (k.to_string(), v))
        .into()
}

impl Core {
    pub fn swarm_of(&self, sid: &Id) -> Option<(Swarm, String)> {
        self.read(|s| {
            s.swarms
                .iter()
                .filter(|w| !w.ended)
                .find_map(|w| w.members.iter().find(|m| &m.session_id == sid).map(|m| (w.clone(), m.role.clone())))
        })
    }

    pub fn swarm_start(self: &Arc<Self>, workspace_id: Id, goal: String, members: Option<Vec<SwarmRole>>) -> Result<Swarm, ApiError> {
        let goal = goal.trim().to_string();
        if goal.is_empty() {
            return Err(err(ErrorCode::BadRequest, "the swarm needs a goal"));
        }
        let default_profile = self.read(|s| s.settings.default_profile.clone());
        let roles = members.filter(|m| !m.is_empty()).unwrap_or_else(|| default_team(&default_profile));
        if roles.len() > MAX_MEMBERS {
            return Err(err(ErrorCode::BadRequest, format!("a swarm has at most {MAX_MEMBERS} members")));
        }
        let mut names: Vec<String> = vec![];
        for r in &roles {
            let n = r.role.trim().to_string();
            if !valid_role(&n) {
                return Err(err(ErrorCode::BadRequest, format!("\"{n}\" cannot be a role name")));
            }
            if names.iter().any(|x| x.eq_ignore_ascii_case(&n)) {
                return Err(err(ErrorCode::BadRequest, format!("two members are called {n}")));
            }
            if self.read(|s| !s.profiles.iter().any(|p| p.id == r.profile_id)) {
                return Err(err(ErrorCode::NotFound, format!("no agent profile {}", r.profile_id)));
            }
            names.push(n);
        }
        // The lead gets the goal to plan; a team without a Coordinator is led by its first member.
        let lead = names.iter().find(|n| n.eq_ignore_ascii_case("coordinator")).unwrap_or(&names[0]).clone();
        let ws = self
            .read(|s| s.workspaces.iter().find(|w| w.id == workspace_id).cloned())
            .ok_or_else(|| err(ErrorCode::NotFound, "no such workspace"))?;

        let swarm = Swarm {
            id: crate::layout::new_id(),
            workspace_id: ws.id.clone(),
            goal: goal.clone(),
            members: names.iter().map(|n| SwarmMember { role: n.clone(), session_id: crate::layout::new_id() }).collect(),
            started_at: now_ms(),
            ended: false,
        };
        // Known before the agents start, so they get the swarm's MCP server.
        self.emit(Event::SwarmUpsert { swarm: swarm.clone() });
        // Their own tab, filled as a grid.
        let mut l = self.read(|s| s.layouts.get(&ws.id).cloned()).unwrap_or_else(crate::layout::default_layout);
        let short: String = goal.chars().take(24).collect();
        let (tab, panes) = crate::layout::grid_tab(&format!("Swarm: {short}"), roles.len());
        l.active_tab = tab.id.clone();
        l.tabs.push(tab);
        self.emit(Event::LayoutSet { workspace_id: ws.id.clone(), layout: l });

        for ((m, r), pane) in swarm.members.iter().zip(&roles).zip(panes) {
            let start = StartSession {
                workspace_id: ws.id.clone(),
                profile_id: r.profile_id.clone(),
                prompt: Some(brief(&m.role, &goal, &names, &lead)),
                pane_id: Some(pane),
                cols: None,
                rows: None,
                resume: None,
                cwd: None,
                worktree: None,
            };
            match self.session_start_as(start, Some(m.session_id.clone())) {
                Ok(s) => self.update_session(&s.id, |x| x.title = format!("{} · {}", m.role, x.title)),
                Err(e) => {
                    // Half a team is no team.
                    self.swarm_stop(&swarm.id);
                    return Err(e);
                }
            }
        }
        Ok(swarm)
    }

    /// Adds a message and delivers it right away to members that are idle.
    pub fn swarm_send(&self, swarm_id: &Id, from: &str, to: &str, text: &str) -> Result<SwarmMessage, ApiError> {
        let swarm =
            self.read(|s| s.swarms.iter().find(|w| &w.id == swarm_id).cloned()).ok_or_else(|| err(ErrorCode::NotFound, "no such swarm"))?;
        if swarm.ended {
            return Err(err(ErrorCode::BadRequest, "this swarm has ended"));
        }
        let text = text.trim();
        if text.is_empty() {
            return Err(err(ErrorCode::BadRequest, "the message is empty"));
        }
        let roles = swarm.members.iter().map(|m| m.role.as_str()).collect::<Vec<_>>().join(", ");
        let to = recipient(&swarm, to)
            .ok_or_else(|| err(ErrorCode::BadRequest, format!("no member \"{to}\"; the team is {roles}, or \"all\", or \"you\"")))?;
        if to == from {
            return Err(err(ErrorCode::BadRequest, "that is you"));
        }
        let msg = SwarmMessage {
            id: crate::layout::new_id(),
            swarm_id: swarm.id.clone(),
            from: from.into(),
            to: to.clone(),
            text: text.chars().take(8000).collect(),
            at: now_ms(),
            delivered: to == YOU,
        };
        let targets: Vec<&SwarmMember> = swarm.members.iter().filter(|m| m.role != from && (to == "all" || m.role == to)).collect();
        {
            let mut out = self.outbox.0.lock();
            for m in &targets {
                out.entry(m.session_id.clone()).or_default().push(msg.id.clone());
            }
        }
        self.emit(Event::SwarmMessage { message: msg.clone() });
        if to == YOU {
            // The team's report to the user: worth a notification.
            let sid = swarm.members.iter().find(|m| m.role == from).map(|m| m.session_id.clone());
            if let Some(sid) = sid {
                let line: String = text.lines().next().unwrap_or("").chars().take(160).collect();
                self.emit(Event::Attention { session_id: sid, kind: AttentionKind::Done, text: line });
            }
        }
        self.swarm_deliver();
        Ok(msg)
    }

    /// Types waiting messages into the terminals of members that finished their turn. Runs with
    /// every tick and after every message.
    pub fn swarm_deliver(&self) {
        let ready: Vec<(Id, Vec<Id>)> = {
            let out = self.outbox.0.lock();
            if out.is_empty() {
                return;
            }
            out.iter()
                .filter(|(sid, ids)| !ids.is_empty() && self.read(|s| s.sessions.get(*sid).is_some_and(|x| ready(s, x))))
                .map(|(sid, ids)| (sid.clone(), ids.clone()))
                .collect()
        };
        for (sid, ids) in ready {
            let msgs: Vec<SwarmMessage> = self.read(|s| s.swarm_messages.iter().filter(|m| ids.contains(&m.id)).cloned().collect());
            if !msgs.is_empty() && self.send_prompt(&sid, &as_prompt(&msgs)).is_err() {
                continue;
            }
            // Status follows with the agent's own hook; until then it is not idle for us.
            self.transition(&sid, AgentStatus::Working, None, |_| {});
            if let Some(v) = self.outbox.0.lock().get_mut(&sid) {
                v.retain(|i| !ids.contains(i));
            }
            self.swarm_mark_delivered(&ids);
        }
        // Members that are gone never read their messages.
        let gone: Vec<Id> = {
            let out = self.outbox.0.lock();
            out.keys().filter(|sid| self.read(|s| !s.sessions.get(*sid).is_some_and(|x| x.alive))).cloned().collect()
        };
        if !gone.is_empty() {
            let mut out = self.outbox.0.lock();
            for g in gone {
                out.remove(&g);
            }
        }
    }

    /// Marks messages delivered once no member is waiting for them any more.
    fn swarm_mark_delivered(&self, ids: &[Id]) {
        let pending: Vec<Id> = self.outbox.0.lock().values().flatten().cloned().collect();
        let done: Vec<SwarmMessage> = self.read(|s| {
            s.swarm_messages.iter().filter(|m| ids.contains(&m.id) && !m.delivered && !pending.contains(&m.id)).cloned().collect()
        });
        for mut m in done {
            m.delivered = true;
            self.emit(Event::SwarmMessage { message: m });
        }
    }

    /// Ends a swarm when all its members have exited.
    pub fn swarm_tick(&self) {
        self.swarm_deliver();
        let over: Vec<Swarm> = self.read(|s| {
            s.swarms
                .iter()
                .filter(|w| !w.ended && w.members.iter().all(|m| !s.sessions.get(&m.session_id).is_some_and(|x| x.alive)))
                .cloned()
                .collect()
        });
        for mut w in over {
            w.ended = true;
            self.emit(Event::SwarmUpsert { swarm: w });
        }
    }

    pub fn swarm_stop(&self, swarm_id: &Id) {
        let Some(mut w) = self.read(|s| s.swarms.iter().find(|w| &w.id == swarm_id).cloned()) else { return };
        for m in &w.members {
            self.outbox.0.lock().remove(&m.session_id);
            self.session_kill(&m.session_id);
        }
        w.ended = true;
        self.emit(Event::SwarmUpsert { swarm: w });
    }

    pub fn swarm_remove(&self, swarm_id: &Id) {
        self.swarm_stop(swarm_id);
        self.emit(Event::SwarmRemoved { id: swarm_id.clone() });
    }

    /// A tool call of a member (through the bridge).
    fn swarm_tool(&self, sid: &Id, tool: &str, args: &Value) -> Result<Value, String> {
        let (swarm, me) = self.swarm_of(sid).ok_or("this agent is not part of a running swarm")?;
        match tool {
            "send_message" => {
                let to = args["to"].as_str().unwrap_or("");
                let text = args["text"].as_str().or(args["message"].as_str()).unwrap_or("");
                let m = self.swarm_send(&swarm.id, &me, to, text).map_err(|e| e.message)?;
                let note = if m.to == YOU {
                    "The user will see it.".to_string()
                } else if m.delivered {
                    "Delivered.".into()
                } else {
                    "Sent; it reaches them when they finish their current turn.".into()
                };
                Ok(json!(format!("Message to {} sent. {note} Their answer will arrive in this terminal; you may end your turn.", m.to)))
            }
            "team" => {
                let members: Vec<Value> = self.read(|s| {
                    swarm
                        .members
                        .iter()
                        .map(|m| {
                            let x = s.sessions.get(&m.session_id);
                            let status = x.map(|x| if x.alive { format!("{:?}", x.status).to_lowercase() } else { "stopped".into() });
                            json!({ "role": m.role, "you": m.role == me, "status": status, "agent": x.map(|x| x.profile_id.clone()) })
                        })
                        .collect()
                });
                Ok(json!({ "goal": swarm.goal, "you": me, "members": members }))
            }
            "messages" => {
                let list: Vec<Value> = self.read(|s| {
                    let mine: Vec<&SwarmMessage> = s
                        .swarm_messages
                        .iter()
                        .filter(|m| m.swarm_id == swarm.id && (m.from == me || m.to == me || m.to == "all"))
                        .collect();
                    mine.iter().rev().take(20).rev().map(|m| json!({ "from": m.from, "to": m.to, "text": m.text })).collect()
                });
                Ok(json!(list))
            }
            _ => Err(format!("unknown tool {tool}")),
        }
    }
}

/// Keeps the last [`KEEP`] messages of each swarm.
pub fn trim(msgs: &mut Vec<SwarmMessage>, swarm_id: &Id) {
    let n = msgs.iter().filter(|m| &m.swarm_id == swarm_id).count();
    if n > KEEP {
        let mut drop = n - KEEP;
        msgs.retain(|m| {
            if drop > 0 && &m.swarm_id == swarm_id {
                drop -= 1;
                false
            } else {
                true
            }
        });
    }
}

// ───────────── the daemon side of the bridge ─────────────

/// `POST /swarm`: `{tool, args}` from `neuralagentd swarm-mcp` → `{text}` or `{error}`.
pub async fn receive(
    AxState(app): AxState<crate::server::App>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> (StatusCode, axum::Json<Value>) {
    let h = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (sid, token) = (h("x-neuralagent-session"), h("x-neuralagent-token"));
    if !app.core.hook_token_ok(&sid, &token) {
        return (StatusCode::UNAUTHORIZED, axum::Json(json!({ "error": "not allowed" })));
    }
    let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let tool = v["tool"].as_str().unwrap_or("");
    match app.core.swarm_tool(&sid, tool, &v["args"]) {
        Ok(Value::String(t)) => (StatusCode::OK, axum::Json(json!({ "text": t }))),
        Ok(other) => (StatusCode::OK, axum::Json(json!({ "text": other.to_string() }))),
        Err(e) => (StatusCode::OK, axum::Json(json!({ "error": e }))),
    }
}

// ───────────── the agent side: a tiny MCP server on stdio ─────────────

fn tools() -> Value {
    json!([
        {
            "name": "send_message",
            "description": "Send a message to another member of your team (by role), to \"all\", or to \"you\" (the user). Use it to hand off a task, report a result or ask a question. The answer arrives in your terminal later; end your turn after sending.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "to": { "type": "string", "description": "A role from the team, \"all\" or \"you\"." },
                    "text": { "type": "string", "description": "The message. Short and concrete: what, where, what is open." }
                },
                "required": ["to", "text"]
            },
            "annotations": { "title": "Message the team", "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false }
        },
        {
            "name": "team",
            "description": "The goal, your role and every member of the team with its status (working, done, waiting, stopped).",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "title": "Team", "readOnlyHint": true, "openWorldHint": false }
        },
        {
            "name": "messages",
            "description": "The last 20 messages sent to you, to everyone, or by you.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "title": "Recent messages", "readOnlyHint": true, "openWorldHint": false }
        }
    ])
}

/// `neuralagentd swarm-mcp`: JSON-RPC lines on stdin/stdout (MCP stdio transport).
pub fn bridge_main() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = req.get("id").cloned() else { continue }; // notifications need no answer
        let result = match req["method"].as_str().unwrap_or("") {
            "initialize" => {
                let asked = req["params"]["protocolVersion"].as_str().unwrap_or("");
                let version = if ["2024-11-05", "2025-03-26", "2025-06-18"].contains(&asked) { asked } else { "2025-06-18" };
                Ok(json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": SERVER_ID, "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Your team. Hand off work and report with send_message; messages to you arrive in your terminal."
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => {
                let name = req["params"]["name"].as_str().unwrap_or("");
                let args = req["params"].get("arguments").cloned().unwrap_or(json!({}));
                let (text, is_error) = match call(name, &args) {
                    Ok(v) => match (v["text"].as_str(), v["error"].as_str()) {
                        (Some(t), _) => (t.to_string(), false),
                        (_, Some(e)) => (e.to_string(), true),
                        _ => ("no answer".to_string(), true),
                    },
                    Err(e) => (format!("NeuralAgent is not reachable: {e}"), true),
                };
                Ok(json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
            }
            m => Err(json!({ "code": -32601, "message": format!("unknown method {m}") })),
        };
        let msg = match result {
            Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
            Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
        };
        if writeln!(out, "{msg}").and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}

fn call(tool: &str, args: &Value) -> std::io::Result<Value> {
    let var = |k: &str| std::env::var(k).map_err(|_| std::io::Error::other(format!("{k} is not set; start this agent from NeuralAgent")));
    let (sid, token, port) = (var(BRIDGE_ENV[0])?, var(BRIDGE_ENV[1])?, var(BRIDGE_ENV[2])?);
    let body = json!({ "tool": tool, "args": args }).to_string();
    let addr = format!("127.0.0.1:{port}").parse().map_err(std::io::Error::other)?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
    s.set_read_timeout(Some(Duration::from_secs(20)))?;
    let head = format!(
        "POST /swarm HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nX-NeuralAgent-Session: {sid}\r\nX-NeuralAgent-Token: {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(head.as_bytes())?;
    s.write_all(body.as_bytes())?;
    let mut res = Vec::new();
    s.take(1 << 20).read_to_end(&mut res)?;
    let res = String::from_utf8_lossy(&res);
    let (head, body) = res.split_once("\r\n\r\n").ok_or_else(|| std::io::Error::other("bad answer"))?;
    if head.starts_with("HTTP/1.1 401") {
        return Err(std::io::Error::other("this agent's session is no longer known"));
    }
    serde_json::from_str(body).map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn swarm() -> Swarm {
        Swarm {
            id: "w".into(),
            workspace_id: "ws".into(),
            goal: "g".into(),
            members: ["Coordinator", "Scout", "Builder", "Reviewer"]
                .iter()
                .enumerate()
                .map(|(i, r)| SwarmMember { role: r.to_string(), session_id: format!("s{i}") })
                .collect(),
            started_at: 0,
            ended: false,
        }
    }

    #[test]
    fn recipients_are_forgiving() {
        let w = swarm();
        assert_eq!(recipient(&w, "builder").as_deref(), Some("Builder"));
        assert_eq!(recipient(&w, "the Reviewer").as_deref(), Some("Reviewer"));
        assert_eq!(recipient(&w, "ALL").as_deref(), Some("all"));
        assert_eq!(recipient(&w, "user").as_deref(), Some(YOU));
        assert_eq!(recipient(&w, "Tester"), None);
    }

    #[test]
    fn roles_must_be_names() {
        assert!(valid_role("Frontend Builder"));
        assert!(!valid_role("all"));
        assert!(!valid_role("a\"b"));
        assert!(!valid_role(""));
    }

    #[test]
    fn only_the_lead_starts() {
        let team: Vec<String> = ["Coordinator", "Scout"].map(String::from).into();
        let lead = brief("Coordinator", "Make a game", &team, "Coordinator");
        assert!(lead.contains("Goal: Make a game") && lead.contains("Start now") && lead.contains("Scout"));
        let scout = brief("Scout", "Make a game", &team, "Coordinator");
        assert!(scout.contains("wait for a task from the Coordinator") && scout.contains("Team: Scout (you), Coordinator."));
    }

    #[test]
    fn trims_per_swarm() {
        let m = |s: &str, i: usize| SwarmMessage {
            id: format!("{s}{i}"),
            swarm_id: s.into(),
            from: "A".into(),
            to: "B".into(),
            text: String::new(),
            at: 0,
            delivered: true,
        };
        let mut v: Vec<SwarmMessage> = (0..KEEP + 5).map(|i| m("a", i)).chain((0..3).map(|i| m("b", i))).collect();
        trim(&mut v, &"a".into());
        assert_eq!(v.iter().filter(|x| x.swarm_id == "a").count(), KEEP);
        assert_eq!(v.first().unwrap().id, "a5");
        assert_eq!(v.iter().filter(|x| x.swarm_id == "b").count(), 3);
    }
}
