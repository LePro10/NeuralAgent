//! Claude view: reads the transcript of a Claude Code session (JSONL in `~/.claude/projects`)
//! and streams it as structured messages. The CLI keeps running in its PTY; the UI renders the
//! messages and types into the PTY. Also: the menu the CLI shows on screen (read from the PTY
//! screen so it can be answered with buttons), slash commands, `@` files, uploads and
//! speech-to-text on this computer.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use base64::Engine;
use na_protocol::*;
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::core::{Core, err, now_ms};
use crate::cv_parse::{self, QueueOp, ShellLine};
use crate::cv_tasks::{self, Tasks};
use crate::{cv_commands, cv_image, cv_screen};

/// How much of the end of a big transcript is read at first.
const INITIAL_BYTES: u64 = 3 << 20;
/// Messages sent on attach / per history page.
const PAGE: usize = 120;
/// Messages kept in memory per session.
const KEEP: usize = 1200;
const MAX_TEXT: usize = 12_000;
const MAX_FIELD: usize = 30_000;
/// Uploads: size limit (decoded) and how long they are kept.
const MAX_UPLOAD: usize = 12 << 20;
const UPLOAD_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const STT_KEEP: Duration = Duration::from_secs(300);

/// Biggest file `cv_file` / `cv_task_output` return.
const MAX_READ: u64 = 512 << 10;
/// How often the subagent files next to a transcript are looked at.
const SCAN_EVERY: Duration = Duration::from_millis(1500);
/// Task list updates are sent at most this often.
const TASKS_EVERY: Duration = Duration::from_millis(500);

#[derive(Default)]
pub struct ClaudeView {
    tails: Mutex<HashMap<Id, Arc<Tail>>>,
    /// Read-only streams of subagent transcripts, by session and agent id.
    subs: Mutex<HashMap<(Id, String), Arc<Tail>>>,
    stt: Mutex<Option<(Arc<na_voice::stt::Stt>, Instant)>>,
    /// One `cv_action` at a time per session, so two actions never interleave their keys.
    pub(crate) action_locks: Mutex<HashMap<Id, Arc<tokio::sync::Mutex<()>>>>,
}

impl ClaudeView {
    /// The session is a Claude Code session the view knows (hooks or an attach created its tail).
    pub fn has_tail(&self, sid: &Id) -> bool {
        self.tails.lock().contains_key(sid)
    }
}

struct Tail {
    tx: broadcast::Sender<CvEvent>,
    st: Mutex<TailState>,
}

#[derive(Default)]
struct TailState {
    path: Option<PathBuf>,
    /// Bytes of the file consumed (whole lines only).
    offset: u64,
    /// Older content exists before the first loaded line.
    more: bool,
    started: bool,
    msgs: Vec<CvMessage>,
    by_id: HashMap<String, usize>,
    meta: CvMeta,
    prompt: Option<CvPrompt>,
    skills: HashMap<String, String>,
    /// The effort came from the session itself (transcript or screen), not the settings default.
    effort_seen: bool,
    /// The last effort read off the screen: only a change there overrides the transcript.
    screen_effort: Option<String>,
    /// A subagent transcript: its lines are all `isSidechain`.
    sidechain: bool,
    tasks: Tasks,
    /// TaskCreate calls waiting for their id.
    todo_pending: Vec<(String, usize)>,
    /// AskUserQuestion / ExitPlanMode calls without a result yet: what the menu on screen is about.
    asking: Vec<(String, String, Value)>,
    /// The tool the last PermissionRequest hook asked about.
    perm: Option<CvPromptTool>,
    /// The last statusline input (its fields survive a reload of the transcript).
    status: Option<Value>,
    spinner_seen: Option<Instant>,
    pending_checkpoints: HashSet<String>,
}

/// What one transcript line means.
#[derive(Default, Debug)]
pub struct Parsed {
    pub msg: Option<CvMessage>,
    pub mode: Option<String>,
    pub title: Option<String>,
    pub context: Option<u64>,
    pub model: Option<String>,
    /// `Some("")`: back to the default (`/effort auto`).
    pub effort: Option<String>,
    pub skills: Vec<(String, String)>,
    /// `/rename` (custom title).
    pub session_name: Option<String>,
    pub plan_file: Option<String>,
    pub queue: Option<QueueOp>,
    /// Tool calls of an assistant line: (id, name, input).
    pub tool_uses: Vec<(String, String, Value)>,
    /// Tool results of a user line: (tool_use_id, toolUseResult, is_error).
    pub tool_results: Vec<(String, Value, bool)>,
    /// A `task_status` attachment.
    pub task_status: Option<Value>,
    /// Output of a `!` command for the input line with this uuid: (parent uuid, stdout, stderr).
    pub shell_out: Option<(String, Option<String>, Option<String>)>,
    /// A file checkpoint for the user message with this uuid.
    pub checkpoint: Option<String>,
}

/// Effort levels Claude Code takes, lowest first.
pub const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

/// The effort a `/effort` output sets: "Set effort level to high (this session only): …",
/// "… Effort stays high.", "Effort level set to auto" (→ `""`, the default again).
pub fn effort_from_output(out: &str) -> Option<String> {
    let lower = out.to_lowercase();
    for key in ["set effort level to ", "effort level set to ", "effort stays "] {
        if let Some(i) = lower.find(key) {
            let word: String = lower[i + key.len()..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
            if EFFORTS.contains(&word.as_str()) {
                return Some(word);
            }
            if word == "auto" || word == "default" {
                return Some(String::new());
            }
        }
    }
    None
}

/// The effort in the CLI's status line ("◐ medium · /effort").
pub fn detect_effort(screen: &str) -> Option<&'static str> {
    screen.lines().find_map(|l| {
        let before = &l[..l.find("/effort")?];
        let word = before.trim_end().trim_end_matches('·').trim_end().rsplit(|c: char| c.is_whitespace()).next()?.to_lowercase();
        EFFORTS.iter().find(|e| **e == word).copied()
    })
}

/// The default effort for `model` in Claude Code's settings (`modelSettings.<model>.effortLevel`, then `effortLevel`).
pub fn settings_effort(dir: &Path, model: Option<&str>) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("settings.json")).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let per_model = model.and_then(|m| v["modelSettings"][m]["effortLevel"].as_str());
    per_model.or(v["effortLevel"].as_str()).filter(|e| EFFORTS.contains(e)).map(str::to_string)
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}\n… ({} more characters)", s.chars().count() - max)
}

/// Big strings inside tool input (file contents) are shortened.
fn clip_value(v: &Value) -> Value {
    match v {
        Value::String(s) => Value::String(clip(s, MAX_FIELD)),
        Value::Array(a) => Value::Array(a.iter().map(clip_value).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), clip_value(v))).collect()),
        o => o.clone(),
    }
}

