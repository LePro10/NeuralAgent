//! Claude view: the background tasks of a conversation (subagents, background shells, monitors).
//! Built from the transcript (Agent/Bash/Monitor calls and results, `<task-notification>`,
//! `task_status`), the subagent files next to it (`<session>/subagents/agent-<id>.meta.json`
//! and `.jsonl`), the `subagentStatusLine` ticks and the SubagentStart/Stop hooks.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use na_protocol::*;
use serde_json::Value;

use crate::cv_parse;

/// Tasks kept per conversation (oldest finished ones go first).
const MAX_TASKS: usize = 200;
const MAX_RESULT: usize = 4000;

fn s(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max { s.to_string() } else { format!("{}…", s.chars().take(max).collect::<String>()) }
}

/// A subagent id is safe to put into a file name.
pub fn valid_agent_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `<transcript without .jsonl>/subagents`.
pub fn subagent_dir(main: &Path) -> PathBuf {
    main.with_extension("").join("subagents")
}

/// The transcript of subagent `id` of the conversation in `main`.
pub fn subagent_path(main: &Path, id: &str) -> Option<PathBuf> {
    valid_agent_id(id).then(|| subagent_dir(main).join(format!("agent-{id}.jsonl")))
}

fn norm_status(st: &str) -> String {
    match st {
        "async_launched" | "in_progress" | "pending" | "running" | "started" => "running",
        "completed" | "done" | "success" | "finished" => "completed",
        "failed" | "error" => "failed",
        "killed" => "killed",
        "stopped" | "cancelled" | "canceled" | "interrupted" => "stopped",
        _ => "running",
    }
    .into()
}

/// A tool call that becomes a task once its result names the task id.
struct Pending {
    kind: &'static str,
    description: String,
    command: Option<String>,
    started: i64,
}

#[derive(Default)]
pub struct Tasks {
    list: Vec<CvTask>,
    pending: HashMap<String, Pending>,
    dirty: bool,
    pub last_sent: Option<Instant>,
    pub last_scan: Option<Instant>,
    mtimes: HashMap<PathBuf, SystemTime>,
}

