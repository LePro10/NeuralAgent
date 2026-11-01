//! Claude view: the background tasks of a conversation (subagents, background shells, monitors).
//! Built from the transcript (Agent/Bash/Monitor calls and results, `<task-notification>`,
//! `task_status`), the subagent files next to it (`<session>/subagents/agent-<id>.meta.json`
//! and `.jsonl`), the `subagentStatusLine` ticks and the SubagentStart/Stop hooks.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use na_protocol::*;
use serde_json::Value;

use crate::cv_parse;

/// Tasks kept per conversation (oldest finished ones go first).
const MAX_TASKS: usize = 200;
const MAX_RESULT: usize = 4000;
/// Subagent files looked at per scan (newest first; two per agent).
const MAX_FILES: usize = 400;
/// A transcript written this long after the agent's end means it runs again.
const REVIVE_MS: i64 = 3000;
/// The label of an agent that waits for its own background shell or monitor.
const WAITING: &str = "Waiting for its own background work";

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
    /// Agents that stopped while their own background work runs: they may go on (D66).
    waiting: HashSet<String>,
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
    /// Running subagents (the Discord card's count).
    pub fn agents_running(&self) -> u32 {
        self.list.iter().filter(|t| t.kind == "agent" && t.status == "running").count() as u32
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
        // Known twice: by its tool call (the transcript) and by its id (a statusline tick or a
        // hook came first). One task again, with the tool call's facts.
        if let (Some(i), Some(j)) = (self.ix(id), tool_use_id.and_then(|t| self.ix_tool(t)))
            && i != j
        {
            let twin = self.list.remove(j);
            let i = if j < i { i - 1 } else { i };
            absorb(&mut self.list[i], twin);
            self.dirty = true;
        }
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
        // "Agent "X" is waiting on its own background work": an interim result, the agent goes on
        // when its shell or monitor reports (the same task id notifies again).
        let wait = summary.contains("waiting on its own background work");
        if wait {
            self.waiting.insert(task_id.clone());
        } else {
            self.waiting.remove(task_id);
        }
        self.upsert(task_id, tool_use_id.as_deref(), |t| {
            t.id = task_id.clone();
            if t.kind.is_empty() {
                t.kind = kind.clone();
            }
            t.background = true;
            t.status = if wait { "running".into() } else { norm_status(status) };
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
            t.ended = if wait { None } else { Some(ts) };
            t.label = wait.then(|| WAITING.to_string());
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
        if self.list[ix].status != "running" || self.waiting.contains(&id) {
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

    /// Reads the subagent files next to the transcript: links agent ids to their tool calls (also
    /// nested agents, through `parentAgentId`), marks finished ones and takes the last step, the
    /// token count and the last write of running ones. Only changed files are read.
    pub fn scan(&mut self, main: &Path) {
        self.last_scan = Some(Instant::now());
        let dir = subagent_dir(main);
        let Ok(rd) = std::fs::read_dir(&dir) else { return };
        let mut files: Vec<(PathBuf, SystemTime)> = rd
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let n = p.file_name()?.to_str()?;
                if !n.starts_with("agent-") || !(n.ends_with(".meta.json") || n.ends_with(".jsonl")) {
                    return None;
                }
                let m = e.metadata().ok()?.modified().ok()?;
                Some((p, m))
            })
            .collect();
        // Newest first (a workflow can start dozens at once).
        files.sort_by_key(|(_, m)| std::cmp::Reverse(*m));
        files.truncate(MAX_FILES);
        let seen: HashSet<PathBuf> = files.iter().map(|(p, _)| p.clone()).collect();
        let name_of = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();

        // The meta files link ids; parents before their children so nested agents find them.
        let mut metas: Vec<(String, Value, SystemTime)> = vec![];
        for (p, m) in &files {
            let name = name_of(p);
            let Some(id) = name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".meta.json")) else { continue };
            if self.mtimes.get(p) == Some(m) {
                continue;
            }
            self.mtimes.insert(p.clone(), *m);
            if let Some(v) = crate::cv_commands::read_small(p, 256 << 10).and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                metas.push((id.to_string(), v, *m));
            }
        }
        metas.sort_by_key(|(_, v, _)| v["spawnDepth"].as_u64().unwrap_or(1));
        for (id, v, m) in metas {
            let tool = s(&v["toolUseId"]);
            let parent = s(&v["parentAgentId"]);
            let has = dir.join(format!("agent-{id}.jsonl")).exists();
            let finished = v["finished"].as_bool() == Some(true);
            let stopped = v["stoppedByUser"].as_bool() == Some(true);
            // Old subagents of a long conversation stay out unless the transcript or a known
            // parent showed them.
            let known = self.ix(&id).is_some()
                || tool.as_deref().and_then(|t| self.ix_tool(t)).is_some()
                || parent.as_deref().is_some_and(|p| self.ix(p).is_some());
            if !known && finished {
                continue;
            }
            let waiting = self.waiting.contains(&id);
            self.upsert(&id, tool.as_deref(), |t| {
                t.id = id.clone();
                t.kind = "agent".into();
                t.has_transcript |= has;
                t.parent = parent.or(t.parent.take());
                t.agent_type = t.agent_type.take().or_else(|| s(&v["agentType"]));
                if t.description.is_empty() {
                    t.description = s(&v["description"]).unwrap_or_default();
                }
                t.model = t.model.take().or_else(|| s(&v["model"]));
                if v["requestShape"] == "background" {
                    t.background = true;
                }
                if t.started.is_none() && !finished {
                    t.started = ms(m);
                }
                // Nested background agents report to their parent, never to the main transcript:
                // `finished` is the only end the main conversation sees.
                if finished && t.status == "running" && !waiting {
                    t.status = if stopped { "stopped" } else { "completed" }.into();
                    t.label = None;
                    t.ended = t.ended.or(ms(m));
                }
            });
        }

        for (p, m) in files {
            let name = name_of(&p);
            let Some(id) = name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".jsonl")) else { continue };
            let Some(ix) = self.ix(id) else { continue };
            if self.mtimes.get(&p) == Some(&m) {
                continue;
            }
            self.mtimes.insert(p.clone(), m);
            // A finished agent whose transcript grows again was resumed (a message to it, or its
            // own background work reported).
            // (By the time of its newest entry, not the file's mtime: copies and restores touch that.)
            let t = &self.list[ix];
            let maybe = t.kind == "agent" && t.status == "completed";
            let step = if t.status == "running" || maybe { last_step(&p) } else { None };
            let revive = maybe && t.ended.zip(step.as_ref().and_then(|s| s.at)).is_some_and(|(e, w)| w > e + REVIVE_MS);
            let step = if revive || !maybe { step } else { None };
            let id = id.to_string();
            self.upsert(&id, None, |t| {
                if revive {
                    t.status = "running".into();
                    t.ended = None;
                }
                t.has_transcript = true;
                t.active = ms(m).or(t.active);
                if let Some(st) = step {
                    if st.label.is_some() {
                        t.label = st.label;
                    }
                    // The statusline's count and the final total win; the transcript's is a floor.
                    if st.tokens > 0 {
                        t.tokens = Some(t.tokens.unwrap_or(0).max(st.tokens));
                    }
                }
            });
        }
        // Forget files that left the newest `MAX_FILES` (clearing all would read every file again).
        if self.mtimes.len() > 2 * MAX_FILES {
            self.mtimes.retain(|p, _| seen.contains(p));
        }
    }
}