fn millis(v: &Value) -> i64 {
    v["timestamp"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp_millis()).unwrap_or(0)
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\x1b' {
            if it.peek() == Some(&'[') {
                it.next();
                for c in it.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let a = s.find(open)? + open.len();
    let b = s[a..].find(close)? + a;
    Some(&s[a..b])
}

/// A tool result's text and its images (by reference, see `cv_image`). `images`: the line's
/// image blocks (`cv_image::images_in`), `off`: the line's position.
fn tool_result_content(c: &Value, images: &[&Value], off: u64) -> (String, Vec<CvImage>) {
    match c {
        Value::String(s) => (clip(s, MAX_TEXT), vec![]),
        Value::Array(a) => {
            let mut refs = vec![];
            let text = a
                .iter()
                .map(|b| match b["type"].as_str() {
                    Some("text") => b["text"].as_str().unwrap_or("").to_string(),
                    Some("image") => match cv_image::index_of(images, b).and_then(|n| cv_image::image_ref(b, off, n)) {
                        Some(r) => {
                            refs.push(r);
                            String::new()
                        }
                        None => "[image]".to_string(),
                    },
                    _ => String::new(),
                })
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            (clip(&text, MAX_TEXT), refs)
        }
        _ => (String::new(), vec![]),
    }
}

/// One transcript line → message / metadata. `off` is the line's position in the file.
#[cfg(test)]
pub fn parse_line(v: &Value, off: u64) -> Parsed {
    parse_line_in(v, off, false)
}

/// As `parse_line`; `sidechain`: the file is a subagent's transcript (all its lines are sidechain lines).
pub fn parse_line_in(v: &Value, off: u64, sidechain: bool) -> Parsed {
    let mut p = Parsed::default();
    let ty = v["type"].as_str().unwrap_or("");
    let uuid = v["uuid"].as_str().unwrap_or("").to_string();
    let sys = |kind: &str, blocks: Vec<CvBlock>| CvMessage {
        i: off,
        id: uuid.clone(),
        role: CvRole::System,
        ts: millis(v),
        kind: Some(kind.into()),
        blocks,
        ..Default::default()
    };
    if !sidechain && v["isSidechain"].as_bool() == Some(true) {
        return p;
    }
    match ty {
        "permission-mode" => p.mode = v["permissionMode"].as_str().map(str::to_string),
        "ai-title" => p.title = v["aiTitle"].as_str().map(str::to_string),
        "custom-title" => p.session_name = v["customTitle"].as_str().or(v["title"].as_str()).map(str::to_string),
        "queue-operation" => p.queue = cv_parse::queue_op(v),
        "file-history-snapshot" => {
            let backups = v["snapshot"]["trackedFileBackups"].as_object().is_some_and(|o| !o.is_empty());
            if backups {
                p.checkpoint = v["messageId"].as_str().map(str::to_string);
            }
        }
        "attachment" => {
            let a = &v["attachment"];
            match a["type"].as_str().unwrap_or("") {
                "skill_listing" => {
                    if let Some(c) = a["content"].as_str() {
                        for line in c.lines() {
                            if let Some(rest) = line.strip_prefix("- ")
                                && let Some((n, d)) = rest.split_once(": ")
                            {
                                p.skills.push((n.trim().to_string(), d.trim().to_string()));
                            }
                        }
                    }
                }
                "task_status" => p.task_status = Some(a.clone()),
                "plan_mode" | "plan_mode_exit" | "plan_mode_reentry" => {
                    p.plan_file = a["planFilePath"].as_str().filter(|f| !f.is_empty()).map(str::to_string)
                }
                _ => {
                    if let Some(b) = cv_parse::hook_attachment(a) {
                        p.msg = Some(sys("hook", vec![b]));
                    }
                }
            }
        }
        "system" => {
            let sub = v["subtype"].as_str().unwrap_or("");
            let text = v["content"].as_str().unwrap_or("");
            let (kind, text) = match sub {
                "compact_boundary" => {
                    let m = &v["compactMetadata"];
                    let block =
                        CvBlock::Compact { trigger: m["trigger"].as_str().map(str::to_string), pre_tokens: m["preTokens"].as_u64() };
                    p.msg = Some(sys("compact", vec![CvBlock::Text { text: "Conversation compacted".into() }, block]));
                    return p;
                }
                "turn_duration" => {
                    let Some(ms) = v["durationMs"].as_u64() else { return p };
                    p.msg = Some(sys("duration", vec![CvBlock::Duration { ms, messages: v["messageCount"].as_u64().map(|n| n as u32) }]));
                    return p;
                }
                "stop_hook_summary" => {
                    if let Some(b) = cv_parse::stop_hook_summary(v) {
                        p.msg = Some(sys("hook", vec![b]));
                    }
                    return p;
                }
                "informational" | "scheduled_task_fire" | "bridge_status" | "api_error" | "away_summary" if !text.is_empty() => {
                    ("notice", text.to_string())
                }
                "local_command" => {
                    let out =
                        strip_ansi(between(text, "<local-command-stdout>", "</local-command-stdout>").unwrap_or(text)).trim().to_string();
                    if out.is_empty() {
                        return p;
                    }
                    p.effort = effort_from_output(&out);
                    ("output", out)
                }
                _ => return p,
            };
            p.msg = Some(sys(kind, vec![CvBlock::Text { text: clip(&text, MAX_TEXT) }]));
        }
        "assistant" => {
            let m = &v["message"];
            if let Some(e) = cv_parse::api_error(v) {
                p.msg = Some(sys("error", vec![e]));
                return p;
            }
            let model = m["model"].as_str().filter(|m| !m.starts_with('<')).map(str::to_string);
            if let Some(u) = m.get("usage").filter(|u| u.is_object()) {
                let n = |k: &str| u[k].as_u64().unwrap_or(0);
                let total = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
                if total > 0 {
                    p.context = Some(total);
                }
            }
            p.model = model.clone();
            let think_ms = v["thinkingDurationMs"].as_u64();
            let mut blocks = vec![];
            for b in m["content"].as_array().into_iter().flatten() {
                match b["type"].as_str() {
                    Some("text") => {
                        let t = b["text"].as_str().unwrap_or("");
                        if !t.trim().is_empty() && t.trim() != "No response requested." {
                            blocks.push(CvBlock::Text { text: t.to_string() });
                        }
                    }
                    Some("thinking") => {
                        blocks.push(CvBlock::Thinking { text: b["thinking"].as_str().unwrap_or("").to_string(), ms: think_ms })
                    }
                    Some("tool_use") => {
                        let (id, name) = (b["id"].as_str().unwrap_or("").to_string(), b["name"].as_str().unwrap_or("").to_string());
                        let input = clip_value(&b["input"]);
                        p.tool_uses.push((id.clone(), name.clone(), input.clone()));
                        blocks.push(CvBlock::ToolUse { id, name, input });
                    }
                    _ => {}
                }
            }
            blocks.extend(cv_parse::refusal(m));
            if blocks.is_empty() {
                return p;
            }
            let id = m["id"].as_str().or(v["uuid"].as_str()).unwrap_or("").to_string();
            p.msg = Some(CvMessage { i: off, id, role: CvRole::Assistant, ts: millis(v), model, kind: None, blocks, ..Default::default() });
        }
        "user" => {
            let id = uuid.clone();
            let c = &v["message"]["content"];
            if v["isMeta"].as_bool() == Some(true) {
                // Only messages from another agent; the rest is the CLI talking to the model.
                let o = &v["origin"];
                if o["kind"] == "peer" {
                    let text = o["body"].as_str().or(c.as_str()).unwrap_or("").to_string();
                    if !text.trim().is_empty() {
                        let mut m = sys("peer", vec![CvBlock::Text { text: clip(&text, MAX_TEXT) }]);
                        m.from = o["senderTaskId"].as_str().or(o["from"].as_str()).map(str::to_string);
                        m.from_name = o["name"].as_str().or(o["from"].as_str()).map(str::to_string);
                        p.msg = Some(m);
                    }
                }
                return p;
            }
            let mk = |kind: Option<&str>, blocks: Vec<CvBlock>| CvMessage {
                i: off,
                id: id.clone(),
                role: CvRole::User,
                ts: millis(v),
                model: None,
                kind: kind.map(str::to_string),
                blocks,
                ..Default::default()
            };
            // A one-text-block array reads like a string.
            let single = c.as_array().filter(|a| a.len() == 1 && a[0]["type"] == "text").and_then(|a| a[0]["text"].as_str());
            if let Some(s) = c.as_str().or(single) {
                if v["isCompactSummary"].as_bool() == Some(true) {
                    p.msg = Some(mk(Some("summary"), vec![CvBlock::Text { text: clip(s, MAX_TEXT) }]));
                } else if s.trim_start().starts_with("<task-notification>") {
                    if let Some(b) = cv_parse::task_notification(s) {
                        p.msg = Some(sys("task", vec![b]));
                    }
                } else if let Some(sh) = cv_parse::shell_line(s) {
                    match sh {
                        ShellLine::Input(command) => {
                            p.msg = Some(mk(Some("shell"), vec![CvBlock::Shell { command, stdout: None, stderr: None }]))
                        }
                        ShellLine::Output { stdout, stderr } => {
                            p.shell_out = Some((v["parentUuid"].as_str().unwrap_or("").to_string(), stdout.clone(), stderr.clone()));
                            p.msg = Some(mk(Some("shell"), vec![CvBlock::Shell { command: String::new(), stdout, stderr }]));
                        }
                    }
                } else if let Some(name) = between(s, "<command-name>", "</command-name>") {
                    let args = between(s, "<command-args>", "</command-args>").unwrap_or("").trim();
                    let line = if args.is_empty() { name.to_string() } else { format!("{name} {args}") };
                    p.msg = Some(mk(Some("command"), vec![CvBlock::Text { text: line }]));
                } else if let Some(out) = between(s, "<local-command-stdout>", "</local-command-stdout>") {
                    let out = strip_ansi(out).trim().to_string();
                    p.effort = effort_from_output(&out);
                    if !out.is_empty() {
                        p.msg = Some(mk(Some("output"), vec![CvBlock::Text { text: clip(&out, MAX_TEXT) }]));
                    }
                } else if s.starts_with("[Request interrupted") {
                    p.msg = Some(sys("notice", vec![CvBlock::Text { text: "Interrupted".into() }]));
                } else if !s.trim().is_empty() && !s.starts_with("<system-reminder>") {
                    let blocks = cv_parse::split_pasted(s).unwrap_or_else(|| vec![CvBlock::Text { text: s.to_string() }]);
                    p.msg = Some(mk(None, blocks));
                }
            } else if let Some(a) = c.as_array() {
                let images = cv_image::images_in(c);
                let results = a.iter().filter(|b| b["type"] == "tool_result").count();
                let mut blocks = vec![];
                for b in a {
                    match b["type"].as_str() {
                        Some("text") => {
                            let t = b["text"].as_str().unwrap_or("");
                            if !t.trim().is_empty() && !t.starts_with("<system-reminder>") && !t.starts_with("[Request interrupted") {
                                match cv_parse::split_pasted(t) {
                                    Some(bs) => blocks.extend(bs),
                                    None => blocks.push(CvBlock::Text { text: t.to_string() }),
                                }
                            } else if t.starts_with("[Request interrupted") {
                                p.msg = Some(sys("notice", vec![CvBlock::Text { text: "Interrupted".into() }]));
                                return p;
                            }
                        }
                        Some("image") => blocks.push(CvBlock::Image {
                            media_type: b["source"]["media_type"].as_str().unwrap_or("image").to_string(),
                            image: cv_image::index_of(&images, b).and_then(|n| cv_image::image_ref(b, off, n)),
                            url: cv_image::image_url(b),
                        }),
                        Some("tool_result") => {
                            let (text, images) = tool_result_content(&b["content"], &images, off);
                            let stopped = text.starts_with("[Tool call interrupted") || text.starts_with("[Request interrupted");
                            let tool_use_id = b["tool_use_id"].as_str().unwrap_or("").to_string();
                            let is_error = !stopped && b["is_error"].as_bool().unwrap_or(false);
                            // `toolUseResult` belongs to the line: only clear with one result in it.
                            let r = if results == 1 { v["toolUseResult"].clone() } else { Value::Null };
                            p.tool_results.push((tool_use_id.clone(), r.clone(), is_error));
                            blocks.push(CvBlock::ToolResult {
                                tool_use_id,
                                text: if stopped { "Interrupted by user".into() } else { text },
                                is_error,
                                images,
                                meta: cv_parse::tool_meta(&r),
                            })
                        }
                        _ => {}
                    }
                }
                if !blocks.is_empty() {
                    p.msg = Some(mk(None, blocks));
                }
            }
        }
        _ => {}
    }
    p
}

impl TailState {
    /// Adds a message; an existing id (an assistant message arrives block by block) is extended.
    fn add(&mut self, mut m: CvMessage) -> CvMessage {
        if let Some(&ix) = self.by_id.get(&m.id)
            && !m.id.is_empty()
        {
            let cur = &mut self.msgs[ix];
            for b in m.blocks.drain(..) {
                if !cur.blocks.contains(&b) {
                    cur.blocks.push(b);
                }
            }
            return cur.clone();
        }
        if !m.id.is_empty() {
            self.by_id.insert(m.id.clone(), self.msgs.len());
        }
        self.msgs.push(m.clone());
        if self.msgs.len() > KEEP {
            self.msgs.drain(..KEEP / 4);
            self.more = true;
            self.by_id = self.msgs.iter().enumerate().filter(|(_, m)| !m.id.is_empty()).map(|(i, m)| (m.id.clone(), i)).collect();
        }
        m
    }

    /// The effort shown on the screen: a new value there wins (the CLI's status line is live).
    fn see_effort(&mut self, effort: Option<&str>) -> bool {
        let Some(e) = effort else { return false };
        if self.screen_effort.as_deref() == Some(e) {
            return false;
        }
        self.screen_effort = Some(e.to_string());
        self.effort_seen = true;
        let changed = self.meta.effort.as_deref() != Some(e);
        self.meta.effort = Some(e.to_string());
        changed
    }

    /// Feeds whole lines starting at file position `base`.
    fn feed(&mut self, data: &[u8], base: u64) -> (Vec<CvEvent>, bool) {
        let mut events = vec![];
        let mut meta_changed = false;
        let mut pos = 0usize;
        while let Some(nl) = data[pos..].iter().position(|b| *b == b'\n') {
            let line = &data[pos..pos + nl];
            let off = base + pos as u64;
            pos += nl + 1;
            if line.is_empty() || line.len() > 12 << 20 {
                continue;
            }
            let Ok(v) = serde_json::from_slice::<Value>(line) else { continue };
            let p = parse_line_in(&v, off, self.sidechain);
            let ts = millis(&v);
            if let Some(m) = p.mode {
                meta_changed |= self.meta.mode.as_ref() != Some(&m);
                self.meta.mode = Some(m);
            }
            if let Some(t) = p.title {
                meta_changed |= self.meta.title.as_ref() != Some(&t);
                self.meta.title = Some(t);
            }
            if let Some(t) = p.session_name {
                meta_changed |= self.meta.session_name.as_ref() != Some(&t);
                self.meta.session_name = Some(t);
            }
            if let Some(f) = p.plan_file {
                meta_changed |= self.meta.plan_file.as_ref() != Some(&f);
                self.meta.plan_file = Some(f);
            }
            if let Some(m) = p.model {
                meta_changed |= self.meta.model.as_ref() != Some(&m);
                self.meta.model = Some(m);
            }
            if let Some(c) = p.context {
                meta_changed |= self.meta.context_tokens != Some(c);
                self.meta.context_tokens = Some(c);
            }
            if let Some(e) = p.effort {
                self.effort_seen = !e.is_empty();
                let e = Some(e).filter(|e| !e.is_empty());
                meta_changed |= self.meta.effort != e;
                self.meta.effort = e;
            }
            for (n, d) in p.skills {
                self.skills.insert(n, d);
            }
            match p.queue {
                Some(QueueOp::Add(text)) => {
                    self.meta.queued.push(CvQueued { text: clip(&text, 2000), ts });
                    if self.meta.queued.len() > 50 {
                        self.meta.queued.remove(0);
                    }
                    meta_changed = true;
                }
                Some(QueueOp::Take(text)) if !self.meta.queued.is_empty() => {
                    let ix = text.and_then(|t| self.meta.queued.iter().position(|q| q.text == clip(&t, 2000))).unwrap_or(0);
                    self.meta.queued.remove(ix);
                    meta_changed = true;
                }
                _ => {}
            }
            if !self.sidechain {
                for (id, name, input) in &p.tool_uses {
                    self.tasks.tool_use(name, id, input, ts);
                    if let Some(op) = cv_parse::todo_from_tool_use(name, id, input) {
                        cv_parse::apply_todo(&mut self.meta.todos, &mut self.todo_pending, op);
                        meta_changed = true;
                    }
                    if matches!(name.as_str(), "AskUserQuestion" | "ExitPlanMode") {
                        self.asking.push((id.clone(), name.clone(), input.clone()));
                        if self.asking.len() > 8 {
                            self.asking.remove(0);
                        }
                    }
                }
                for (tool_use_id, r, is_error) in &p.tool_results {
                    self.tasks.tool_result(tool_use_id, r, *is_error, ts);
                    if let Some(op) = cv_parse::todo_created(tool_use_id, r) {
                        cv_parse::apply_todo(&mut self.meta.todos, &mut self.todo_pending, op);
                        meta_changed = true;
                    }
                    self.asking.retain(|(id, _, _)| id != tool_use_id);
                }
                if let Some(a) = &p.task_status {
                    self.tasks.status_attachment(a);
                }
                if let Some(m) = &p.msg
                    && let Some(b @ CvBlock::TaskNote { .. }) = m.blocks.first()
                {
                    self.tasks.note(b, ts);
                }
            }
            if let Some(id) = p.checkpoint {
                match self.by_id.get(&id).copied() {
                    Some(ix) if self.msgs[ix].checkpoint.is_none() => {
                        self.msgs[ix].checkpoint = Some(true);
                        events.push(CvEvent::Upsert { message: self.msgs[ix].clone() });
                    }
                    Some(_) => {}
                    None => self.checkpoints_ahead(id),
                }
            }
            // `!` output: into the input's message when it is loaded.
            if let Some((parent, stdout, stderr)) = &p.shell_out
                && let Some(&ix) = self.by_id.get(parent)
                && let Some(CvBlock::Shell { stdout: o, stderr: e, .. }) = self.msgs[ix].blocks.first_mut()
            {
                *o = stdout.clone();
                *e = stderr.clone();
                events.push(CvEvent::Upsert { message: self.msgs[ix].clone() });
                continue;
            }
            if let Some(mut m) = p.msg {
                if m.role == CvRole::User && m.kind.is_none() {
                    if self.pending_checkpoints.remove(&m.id) {
                        m.checkpoint = Some(true);
                    }
                    // A queued message was delivered.
                    if let Some(CvBlock::Text { text }) = m.blocks.first()
                        && let Some(ix) = self.meta.queued.iter().position(|q| text.trim() == q.text.trim())
                    {
                        self.meta.queued.remove(ix);
                        meta_changed = true;
                    }
                }
                let full = self.add(m);
                events.push(CvEvent::Upsert { message: full });
            }
        }
        self.offset = base + pos as u64;
        // Not set in this session: the default from the settings, for the model in use.
        if !self.effort_seen
            && let Some(dir) = claude_dir()
        {
            let e = settings_effort(&dir, self.meta.model.as_deref());
            meta_changed |= self.meta.effort != e;
            self.meta.effort = e;
        }
        let running = (!self.tasks.is_empty()).then(|| self.tasks.running());
        if self.meta.tasks_running != running {
            self.meta.tasks_running = running;
            meta_changed = true;
        }
        (events, meta_changed)
    }

    /// A checkpoint line can come before its message.
    fn checkpoints_ahead(&mut self, id: String) {
        if self.pending_checkpoints.len() > 500 {
            self.pending_checkpoints.clear();
        }
        self.pending_checkpoints.insert(id);
    }

    fn page(&self) -> Vec<CvMessage> {
        self.msgs[self.msgs.len().saturating_sub(PAGE)..].to_vec()
    }
    fn more_before(&self) -> bool {
        self.more || self.msgs.len() > PAGE
    }

    /// Reads what was appended (or loads the end of the file the first time).
    fn poll(&mut self) -> Vec<CvEvent> {
        let Some(path) = self.path.clone() else { return vec![] };
        let Ok(mut f) = std::fs::File::open(&path) else { return vec![] };
        let Ok(len) = f.metadata().map(|m| m.len()) else { return vec![] };
        let mut events = vec![];
        let mut reset = false;
        if !self.started || len < self.offset {
            reset = true;
            let start = len.saturating_sub(INITIAL_BYTES);
            self.msgs.clear();
            self.by_id.clear();
            self.skills.clear();
            self.meta = CvMeta {
                transcript: path.file_name().map(|n| n.to_string_lossy().into_owned()),
                actions: (!self.sidechain).then_some(true),
                ..Default::default()
            };
            self.effort_seen = false;
            self.screen_effort = None;
            self.tasks = Tasks::default();
            self.todo_pending.clear();
            self.asking.clear();
            self.pending_checkpoints.clear();
            if let Some(st) = self.status.clone() {
                apply_status(&mut self.meta, &st);
            }
            self.more = start > 0;
            self.offset = start;
            self.started = true;
            if start > 0 {
                // Begin at a whole line.
                let mut buf = vec![0u8; 64 << 10];
                let _ = f.seek(SeekFrom::Start(start));
                let n = f.read(&mut buf).unwrap_or(0);
                self.offset = start + buf[..n].iter().position(|b| *b == b'\n').map(|i| i as u64 + 1).unwrap_or(0);
                // The skill list comes early in a session: read it from the part not loaded.
                for (n, d) in head_skills(&mut f, start) {
                    self.skills.entry(n).or_insert(d);
                }
            }
        }
        if len <= self.offset && !reset {
            return events;
        }
        let mut data = Vec::with_capacity((len - self.offset.min(len)) as usize);
        if f.seek(SeekFrom::Start(self.offset)).is_err() || f.take(len - self.offset.min(len)).read_to_end(&mut data).is_err() {
            return events;
        }
        let base = self.offset;
        let (evs, meta_changed) = self.feed(&data, base);
        if reset {
            // Skills seen while loading are reachable through `cv_commands`; send one reset.
            events.push(CvEvent::Reset { messages: self.page(), more: self.more_before(), meta: self.meta.clone() });
            if !self.sidechain {
                self.tasks.clear_dirty();
                self.tasks.last_sent = Some(Instant::now());
                events.push(CvEvent::Tasks { tasks: self.tasks.list() });
            }
        } else {
            events.extend(evs);
            if meta_changed {
                events.push(CvEvent::Meta { meta: self.meta.clone() });
            }
            events.extend(self.tasks_event(false));
        }
        events
    }

    /// The task list when it changed (at most every `TASKS_EVERY` unless `now`).
    fn tasks_event(&mut self, now: bool) -> Option<CvEvent> {
        if self.sidechain || !self.tasks.dirty() {
            return None;
        }
        if !now && self.tasks.last_sent.is_some_and(|t| t.elapsed() < TASKS_EVERY) {
            return None;
        }
        self.tasks.clear_dirty();
        self.tasks.last_sent = Some(Instant::now());
        Some(CvEvent::Tasks { tasks: self.tasks.list() })
    }

    /// The prompt on the screen with what the transcript and hooks know about it.
    fn enrich(&self, p: Option<CvPrompt>) -> Option<CvPrompt> {
        let mut p = p?;
        let mut kind = cv_screen::classify(&p);
        let asking = self.asking.last();
        if let Some((id, name, input)) = asking
            && name == "AskUserQuestion"
            && kind != "permission"
        {
            kind = "question";
            p.question = Some(question_of(id, input));
        }
        if let Some((_, name, input)) = asking
            && name == "ExitPlanMode"
            && (kind == "plan" || kind == "menu" || kind == "permission")
        {
            kind = "plan";
            p.plan = input["plan"].as_str().map(str::to_string);
        }
        if kind == "permission" {
            p.tool = self.perm.clone();
        }
        p.kind = Some(kind.into());
        p.id = Some(cv_screen::fingerprint(&p));
        Some(p)
    }
}

/// AskUserQuestion's input → the question sheet.
fn question_of(tool_use_id: &str, input: &Value) -> CvQuestion {
    let str_of = |v: &Value| v.as_str().unwrap_or("").to_string();
    CvQuestion {
        questions: input["questions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|q| CvQuestionItem {
                question: str_of(&q["question"]),
                header: str_of(&q["header"]),
                multi_select: q["multiSelect"].as_bool().unwrap_or(false),
                options: q["options"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|o| CvQuestionOption { label: str_of(&o["label"]), description: str_of(&o["description"]) })
                    .collect(),
            })
            .collect(),
        tab: None,
        tool_use_id: Some(tool_use_id.to_string()),
    }
}