impl Tasks {
    pub fn list(&self) -> Vec<CvTask> {
        self.list.clone()
    }
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }
    pub fn dirty(&self) -> bool {
        self.dirty
    }
    pub fn clear_dirty(&mut self) {
        self.dirty = false;
    }
    pub fn running(&self) -> u32 {
        self.list.iter().filter(|t| t.status == "running").count() as u32
    }
    pub fn get(&self, id: &str) -> Option<&CvTask> {
        self.list.iter().find(|t| t.id == id)
    }

    fn ix(&self, id: &str) -> Option<usize> {
        self.list.iter().position(|t| t.id == id)
    }
    fn ix_tool(&self, tool_use_id: &str) -> Option<usize> {
        self.list.iter().position(|t| t.tool_use_id.as_deref() == Some(tool_use_id))
    }

    /// Changes one task (found by id, else by tool call, else new) and marks the list changed
    /// when anything differs.
    fn upsert(&mut self, id: &str, tool_use_id: Option<&str>, f: impl FnOnce(&mut CvTask)) {
        let ix = self.ix(id).or_else(|| tool_use_id.and_then(|t| self.ix_tool(t)));
        let ix = match ix {
            Some(i) => i,
            None => {
                self.list.push(CvTask { id: id.to_string(), status: "running".into(), ..Default::default() });
                self.trim();
                self.list.len() - 1
            }
        };
        let before = self.list[ix].clone();
        let t = &mut self.list[ix];
        if t.tool_use_id.is_none() {
            t.tool_use_id = tool_use_id.map(str::to_string);
        }
        f(t);
        if t.kind.is_empty() {
            t.kind = cv_parse::task_kind(&t.id).into();
        }
        if *t != before {
            self.dirty = true;
        }
        // The real id arrived for a task first known by its tool call: drop a twin made from a hook.
        if before.id != self.list[ix].id {
            let id = self.list[ix].id.clone();
            if let Some(j) = self.list.iter().enumerate().position(|(k, t)| k != ix && t.id == id) {
                let twin = self.list.remove(j);
                let t = &mut self.list[if j < ix { ix - 1 } else { ix }];
                t.label = t.label.take().or(twin.label);
                t.tokens = t.tokens.or(twin.tokens);
                t.has_transcript |= twin.has_transcript;
            }
        }
    }

    fn trim(&mut self) {
        while self.list.len() > MAX_TASKS {
            let i = self.list.iter().position(|t| t.status != "running").unwrap_or(0);
            self.list.remove(i);
        }
    }

    /// An assistant tool call.
    pub fn tool_use(&mut self, name: &str, id: &str, input: &Value, ts: i64) {
        match name {
            "Agent" | "Task" => {
                let background = input["run_in_background"].as_bool() == Some(true);
                self.upsert(id, Some(id), |t| {
                    t.kind = "agent".into();
                    t.description = s(&input["description"]).unwrap_or_default();
                    t.agent_type = s(&input["subagent_type"]).or(t.agent_type.take());
                    t.model = s(&input["model"]).or(t.model.take());
                    t.background = background;
                    t.started = Some(ts);
                });
            }
            "Bash" if input["run_in_background"].as_bool() == Some(true) => {
                self.pending.insert(
                    id.into(),
                    Pending {
                        kind: "bash",
                        description: s(&input["description"]).unwrap_or_default(),
                        command: s(&input["command"]).map(|c| clip(&c, 500)),
                        started: ts,
                    },
                );
            }
            "Monitor" => {
                self.pending.insert(
                    id.into(),
                    Pending {
                        kind: "monitor",
                        description: s(&input["description"]).unwrap_or_default(),
                        command: s(&input["command"]).map(|c| clip(&c, 500)),
                        started: ts,
                    },
                );
            }
            _ => {}
        }
        if self.pending.len() > 400 {
            self.pending.clear();
        }
    }

    /// A tool result with its `toolUseResult`.
    pub fn tool_result(&mut self, tool_use_id: &str, r: &Value, is_error: bool, ts: i64) {
        if let Some(p) = self.pending.remove(tool_use_id) {
            let Some(task_id) = s(&r["backgroundTaskId"]).or_else(|| s(&r["taskId"])) else { return };
            self.upsert(&task_id, Some(tool_use_id), |t| {
                t.kind = p.kind.into();
                t.description = p.description;
                t.command = p.command;
                t.background = true;
                t.started = Some(p.started);
                t.output_file = s(&r["outputFile"]).or(t.output_file.take());
            });
            return;
        }
        let known = self.ix_tool(tool_use_id).is_some();
        let agent_id = s(&r["agentId"]);
        if !known && agent_id.is_none() {
            return;
        }
        let id = agent_id.clone().unwrap_or_else(|| tool_use_id.to_string());
        let status = s(&r["status"]);
        self.upsert(&id, Some(tool_use_id), |t| {
            t.kind = "agent".into();
            if let Some(a) = &agent_id {
                t.id = a.clone();
            }
            if t.description.is_empty() {
                t.description = s(&r["description"]).unwrap_or_default();
            }
            t.agent_type = s(&r["agentType"]).or(t.agent_type.take());
            t.model = s(&r["resolvedModel"]).or(t.model.take());
            t.output_file = s(&r["outputFile"]).or(t.output_file.take());
            match status.as_deref() {
                Some("async_launched") => {
                    t.background = true;
                    t.status = "running".into();
                }
                Some(st) => {
                    t.status = norm_status(st);
                    t.ended = Some(ts);
                }
                None if is_error => {
                    t.status = "failed".into();
                    t.ended = Some(ts);
                }
                None => {}
            }
            t.duration_ms = r["totalDurationMs"].as_u64().or(t.duration_ms);
            t.tokens = r["totalTokens"].as_u64().or(t.tokens);
            t.tool_count = r["totalToolUseCount"].as_u64().map(|n| n as u32).or(t.tool_count);
            if let Some(text) = cv_parse::agent_result_text(r) {
                t.result = Some(clip(&text, MAX_RESULT));
            }
        });
    }

    /// `<task-notification>`: a background task finished.
    pub fn note(&mut self, b: &CvBlock, ts: i64) {
        let CvBlock::TaskNote { task_id, tool_use_id, status, summary, result, kind, tokens, tool_count, duration_ms, output_file } = b
        else {
            return;
        };
        self.upsert(task_id, tool_use_id.as_deref(), |t| {
            t.id = task_id.clone();
            if t.kind.is_empty() {
                t.kind = kind.clone();
            }
            t.background = true;
            t.status = norm_status(status);
            if !summary.is_empty() {
                t.summary = Some(summary.clone());
                if t.description.is_empty() {
                    t.description = summary.clone();
                }
            }
            if !result.is_empty() {
                t.result = Some(clip(result, MAX_RESULT));
            }
            t.tokens = tokens.or(t.tokens);
            t.tool_count = tool_count.or(t.tool_count);
            t.duration_ms = duration_ms.or(t.duration_ms);
            t.output_file = output_file.clone().or(t.output_file.take());
            t.ended = Some(ts);
            t.label = None;
        });
    }

    /// `attachment.task_status`: the CLI's own view of a task (after compaction, on resume).
    pub fn status_attachment(&mut self, a: &Value) {
        let Some(id) = s(&a["taskId"]) else { return };
        let kind = match a["taskType"].as_str().unwrap_or("") {
            "local_bash" => "bash",
            "local_agent" | "remote_agent" => "agent",
            k if k.contains("monitor") => "monitor",
            _ => "",
        };
        let tool_use_id = s(&a["shell"]["toolUseId"]);
        self.upsert(&id, tool_use_id.as_deref(), |t| {
            if !kind.is_empty() {
                t.kind = kind.into();
            }
            t.background = true;
            if let Some(d) = s(&a["description"]) {
                t.description = d;
            }
            if let Some(st) = s(&a["status"]) {
                t.status = norm_status(&st);
            }
            if let Some(d) = s(&a["deltaSummary"]) {
                t.summary = Some(clip(&d, 600));
            }
            t.output_file = s(&a["outputFilePath"]).or(t.output_file.take());
            t.command = s(&a["shell"]["command"]).map(|c| clip(&c, 500)).or(t.command.take());
        });
    }

    /// One `subagentStatusLine` tick: live rows of the running tasks.
    pub fn statusline(&mut self, tasks: &[Value]) {
        for v in tasks {
            let Some(id) = s(&v["id"]) else { continue };
            let ty = format!("{} {}", v["type"].as_str().unwrap_or(""), v["agentType"].as_str().unwrap_or("")).to_lowercase();
            self.upsert(&id, None, |t| {
                if t.kind.is_empty() {
                    t.kind = if ty.contains("bash") || ty.contains("shell") {
                        "bash"
                    } else if ty.contains("monitor") {
                        "monitor"
                    } else {
                        "agent"
                    }
                    .into();
                }
                if t.description.is_empty() {
                    t.description = s(&v["description"]).or_else(|| s(&v["name"])).unwrap_or_default();
                }
                t.agent_type = t.agent_type.take().or_else(|| s(&v["agentType"]));
                if let Some(st) = s(&v["status"]) {
                    t.status = norm_status(&st);
                }
                // A live label only while it runs (a finished task shows its summary).
                if let Some(l) = s(&v["label"]).filter(|_| t.status == "running") {
                    t.label = Some(clip(&l, 200));
                }
                t.tokens = v["tokenCount"].as_u64().or(t.tokens);
                t.model = t.model.take().or_else(|| s(&v["model"]));
                if t.started.is_none() {
                    t.started = v["startTime"].as_i64();
                }
            });
        }
    }

    /// SubagentStop hook: a subagent ended (sync ones get no task notification).
    pub fn subagent_stop(&mut self, payload: &Value, now: i64) {
        let Some(id) = s(&payload["agent_id"]) else { return };
        let Some(ix) = self.ix(&id) else { return };
        if self.list[ix].status != "running" {
            return;
        }
        let msg = s(&payload["last_assistant_message"]);
        self.upsert(&id, None, |t| {
            t.status = "completed".into();
            t.ended = Some(now);
            t.label = None;
            if t.result.is_none() {
                t.result = msg.map(|m| clip(&m, MAX_RESULT));
            }
        });
    }

    /// Reads the subagent files next to the transcript: links agent ids to their tool calls and
    /// takes the last step of running ones as their label. Only changed files are read.
    pub fn scan(&mut self, main: &Path) {
        self.last_scan = Some(Instant::now());
        let dir = subagent_dir(main);
        let Ok(rd) = std::fs::read_dir(&dir) else { return };
        let mut files: Vec<(PathBuf, SystemTime)> = rd
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let m = e.metadata().ok()?.modified().ok()?;
                Some((p, m))
            })
            .collect();
        // Newest first, the meta files (they link ids) before the transcripts.
        files.sort_by_key(|(_, m)| std::cmp::Reverse(*m));
        files.truncate(80);
        files.sort_by_key(|(p, _)| !p.to_string_lossy().ends_with(".meta.json"));
        for (p, m) in files {
            if self.mtimes.get(&p) == Some(&m) {
                continue;
            }
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if name.ends_with(".meta.json")
                || name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".jsonl")).is_some_and(|id| self.ix(id).is_some())
            {
                self.mtimes.insert(p.clone(), m);
            }
            if let Some(id) = name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".meta.json")) {
                let Some(v) =
                    crate::cv_commands::read_small(&p, 256 << 10).map(|t| serde_json::from_str::<Value>(&t).unwrap_or(Value::Null))
                else {
                    continue;
                };
                let tool = s(&v["toolUseId"]);
                let has = dir.join(format!("agent-{id}.jsonl")).exists();
                let finished = v["finished"].as_bool() == Some(true);
                let id = id.to_string();
                // Old subagents of a long conversation stay out unless the transcript showed them.
                if self.ix(&id).is_none() && tool.as_deref().and_then(|t| self.ix_tool(t)).is_none() && finished {
                    continue;
                }
                self.upsert(&id, tool.as_deref(), |t| {
                    t.id = id.clone();
                    t.kind = "agent".into();
                    t.has_transcript |= has;
                    t.agent_type = t.agent_type.take().or_else(|| s(&v["agentType"]));
                    if t.description.is_empty() {
                        t.description = s(&v["description"]).unwrap_or_default();
                    }
                    t.model = t.model.take().or_else(|| s(&v["model"]));
                    if finished && t.status == "running" && !t.background {
                        t.status = "completed".into();
                        t.label = None;
                    }
                });
            } else if let Some(id) = name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".jsonl")) {
                let Some(ix) = self.ix(id) else { continue };
                let running = self.list[ix].status == "running";
                let label = if running { last_step(&p) } else { None };
                let id = id.to_string();
                self.upsert(&id, None, |t| {
                    t.has_transcript = true;
                    if label.is_some() {
                        t.label = label;
                    }
                });
            }
        }
        if self.mtimes.len() > 2000 {
            self.mtimes.clear();
        }
    }
}

