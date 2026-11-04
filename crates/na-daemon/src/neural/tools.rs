//! Neural's tools: what the model can do, and the guarded code that does it. Requests go
//! through the normal client path as `ClientKind::Orchestrator` (policy + audit log).

use std::sync::Arc;

use na_protocol::{CvAction, CvAnswer, CvBlock, CvRole, Id, NeuralPending, NeuralTaskStatus, Request, StartSession};
use serde_json::{Value, json};

use super::observe::clip;
use super::world::short;
use super::{guard, tasks};
use crate::core::{Core, now_ms};
use crate::llm::{Call, Tool};
use crate::orch::me;

/// What a tool call produced: for the model, for the chat, success, the agent it was about.
pub struct Outcome {
    pub content: String,
    pub label: Option<String>,
    pub ok: bool,
    pub sid: Option<Id>,
}

fn out(v: Value, label: Option<String>, ok: bool, sid: Option<Id>) -> Outcome {
    Outcome { content: v.to_string(), label, ok, sid }
}

fn fail(msg: &str) -> Outcome {
    out(json!({ "ok": false, "error": msg }), None, false, None)
}

pub fn list() -> Vec<Tool> {
    let p = |v: Value| v;
    vec![
        Tool {
            name: "find_folder",
            description: "Find workspaces and project folders on this computer whose name matches what the user said.",
            params: p(json!({ "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] })),
        },
        Tool {
            name: "start_agent",
            description: "Start a coding agent in a workspace (name) or folder path, with a prompt. It opens as a new pane on the computer and is linked to a task (a new one from the prompt unless you name one).",
            params: p(json!({ "type": "object", "properties": {
                "folder": { "type": "string", "description": "Workspace name, or folder path from find_folder" },
                "prompt": { "type": "string", "description": "The work, written as a good prompt: goal, context, what done means" },
                "agent": { "type": "string", "description": "Agent type id (claude, codex, …); omit for the default" },
                "task": { "type": "string", "description": "Task id to link (t1); omit to create one" },
                "worktree": { "type": "boolean", "description": "Work in its own git worktree (only when asked or for parallel work)" }
            }, "required": ["folder", "prompt"] })),
        },
        Tool {
            name: "send_to_agent",
            description: "Send a prompt, feedback or an answer in words to a running agent (it arrives as its next message).",
            params: p(
                json!({ "type": "object", "properties": { "agent": { "type": "string", "description": "Short id" }, "text": { "type": "string" } }, "required": ["agent", "text"] }),
            ),
        },
        Tool {
            name: "answer_agent",
            description: "Answer the open prompt of a waiting agent (permission, question, plan approval, menu): `choice` is the option number or label; `text` is free text where the prompt allows it. Use it only when the answer is clear from the user's goal and safe; otherwise ask the user.",
            params: p(json!({ "type": "object", "properties": {
                "agent": { "type": "string" }, "choice": { "type": "string" }, "text": { "type": "string" }
            }, "required": ["agent"] })),
        },
        Tool {
            name: "inspect_agent",
            description: "What an agent did and said: its last answers, the tools it used, errors, its open prompt (or its screen for agents without a transcript). Use it to review work.",
            params: p(json!({ "type": "object", "properties": { "agent": { "type": "string" } }, "required": ["agent"] })),
        },
        Tool {
            name: "agent_changes",
            description: "The files an agent changed (git, in its worktree or workspace) and the start of the diff.",
            params: p(
                json!({ "type": "object", "properties": { "agent": { "type": "string" }, "path": { "type": "string", "description": "Only this file's diff" } }, "required": ["agent"] }),
            ),
        },
        Tool {
            name: "run_check",
            description: "Run a check command (tests, type check, lint, build, git status) in an agent's folder or a workspace, and get the exit status and the last lines. Other commands need the user's OK.",
            params: p(json!({ "type": "object", "properties": {
                "command": { "type": "string" }, "agent": { "type": "string" }, "folder": { "type": "string" }, "task": { "type": "string" }
            }, "required": ["command"] })),
        },
        Tool {
            name: "stop_agent",
            description: "Stop (interrupt) a running agent.",
            params: p(json!({ "type": "object", "properties": { "agent": { "type": "string" } }, "required": ["agent"] })),
        },
        Tool {
            name: "track_task",
            description: "Write down a goal the user gave you, to follow up until it is done (start_agent also creates one).",
            params: p(json!({ "type": "object", "properties": {
                "title": { "type": "string" }, "done_when": { "type": "string" }, "folder": { "type": "string" }, "check": { "type": "string", "description": "Command that proves it works" }
            }, "required": ["title"] })),
        },
        Tool {
            name: "update_task",
            description: "Change a task: status (open, working, review, blocked, done, failed), a short note on where it stands, its check command.",
            params: p(json!({ "type": "object", "properties": {
                "task": { "type": "string" }, "status": { "type": "string" }, "note": { "type": "string" }, "check": { "type": "string" }, "done_when": { "type": "string" }
            }, "required": ["task"] })),
        },
        Tool {
            name: "remember",
            description: "Remember something about the user for later sessions (a preference, how a project works). Only what they told you or asked you to remember.",
            params: p(json!({ "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] })),
        },
        Tool {
            name: "forget",
            description: "Forget a note (its id, n1).",
            params: p(json!({ "type": "object", "properties": { "note": { "type": "string" } }, "required": ["note"] })),
        },
    ]
}

impl Core {
    /// Runs one tool. `confirmed`: the user allowed this exact call (skip the guard).
    pub async fn neural_tool(self: &Arc<Self>, call: &Call, confirmed: bool) -> Outcome {
        let a = &call.args;
        let s = |k: &str| a[k].as_str().map(str::trim).filter(|v| !v.is_empty()).map(str::to_string);
        let agent = || s("agent").and_then(|x| self.resolve_session(&x));
        match call.name.as_str() {
            "find_folder" => out(json!({ "matches": self.find_folders(&s("query").unwrap_or_default()) }), None, true, None),
            "start_agent" => {
                let Some(folder) = s("folder") else { return fail("folder is missing") };
                let prompt = s("prompt");
                if !confirmed && let Some(why) = prompt.as_deref().and_then(guard::destructive) {
                    return self.ask_user(
                        call,
                        format!("Start an agent in {folder} with a prompt that {why}"),
                        prompt.unwrap_or_default(),
                        None,
                    );
                }
                self.tool_start(&folder, s("agent"), prompt, s("task"), a["worktree"].as_bool()).await
            }
            "send_to_agent" => {
                let Some(text) = s("text") else { return fail("text is missing") };
                let Some((sid, name)) = agent() else { return fail("no running agent matches that id; check <world>") };
                if !confirmed && let Some(why) = guard::destructive(&text) {
                    return self.ask_user(call, format!("Tell {name} something that {why}"), text, Some(sid));
                }
                match self.handle(&me(), Request::SessionPrompt { id: sid.clone(), text }).await {
                    Ok(_) => {
                        self.neural_update(|n| {
                            if let Some(t) = tasks::of_agent(n, &sid).map(|t| t.id.clone()) {
                                tasks::link(n, &t, &sid, now_ms());
                            }
                        });
                        out(json!({ "ok": true }), Some(format!("Prompted {name}")), true, Some(sid))
                    }
                    Err(e) => out(
                        json!({ "ok": false, "error": e.message }),
                        Some(format!("Could not prompt {name}: {}", e.message)),
                        false,
                        Some(sid),
                    ),
                }
            }
            "answer_agent" => {
                let Some((sid, name)) = agent() else { return fail("no running agent matches that id; check <world>") };
                self.tool_answer(call, &sid, &name, s("choice"), s("text"), confirmed).await
            }
            "inspect_agent" => match agent() {
                Some((sid, _)) => out(self.agent_report(&sid), None, true, Some(sid)),
                None => fail("no running agent matches that id; check <world>"),
            },
            "agent_changes" => match agent() {
                Some((sid, _)) => out(self.agent_changes(&sid, s("path")).await, None, true, Some(sid)),
                None => fail("no running agent matches that id; check <world>"),
            },
            "run_check" => {
                let Some(cmd) = s("command") else { return fail("command is missing") };
                let dir = match (agent(), s("folder")) {
                    (Some((sid, _)), _) => self.agent_dir(&sid),
                    (None, Some(f)) => self
                        .resolve_workspace(&f)
                        .await
                        .ok()
                        .and_then(|(id, _)| self.read(|st| st.workspaces.iter().find(|w| w.id == id).map(|w| w.path.clone()))),
                    _ => None,
                };
                let Some(dir) = dir else { return fail("say which agent or folder to run it in") };
                if !confirmed && !guard::safe_command(&cmd) {
                    return self.ask_user(call, format!("Run a command in {}", super::super::orch::last_part(&dir)), cmd, None);
                }
                let (ok, tail) = self.run_check(&dir, &cmd).await;
                if let Some(t) = s("task") {
                    self.neural_update(|n| {
                        if let Some(t) = tasks::get_mut(n, &t) {
                            t.note = format!("`{cmd}` {}", if ok { "passes" } else { "fails" });
                            t.updated_at = now_ms();
                        }
                    });
                }
                let label = format!("Ran `{}`: {}", clip(&cmd, 60), if ok { "passed" } else { "failed" });
                out(json!({ "ok": ok, "output": tail }), Some(label), ok, None)
            }
            "stop_agent" => {
                let Some((sid, name)) = agent() else { return fail("no running agent matches that id; check <world>") };
                match self.handle(&me(), Request::SessionStop { id: sid.clone() }).await {
                    Ok(_) => out(json!({ "ok": true }), Some(format!("Stopped {name}")), true, Some(sid)),
                    Err(e) => out(
                        json!({ "ok": false, "error": e.message }),
                        Some(format!("Could not stop {name}: {}", e.message)),
                        false,
                        Some(sid),
                    ),
                }
            }
            "track_task" => {
                let Some(title) = s("title") else { return fail("title is missing") };
                let ws = match s("folder") {
                    Some(f) => self.resolve_workspace(&f).await.ok().map(|w| w.0),
                    None => None,
                };
                let id = self.neural_update(|n| tasks::create(n, &title, &s("done_when").unwrap_or_default(), ws, s("check"), now_ms()));
                out(json!({ "ok": true, "task": id }), Some(format!("Noted the task “{}”", clip(&title, 60))), true, None)
            }
            "update_task" => {
                let Some(id) = s("task") else { return fail("task is missing") };
                let status = s("status").and_then(|x| serde_json::from_value::<NeuralTaskStatus>(json!(x)).ok());
                let found = self.neural_update(|n| {
                    let t = tasks::get_mut(n, &id)?;
                    if let Some(st) = status {
                        t.status = st;
                    }
                    if let Some(x) = s("note") {
                        t.note = clip(&x, 200);
                    }
                    if let Some(x) = s("check") {
                        t.check = Some(x);
                    }
                    if let Some(x) = s("done_when") {
                        t.done_when = clip(&x, 300);
                    }
                    t.updated_at = now_ms();
                    Some((t.title.clone(), t.status))
                });
                match found {
                    Some((title, st)) if st.finished() && status.is_some() => {
                        let word = if st == NeuralTaskStatus::Done { "Done" } else { "Gave up on" };
                        out(json!({ "ok": true }), Some(format!("{word}: “{}”", clip(&title, 60))), true, None)
                    }
                    Some(_) => out(json!({ "ok": true }), None, true, None),
                    None => fail("no such task"),
                }
            }
            "remember" => {
                let Some(text) = s("text") else { return fail("text is missing") };
                let id = self.neural_note_add(&text);
                out(json!({ "ok": true, "note": id }), Some(format!("Remembered: {}", clip(&text, 80))), true, None)
            }
            "forget" => {
                let Some(id) = s("note") else { return fail("note is missing") };
                let gone = self.neural_update(|n| {
                    let before = n.notes.len();
                    n.notes.retain(|x| x.id != id);
                    before != n.notes.len()
                });
                if gone { out(json!({ "ok": true }), Some("Forgot a note".into()), true, None) } else { fail("no such note") }
            }
            other => fail(&format!("unknown tool {other}")),
        }
    }

    /// The guard said no: keep the call for the user to allow.
    fn ask_user(&self, call: &Call, title: String, detail: String, sid: Option<Id>) -> Outcome {
        let id = self.neural_id("p");
        let pending = NeuralPending {
            id: id.clone(),
            at: now_ms(),
            title: title.clone(),
            detail,
            action: json!({ "name": call.name, "args": call.args }),
            session_id: sid.clone(),
        };
        self.neural_update(|n| {
            n.pending.push(pending);
            if n.pending.len() > 10 {
                n.pending.remove(0);
            }
        });
        if let Some(sid) = &sid {
            self.neural_attention(sid, na_protocol::AttentionKind::Waiting, &title);
        }
        out(
            json!({ "ok": false, "needs_confirmation": true, "note": "Not done yet: the user sees Allow / Deny for it. Tell them in one sentence what you want to do and why." }),
            Some(format!("Asked you: {title}")),
            // Asking is not a failure: the action line reads neutral, the card below holds the choice.
            true,
            sid,
        )
    }

    async fn tool_start(
        self: &Arc<Self>,
        folder: &str,
        agent: Option<String>,
        prompt: Option<String>,
        task: Option<String>,
        worktree: Option<bool>,
    ) -> Outcome {
        let ws = match self.resolve_workspace(folder).await {
            Ok(w) => w,
            Err(e) => return fail(&e.message),
        };
        let profile =
            match agent.map(|p| self.resolve_profile(&p)).unwrap_or_else(|| Ok(self.read(|st| st.settings.default_profile.clone()))) {
                Ok(p) => p,
                Err(e) => return fail(&e.message),
            };
        let sid = match self.start_agent_raw(&ws.0, &profile, prompt.clone(), worktree).await {
            Ok(sid) => sid,
            Err(e) => {
                return out(
                    json!({ "ok": false, "error": e.message }),
                    Some(format!("Could not start an agent in {}: {}", ws.1, e.message)),
                    false,
                    None,
                );
            }
        };
        let title = prompt.as_deref().map(first_line).unwrap_or_else(|| format!("Work in {}", ws.1));
        let task = self.neural_update(|n| {
            let id = match task.filter(|t| tasks::get_mut(n, t).is_some()) {
                Some(t) => t,
                None => tasks::create(n, &title, "", Some(ws.0.clone()), None, now_ms()),
            };
            tasks::link(n, &id, &sid, now_ms());
            id
        });
        let pname = self.read(|st| st.profiles.iter().find(|p| p.id == profile).map(|p| p.name.clone())).unwrap_or(profile);
        out(json!({ "ok": true, "agent": short(&sid), "task": task }), Some(format!("Started {pname} in {}", ws.1)), true, Some(sid))
    }

    /// Starts an agent as Neural and returns its session id.
    pub(crate) async fn start_agent_raw(
        self: &Arc<Self>,
        ws: &str,
        profile: &str,
        prompt: Option<String>,
        worktree: Option<bool>,
    ) -> Result<Id, na_protocol::ApiError> {
        let start = StartSession {
            workspace_id: ws.to_string(),
            profile_id: profile.to_string(),
            prompt,
            pane_id: None,
            cols: None,
            rows: None,
            resume: None,
            cwd: None,
            worktree,
        };
        let v = self.handle(&me(), Request::SessionStart(start)).await?;
        Ok(v["id"].as_str().unwrap_or("").to_string())
    }

    async fn tool_answer(
        self: &Arc<Self>,
        call: &Call,
        sid: &Id,
        name: &str,
        choice: Option<String>,
        text: Option<String>,
        confirmed: bool,
    ) -> Outcome {
        let Some(p) = self.cv_current_prompt(sid) else {
            return fail("that agent shows no prompt Neural can read; use send_to_agent or ask the user");
        };
        // Allowed by the user: only for the very prompt they saw (it may have been replaced since).
        if confirmed && call.args.get("_seen").is_some() && call.args["_seen"] != prompt_key(&p) {
            return fail("the agent's prompt changed since the user allowed it; look at it again");
        }
        let ask = |title: String, detail: String| {
            let mut c = call.clone();
            if c.args.is_object() {
                c.args["_seen"] = prompt_key(&p);
            }
            self.ask_user(&c, title, detail, Some(sid.clone()))
        };
        // Free text and the chosen label go to the agent as instructions too.
        if !confirmed && let Some(why) = [choice.as_deref(), text.as_deref()].into_iter().flatten().find_map(guard::destructive) {
            return ask(
                format!("Tell {name} something that {why}"),
                [choice.clone(), text.clone()].into_iter().flatten().collect::<Vec<_>>().join(" — "),
            );
        }
        let action = if p.kind.as_deref() == Some("question") {
            let qs = p.question.as_ref().map(|q| q.questions.clone()).unwrap_or_default();
            let answers = qs
                .iter()
                .enumerate()
                .map(|(i, q)| {
                    let want = if i == 0 { choice.clone().or(text.clone()) } else { text.clone() };
                    let want = want.unwrap_or_default();
                    match q.options.iter().find(|o| {
                        o.label.eq_ignore_ascii_case(&want) || o.label.to_lowercase().starts_with(&want.to_lowercase()) && !want.is_empty()
                    }) {
                        Some(o) => CvAnswer { labels: vec![o.label.clone()], other: None },
                        None => CvAnswer { labels: vec![], other: Some(want) },
                    }
                })
                .collect();
            CvAction::AnswerQuestion { answers, prompt_id: p.id.clone() }
        } else {
            let want = choice.clone().unwrap_or_else(|| "1".into());
            let opt = p
                .options
                .iter()
                .find(|o| o.n == want)
                .or_else(|| p.options.iter().find(|o| o.label.to_lowercase().starts_with(&want.to_lowercase())));
            let Some(opt) = opt else {
                return fail(&format!(
                    "no option \"{want}\"; the prompt offers: {}",
                    p.options.iter().map(|o| format!("{}. {}", o.n, o.label)).collect::<Vec<_>>().join(", ")
                ));
            };
            // Saying yes to something destructive, or "yes, don't ask again" to anything that is not
            // a safe check, needs the user.
            let label = opt.label.to_lowercase();
            let yes = label.starts_with("yes") || label.starts_with("allow") || label.starts_with("approve");
            let lasting =
                ["don't ask", "dont ask", "do not ask", "always", "all edits", "auto-accept", "bypass"].iter().any(|w| label.contains(w));
            let safe = p.tool.as_ref().is_some_and(|t| guard::safe_permission(&t.name, &t.input));
            let command = p.tool.as_ref().and_then(|t| t.input["command"].as_str()).unwrap_or("").to_string();
            let risky =
                !safe && (guard::destructive_command(&command).is_some() || p.plan.as_deref().and_then(guard::destructive).is_some());
            if yes && (risky || lasting && !safe) && !confirmed {
                let what =
                    if lasting { format!("Let {name} go on without asking ({})", opt.label) } else { format!("Let {name} run a command") };
                let detail = if command.is_empty() { super::observe::describe_prompt(&p) } else { command };
                return ask(what, detail);
            }
            CvAction::Answer { n: opt.n.clone(), nav: None, text: text.clone(), prompt_id: p.id.clone() }
        };
        match self.handle(&me(), Request::CvAction { sid: sid.clone(), action }).await {
            Ok(_) => out(json!({ "ok": true }), Some(format!("Answered {name}")), true, Some(sid.clone())),
            Err(e) => out(
                json!({ "ok": false, "error": e.message }),
                Some(format!("Could not answer {name}: {}", e.message)),
                false,
                Some(sid.clone()),
            ),
        }
    }

    /// Folder an agent works in (its worktree if it has one).
    pub(crate) fn agent_dir(&self, sid: &str) -> Option<String> {
        self.read(|st| st.sessions.get(sid).map(|s| s.worktree.as_ref().map(|w| w.path.clone()).unwrap_or_else(|| s.cwd.clone())))
    }

    /// The agent's final answer: from its transcript when there is one, else its last message.
    pub(crate) fn agent_final_text(&self, sid: &Id) -> String {
        if let Ok(h) = self.cv_history(sid, u64::MAX, None)
            && let Some(t) = h.messages.iter().rev().filter(|m| m.role == CvRole::Assistant).find_map(|m| {
                let t: Vec<&str> =
                    m.blocks.iter().filter_map(|b| if let CvBlock::Text { text } = b { Some(text.as_str()) } else { None }).collect();
                (!t.is_empty()).then(|| t.join("\n"))
            })
        {
            return t;
        }
        self.read(|st| st.sessions.get(sid).and_then(|s| s.last_message.clone())).unwrap_or_default()
    }

    /// What the agent did and said, compact (inspect_agent).
    pub(crate) fn agent_report(&self, sid: &Id) -> Value {
        let (status, prompt_first) =
            self.read(|st| st.sessions.get(sid).map(|s| (format!("{:?}", s.status).to_lowercase(), s.prompt.clone()))).unwrap_or_default();
        let open = self.cv_current_prompt(sid).map(|p| {
            json!({ "asks": super::observe::describe_prompt(&p), "options": p.options.iter().map(|o| format!("{}. {}", o.n, o.label)).collect::<Vec<_>>() })
        });
        if let Ok(h) = self.cv_history(sid, u64::MAX, None) {
            let mut said = vec![];
            let mut tools = vec![];
            let mut errors = vec![];
            let mut last_user = None;
            for m in h.messages.iter().rev() {
                for b in m.blocks.iter().rev() {
                    match b {
                        CvBlock::Text { text } if m.role == CvRole::Assistant && said.len() < 3 => said.push(clip(text, 900)),
                        CvBlock::Text { text } if m.role == CvRole::User && last_user.is_none() && m.kind.is_none() => {
                            last_user = Some(clip(text, 400))
                        }
                        CvBlock::ToolUse { name, input, .. } if tools.len() < 12 => {
                            let what = input["command"]
                                .as_str()
                                .or_else(|| input["file_path"].as_str())
                                .or_else(|| input["pattern"].as_str())
                                .unwrap_or("");
                            tools.push(format!("{name} {}", clip(what, 100)));
                        }
                        CvBlock::ToolResult { text, is_error: true, .. } if errors.len() < 3 => errors.push(clip(text, 300)),
                        _ => {}
                    }
                }
            }
            said.reverse();
            tools.reverse();
            return json!({ "status": status, "first_prompt": prompt_first, "last_user_message": last_user, "said": said, "tools_used": tools, "tool_errors": errors, "open_prompt": open });
        }
        let screen = self.pty(sid).map(|p| p.screen_text()).unwrap_or_default();
        let last = self.read(|st| st.sessions.get(sid).and_then(|x| x.last_message.clone()));
        json!({ "status": status, "first_prompt": prompt_first, "screen": tail(&screen, 3000), "last_message": last, "open_prompt": open })
    }

    pub(crate) async fn agent_changes(&self, sid: &Id, path: Option<String>) -> Value {
        let Some((dir, base)) = self.read(|st| {
            st.sessions.get(sid).map(|s| match &s.worktree {
                Some(w) => (w.path.clone(), Some(w.base.clone())),
                None => {
                    (st.workspaces.iter().find(|w| w.id == s.workspace_id).map(|w| w.path.clone()).unwrap_or_else(|| s.cwd.clone()), None)
                }
            })
        }) else {
            return json!({ "ok": false, "error": "no such agent" });
        };
        if !self.folder_ok(std::path::Path::new(&dir)) {
            return json!({ "ok": false, "error": crate::permissions::NEEDS_FDA });
        }
        let r = tokio::task::spawn_blocking(move || {
            let c = crate::git::changes(std::path::Path::new(&dir), base.as_deref())?;
            let d = crate::git::diff(std::path::Path::new(&dir), base.as_deref(), path.as_deref())?;
            anyhow::Ok((c, d))
        })
        .await;
        match r {
            Ok(Ok((c, d))) => json!({
                "branch": c.branch,
                "files": c.files.iter().take(40).map(|f| format!("{:?} {} +{}/-{}", f.status, f.path, f.additions, f.deletions).to_lowercase()).collect::<Vec<_>>(),
                "diff": clip(&d.text, 5000),
            }),
            Ok(Err(e)) => json!({ "ok": false, "error": format!("{e:#}") }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }

    /// Runs a check command in `dir` (login environment, 5 minutes at most). Exit 0 and the tail.
    pub(crate) async fn run_check(&self, dir: &str, cmd: &str) -> (bool, String) {
        if !self.folder_ok(std::path::Path::new(dir)) {
            return (false, crate::permissions::NEEDS_FDA.to_string());
        }
        let mut c = tokio::process::Command::new("/bin/sh");
        c.arg("-c").arg(cmd).current_dir(dir).env_clear().envs(self.env.vars.iter()).kill_on_drop(true);
        c.stdin(std::process::Stdio::null());
        let r = tokio::time::timeout(std::time::Duration::from_secs(300), c.output()).await;
        let (ok, text) = match r {
            Ok(Ok(o)) => (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))),
            Ok(Err(e)) => (false, format!("could not run: {e}")),
            Err(_) => (false, "timed out after 5 minutes".into()),
        };
        self.audit.note("neural_check", Some(format!("{cmd} in {dir}")), ok, (!ok).then(|| clip(&tail(&text, 200), 200)));
        (ok, tail(&text, 2500))
    }
}

/// What identifies an open prompt for a confirmation: its id and what it asks.
fn prompt_key(p: &na_protocol::CvPrompt) -> Value {
    json!([p.id, super::observe::describe_prompt(p)])
}

fn first_line(s: &str) -> String {
    clip(s.lines().find(|l| !l.trim().is_empty()).unwrap_or(s), 90)
}

pub fn tail(s: &str, max: usize) -> String {
    let lines: Vec<&str> = s.trim_end().lines().map(str::trim_end).filter(|l| !l.is_empty()).collect();
    let mut out = String::new();
    for l in lines.iter().rev() {
        if out.len() + l.len() + 1 > max {
            break;
        }
        out.insert_str(0, &format!("{l}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn tail_keeps_the_last_lines() {
        assert_eq!(super::tail("a\nb\n\nc\n", 4), "b\nc\n");
    }

    #[test]
    fn tools_have_unique_names() {
        let l = super::list();
        let mut n: Vec<_> = l.iter().map(|t| t.name).collect();
        n.sort();
        n.dedup();
        assert_eq!(n.len(), l.len());
    }
}