/// Claude Code's statusline input → meta. Returns whether anything but the durations changed.
fn apply_status(meta: &mut CvMeta, v: &Value) -> bool {
    let before = meta.clone();
    let st = |p: &str| v.pointer(p).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    let num = |p: &str| v.pointer(p).and_then(Value::as_u64);
    if let Some(m) = st("/model/id") {
        meta.model = Some(m);
    }
    meta.context_window = num("/context_window/context_window_size").or(meta.context_window);
    if let Some(p) = v.pointer("/context_window/used_percentage").and_then(Value::as_f64) {
        meta.context_pct = Some(p as f32);
    }
    if let Some(u) = v.pointer("/context_window/current_usage").filter(|u| u.is_object()) {
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let total = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
        if total > 0 {
            meta.context_tokens = Some(total);
        }
    }
    meta.cost_usd = v.pointer("/cost/total_cost_usd").and_then(Value::as_f64).or(meta.cost_usd);
    meta.duration_ms = num("/cost/total_duration_ms").or(meta.duration_ms);
    meta.api_duration_ms = num("/cost/total_api_duration_ms").or(meta.api_duration_ms);
    meta.lines_added = num("/cost/total_lines_added").or(meta.lines_added);
    meta.lines_removed = num("/cost/total_lines_removed").or(meta.lines_removed);
    if let Some(f) = v["fast_mode"].as_bool() {
        meta.fast = Some(f);
    }
    if let Some(t) = v.pointer("/thinking/enabled").and_then(Value::as_bool) {
        meta.thinking = Some(t);
    }
    meta.output_style = st("/output_style/name").or(meta.output_style.take());
    meta.session_name = st("/session_name").or(meta.session_name.take());
    meta.version = st("/version").or(meta.version.take());
    if let Some(w) = v.get("worktree").filter(|w| w.is_object()) {
        meta.worktree = Some(CvWorktree {
            name: w["name"].as_str().unwrap_or("").into(),
            path: w["path"].as_str().unwrap_or("").into(),
            branch: w["branch"].as_str().map(str::to_string),
            original_cwd: w["original_cwd"].as_str().map(str::to_string),
        });
    }
    if let Some(n) = num("/pr/number") {
        meta.pr = Some(CvPr { number: n as u32, url: st("/pr/url").unwrap_or_default(), state: st("/pr/review_state") });
    }
    if let Some(d) = v.pointer("/workspace/added_dirs").and_then(Value::as_array) {
        meta.added_dirs = d.iter().filter_map(|x| x.as_str().map(str::to_string)).collect();
    }
    // The session's running time grows with every call: alone it is not worth an update.
    let mut cmp = meta.clone();
    (cmp.duration_ms, cmp.api_duration_ms) = (before.duration_ms, before.api_duration_ms);
    cmp != before
}

// ───────────── the menu on the screen ─────────────

fn menu_line(line: &str) -> Option<(bool, String, String)> {
    let t = line.trim().trim_matches('│').trim();
    let (selected, rest) = match t.strip_prefix('❯').or_else(|| t.strip_prefix('›')).or_else(|| t.strip_prefix('>')) {
        Some(r) => (true, r.trim_start()),
        None => (false, t),
    };
    let (num, label) = rest.split_once(". ")?;
    if num.is_empty() || num.len() > 2 || !num.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((selected, num.to_string(), label.trim().trim_end_matches('│').trim().to_string()))
}

fn is_rule(t: &str) -> bool {
    t.chars().count() >= 3 && t.chars().all(|c| "─━═╌╍┄┅┈┉-_".contains(c))
}

fn is_border(l: &str) -> bool {
    let t = l.trim();
    t.is_empty() || t.chars().all(|c| "─━═╌╍┄┅┈┉│┃╭╮╰╯┌┐└┘├┤ -".contains(c))
}

/// The numbered menu at the bottom of the screen (permission, question, plan, `/model`, …).
/// Only menus with a `❯` pointer count, so a numbered list in the assistant's output is not one.
pub fn detect_prompt(screen: &str) -> Option<CvPrompt> {
    let lines: Vec<&str> = screen.lines().collect();
    let last = lines.iter().rposition(|l| !is_border(l))?;
    let from = last.saturating_sub(24);
    // The last run of consecutive menu lines.
    let mut end = None;
    for i in (from..=last).rev() {
        if menu_line(lines[i]).is_some() {
            end = Some(i);
            break;
        }
    }
    let end = end?;
    let mut start = end;
    while start > from {
        let prev = lines[start - 1];
        if menu_line(prev).is_some() || (start >= 2 && menu_line(lines[start - 2]).is_some() && !is_border(prev) && prev.starts_with("   "))
        {
            start -= 1;
        } else {
            break;
        }
    }
    let mut options: Vec<CvOption> = vec![];
    for l in &lines[start..=end] {
        if let Some((selected, n, label)) = menu_line(l) {
            let (checked, label) = cv_screen::checkbox(&label);
            let text = cv_screen::wants_text(&label).then_some(true);
            options.push(CvOption { n, label, selected, checked, text, ..Default::default() });
        } else if let Some(o) = options.last_mut() {
            // An indented line between options describes the one above.
            let d = l.trim().trim_matches('│').trim().to_string();
            o.description = Some(match o.description.take() {
                Some(p) => format!("{p}\n{d}"),
                None => d,
            });
        }
    }
    if options.len() < 2 || !options.iter().any(|o| o.selected) || options[0].n != "1" {
        return None;
    }
    // Only the footer (hints) may follow the options.
    if lines[end + 1..=last].iter().filter(|l| !is_border(l)).count() > 3 {
        return None;
    }
    // The question: the lines above the options, up to the nearest solid rule (the box's top
    // edge). Blank lines inside are kept. A dashed box holds the command or diff itself: it is
    // kept between ``` lines, and reading goes on above it.
    let mut title: Vec<String> = vec![];
    for l in lines[..start].iter().rev().take(28) {
        let t = l.trim().trim_matches('│').trim();
        if t.is_empty() {
            if !title.is_empty() {
                title.push(String::new());
            }
            continue;
        }
        if t.chars().count() >= 3 && t.chars().all(|c| "╌╍┄┅┈┉".contains(c)) {
            title.push("```".into());
            continue;
        }
        if is_rule(t) || is_border(l) {
            if title.is_empty() {
                continue;
            }
            break;
        }
        title.push(t.to_string());
        if title.len() >= 20 {
            break;
        }
    }
    while title.last().is_some_and(|l| l.is_empty()) {
        title.pop();
    }
    title.reverse();
    while title.first().is_some_and(|l| l.is_empty()) {
        title.remove(0);
    }
    if title.iter().filter(|l| *l == "```").count() % 2 == 1 {
        // Cut off at the top: the opening fence is missing.
        title.insert(0, "```".into());
    }
    Some(CvPrompt { title: title.join("\n"), options, ..Default::default() })
}