/// "Read main.rs", "Bash cargo test", … from the last tool call in a subagent transcript.
pub fn last_step(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(64 << 10);
    f.seek(SeekFrom::Start(start)).ok()?;
    // Bytes, not a String: the window may start inside a multi-byte character.
    let mut raw = vec![];
    f.take(64 << 10).read_to_end(&mut raw).ok()?;
    let buf = String::from_utf8_lossy(&raw);
    for line in buf.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "assistant" {
            continue;
        }
        for b in v["message"]["content"].as_array().into_iter().flatten().rev() {
            match b["type"].as_str() {
                Some("tool_use") => return Some(step_label(b["name"].as_str().unwrap_or("Tool"), &b["input"])),
                Some("text") => {
                    let t = b["text"].as_str().unwrap_or("").trim();
                    if !t.is_empty() {
                        return Some(clip(t.lines().next().unwrap_or(t), 120));
                    }
                }
                _ => {}
            }
        }
    }
    None
}

pub fn step_label(name: &str, input: &Value) -> String {
    let base = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    let arg = s(&input["description"])
        .or_else(|| s(&input["file_path"]).map(|p| base(&p)))
        .or_else(|| s(&input["path"]).map(|p| base(&p)))
        .or_else(|| s(&input["command"]))
        .or_else(|| s(&input["pattern"]))
        .or_else(|| s(&input["url"]))
        .or_else(|| s(&input["query"]))
        .unwrap_or_default();
    let arg = arg.lines().next().unwrap_or("").to_string();
    if arg.is_empty() { name.to_string() } else { clip(&format!("{name} {arg}"), 120) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn async_agent_lifecycle() {
        let mut t = Tasks::default();
        t.tool_use("Agent", "tu1", &json!({ "description": "Survey", "subagent_type": "Explore", "run_in_background": true }), 100);
        assert_eq!(t.list()[0].id, "tu1");
        t.tool_result(
            "tu1",
            &json!({ "isAsync": true, "status": "async_launched", "agentId": "a0123456789abcdef", "outputFile": "/t/a.output" }),
            false,
            110,
        );
        let l = t.list();
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].id.as_str(), l[0].status.as_str(), l[0].background), ("a0123456789abcdef", "running", true));
        assert_eq!(l[0].agent_type.as_deref(), Some("Explore"));
        assert_eq!(t.running(), 1);
        let note = cv_parse::task_notification("<task-notification><task-id>a0123456789abcdef</task-id><tool-use-id>tu1</tool-use-id><status>completed</status><summary>done</summary><result>R</result><usage><subagent_tokens>50</subagent_tokens></usage></task-notification>").unwrap();
        t.note(&note, 200);
        let l = t.list();
        assert_eq!((l[0].status.as_str(), l[0].result.as_deref(), l[0].tokens, l[0].ended), ("completed", Some("R"), Some(50), Some(200)));
        assert_eq!(t.running(), 0);
        assert!(t.dirty());
    }

    #[test]
    fn sync_agent_and_background_shell() {
        let mut t = Tasks::default();
        t.tool_use("Agent", "tu2", &json!({ "description": "Check", "subagent_type": "general-purpose" }), 1);
        t.tool_result(
            "tu2",
            &json!({ "status": "completed", "agentId": "a2", "content": [{ "type": "text", "text": "fine" }], "totalTokens": 7 }),
            false,
            9,
        );
        let l = t.list();
        assert_eq!(
            (l[0].id.as_str(), l[0].status.as_str(), l[0].result.as_deref(), l[0].background),
            ("a2", "completed", Some("fine"), false)
        );
        t.tool_use("Bash", "tu3", &json!({ "command": "sleep 100", "description": "Wait", "run_in_background": true }), 20);
        t.tool_use("Bash", "tu4", &json!({ "command": "ls" }), 21);
        t.tool_result("tu4", &json!({ "stdout": "x" }), false, 22);
        t.tool_result("tu3", &json!({ "stdout": "", "backgroundTaskId": "bsze43f5n" }), false, 22);
        let l = t.list();
        assert_eq!(l.len(), 2);
        assert_eq!((l[1].id.as_str(), l[1].kind.as_str(), l[1].command.as_deref()), ("bsze43f5n", "bash", Some("sleep 100")));
        t.status_attachment(
            &json!({ "taskId": "bsze43f5n", "taskType": "local_bash", "status": "killed", "outputFilePath": "/t/b.output" }),
        );
        assert_eq!(t.get("bsze43f5n").unwrap().status, "killed");
        assert_eq!(t.get("bsze43f5n").unwrap().output_file.as_deref(), Some("/t/b.output"));
    }

    #[test]
    fn statusline_and_stop_hook() {
        let mut t = Tasks::default();
        t.tool_use("Agent", "tu5", &json!({ "description": "Run" }), 1);
        t.tool_result("tu5", &json!({ "status": "async_launched", "agentId": "a5" }), false, 2);
        t.statusline(&[json!({ "id": "a5", "label": "Reading main.rs", "tokenCount": 1200, "status": "running" })]);
        assert_eq!(t.get("a5").unwrap().label.as_deref(), Some("Reading main.rs"));
        assert_eq!(t.get("a5").unwrap().tokens, Some(1200));
        t.subagent_stop(&json!({ "agent_id": "a5", "last_assistant_message": "bye" }), 50);
        let a = t.get("a5").unwrap();
        assert_eq!((a.status.as_str(), a.label.as_deref(), a.result.as_deref()), ("completed", None, Some("bye")));
    }

    #[test]
    fn subagent_files_link_ids_and_give_labels() {
        let dir = std::env::temp_dir().join(format!("na-cvtasks-{}", std::process::id()));
        let main = dir.join("s1.jsonl");
        let sub = subagent_dir(&main);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(&main, "").unwrap();
        std::fs::write(
            sub.join("agent-a9.meta.json"),
            r#"{"agentType":"Explore","description":"Look","toolUseId":"tu9","finished":false}"#,
        )
        .unwrap();
        std::fs::write(
            sub.join("agent-a9.jsonl"),
            "{\"type\":\"assistant\",\"isSidechain\":true,\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"x\",\"name\":\"Read\",\"input\":{\"file_path\":\"/r/src/main.rs\"}}]}}\n",
        )
        .unwrap();
        let mut t = Tasks::default();
        t.tool_use("Agent", "tu9", &json!({ "description": "Look" }), 1);
        t.scan(&main);
        let a = t.get("a9").expect("linked by toolUseId");
        assert!(a.has_transcript);
        assert_eq!(a.label.as_deref(), Some("Read main.rs"));
        assert_eq!(subagent_path(&main, "a9"), Some(sub.join("agent-a9.jsonl")));
        assert_eq!(subagent_path(&main, "../x"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