/// `o` was the same task under its tool call's id: what `t` lacks comes from it.
fn absorb(t: &mut CvTask, o: CvTask) {
    if t.description.is_empty() {
        t.description = o.description;
    }
    if t.kind.is_empty() {
        t.kind = o.kind;
    }
    t.tool_use_id = t.tool_use_id.take().or(o.tool_use_id);
    t.parent = t.parent.take().or(o.parent);
    t.agent_type = o.agent_type.or(t.agent_type.take());
    t.model = o.model.or(t.model.take());
    t.background |= o.background;
    // The tool call's time is when it started.
    t.started = o.started.or(t.started);
    t.label = t.label.take().or(o.label);
    t.tokens = t.tokens.max(o.tokens);
    t.tool_count = t.tool_count.or(o.tool_count);
    t.duration_ms = t.duration_ms.or(o.duration_ms);
    t.summary = t.summary.take().or(o.summary);
    t.result = t.result.take().or(o.result);
    t.has_transcript |= o.has_transcript;
    t.command = t.command.take().or(o.command);
    t.output_file = t.output_file.take().or(o.output_file);
    t.active = t.active.max(o.active);
}

fn ms(t: SystemTime) -> Option<i64> {
    t.duration_since(SystemTime::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// The latest step of a running subagent.
#[derive(Debug, Default, PartialEq)]
pub struct Step {
    /// "Read main.rs", "Bash cargo test" or the first line of its newest text.
    pub label: Option<String>,
    /// The time of the newest entry (ms).
    pub at: Option<i64>,
    /// Tokens of its newest model call (input, cache and output): how big its context is now.
    pub tokens: u64,
}

/// The last step of a subagent transcript: its last 16 KB, or 64 KB when a big tool result
/// fills those (a scan reads this for every agent that wrote since the last one).
pub fn last_step(path: &Path) -> Option<Step> {
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let first = last_step_in(&mut f, len, 16 << 10);
    if len <= 16 << 10 || first.as_ref().is_some_and(|s| s.label.is_some()) {
        return first;
    }
    last_step_in(&mut f, len, 64 << 10)
}

fn last_step_in(f: &mut std::fs::File, len: u64, window: u64) -> Option<Step> {
    let start = len.saturating_sub(window);
    f.seek(SeekFrom::Start(start)).ok()?;
    // Bytes, not a String: the window may start inside a multi-byte character.
    let mut raw = vec![];
    f.take(window).read_to_end(&mut raw).ok()?;
    let buf = String::from_utf8_lossy(&raw);
    let mut step = Step::default();
    for line in buf.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if step.at.is_none() {
            step.at = v["timestamp"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp_millis());
        }
        if v["type"] != "assistant" {
            continue;
        }
        if step.tokens == 0 {
            let u = &v["message"]["usage"];
            step.tokens = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]
                .iter()
                .filter_map(|k| u[*k].as_u64())
                .sum();
        }
        for b in v["message"]["content"].as_array().into_iter().flatten().rev() {
            match b["type"].as_str() {
                Some("tool_use") => step.label = Some(step_label(b["name"].as_str().unwrap_or("Tool"), &b["input"])),
                Some("text") => {
                    let t = b["text"].as_str().unwrap_or("").trim();
                    if !t.is_empty() {
                        step.label = Some(clip(t.lines().next().unwrap_or(t), 120));
                    }
                }
                _ => {}
            }
            if step.label.is_some() {
                return Some(step);
            }
        }
    }
    (step.tokens > 0 || step.at.is_some()).then_some(step)
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
    fn a_statusline_tick_before_the_launch_result_makes_no_twin() {
        // Seen live (Claude Code 2.1.316): the call, a statusline row by agent id, then the result.
        let mut t = Tasks::default();
        t.tool_use("Agent", "tu1", &json!({ "description": "Wait C", "subagent_type": "general-purpose", "run_in_background": true }), 100);
        t.statusline(&[json!({ "id": "a91", "type": "local_agent", "agentType": "general-purpose", "description": "Wait C", "status": "running", "label": "Bash until" })]);
        assert_eq!(t.list().len(), 2, "not linked yet: nothing ties the row to the call");
        t.tool_result("tu1", &json!({ "isAsync": true, "status": "async_launched", "agentId": "a91" }), false, 110);
        let l = t.list();
        assert_eq!(l.len(), 1, "{l:?}");
        assert_eq!((l[0].id.as_str(), l[0].tool_use_id.as_deref(), l[0].started, l[0].background), ("a91", Some("tu1"), Some(100), true));
        assert_eq!((l[0].description.as_str(), l[0].label.as_deref(), t.running()), ("Wait C", Some("Bash until"), 1));
    }

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

    #[test]
    fn nested_agents_finish_and_count_tokens() {
        let dir = std::env::temp_dir().join(format!("na-cvtasks-nested-{}", std::process::id()));
        let main = dir.join("s2.jsonl");
        let sub = subagent_dir(&main);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(&main, "").unwrap();
        // The child is written first: the scan still links it after its parent (spawnDepth).
        std::fs::write(
            sub.join("agent-ac1.meta.json"),
            r#"{"agentType":"worker","description":"Child","toolUseId":"tuc","parentAgentId":"ap1","spawnDepth":2,"requestShape":"background"}"#,
        )
        .unwrap();
        std::fs::write(
            sub.join("agent-ac1.jsonl"),
            "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":10,\"cache_read_input_tokens\":2000,\"output_tokens\":5},\"content\":[{\"type\":\"text\",\"text\":\"Looking around\\nmore\"}]}}\n",
        )
        .unwrap();
        std::fs::write(
            sub.join("agent-ap1.meta.json"),
            r#"{"agentType":"general-purpose","description":"Parent","toolUseId":"tup","spawnDepth":1,"requestShape":"background"}"#,
        )
        .unwrap();
        // An old, finished agent nobody mentions stays out.
        std::fs::write(sub.join("agent-aold.meta.json"), r#"{"description":"Old","toolUseId":"tuold","spawnDepth":1,"finished":true}"#)
            .unwrap();
        let mut t = Tasks::default();
        t.tool_use("Agent", "tup", &json!({ "description": "Parent", "run_in_background": true }), 1);
        t.scan(&main);
        let c = t.get("ac1").expect("nested agent");
        assert_eq!((c.parent.as_deref(), c.tool_use_id.as_deref(), c.background), (Some("ap1"), Some("tuc"), true));
        assert_eq!((c.label.as_deref(), c.tokens), (Some("Looking around"), Some(2015)));
        assert!(c.active.is_some() && c.has_transcript);
        assert!(t.get("aold").is_none());
        assert_eq!(t.running(), 2);
        // The child ends: only its meta file says so.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(
            sub.join("agent-ac1.meta.json"),
            r#"{"description":"Child","toolUseId":"tuc","parentAgentId":"ap1","spawnDepth":2,"finished":true,"stoppedByUser":true}"#,
        )
        .unwrap();
        t.scan(&main);
        let c = t.get("ac1").unwrap();
        assert_eq!((c.status.as_str(), c.label.as_deref()), ("stopped", None));
        assert!(c.ended.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn waiting_and_resumed_agents() {
        let dir = std::env::temp_dir().join(format!("na-cvtasks-wait-{}", std::process::id()));
        let main = dir.join("s3.jsonl");
        let sub = subagent_dir(&main);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(&main, "").unwrap();
        let mut t = Tasks::default();
        t.tool_use("Agent", "tuw", &json!({ "description": "Slow", "run_in_background": true }), 1);
        t.tool_result("tuw", &json!({ "isAsync": true, "status": "async_launched", "agentId": "aw" }), false, 2);
        // Its turn ended with its own `sleep` still running: interim notification, meta "finished".
        std::fs::write(sub.join("agent-aw.meta.json"), r#"{"description":"Slow","toolUseId":"tuw","spawnDepth":1,"finished":true}"#)
            .unwrap();
        t.subagent_stop(&json!({ "agent_id": "aw" }), 3);
        let wait = "<task-notification><task-id>aw</task-id><tool-use-id>tuw</tool-use-id><status>completed</status><summary>Agent \"Slow\" is waiting on its own background work</summary><result>interim</result></task-notification>";
        t.note(&cv_parse::task_notification(wait).unwrap(), 4);
        t.subagent_stop(&json!({ "agent_id": "aw" }), 5);
        t.scan(&main);
        let a = t.get("aw").unwrap();
        assert_eq!((a.status.as_str(), a.label.as_deref(), a.ended), ("running", Some(WAITING), None));
        // The real end.
        let done = "<task-notification><task-id>aw</task-id><tool-use-id>tuw</tool-use-id><status>completed</status><summary>Agent \"Slow\" finished</summary><result>3 files</result></task-notification>";
        t.note(&cv_parse::task_notification(done).unwrap(), 1000);
        assert_eq!((t.get("aw").unwrap().status.as_str(), t.get("aw").unwrap().ended), ("completed", Some(1000)));
        // Later its transcript grows again (a message to it): it runs again.
        // Copied or touched files say nothing: only a newer entry counts.
        std::fs::write(sub.join("agent-aw.jsonl"), "{\"type\":\"assistant\",\"timestamp\":\"1970-01-01T00:00:00.500Z\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Old\"}]}}\n").unwrap();
        t.scan(&main);
        assert_eq!(t.get("aw").unwrap().status, "completed");
        std::thread::sleep(std::time::Duration::from_millis(20));
        let line = format!(
            "{{\"type\":\"assistant\",\"timestamp\":\"{}\",\"message\":{{\"content\":[{{\"type\":\"text\",\"text\":\"Again\"}}]}}}}\n",
            chrono::Utc::now().to_rfc3339()
        );
        std::fs::write(sub.join("agent-aw.jsonl"), line).unwrap();
        t.scan(&main);
        let a = t.get("aw").unwrap();
        assert_eq!((a.status.as_str(), a.label.as_deref(), a.ended), ("running", Some("Again"), None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `cargo test -p na-daemon scan_cost -- --ignored --nocapture`: a 400-agent workflow.
    #[test]
    #[ignore]
    fn scan_cost_of_a_big_fan_out() {
        let dir = std::env::temp_dir().join(format!("na-cvtasks-bench-{}", std::process::id()));
        let main = dir.join("s.jsonl");
        let sub = subagent_dir(&main);
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(&main, "").unwrap();
        let line =
            format!("{{\"type\":\"user\",\"timestamp\":\"2026-10-31T10:00:00Z\",\"message\":{{\"content\":\"{}\"}}}}\n", "x".repeat(4000));
        let step = "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":10},\"content\":[{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{\"file_path\":\"/a/b.rs\"}}]}}\n";
        let mut t = Tasks::default();
        for i in 0..400 {
            std::fs::write(
                sub.join(format!("agent-a{i}.meta.json")),
                format!(
                    r#"{{"agentType":"Explore","description":"Agent {i}","toolUseId":"tu{i}","spawnDepth":1,"requestShape":"background"}}"#
                ),
            )
            .unwrap();
            std::fs::write(sub.join(format!("agent-a{i}.jsonl")), format!("{}{step}", line.repeat(50))).unwrap();
            t.tool_use("Agent", &format!("tu{i}"), &json!({ "description": format!("Agent {i}"), "run_in_background": true }), 1);
        }
        let at = Instant::now();
        t.scan(&main);
        let first = at.elapsed();
        let at = Instant::now();
        t.scan(&main);
        let idle = at.elapsed();
        // 100 agents write meanwhile.
        for i in 300..400 {
            use std::io::Write;
            std::fs::OpenOptions::new()
                .append(true)
                .open(sub.join(format!("agent-a{i}.jsonl")))
                .unwrap()
                .write_all(step.as_bytes())
                .unwrap();
        }
        let at = Instant::now();
        t.scan(&main);
        let busy = at.elapsed();
        eprintln!("scan of 400 agents: first {first:?}, nothing changed {idle:?}, 100 changed {busy:?}; running {}", t.running());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