/// "✶ Roosting… (12s · esc to interrupt)" → the status text, while the CLI is busy. With a
/// statusline the CLI leaves out "esc to interrupt": the spinner glyph and "…" are enough.
pub fn detect_activity(screen: &str) -> Option<String> {
    cv_screen::spinner(screen)
}

/// The permission mode shown in the CLI's footer ("⏸ plan mode on", "⏵⏵ accept edits on", …).
pub fn detect_mode(screen: &str) -> Option<&'static str> {
    let tail: Vec<&str> = screen.lines().rev().take(8).collect();
    let has = |needle: &str| tail.iter().any(|l| l.to_lowercase().contains(needle));
    if has("plan mode on") {
        Some("plan")
    } else if has("accept edits on") {
        Some("acceptEdits")
    } else if has("bypass permissions on") {
        Some("bypassPermissions")
    } else if has("auto mode on") {
        Some("auto")
    } else if has("don't ask on") || has("don\u{2019}t ask on") || has("dontask mode on") {
        Some("dontAsk")
    } else if has("manual mode on") || has("? for shortcuts") || has("shift+tab to cycle") {
        Some("default")
    } else {
        None
    }
}

// ───────────── slash commands, files ─────────────

pub fn claude_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".claude")))
}

/// The file is inside Claude Code's config dir (after resolving links).
fn in_claude_dir(p: &Path) -> bool {
    claude_dir().and_then(|d| d.canonicalize().ok()).zip(p.canonicalize().ok()).is_some_and(|(d, p)| p.starts_with(d))
}

/// Where `cv_file` / `cv_task_output` may read: Claude's session, plan and task folders, the
/// CLI's temp folders (`<tmp>/claude-*`) and Markdown files of the project (a plans folder there).
struct ReadRoots {
    dirs: Vec<PathBuf>,
    temps: Vec<PathBuf>,
    project: Option<PathBuf>,
}

fn read_roots(cwd: Option<&str>) -> ReadRoots {
    let canon = |p: PathBuf| p.canonicalize().ok();
    ReadRoots {
        dirs: claude_dir().iter().flat_map(|c| ["projects", "plans", "tasks"].map(|d| c.join(d))).filter_map(canon).collect(),
        temps: [std::env::temp_dir(), PathBuf::from("/tmp")].into_iter().filter_map(canon).collect(),
        project: cwd.filter(|c| !c.is_empty()).map(PathBuf::from).and_then(canon),
    }
}

/// `path` resolved (symlinks too) when it is a regular file inside the roots; `None` otherwise.
fn confined(path: &Path, r: &ReadRoots) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let real = path.canonicalize().ok()?;
    if !std::fs::metadata(&real).ok()?.is_file() {
        return None;
    }
    let in_temp = r.temps.iter().any(|t| {
        real.strip_prefix(t)
            .ok()
            .and_then(|rest| rest.components().next())
            .is_some_and(|c| c.as_os_str().to_string_lossy().starts_with("claude-"))
    });
    let in_project = r.project.as_ref().is_some_and(|p| real.starts_with(p)) && real.extension().is_some_and(|e| e == "md");
    (r.dirs.iter().any(|d| real.starts_with(d)) || in_temp || in_project).then_some(real)
}

/// A text file, at most `max` bytes: its end (`tail`) or its start.
fn read_text(path: &Path, max: u64, tail: bool) -> Result<CvTextResult, ApiError> {
    // Check before opening: opening a FIFO would block.
    let meta = std::fs::metadata(path).map_err(|_| err(ErrorCode::NotFound, "the file is gone"))?;
    if !meta.is_file() {
        return Err(err(ErrorCode::BadRequest, "not a file"));
    }
    let mut f = std::fs::File::open(path).map_err(|_| err(ErrorCode::NotFound, "the file is gone"))?;
    let size = meta.len();
    let start = if tail { size.saturating_sub(max) } else { 0 };
    f.seek(SeekFrom::Start(start)).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    let mut buf = vec![];
    f.take(max).read_to_end(&mut buf).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    let text = strip_ansi(&String::from_utf8_lossy(&buf));
    // Cut at a whole line where the read started in the middle.
    let text = match text.split_once('\n') {
        Some((_, rest)) if start > 0 && !rest.is_empty() => rest.to_string(),
        _ => text,
    };
    Ok(CvTextResult { text, truncated: size > max, size })
}

/// Skills listed in the first part of a transcript (up to `upto`, at most 2 MB).
fn head_skills(f: &mut std::fs::File, upto: u64) -> Vec<(String, String)> {
    let mut buf = vec![];
    if f.seek(SeekFrom::Start(0)).is_err() || f.take(upto.min(2 << 20)).read_to_end(&mut buf).is_err() {
        return vec![];
    }
    buf.split(|b| *b == b'\n')
        .filter(|l| l.windows(13).any(|w| w == b"skill_listing"))
        .filter_map(|l| serde_json::from_slice::<Value>(l).ok())
        .flat_map(|v| parse_line_in(&v, 0, false).skills)
        .collect()
}

fn project_dir_name(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// Files below `root` for `@`: git's list when it is a repository, else a bounded walk.
fn list_files(root: &Path) -> Vec<String> {
    if let Ok(out) = std::process::Command::new("git")
        .args(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        && out.status.success()
        && !out.stdout.is_empty()
    {
        return out
            .stdout
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .take(60_000)
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect();
    }
    let mut out = vec![];
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "target" | "dist" | "build" | "__pycache__") {
                continue;
            }
            let p = e.path();
            if p.is_dir() {
                if depth < 6 {
                    stack.push((p, depth + 1));
                }
            } else if let Ok(rel) = p.strip_prefix(root) {
                out.push(rel.to_string_lossy().into_owned());
            }
            if out.len() >= 30_000 {
                return out;
            }
        }
    }
    out
}

pub fn match_files(files: &[String], query: &str, limit: usize) -> Vec<String> {
    let q = query.to_lowercase();
    let mut scored: Vec<(i32, &String)> = files
        .iter()
        .filter_map(|f| {
            let l = f.to_lowercase();
            if q.is_empty() {
                return Some((-(f.matches('/').count() as i32), f));
            }
            let base = l.rsplit('/').next().unwrap_or(&l);
            if base.starts_with(&q) {
                Some((1000 - l.len() as i32, f))
            } else if base.contains(&q) {
                Some((800 - l.len() as i32, f))
            } else if l.contains(&q) {
                Some((500 - l.len() as i32, f))
            } else {
                // characters in order
                let mut it = l.chars();
                q.chars().all(|c| it.any(|x| x == c)).then_some((100 - l.len() as i32, f))
            }
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));
    scored.into_iter().take(limit).map(|(_, f)| f.clone()).collect()
}

fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("file");
    let cleaned: String =
        base.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect();
    let cleaned = cleaned.trim_start_matches('.');
    let cleaned: String = cleaned.chars().take(80).collect();
    if cleaned.is_empty() { "file".into() } else { cleaned }
}

const UPLOAD_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "pdf", "txt", "md"];

// ───────────── Core glue ─────────────

impl Core {
    fn cv_tail(&self, sid: &Id) -> Arc<Tail> {
        self.cv
            .tails
            .lock()
            .entry(sid.clone())
            .or_insert_with(|| {
                let st = TailState { meta: CvMeta { actions: Some(true), ..Default::default() }, ..Default::default() };
                Arc::new(Tail { tx: broadcast::channel(512).0, st: Mutex::new(st) })
            })
            .clone()
    }

    /// A hook told us where the session's transcript is (it changes after `/clear` and `/resume`).
    pub fn cv_note_path(&self, sid: &Id, path: &str) {
        // Only Claude's own transcripts (`<config dir>/**/*.jsonl`): a hook payload must not point the reader elsewhere.
        if !in_claude_dir(Path::new(path)) || Path::new(path).extension().is_none_or(|e| e != "jsonl") {
            return;
        }
        let tail = self.cv_tail(sid);
        {
            let mut st = tail.st.lock();
            if st.path.as_deref() == Some(Path::new(path)) {
                drop(st);
                self.cv_poll(sid, &tail);
                return;
            }
            st.path = Some(PathBuf::from(path));
            st.started = false;
            st.offset = 0;
        }
        self.cv_poll(sid, &tail);
    }

    fn cv_guess_path(&self, sid: &Id, tail: &Tail) {
        let mut st = tail.st.lock();
        if st.path.is_some() {
            return;
        }
        let Some((cwd, es)) = self.read(|s| s.sessions.get(sid).map(|x| (x.cwd.clone(), x.engine_session.clone()))) else { return };
        let (Some(es), Some(dir)) = (es, claude_dir()) else { return };
        let p = dir.join("projects").join(project_dir_name(&cwd)).join(format!("{es}.jsonl"));
        if p.exists() {
            st.path = Some(p);
        }
    }

    /// The main transcript of a session (guessed from its Claude session id when no hook said it yet).
    fn cv_main_path(&self, sid: &Id) -> Option<PathBuf> {
        let tail = self.cv_tail(sid);
        self.cv_guess_path(sid, &tail);
        tail.st.lock().path.clone()
    }

    /// The transcript file to read: the session's, or one of its subagents'.
    fn cv_path(&self, sid: &Id, agent: Option<&str>) -> Result<PathBuf, ApiError> {
        let main = self.cv_main_path(sid).ok_or_else(|| err(ErrorCode::NotFound, "no transcript yet"))?;
        match agent {
            None => Ok(main),
            Some(a) => {
                let p = cv_tasks::subagent_path(&main, a).ok_or_else(|| err(ErrorCode::BadRequest, "not an agent id"))?;
                if p.exists() { Ok(p) } else { Err(err(ErrorCode::NotFound, "this agent has no transcript")) }
            }
        }
    }

    /// Reads new transcript lines now and tells whoever is attached.
    fn cv_poll(&self, sid: &Id, tail: &Tail) {
        if tail.tx.receiver_count() == 0 {
            return;
        }
        let mut st = tail.st.lock();
        for e in st.poll() {
            let _ = tail.tx.send(e);
        }
        let _ = sid;
    }

    /// Whether Claude is working: the spinner (seen in the last moment), or a prompt was just
    /// submitted and the spinner is not drawn yet. Never while a menu waits for the user.
    fn cv_busy(&self, sid: &Id, st: &mut TailState, spinner: bool, prompt: bool) -> bool {
        if spinner {
            st.spinner_seen = Some(Instant::now());
        }
        if prompt {
            return false;
        }
        let recent = st.spinner_seen.is_some_and(|t| t.elapsed() < Duration::from_millis(1200));
        let just_sent = self
            .read(|s| s.sessions.get(sid).map(|x| (x.status, x.status_since)))
            .is_some_and(|(status, since)| status == AgentStatus::Working && now_ms() - since < 4000);
        spinner || recent || just_sent
    }

    /// Screen state into the tail: menu, activity, busy, mode, effort. Returns (prompt changed, meta changed).
    fn cv_screen_into(&self, sid: &Id, st: &mut TailState, screen: &str) -> (bool, bool) {
        let prompt = st.enrich(detect_prompt(screen).or_else(|| cv_screen::detect_menu(screen)));
        let activity = detect_activity(screen);
        let busy = Some(self.cv_busy(sid, st, activity.is_some(), prompt.is_some()));
        let mut meta_changed = st.see_effort(detect_effort(screen));
        if let Some(m) = detect_mode(screen)
            && st.meta.mode.as_deref() != Some(m)
        {
            st.meta.mode = Some(m.into());
            meta_changed = true;
        }
        if st.meta.activity != activity {
            st.meta.activity = activity;
            meta_changed = true;
        }
        if st.meta.busy != busy {
            st.meta.busy = busy;
            meta_changed = true;
        }
        if prompt.is_none() {
            st.perm = None;
        }
        let prompt_changed = st.prompt != prompt;
        st.prompt = prompt;
        (prompt_changed, meta_changed)
    }

    /// Once per tick: new lines, the menu / activity on the screen and the task list, for attached sessions.
    pub fn cv_tick(&self) {
        let tails: Vec<(Id, Arc<Tail>)> = self.cv.tails.lock().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (sid, tail) in tails {
            if tail.tx.receiver_count() == 0 {
                continue;
            }
            self.cv_guess_path(&sid, &tail);
            self.cv_poll(&sid, &tail);
            let screen = self.pty(&sid).map(|p| p.screen_text()).unwrap_or_default();
            let mut st = tail.st.lock();
            let (prompt_changed, meta_changed) = self.cv_screen_into(&sid, &mut st, &screen);
            if prompt_changed {
                let _ = tail.tx.send(CvEvent::Prompt { prompt: st.prompt.clone() });
            }
            // Subagent files: while something runs, or right after a SubagentStart hook.
            let scan_due =
                st.tasks.last_scan.is_none_or(|t| t.elapsed() > SCAN_EVERY) && (st.tasks.running() > 0 || st.tasks.last_scan.is_none());
            if scan_due && let Some(path) = st.path.clone() {
                st.tasks.scan(&path);
            }
            let running = (!st.tasks.is_empty()).then(|| st.tasks.running());
            let meta_changed = meta_changed || st.meta.tasks_running != running;
            st.meta.tasks_running = running;
            if meta_changed {
                let _ = tail.tx.send(CvEvent::Meta { meta: st.meta.clone() });
            }
            if let Some(e) = st.tasks_event(false) {
                let _ = tail.tx.send(e);
            }
        }
        // Subagent streams: new lines; dropped when nobody watches.
        let subs: Vec<((Id, String), Arc<Tail>)> = {
            let mut g = self.cv.subs.lock();
            g.retain(|_, t| t.tx.receiver_count() > 0);
            g.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        };
        for ((sid, _), tail) in subs {
            self.cv_poll(&sid, &tail);
        }
        let mut stt = self.cv.stt.lock();
        if stt.as_ref().is_some_and(|(_, used)| used.elapsed() > STT_KEEP) {
            *stt = None;
        }
    }

    /// Claude Code's statusline input: the live effort (`effort.level`, the surest source since the
    /// "◐ medium · /effort" hint is only shown now and then), context window, cost, worktree, PR…
    /// Kept even before anyone opened the Claude view (the statusline runs right at start).
    pub fn cv_status(&self, sid: &Id, payload: &Value) {
        let tail = self.cv_tail(sid);
        let mut st = tail.st.lock();
        let mut changed = apply_status(&mut st.meta, payload);
        st.status = Some(payload.clone());
        if let Some(level) = payload.pointer("/effort/level").and_then(Value::as_str)
            && let Some(level) = EFFORTS.iter().find(|e| **e == level).copied()
        {
            changed |= st.see_effort(Some(level));
        }
        if changed {
            let _ = tail.tx.send(CvEvent::Meta { meta: st.meta.clone() });
        }
    }

    /// Hooks the Claude view uses: the tool a permission prompt is about, subagent start/stop,
    /// the live subagent rows (`subagent-statusline`).
    pub fn cv_hook(&self, sid: &Id, event: &str, payload: &Value) {
        if !matches!(
            event,
            "PermissionRequest"
                | "PostToolUse"
                | "PostToolUseFailure"
                | "UserPromptSubmit"
                | "Stop"
                | "SubagentStart"
                | "SubagentStop"
                | "subagent-statusline"
        ) {
            return;
        }
        let tail = self.cv_tail(sid);
        let mut st = tail.st.lock();
        let text = |k: &str| payload[k].as_str().filter(|s| !s.is_empty()).map(str::to_string);
        match event {
            "PermissionRequest" => {
                st.perm = Some(CvPromptTool {
                    name: text("tool_name").unwrap_or_default(),
                    input: clip_value(&payload["tool_input"]),
                    tool_use_id: text("tool_use_id"),
                    agent_id: text("agent_id"),
                    agent: text("agent_type"),
                });
                return;
            }
            "PostToolUse" | "PostToolUseFailure" | "UserPromptSubmit" | "Stop" => {
                st.perm = None;
                return;
            }
            // Look at the subagent files on the next tick.
            "SubagentStart" => st.tasks.last_scan = None,
            "SubagentStop" => st.tasks.subagent_stop(payload, now_ms()),
            _ => {
                if let Some(t) = payload["tasks"].as_array() {
                    st.tasks.statusline(t);
                }
            }
        }
        let running = (!st.tasks.is_empty()).then(|| st.tasks.running());
        if st.meta.tasks_running != running {
            st.meta.tasks_running = running;
            let _ = tail.tx.send(CvEvent::Meta { meta: st.meta.clone() });
        }
        if let Some(e) = st.tasks_event(event == "SubagentStop") {
            let _ = tail.tx.send(e);
        }
    }

    pub fn cv_forget(&self, sid: &Id) {
        self.cv.tails.lock().remove(sid);
        self.cv.subs.lock().retain(|(s, _), _| s != sid);
        self.cv.action_locks.lock().remove(sid);
    }

    /// Attach: the current conversation and a receiver for what follows. With `agent`: that
    /// subagent's transcript (read-only, no prompts or tasks).
    pub fn cv_attach(&self, sid: &Id, agent: Option<&str>) -> Result<(CvAttachResult, broadcast::Receiver<CvEvent>), ApiError> {
        if self.read(|s| !s.sessions.contains_key(sid)) {
            return Err(err(ErrorCode::NotFound, "no such session"));
        }
        if let Some(a) = agent {
            let path = self.cv_path(sid, Some(a))?;
            let tail = self
                .cv
                .subs
                .lock()
                .entry((sid.clone(), a.to_string()))
                .or_insert_with(|| {
                    let st = TailState { path: Some(path), sidechain: true, ..Default::default() };
                    Arc::new(Tail { tx: broadcast::channel(512).0, st: Mutex::new(st) })
                })
                .clone();
            let mut st = tail.st.lock();
            let rx = tail.tx.subscribe();
            let _ = st.poll();
            let res = CvAttachResult { messages: st.page(), more: st.more_before(), meta: st.meta.clone(), prompt: None, tasks: vec![] };
            return Ok((res, rx));
        }
        let tail = self.cv_tail(sid);
        self.cv_guess_path(sid, &tail);
        let mut st = tail.st.lock();
        // Subscribe first, under the lock: nothing can slip between the snapshot and the stream.
        let rx = tail.tx.subscribe();
        // Events from this poll reach only the receivers that exist (us, after the snapshot).
        let _ = st.poll();
        if let Some(path) = st.path.clone() {
            st.tasks.scan(&path);
        }
        let screen = self.pty(sid).map(|p| p.screen_text()).unwrap_or_default();
        let _ = self.cv_screen_into(sid, &mut st, &screen);
        st.meta.tasks_running = (!st.tasks.is_empty()).then(|| st.tasks.running());
        st.tasks.clear_dirty();
        let res = CvAttachResult {
            messages: st.page(),
            more: st.more_before(),
            meta: st.meta.clone(),
            prompt: st.prompt.clone(),
            tasks: st.tasks.list(),
        };
        Ok((res, rx))
    }

    pub fn cv_history(&self, sid: &Id, before: u64, agent: Option<&str>) -> Result<CvHistoryResult, ApiError> {
        let path = self.cv_path(sid, agent)?;
        let mut f = std::fs::File::open(&path).map_err(|e| err(ErrorCode::NotFound, e.to_string()))?;
        let before = before.min(f.metadata().map(|m| m.len()).unwrap_or(0));
        let mut window = 2u64 << 20;
        loop {
            let start = before.saturating_sub(window);
            let mut buf = vec![0u8; (before - start) as usize];
            f.seek(SeekFrom::Start(start)).and_then(|_| f.read_exact(&mut buf)).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
            let mut skip = 0usize;
            if start > 0 {
                skip = buf.iter().position(|b| *b == b'\n').map(|i| i + 1).unwrap_or(buf.len());
            }
            let mut st = TailState { sidechain: agent.is_some(), ..Default::default() };
            let _ = st.feed(&buf[skip..], start + skip as u64);
            if st.msgs.len() >= PAGE / 2 || start == 0 || window >= 64 << 20 {
                let n = st.msgs.len();
                let msgs = st.msgs.split_off(n.saturating_sub(PAGE));
                let more = start > 0 || n > PAGE;
                return Ok(CvHistoryResult { messages: msgs, more });
            }
            window *= 4;
        }
    }

    /// The bytes of an image in the session's (or a subagent's) transcript (see `cv_image`).
    pub fn cv_image(&self, sid: &Id, id: &str, max: Option<u32>, agent: Option<&str>) -> Result<CvImageData, ApiError> {
        let path = self.cv_path(sid, agent)?;
        cv_image::serve(&path, id, max)
    }

    /// The prompt the session shows now (for actions).
    pub(crate) fn cv_current_prompt(&self, sid: &Id) -> Option<CvPrompt> {
        self.cv.tails.lock().get(sid).and_then(|t| t.st.lock().prompt.clone())
    }

    /// The text of a user prompt in the loaded conversation.
    pub(crate) fn cv_user_text(&self, sid: &Id, message_id: &str) -> Option<String> {
        let tail = self.cv.tails.lock().get(sid).cloned()?;
        let st = tail.st.lock();
        let m = st.msgs.iter().find(|m| m.id == message_id && m.role == CvRole::User)?;
        m.blocks.iter().find_map(|b| match b {
            CvBlock::Text { text } => Some(text.clone()),
            _ => None,
        })
    }

    /// The end of a background shell's output file. Agents: their final report (their output
    /// file is their transcript; open it with `cv_attach(sid, agent)`).
    pub fn cv_task_output(&self, sid: &Id, task: &str, max: Option<u32>) -> Result<CvTextResult, ApiError> {
        let t = {
            let tail = self.cv.tails.lock().get(sid).cloned().ok_or_else(|| err(ErrorCode::NotFound, "open the conversation first"))?;
            let st = tail.st.lock();
            st.tasks.get(task).cloned().ok_or_else(|| err(ErrorCode::NotFound, "no such task"))?
        };
        if t.kind == "agent" {
            let text = t.result.or(t.summary).or(t.label).unwrap_or_default();
            return Ok(CvTextResult { size: text.len() as u64, text, truncated: false });
        }
        let path = t.output_file.ok_or_else(|| err(ErrorCode::NotFound, "this task has no output file"))?;
        let real = self.cv_confined(sid, &path)?;
        read_text(&real, max.map(|m| m as u64).unwrap_or(64 << 10).min(MAX_READ), true)
    }

    /// A file the conversation named: the plan file, a saved full tool output, a task's output.
    /// Nothing else can be read this way.
    pub fn cv_file(&self, sid: &Id, path: &str) -> Result<CvTextResult, ApiError> {
        let named = {
            let tail = self.cv.tails.lock().get(sid).cloned().ok_or_else(|| err(ErrorCode::NotFound, "open the conversation first"))?;
            let st = tail.st.lock();
            st.meta.plan_file.as_deref() == Some(path)
                || st.tasks.list().iter().any(|t| t.output_file.as_deref() == Some(path))
                || st.msgs.iter().any(|m| {
                    m.blocks
                        .iter()
                        .any(|b| matches!(b, CvBlock::ToolResult { meta: Some(x), .. } if x.full_output.as_deref() == Some(path)))
                })
        };
        if !named {
            return Err(err(ErrorCode::Forbidden, "this file is not part of the conversation"));
        }
        read_text(&self.cv_confined(sid, path)?, MAX_READ, false)
    }

    /// A file the conversation named, if it is one the phone may read (see `ReadRoots`).
    fn cv_confined(&self, sid: &Id, path: &str) -> Result<PathBuf, ApiError> {
        let cwd = self.read(|s| s.sessions.get(sid).map(|x| x.cwd.clone()));
        confined(Path::new(path), &read_roots(cwd.as_deref()))
            .ok_or_else(|| err(ErrorCode::Forbidden, "this file is outside the conversation's folders"))
    }

    pub fn cv_commands(&self, sid: &Id) -> Vec<CvCommand> {
        let mut out = cv_commands::builtin();
        let cwd = self.read(|s| s.sessions.get(sid).map(|x| x.cwd.clone())).unwrap_or_default();
        if !cwd.is_empty() {
            cv_commands::collect_commands(&Path::new(&cwd).join(".claude/commands"), "", "project", &mut out, 0);
            cv_commands::collect_skills(&Path::new(&cwd).join(".claude/skills"), "", "skill", &mut out);
        }
        if let Some(c) = claude_dir() {
            cv_commands::collect_commands(&c.join("commands"), "", "user", &mut out, 0);
            cv_commands::collect_skills(&c.join("skills"), "", "skill", &mut out);
            cv_commands::collect_plugins(&c, &mut out);
        }
        // Skills (also from plugins and bundled ones) as the session itself listed them.
        if let Some(t) = self.cv.tails.lock().get(sid) {
            let have: HashSet<String> = out.iter().flat_map(|c| std::iter::once(c.name.clone()).chain(c.aliases.iter().cloned())).collect();
            for (n, d) in t.st.lock().skills.iter() {
                if !have.contains(n) {
                    let plugin = n.contains(':');
                    out.push(CvCommand {
                        name: n.clone(),
                        description: d.chars().take(160).collect(),
                        source: if plugin { "plugin" } else { "skill" }.into(),
                        group: Some(if plugin { "plugins" } else { "skills" }.into()),
                        kind: Some("prompt".into()),
                        ..Default::default()
                    });
                }
            }
        }
        // First one wins: built-in, then project, then user.
        let mut seen = HashSet::new();
        out.retain(|c| seen.insert(c.name.clone()));
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    pub fn cv_files(&self, sid: &Id, query: &str) -> Vec<String> {
        let Some(cwd) = self.read(|s| s.sessions.get(sid).map(|x| x.cwd.clone())) else { return vec![] };
        let files = list_files(Path::new(&cwd));
        match_files(&files, query, 40)
    }

    pub fn cv_upload(&self, sid: &Id, name: &str, data: &str) -> Result<UploadResult, na_protocol::ApiError> {
        if self.read(|s| !s.sessions.contains_key(sid)) {
            return Err(err(ErrorCode::NotFound, "no such session"));
        }
        store_upload(&self.paths.root, sid, name, data)
    }

    /// Speech to text with the local Parakeet model; blocks (run it on a blocking thread).
    pub fn cv_transcribe(&self, audio: &str) -> Result<TranscribeResult, na_protocol::ApiError> {
        if audio.len() > 16_000 * 2 * 120 * 4 / 3 + 16 {
            return Err(err(ErrorCode::BadRequest, "recording is longer than two minutes"));
        }
        let bytes =
            base64::engine::general_purpose::STANDARD.decode(audio.trim()).map_err(|_| err(ErrorCode::BadRequest, "not valid base64"))?;
        if bytes.len() > 16_000 * 2 * 120 {
            return Err(err(ErrorCode::BadRequest, "recording is longer than two minutes"));
        }
        let samples: Vec<f32> = bytes.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b) as f32 / 32768.0).collect();
        if samples.len() < 1600 {
            return Ok(TranscribeResult { text: String::new() });
        }
        let stt = {
            let mut g = self.cv.stt.lock();
            match g.as_mut() {
                Some((s, used)) => {
                    *used = Instant::now();
                    s.clone()
                }
                None => {
                    let dir = self.paths.root.join("models").join(na_voice::models::PARAKEET);
                    if !dir.exists() {
                        return Err(err(
                            ErrorCode::NotFound,
                            "Speech to text needs the voice models: download them in Settings → Voice on the computer.",
                        ));
                    }
                    let threads = std::thread::available_parallelism().map(|n| n.get().clamp(2, 4) as i32).unwrap_or(2);
                    let s = Arc::new(
                        na_voice::stt::Stt::load(na_voice::stt::SttModel {
                            kind: na_voice::stt::SttKind::Parakeet,
                            dir,
                            language: None,
                            threads,
                        })
                        .map_err(|e| err(ErrorCode::Internal, format!("{e:#}")))?,
                    );
                    *g = Some((s.clone(), Instant::now()));
                    s
                }
            }
        };
        let text = stt.transcribe(&samples).map_err(|e| err(ErrorCode::Internal, format!("{e:#}")))?;
        Ok(TranscribeResult { text })
    }

    pub async fn cv_handle(self: &Arc<Self>, req: Request) -> Option<Result<Value, na_protocol::ApiError>> {
        Some(match req {
            Request::CvHistory { sid, before, agent } => {
                let core = self.clone();
                match tokio::task::spawn_blocking(move || core.cv_history(&sid, before, agent.as_deref())).await {
                    Ok(r) => r.map(|r| json!(r)),
                    Err(e) => Err(err(ErrorCode::Internal, e.to_string())),
                }
            }
            Request::CvImage { sid, id, max, agent } => {
                let core = self.clone();
                match tokio::task::spawn_blocking(move || core.cv_image(&sid, &id, max, agent.as_deref())).await {
                    Ok(r) => r.map(|r| json!(r)),
                    Err(e) => Err(err(ErrorCode::Internal, e.to_string())),
                }
            }
            Request::CvCommands { sid } => {
                let core = self.clone();
                tokio::task::spawn_blocking(move || json!(core.cv_commands(&sid)))
                    .await
                    .map_err(|e| err(ErrorCode::Internal, e.to_string()))
            }
            Request::CvFiles { sid, query } => {
                let core = self.clone();
                tokio::task::spawn_blocking(move || json!(core.cv_files(&sid, &query)))
                    .await
                    .map_err(|e| err(ErrorCode::Internal, e.to_string()))
            }
            Request::Upload { sid, name, data } => {
                let core = self.clone();
                match tokio::task::spawn_blocking(move || core.cv_upload(&sid, &name, &data)).await {
                    Ok(r) => r.map(|r| json!(r)),
                    Err(e) => Err(err(ErrorCode::Internal, e.to_string())),
                }
            }
            Request::CvAction { sid, action } => self.cv_action(&sid, action).await.map(|_| Value::Null),
            Request::CvTaskOutput { sid, task, max } => {
                let core = self.clone();
                match tokio::task::spawn_blocking(move || core.cv_task_output(&sid, &task, max)).await {
                    Ok(r) => r.map(|r| json!(r)),
                    Err(e) => Err(err(ErrorCode::Internal, e.to_string())),
                }
            }
            Request::CvFile { sid, path } => {
                let core = self.clone();
                match tokio::task::spawn_blocking(move || core.cv_file(&sid, &path)).await {
                    Ok(r) => r.map(|r| json!(r)),
                    Err(e) => Err(err(ErrorCode::Internal, e.to_string())),
                }
            }
            Request::Transcribe { audio, .. } => {
                let core = self.clone();
                match tokio::task::spawn_blocking(move || core.cv_transcribe(&audio)).await {
                    Ok(r) => r.map(|r| json!(r)),
                    Err(e) => Err(err(ErrorCode::Internal, e.to_string())),
                }
            }
            _ => return None,
        })
    }
}

/// Removes uploads older than the retention time.
fn prune_uploads(root: &Path) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for d in rd.flatten() {
        let Ok(files) = std::fs::read_dir(d.path()) else { continue };
        let mut empty = true;
        for f in files.flatten() {
            let old = f
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| SystemTime::now().duration_since(t).ok())
                .is_some_and(|age| age > UPLOAD_TTL);
            if old {
                let _ = std::fs::remove_file(f.path());
            } else {
                empty = false;
            }
        }
        if empty {
            let _ = std::fs::remove_dir(d.path());
        }
    }
}

/// Validates and writes one uploaded file under `<root>/uploads/<session>/`.
fn store_upload(root_dir: &std::path::Path, sid: &str, name: &str, data: &str) -> Result<UploadResult, na_protocol::ApiError> {
    let name = safe_name(name);
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if !UPLOAD_EXT.contains(&ext.as_str()) {
        return Err(err(ErrorCode::BadRequest, "only images (and PDF or text files) can be added"));
    }
    if data.len() > MAX_UPLOAD * 4 / 3 + 16 {
        return Err(err(ErrorCode::BadRequest, "file is larger than 12 MB"));
    }
    let bytes =
        base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|_| err(ErrorCode::BadRequest, "not valid base64"))?;
    if bytes.is_empty() || bytes.len() > MAX_UPLOAD {
        return Err(err(ErrorCode::BadRequest, "file is empty or larger than 12 MB"));
    }
    let root = root_dir.join("uploads");
    let dir = root.join(safe_name(sid));
    std::fs::create_dir_all(&dir).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    prune_uploads(&root);
    let stamp = crate::core::now_ms();
    let path = dir.join(format!("{stamp}-{name}"));
    crate::paths::write_private(&path, &bytes).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    Ok(UploadResult { path: path.to_string_lossy().into_owned() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(lines: &[Value]) -> (TailState, Vec<CvEvent>) {
        let mut data = String::new();
        for l in lines {
            data.push_str(&l.to_string());
            data.push('\n');
        }
        let mut st = TailState::default();
        let (evs, _) = st.feed(data.as_bytes(), 0);
        (st, evs)
    }

    #[test]
    fn effort_comes_from_effort_output_screen_and_settings() {
        // Both shapes the CLI writes: a system `local_command` line and a user stdout line.
        let (st, _) = feed(&[
            json!({"type":"system","subtype":"local_command","uuid":"s1","content":"<local-command-stdout>Set effort level to \u{1b}[1mhigh\u{1b}[22m (saved as your default for new sessions): Deeper reasoning</local-command-stdout>"}),
        ]);
        assert_eq!(st.meta.effort.as_deref(), Some("high"));
        let (mut st, _) = feed(&[
            json!({"type":"user","uuid":"o","message":{"role":"user","content":"<local-command-stdout>Set effort level to low (this session only): Quick answers</local-command-stdout>"}}),
        ]);
        assert_eq!(st.meta.effort.as_deref(), Some("low"));
        assert_eq!(effort_from_output("Ultracode off. Effort stays xhigh."), Some("xhigh".into()));
        assert_eq!(effort_from_output("Effort level set to auto"), Some(String::new()));
        assert_eq!(effort_from_output("Set model to opus"), None);
        // The status line: only a change there counts, so the transcript is not overridden on every tick.
        let screen = "  ⏵⏵ accept edits on\n  ◐ medium · /effort\n";
        assert_eq!(detect_effort(screen), Some("medium"));
        assert_eq!(detect_effort("> /effort high\n"), None);
        assert!(st.see_effort(detect_effort(screen)));
        assert_eq!(st.meta.effort.as_deref(), Some("medium"));
        assert!(!st.see_effort(Some("medium")));
        // Settings: per model first, then the global default.
        let dir = std::env::temp_dir().join(format!("na-effort-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), r#"{"effortLevel":"low","modelSettings":{"claude-opus-5-5":{"effortLevel":"max"}}}"#)
            .unwrap();
        assert_eq!(settings_effort(&dir, Some("claude-opus-5-5")).as_deref(), Some("max"));
        assert_eq!(settings_effort(&dir, Some("claude-haiku-5-5")).as_deref(), Some("low"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn assistant_blocks_merge_and_tool_results_pair() {
        let (st, evs) = feed(&[
            json!({"type":"user","uuid":"u1","timestamp":"2026-10-30T10:00:00.000Z","message":{"role":"user","content":"list files"}}),
            json!({"type":"assistant","uuid":"a1","timestamp":"2026-10-30T10:00:01.000Z","message":{"id":"msg_1","model":"claude-haiku-5-5","role":"assistant",
                "content":[{"type":"thinking","thinking":"","signature":"x"}],"usage":{"input_tokens":3,"cache_read_input_tokens":100,"cache_creation_input_tokens":20,"output_tokens":5}}}),
            json!({"type":"assistant","uuid":"a2","message":{"id":"msg_1","model":"claude-haiku-5-5","role":"assistant",
                "content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}),
            json!({"type":"user","uuid":"u2","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"a.txt\nb.txt","is_error":false}]},"toolUseResult":{"stdout":"a.txt"}}),
            json!({"type":"assistant","uuid":"a3","message":{"id":"msg_2","model":"claude-haiku-5-5","role":"assistant","content":[{"type":"text","text":"Two files."}]}}),
        ]);
        assert_eq!(st.msgs.len(), 4);
        assert_eq!(st.msgs[1].blocks.len(), 2);
        assert!(matches!(&st.msgs[1].blocks[1], CvBlock::ToolUse { name, .. } if name == "Bash"));
        assert!(
            matches!(&st.msgs[2].blocks[0], CvBlock::ToolResult { tool_use_id, text, .. } if tool_use_id == "toolu_1" && text.starts_with("a.txt"))
        );
        assert_eq!(st.meta.model.as_deref(), Some("claude-haiku-5-5"));
        assert_eq!(st.meta.context_tokens, Some(123));
        // the merged assistant message is announced twice (once per block), the second with both blocks
        let upserts: Vec<_> = evs.iter().filter_map(|e| if let CvEvent::Upsert { message } = e { Some(message) } else { None }).collect();
        assert_eq!(upserts.len(), 5);
        assert_eq!(upserts[2].blocks.len(), 2);
        assert_eq!(upserts[0].ts, 1_793_354_400_000);
    }

    #[test]
    fn background_tasks_from_the_transcript() {
        let (st, evs) = feed(&[
            json!({"type":"assistant","uuid":"a1","timestamp":"2026-10-31T10:00:00Z","message":{"id":"msg_1","model":"claude-haiku-5-5","content":[
                {"type":"tool_use","id":"toolu_a","name":"Agent","input":{"description":"Survey","subagent_type":"Explore","prompt":"look","run_in_background":true}}]}}),
            json!({"type":"user","uuid":"u1","toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a0123456789abcdef","outputFile":"/t/a.output"},
                "message":{"content":[{"type":"tool_result","tool_use_id":"toolu_a","content":[{"type":"text","text":"Async agent launched"}]}]}}),
            json!({"type":"queue-operation","operation":"enqueue","content":"<task-notification>…</task-notification>"}),
            json!({"type":"user","uuid":"n1","timestamp":"2026-10-31T10:01:00Z","origin":{"kind":"task-notification"},"message":{"role":"user","content":
                "<task-notification>\n<task-id>a0123456789abcdef</task-id>\n<tool-use-id>toolu_a</tool-use-id>\n<status>completed</status>\n<summary>Agent \"Survey\" completed</summary>\n<result>Found 3 files</result>\n</task-notification>"}}),
        ]);
        let kinds: Vec<_> = st.msgs.iter().map(|m| m.kind.clone().unwrap_or_default()).collect();
        assert_eq!(kinds, ["", "", "task"]);
        assert!(
            matches!(&st.msgs[1].blocks[0], CvBlock::ToolResult { meta: Some(m), .. } if m.agent_id.as_deref() == Some("a0123456789abcdef"))
        );
        assert!(
            matches!(&st.msgs[2].blocks[0], CvBlock::TaskNote { status, result, .. } if status == "completed" && result == "Found 3 files")
        );
        let t = st.tasks.get("a0123456789abcdef").unwrap();
        assert_eq!((t.status.as_str(), t.tool_use_id.as_deref(), t.agent_type.as_deref()), ("completed", Some("toolu_a"), Some("Explore")));
        assert!(st.meta.queued.is_empty(), "task notices are not typed-ahead messages");
        assert_eq!(st.meta.tasks_running, Some(0));
        let _ = evs;
    }

    #[test]
    fn shell_paste_queue_peer_errors() {
        let (st, evs) = feed(&[
            json!({"type":"user","uuid":"b1","message":{"role":"user","content":"<bash-input>ls</bash-input>"}}),
            json!({"type":"user","uuid":"b2","parentUuid":"b1","message":{"role":"user","content":"<bash-stdout>a.txt\nb.txt</bash-stdout><bash-stderr></bash-stderr>"}}),
            json!({"type":"queue-operation","operation":"enqueue","timestamp":"2026-10-31T10:00:00Z","content":"and then this"}),
            json!({"type":"user","uuid":"p1","message":{"role":"user","content":"see\n<pasted_content id=\"x\">\nl1\nl2\n</pasted_content id=\"x\">"}}),
            json!({"type":"user","uuid":"q1","message":{"role":"user","content":"and then this"}}),
            json!({"type":"user","uuid":"peer","isMeta":true,"origin":{"kind":"peer","from":"agent-x","senderTaskId":"t9","name":"reviewer","body":"Looks good"},
                "message":{"role":"user","content":"Another Claude session sent a message: Looks good"}}),
            json!({"type":"user","uuid":"meta","isMeta":true,"message":{"role":"user","content":"Caveat: noise"}}),
            json!({"type":"assistant","uuid":"e1","isApiErrorMessage":true,"error":"rate_limit","apiErrorStatus":429,
                "message":{"id":"x","model":"<synthetic>","content":[{"type":"text","text":"You've hit your session limit"}]}}),
            json!({"type":"assistant","uuid":"th","thinkingDurationMs":770,"message":{"id":"msg_t","model":"m","content":[{"type":"thinking","thinking":"hmm"}]}}),
            json!({"type":"file-history-snapshot","messageId":"q1","snapshot":{"trackedFileBackups":{"a.rs":{}}}}),
            json!({"type":"attachment","uuid":"h1","attachment":{"type":"hook_system_message","content":"Formatted","hookName":"PostToolUse:Edit","hookEvent":"PostToolUse"}}),
            json!({"type":"attachment","attachment":{"type":"plan_mode","planFilePath":"/c/plans/p.md","planExists":true}}),
            json!({"type":"custom-title","customTitle":"my-session"}),
        ]);
        let kinds: Vec<_> = st.msgs.iter().map(|m| m.kind.clone().unwrap_or_default()).collect();
        assert_eq!(kinds, ["shell", "", "", "peer", "error", "", "hook"]);
        assert!(matches!(&st.msgs[0].blocks[0], CvBlock::Shell { command, stdout: Some(o), .. } if command == "ls" && o == "a.txt\nb.txt"));
        assert!(matches!(&st.msgs[1].blocks[1], CvBlock::Pasted { lines: 2, .. }));
        assert_eq!(st.msgs[2].checkpoint, Some(true));
        assert_eq!((st.msgs[3].from.as_deref(), st.msgs[3].from_name.as_deref()), (Some("t9"), Some("reviewer")));
        assert!(matches!(&st.msgs[4].blocks[0], CvBlock::Error { status: Some(429), .. }));
        assert!(matches!(&st.msgs[5].blocks[0], CvBlock::Thinking { ms: Some(770), .. }));
        assert!(st.meta.queued.is_empty(), "delivered");
        assert_eq!(st.meta.plan_file.as_deref(), Some("/c/plans/p.md"));
        assert_eq!(st.meta.session_name.as_deref(), Some("my-session"));
        // the shell output updated the input's message instead of adding one
        let shell_upserts = evs.iter().filter(|e| matches!(e, CvEvent::Upsert { message } if message.id == "b1")).count();
        assert_eq!(shell_upserts, 2);
    }

    #[test]
    fn queue_and_todos_in_meta() {
        let (st, _) = feed(&[
            json!({"type":"queue-operation","operation":"enqueue","content":"one"}),
            json!({"type":"queue-operation","operation":"enqueue","content":"two"}),
            json!({"type":"queue-operation","operation":"dequeue"}),
            json!({"type":"assistant","uuid":"a","message":{"id":"m1","model":"m","content":[
                {"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"A","status":"in_progress","activeForm":"Doing A"},{"content":"B","status":"pending"}]}}]}}),
        ]);
        assert_eq!(st.meta.queued.iter().map(|q| q.text.as_str()).collect::<Vec<_>>(), ["two"]);
        assert_eq!(st.meta.todos.len(), 2);
        assert_eq!(st.meta.todos[0].active.as_deref(), Some("Doing A"));
    }

    #[test]
    fn subagent_transcripts_keep_sidechain_lines() {
        let mut st = TailState { sidechain: true, ..Default::default() };
        let line = json!({"type":"assistant","isSidechain":true,"uuid":"s","message":{"id":"m","model":"m","content":[{"type":"text","text":"from the subagent"}]}});
        let data = format!("{line}\n");
        let _ = st.feed(data.as_bytes(), 0);
        assert_eq!(st.msgs.len(), 1);
        let (main, _) = feed(&[line]);
        assert!(main.msgs.is_empty());
    }

    #[test]
    fn question_and_plan_prompts_get_their_details() {
        let (mut st, _) = feed(&[json!({"type":"assistant","uuid":"a","message":{"id":"m1","model":"m","content":[
            {"type":"tool_use","id":"tq","name":"AskUserQuestion","input":{"questions":[{"question":"Which color?","header":"Color","multiSelect":false,
                "options":[{"label":"Red","description":"warm"},{"label":"Blue","description":"cold"}]}]}}]}})]);
        let screen = "Which color?\n\n❯ 1. Red\n     warm\n  2. Blue\n     cold\n  3. Type something.\n\nEnter to select · Esc to cancel";
        let p = st.enrich(detect_prompt(screen)).unwrap();
        assert_eq!(p.kind.as_deref(), Some("question"));
        let q = p.question.unwrap();
        assert_eq!((q.questions[0].header.as_str(), q.questions[0].options[1].description.as_str()), ("Color", "cold"));
        assert_eq!(q.tool_use_id.as_deref(), Some("tq"));
        assert_eq!(p.options[0].description.as_deref(), Some("warm"));
        assert_eq!(p.options[2].text, Some(true));
        // answered: the next menu is not that question any more
        let r = json!({"type":"user","uuid":"r","toolUseResult":{"answers":{"Which color?":"Red"}},"message":{"content":[{"type":"tool_result","tool_use_id":"tq","content":"ok"}]}});
        let _ = st.feed(format!("{r}\n").as_bytes(), 1000);
        st.perm =
            Some(CvPromptTool { name: "Bash".into(), input: json!({"command":"ls"}), tool_use_id: None, agent_id: None, agent: None });
        let perm = "Bash command\n\n  ls\n\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again for ls commands\n  3. No, and tell Claude what to do differently (esc)";
        let p = st.enrich(detect_prompt(perm)).unwrap();
        assert_eq!(p.kind.as_deref(), Some("permission"));
        assert_eq!(p.tool.map(|t| t.name).as_deref(), Some("Bash"));
        assert!(p.question.is_none());
    }

    #[test]
    fn commands_output_notices_and_noise() {
        let (st, _) = feed(&[
            json!({"type":"user","uuid":"m","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>x</local-command-caveat>"}}),
            json!({"type":"user","uuid":"c","message":{"role":"user","content":"<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>haiku</command-args>"}}),
            json!({"type":"user","uuid":"o","message":{"role":"user","content":"<local-command-stdout>Set model to \u{1b}[1mhaiku\u{1b}[0m</local-command-stdout>"}}),
            json!({"type":"system","uuid":"s","subtype":"compact_boundary","content":"Conversation compacted"}),
            json!({"type":"system","uuid":"t","subtype":"turn_duration","durationMs":5}),
            json!({"type":"user","uuid":"side","isSidechain":true,"message":{"role":"user","content":"sub"}}),
            json!({"type":"permission-mode","permissionMode":"plan"}),
            json!({"type":"ai-title","aiTitle":"Fix the build"}),
            json!({"type":"file-history-snapshot"}),
            json!({"type":"attachment","attachment":{"type":"skill_listing","content":"- brief: Make a brief\n- plugin:x: Does x"}}),
        ]);
        let kinds: Vec<_> = st.msgs.iter().map(|m| m.kind.clone().unwrap_or_default()).collect();
        assert_eq!(kinds, ["command", "output", "compact", "duration"]);
        assert!(matches!(&st.msgs[0].blocks[0], CvBlock::Text { text } if text == "/model haiku"));
        assert!(matches!(&st.msgs[1].blocks[0], CvBlock::Text { text } if text == "Set model to haiku"));
        assert_eq!(st.meta.mode.as_deref(), Some("plan"));
        assert_eq!(st.meta.title.as_deref(), Some("Fix the build"));
        assert_eq!(st.skills.len(), 2);
    }

    #[test]
    fn partial_line_waits_and_images_have_no_bytes() {
        let mut st = TailState::default();
        let a = json!({"type":"user","uuid":"u","message":{"role":"user","content":[{"type":"text","text":"[Image #1]"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}]}}).to_string();
        let (_, _) = st.feed(a[..20].as_bytes(), 0);
        assert!(st.msgs.is_empty() && st.offset == 0);
        let full = format!("{a}\n");
        let (evs, _) = st.feed(full.as_bytes(), 0);
        assert_eq!(evs.len(), 1);
        assert_eq!(st.offset, full.len() as u64);
        assert!(
            matches!(&st.msgs[0].blocks[1], CvBlock::Image { media_type, image: Some(r), url: None } if media_type == "image/png" && r.bytes == 3)
        );
    }

    #[test]
    fn tool_result_images_become_references() {
        // A PNG header: 2×3 pixels.
        let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\0\x02\0\0\0\x03\x08\x06\0\0\0");
        let line = json!({"type":"user","uuid":"r","message":{"role":"user","content":[
            {"type":"tool_result","tool_use_id":"t1","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":png}}]},
            {"type":"tool_result","tool_use_id":"t2","content":[{"type":"text","text":"shot"},{"type":"image","source":{"type":"url","url":"https://x"}}]}]}});
        let p = parse_line(&line, 77);
        let blocks = p.msg.unwrap().blocks;
        let CvBlock::ToolResult { text, images, .. } = &blocks[0] else { panic!() };
        assert_eq!(text, "");
        assert_eq!(images.len(), 1);
        assert_eq!((images[0].id.as_str(), images[0].w, images[0].h), (format!("77-0-{}", png.len()).as_str(), Some(2), Some(3)));
        // No bytes in the transcript: the placeholder stays.
        let CvBlock::ToolResult { text, images, .. } = &blocks[1] else { panic!() };
        assert_eq!((text.as_str(), images.len()), ("shot\n[image]", 0));
    }

    #[test]
    fn permission_menu_on_the_screen() {
        let screen = "\
 ● Bash(rm -rf build)\n\
\n\
╭──────────────────────────────────────────────╮\n\
│ Bash command                                 │\n\
│   rm -rf build                               │\n\
│                                              │\n\
│ Do you want to proceed?                      │\n\
│ ❯ 1. Yes                                     │\n\
│   2. Yes, and don't ask again for rm         │\n\
│   3. No, and tell Claude what to do (esc)    │\n\
╰──────────────────────────────────────────────╯\n";
        let p = detect_prompt(screen).expect("menu");
        assert_eq!(p.options.len(), 3);
        assert!(p.options[0].selected && p.options[0].label == "Yes");
        assert_eq!(p.options[2].n, "3");
        assert!(p.title.contains("Do you want to proceed?"));
    }

    #[test]
    fn command_in_a_dashed_box_is_kept() {
        let screen = "\
────────────────────────────────────────\n\
 Bash command\n\
\n\
 List files and count lines\n\
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌\n\
│ find cv-demo -type f\n\
│ --exclude-dir=node_modules\n\
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌\n\
 A nested command in this command can't be checked before it runs\n\
\n\
 Do you want to proceed?\n\
 ❯ 1. Yes\n\
   2. Yes, and switch to auto mode · auto mode handles these prompts for you\n\
   3. No\n\
\n\
 Esc to cancel · Tab to amend\n";
        let p = detect_prompt(screen).expect("menu");
        assert_eq!(
            p.title,
            "Bash command\n\nList files and count lines\n```\nfind cv-demo -type f\n--exclude-dir=node_modules\n```\nA nested command in this command can't be checked before it runs\n\nDo you want to proceed?"
        );
    }

    #[test]
    fn numbered_list_in_output_is_not_a_menu() {
        let screen = "● Here is the plan:\n  1. First\n  2. Second\n  3. Third\n\n╭──╮\n│ > │\n╰──╯\n  ? for shortcuts\n";
        assert!(detect_prompt(screen).is_none());
    }

    #[test]
    fn mode_from_the_footer() {
        assert_eq!(detect_mode("> \n  \u{23f8} manual mode on (shift+tab to cycle)"), Some("default"));
        assert_eq!(detect_mode("  \u{23f5}\u{23f5} accept edits on (shift+tab to cycle)"), Some("acceptEdits"));
        assert_eq!(detect_mode("  \u{23f8} plan mode on (shift+tab to cycle)"), Some("plan"));
        assert_eq!(detect_mode("  don't ask on (shift+tab to cycle)"), Some("dontAsk"));
        assert_eq!(detect_mode("  ? for shortcuts"), Some("default"));
        assert_eq!(detect_mode("just output"), None);
    }

    #[test]
    fn activity_line() {
        assert_eq!(detect_activity("x\n✻ Pondering… (3s · esc to interrupt)\n> ").as_deref(), Some("✻ Pondering… (3s · esc to interrupt)"));
        assert!(detect_activity("idle\n> ").is_none());
    }

    #[test]
    fn file_matching_prefers_names() {
        let files: Vec<String> =
            ["src/main.rs", "docs/README.md", "src/readme_helper.rs", "a/b/c/main_test.rs"].iter().map(|s| s.to_string()).collect();
        let m = match_files(&files, "readme", 5);
        assert_eq!(m[0], "docs/README.md");
        assert_eq!(match_files(&files, "mnrs", 5)[0], "src/main.rs");
    }

    #[test]
    fn upload_names_are_safe() {
        assert_eq!(safe_name("../../etc/pass wd.png"), "pass_wd.png");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(project_dir_name("/Users/a/my.proj"), "-Users-a-my-proj");
    }

    #[test]
    fn uploads_are_validated_and_stored() {
        use base64::Engine;
        let root = std::env::temp_dir().join(format!("na-upload-{}-{}", std::process::id(), rand::random::<u32>()));
        let b64 = base64::engine::general_purpose::STANDARD;
        let r = store_upload(&root, "s1", "../shot one.png", &b64.encode(b"\x89PNG1234")).unwrap();
        let p = std::path::PathBuf::from(&r.path);
        assert!(p.starts_with(root.join("uploads").join("s1")) && p.exists());
        assert_eq!(std::fs::read(&p).unwrap(), b"\x89PNG1234");
        assert!(store_upload(&root, "s1", "x.exe", &b64.encode(b"a")).is_err());
        assert!(store_upload(&root, "s1", "x.png", "!!!").is_err());
        assert!(store_upload(&root, "s1", "x.png", "").is_err());
        assert!(store_upload(&root, "s1", "x.png", &b64.encode(vec![0u8; MAX_UPLOAD + 1])).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    /// Dev aid: renders a terminal snapshot (`{snapshot, cols, rows}` JSON from `term_attach`, path in
    /// `NA_SNAP`) like the daemon does and runs the screen detectors on it.
    /// `NA_SNAP=/tmp/snap.json cargo test -p na-daemon dev_screen -- --ignored --nocapture`
    #[test]
    fn skills_from_the_head_of_a_long_transcript() {
        let p = std::env::temp_dir().join(format!("na-cv-head-{}.jsonl", std::process::id()));
        let listing = json!({"type":"attachment","attachment":{"type":"skill_listing","content":"- brief: Make a brief"}});
        std::fs::write(&p, format!("{}\n{}\n", json!({"type":"user","message":{"role":"user","content":"hi"}}), listing)).unwrap();
        let mut f = std::fs::File::open(&p).unwrap();
        assert_eq!(head_skills(&mut f, 1 << 20), vec![("brief".to_string(), "Make a brief".to_string())]);
        let mut f = std::fs::File::open(&p).unwrap();
        assert!(head_skills(&mut f, 10).is_empty());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn readable_files_stay_inside_their_folders() {
        let base = std::env::temp_dir().join(format!("na-cv-roots-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let base = base.canonicalize().unwrap();
        let (sess, proj, out) = (base.join("claude/projects/x"), base.join("proj"), base.join("outside"));
        for d in [&sess, &proj, &out] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(sess.join("t.output"), "ok").unwrap();
        std::fs::write(proj.join("plan.md"), "# plan").unwrap();
        std::fs::write(proj.join(".env"), "SECRET=1").unwrap();
        std::fs::write(out.join("id_rsa"), "key").unwrap();
        let link = sess.join("escape.output");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(out.join("id_rsa"), &link).unwrap();
        let r = ReadRoots { dirs: vec![base.join("claude/projects")], temps: vec![], project: Some(proj.clone()) };
        assert_eq!(confined(&sess.join("t.output"), &r), Some(sess.join("t.output")));
        assert!(confined(&proj.join("plan.md"), &r).is_some());
        assert_eq!(confined(&proj.join(".env"), &r), None, "only Markdown from the project");
        assert_eq!(confined(&out.join("id_rsa"), &r), None);
        assert_eq!(confined(&link, &r), None, "a link out of the folder");
        assert_eq!(confined(&sess.join("../x/../x/t.output"), &r), Some(sess.join("t.output")));
        assert_eq!(confined(&sess, &r), None, "a folder is not a file");
        assert_eq!(confined(Path::new("t.output"), &r), None);
        // The CLI's temp folders: `<tmp>/claude-*` only.
        let tmp = ReadRoots { dirs: vec![], temps: vec![base.clone()], project: None };
        std::fs::create_dir_all(base.join("claude-501/p/tasks")).unwrap();
        std::fs::write(base.join("claude-501/p/tasks/b1.output"), "x").unwrap();
        assert!(confined(&base.join("claude-501/p/tasks/b1.output"), &tmp).is_some());
        assert_eq!(confined(&out.join("id_rsa"), &tmp), None);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn read_text_tails_keep_whole_lines_but_not_nothing() {
        let p = std::env::temp_dir().join(format!("na-cv-read-{}.txt", std::process::id()));
        std::fs::write(&p, "first line\nsecond line\nthird\n").unwrap();
        let r = read_text(&p, 14, true).unwrap();
        assert_eq!((r.text.as_str(), r.truncated, r.size), ("third\n", true, 29));
        // One long line: the cut would leave nothing, so the raw end is kept.
        std::fs::write(&p, format!("{}\n", "x".repeat(100))).unwrap();
        let r = read_text(&p, 10, true).unwrap();
        assert_eq!(r.text, "xxxxxxxxx\n");
        let r = read_text(&p, 10, false).unwrap();
        assert_eq!(r.text, "x".repeat(10));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    #[ignore]
    fn dev_screen() {
        let Ok(path) = std::env::var("NA_SNAP") else { return };
        let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let n = |k: &str| std::num::NonZeroU16::new(v[k].as_u64().unwrap() as u16).unwrap();
        let mut p = vt100::Parser::new(n("rows"), n("cols"), 0);
        p.process(v["snapshot"].as_str().unwrap().as_bytes());
        let screen = p.screen().contents();
        println!("{screen}\n-----");
        println!(
            "prompt: {:?}\nmenu: {:?}\nactivity: {:?}\nmode: {:?}",
            detect_prompt(&screen),
            cv_screen::detect_menu(&screen),
            detect_activity(&screen),
            detect_mode(&screen)
        );
    }

    #[tokio::test]
    async fn statusline_effort_is_kept_before_the_view_opens() {
        let root = std::env::temp_dir().join(format!("na-cv-test-{}-{}", std::process::id(), rand::random::<u32>()));
        std::fs::create_dir_all(&root).unwrap();
        let env = crate::env::LoginEnv { vars: Default::default(), shell: "/bin/sh".into(), home: root.clone() };
        let core = Core::load(crate::paths::Paths { root: root.clone() }, env);
        let sid: Id = "s1".into();
        core.cv_status(&sid, &json!({ "effort": { "level": "medium" } }));
        assert_eq!(core.cv_tail(&sid).st.lock().meta.effort.as_deref(), Some("medium"));
        assert_eq!(core.cv_tail(&sid).st.lock().meta.actions, Some(true));
        core.cv_status(&sid, &json!({ "effort": { "level": "bogus" } }));
        assert_eq!(core.cv_tail(&sid).st.lock().meta.effort.as_deref(), Some("medium"));
        // The rest of the statusline input.
        core.cv_status(
            &sid,
            &json!({
                "model": { "id": "claude-haiku-x", "display_name": "Haiku" },
                "context_window": { "context_window_size": 200000, "used_percentage": 13.5,
                    "current_usage": { "input_tokens": 10, "cache_read_input_tokens": 26000, "cache_creation_input_tokens": 990 } },
                "cost": { "total_cost_usd": 0.42, "total_duration_ms": 9000, "total_api_duration_ms": 4000, "total_lines_added": 5, "total_lines_removed": 2 },
                "fast_mode": false, "thinking": { "enabled": true }, "output_style": { "name": "default" }, "version": "2.1.316",
                "session_name": "fix-bug", "workspace": { "added_dirs": ["/tmp/other"] },
                "worktree": { "name": "wt", "path": "/tmp/wt", "branch": "feat" },
                "pr": { "number": 12, "url": "https://example.com/pr/12", "review_state": "approved" }
            }),
        );
        {
            let tail = core.cv_tail(&sid);
            let st = tail.st.lock();
            let m = &st.meta;
            assert_eq!((m.context_window, m.context_pct, m.context_tokens), (Some(200000), Some(13.5), Some(27000)));
            assert_eq!((m.cost_usd, m.duration_ms, m.lines_added, m.lines_removed), (Some(0.42), Some(9000), Some(5), Some(2)));
            assert_eq!(
                (m.fast, m.thinking, m.version.as_deref(), m.session_name.as_deref()),
                (Some(false), Some(true), Some("2.1.316"), Some("fix-bug"))
            );
            assert_eq!(m.worktree.as_ref().map(|w| w.branch.as_deref()), Some(Some("feat")));
            assert_eq!(m.pr.as_ref().map(|p| (p.number, p.state.as_deref())), Some((12, Some("approved"))));
            assert_eq!(m.added_dirs, vec!["/tmp/other"]);
            assert_eq!(m.model.as_deref(), Some("claude-haiku-x"));
        }
        // Subagent rows and hooks feed the task list.
        core.cv_hook(
            &sid,
            "subagent-statusline",
            &json!({ "tasks": [{ "id": "a77", "type": "local_agent", "description": "Scan", "label": "Grep foo", "status": "running" }] }),
        );
        core.cv_hook(
            &sid,
            "PermissionRequest",
            &json!({ "tool_name": "Bash", "tool_input": { "command": "ls" }, "agent_id": "a77", "agent_type": "Explore" }),
        );
        {
            let tail = core.cv_tail(&sid);
            let st = tail.st.lock();
            assert_eq!(st.tasks.get("a77").and_then(|t| t.label.clone()).as_deref(), Some("Grep foo"));
            assert_eq!(st.meta.tasks_running, Some(1));
            assert_eq!(st.perm.as_ref().map(|t| (t.name.as_str(), t.agent_id.as_deref())), Some(("Bash", Some("a77"))));
        }
        core.cv_hook(&sid, "SubagentStop", &json!({ "agent_id": "a77" }));
        assert_eq!(core.cv_tail(&sid).st.lock().tasks.get("a77").map(|t| t.status.clone()).as_deref(), Some("completed"));
        let _ = std::fs::remove_dir_all(root);
    }
}
