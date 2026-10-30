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

use crate::core::{Core, err};

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

#[derive(Default)]
pub struct ClaudeView {
    tails: Mutex<HashMap<Id, Arc<Tail>>>,
    stt: Mutex<Option<(Arc<na_voice::stt::Stt>, Instant)>>,
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

fn tool_result_text(c: &Value) -> String {
    match c {
        Value::String(s) => clip(s, MAX_TEXT),
        Value::Array(a) => clip(
            &a.iter()
                .map(|b| match b["type"].as_str() {
                    Some("text") => b["text"].as_str().unwrap_or("").to_string(),
                    Some("image") => "[image]".to_string(),
                    _ => String::new(),
                })
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
            MAX_TEXT,
        ),
        _ => String::new(),
    }
}

/// One transcript line → message / metadata. `off` is the line's position in the file.
pub fn parse_line(v: &Value, off: u64) -> Parsed {
    let mut p = Parsed::default();
    let ty = v["type"].as_str().unwrap_or("");
    match ty {
        "permission-mode" => p.mode = v["permissionMode"].as_str().map(str::to_string),
        "ai-title" => p.title = v["aiTitle"].as_str().map(str::to_string),
        "attachment" => {
            let a = &v["attachment"];
            if a["type"] == "skill_listing"
                && let Some(c) = a["content"].as_str()
            {
                for line in c.lines() {
                    if let Some(rest) = line.strip_prefix("- ")
                        && let Some((n, d)) = rest.split_once(": ")
                    {
                        p.skills.push((n.trim().to_string(), d.trim().to_string()));
                    }
                }
            }
        }
        "system" => {
            let sub = v["subtype"].as_str().unwrap_or("");
            let text = v["content"].as_str().unwrap_or("");
            let (kind, text) = match sub {
                "compact_boundary" => ("compact", "Conversation compacted".to_string()),
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
            p.msg = Some(CvMessage {
                i: off,
                id: v["uuid"].as_str().unwrap_or("").to_string(),
                role: CvRole::System,
                ts: millis(v),
                model: None,
                kind: Some(kind.into()),
                blocks: vec![CvBlock::Text { text: clip(&text, MAX_TEXT) }],
            });
        }
        "assistant" => {
            if v["isSidechain"].as_bool() == Some(true) {
                return p;
            }
            let m = &v["message"];
            let model = m["model"].as_str().filter(|m| !m.starts_with('<')).map(str::to_string);
            if let Some(u) = m.get("usage").filter(|u| u.is_object()) {
                let n = |k: &str| u[k].as_u64().unwrap_or(0);
                let total = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
                if total > 0 {
                    p.context = Some(total);
                }
            }
            p.model = model.clone();
            let mut blocks = vec![];
            for b in m["content"].as_array().into_iter().flatten() {
                match b["type"].as_str() {
                    Some("text") => {
                        let t = b["text"].as_str().unwrap_or("");
                        if !t.trim().is_empty() && t.trim() != "No response requested." {
                            blocks.push(CvBlock::Text { text: t.to_string() });
                        }
                    }
                    Some("thinking") => blocks.push(CvBlock::Thinking { text: b["thinking"].as_str().unwrap_or("").to_string() }),
                    Some("tool_use") => blocks.push(CvBlock::ToolUse {
                        id: b["id"].as_str().unwrap_or("").to_string(),
                        name: b["name"].as_str().unwrap_or("").to_string(),
                        input: clip_value(&b["input"]),
                    }),
                    _ => {}
                }
            }
            if blocks.is_empty() {
                return p;
            }
            let id = m["id"].as_str().or(v["uuid"].as_str()).unwrap_or("").to_string();
            p.msg = Some(CvMessage { i: off, id, role: CvRole::Assistant, ts: millis(v), model, kind: None, blocks });
        }
        "user" => {
            if v["isMeta"].as_bool() == Some(true) || v["isSidechain"].as_bool() == Some(true) {
                return p;
            }
            let id = v["uuid"].as_str().unwrap_or("").to_string();
            let mk = |kind: Option<&str>, blocks: Vec<CvBlock>| CvMessage {
                i: off,
                id: id.clone(),
                role: CvRole::User,
                ts: millis(v),
                model: None,
                kind: kind.map(str::to_string),
                blocks,
            };
            let c = &v["message"]["content"];
            if let Some(s) = c.as_str() {
                if v["isCompactSummary"].as_bool() == Some(true) {
                    p.msg = Some(mk(Some("summary"), vec![CvBlock::Text { text: clip(s, MAX_TEXT) }]));
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
                } else if !s.trim().is_empty() && !s.starts_with("<system-reminder>") && !s.starts_with("<task-notification>") {
                    p.msg = Some(mk(None, vec![CvBlock::Text { text: s.to_string() }]));
                }
            } else if let Some(a) = c.as_array() {
                let mut blocks = vec![];
                for b in a {
                    match b["type"].as_str() {
                        Some("text") => {
                            let t = b["text"].as_str().unwrap_or("");
                            if !t.trim().is_empty() && !t.starts_with("<system-reminder>") && !t.starts_with("[Request interrupted") {
                                blocks.push(CvBlock::Text { text: t.to_string() });
                            } else if t.starts_with("[Request interrupted") {
                                p.msg = Some(CvMessage {
                                    i: off,
                                    id: id.clone(),
                                    role: CvRole::System,
                                    ts: millis(v),
                                    model: None,
                                    kind: Some("notice".into()),
                                    blocks: vec![CvBlock::Text { text: "Interrupted".into() }],
                                });
                                return p;
                            }
                        }
                        Some("image") => {
                            blocks.push(CvBlock::Image { media_type: b["source"]["media_type"].as_str().unwrap_or("image").to_string() })
                        }
                        Some("tool_result") => {
                            let text = tool_result_text(&b["content"]);
                            let stopped = text.starts_with("[Tool call interrupted") || text.starts_with("[Request interrupted");
                            blocks.push(CvBlock::ToolResult {
                                tool_use_id: b["tool_use_id"].as_str().unwrap_or("").to_string(),
                                text: if stopped { "Interrupted by user".into() } else { text },
                                is_error: !stopped && b["is_error"].as_bool().unwrap_or(false),
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
            let p = parse_line(&v, off);
            if let Some(m) = p.mode {
                meta_changed |= self.meta.mode.as_ref() != Some(&m);
                self.meta.mode = Some(m);
            }
            if let Some(t) = p.title {
                meta_changed |= self.meta.title.as_ref() != Some(&t);
                self.meta.title = Some(t);
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
            if let Some(m) = p.msg {
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
        (events, meta_changed)
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
            self.meta = CvMeta { transcript: path.file_name().map(|n| n.to_string_lossy().into_owned()), ..Default::default() };
            self.effort_seen = false;
            self.screen_effort = None;
            self.more = start > 0;
            self.offset = start;
            self.started = true;
            if start > 0 {
                // Begin at a whole line.
                let mut buf = vec![0u8; 64 << 10];
                let _ = f.seek(SeekFrom::Start(start));
                let n = f.read(&mut buf).unwrap_or(0);
                self.offset = start + buf[..n].iter().position(|b| *b == b'\n').map(|i| i as u64 + 1).unwrap_or(0);
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
        } else {
            events.extend(evs);
            if meta_changed {
                events.push(CvEvent::Meta { meta: self.meta.clone() });
            }
        }
        events
    }
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
            options.push(CvOption { n, label, selected });
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
    Some(CvPrompt { title: title.join("\n"), options })
}

/// "✻ Thinking… (12s · esc to interrupt)" → the status text, while the CLI is busy.
pub fn detect_activity(screen: &str) -> Option<String> {
    screen
        .lines()
        .rev()
        .take(14)
        .find(|l| l.contains("esc to interrupt"))
        .map(|l| l.trim().trim_matches('│').trim().to_string())
        .filter(|l| !l.is_empty())
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

const BUILTIN: &[(&str, &str)] = &[
    ("add-dir", "Add a working directory"),
    ("agents", "Manage subagents"),
    ("btw", "Ask a side question"),
    ("bug", "Report a bug"),
    ("clear", "Start a new conversation"),
    ("compact", "Summarize the conversation to free context"),
    ("config", "Open settings"),
    ("context", "Show context usage"),
    ("copy", "Copy the last answer"),
    ("cost", "Show cost and duration"),
    ("diff", "View uncommitted changes"),
    ("doctor", "Check the installation"),
    ("exit", "Exit Claude Code"),
    ("export", "Export the conversation"),
    ("help", "Show help and commands"),
    ("hooks", "Manage hooks"),
    ("ide", "Connect to an IDE"),
    ("init", "Create a CLAUDE.md for this project"),
    ("install-github-app", "Set up the Claude GitHub app"),
    ("login", "Sign in"),
    ("logout", "Sign out"),
    ("loop", "Run a prompt on an interval"),
    ("mcp", "Manage MCP servers"),
    ("memory", "Edit memory files"),
    ("model", "Choose the model"),
    ("output-style", "Choose the output style"),
    ("permissions", "Manage tool permissions"),
    ("plan", "Enter plan mode"),
    ("plugin", "Manage plugins"),
    ("pr-comments", "Show comments of a pull request"),
    ("privacy-settings", "Privacy settings"),
    ("release-notes", "Show release notes"),
    ("remote-control", "Continue this session from another device"),
    ("rename", "Rename the conversation"),
    ("resume", "Resume a conversation"),
    ("review", "Review a pull request"),
    ("rewind", "Go back to an earlier point"),
    ("security-review", "Review pending changes for security issues"),
    ("skills", "List skills"),
    ("status", "Show status"),
    ("statusline", "Set up the status line"),
    ("tasks", "Show background tasks"),
    ("terminal-setup", "Set up terminal key bindings"),
    ("theme", "Change the theme"),
    ("todos", "Show the todo list"),
    ("upgrade", "Upgrade the plan"),
    ("usage", "Show plan usage limits"),
    ("vim", "Toggle vim mode"),
];

fn front_description(text: &str) -> String {
    let mut lines = text.lines();
    if lines.next().map(str::trim) == Some("---") {
        for l in lines.by_ref() {
            if l.trim() == "---" {
                break;
            }
            if let Some(d) = l.strip_prefix("description:") {
                return d.trim().trim_matches(['"', '\'']).to_string();
            }
        }
    }
    // No front matter description: the first text line.
    text.lines().map(str::trim).find(|l| !l.is_empty() && *l != "---" && !l.starts_with('#')).unwrap_or("").chars().take(120).collect()
}

fn collect_commands(dir: &Path, prefix: &str, source: &str, out: &mut Vec<CvCommand>, depth: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() && depth < 3 {
            collect_commands(&p, &format!("{prefix}{name}:"), source, out, depth + 1);
        } else if let Some(stem) = name.strip_suffix(".md") {
            let text = std::fs::read_to_string(&p).unwrap_or_default();
            out.push(CvCommand { name: format!("{prefix}{stem}"), description: front_description(&text), source: source.into() });
        }
    }
}

fn collect_skills(dir: &Path, source: &str, out: &mut Vec<CvCommand>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let md = e.path().join("SKILL.md");
        if let Ok(text) = std::fs::read_to_string(&md) {
            let name = e.file_name().to_string_lossy().into_owned();
            out.push(CvCommand { name, description: front_description(&text), source: source.into() });
        }
    }
}

pub fn claude_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".claude")))
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
            .or_insert_with(|| Arc::new(Tail { tx: broadcast::channel(512).0, st: Mutex::new(TailState::default()) }))
            .clone()
    }

    /// A hook told us where the session's transcript is (it changes after `/clear` and `/resume`).
    pub fn cv_note_path(&self, sid: &Id, path: &str) {
        // Only Claude's own transcripts (`<config dir>/**/*.jsonl`): a hook payload must not point the reader elsewhere.
        let ok = Path::new(path).extension().is_some_and(|e| e == "jsonl")
            && claude_dir()
                .and_then(|d| d.canonicalize().ok())
                .zip(Path::new(path).canonicalize().ok())
                .is_some_and(|(d, p)| p.starts_with(d));
        if !ok {
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

    /// Reads new transcript lines now and tells whoever is attached.
    fn cv_poll(&self, sid: &Id, tail: &Tail) {
        if tail.tx.receiver_count() == 0 {
            return;
        }
        let events = {
            let mut st = tail.st.lock();
            let evs = st.poll();
            for e in &evs {
                let _ = tail.tx.send(e.clone());
            }
            evs
        };
        let _ = (sid, events);
    }

    /// Once per tick: new lines, and the menu / activity on the screen, for attached sessions.
    pub fn cv_tick(&self) {
        let tails: Vec<(Id, Arc<Tail>)> = self.cv.tails.lock().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (sid, tail) in tails {
            if tail.tx.receiver_count() == 0 {
                continue;
            }
            self.cv_guess_path(&sid, &tail);
            self.cv_poll(&sid, &tail);
            let screen = self.pty(&sid).map(|p| p.screen_text()).unwrap_or_default();
            let prompt = detect_prompt(&screen);
            let activity = detect_activity(&screen);
            let mode = detect_mode(&screen);
            let effort = detect_effort(&screen);
            let mut st = tail.st.lock();
            let mut meta_changed = false;
            meta_changed |= st.see_effort(effort);
            if let Some(m) = mode
                && st.meta.mode.as_deref() != Some(m)
            {
                st.meta.mode = Some(m.into());
                meta_changed = true;
            }
            if st.prompt != prompt {
                st.prompt = prompt.clone();
                let _ = tail.tx.send(CvEvent::Prompt { prompt });
            }
            if st.meta.activity != activity {
                st.meta.activity = activity;
                meta_changed = true;
            }
            if meta_changed {
                let _ = tail.tx.send(CvEvent::Meta { meta: st.meta.clone() });
            }
        }
        let mut stt = self.cv.stt.lock();
        if stt.as_ref().is_some_and(|(_, used)| used.elapsed() > STT_KEEP) {
            *stt = None;
        }
    }

    /// Claude Code hands its statusline command the live effort (`effort.level`): the surest
    /// source, since the "◐ medium · /effort" hint on the screen is only shown now and then.
    /// Kept even before anyone opened the Claude view (the statusline runs right at start, and
    /// the settings default can differ from what the CLI really uses).
    pub fn cv_status_effort(&self, sid: &Id, level: &str) {
        let Some(level) = EFFORTS.iter().find(|e| **e == level).copied() else { return };
        let tail = self.cv_tail(sid);
        let mut st = tail.st.lock();
        if st.see_effort(Some(level)) {
            let _ = tail.tx.send(CvEvent::Meta { meta: st.meta.clone() });
        }
    }

    pub fn cv_forget(&self, sid: &Id) {
        self.cv.tails.lock().remove(sid);
    }

    /// Attach: the current conversation and a receiver for what follows.
    pub fn cv_attach(&self, sid: &Id) -> Result<(CvAttachResult, broadcast::Receiver<CvEvent>), na_protocol::ApiError> {
        if self.read(|s| !s.sessions.contains_key(sid)) {
            return Err(err(ErrorCode::NotFound, "no such session"));
        }
        let tail = self.cv_tail(sid);
        self.cv_guess_path(sid, &tail);
        let mut st = tail.st.lock();
        // Subscribe first, under the lock: nothing can slip between the snapshot and the stream.
        let rx = tail.tx.subscribe();
        // Events from this poll reach only the receivers that exist (us, after the snapshot).
        let _ = st.poll();
        let screen = self.pty(sid).map(|p| p.screen_text()).unwrap_or_default();
        st.prompt = detect_prompt(&screen);
        st.meta.activity = detect_activity(&screen);
        if let Some(m) = detect_mode(&screen) {
            st.meta.mode = Some(m.into());
        }
        st.see_effort(detect_effort(&screen));
        let res = CvAttachResult { messages: st.page(), more: st.more_before(), meta: st.meta.clone(), prompt: st.prompt.clone() };
        Ok((res, rx))
    }

    pub fn cv_history(&self, sid: &Id, before: u64) -> Result<CvHistoryResult, na_protocol::ApiError> {
        let path = self
            .cv
            .tails
            .lock()
            .get(sid)
            .and_then(|t| t.st.lock().path.clone())
            .ok_or_else(|| err(ErrorCode::NotFound, "no transcript yet"))?;
        let mut f = std::fs::File::open(&path).map_err(|e| err(ErrorCode::NotFound, e.to_string()))?;
        let mut window = 2u64 << 20;
        loop {
            let start = before.saturating_sub(window);
            let mut buf = vec![0u8; (before - start) as usize];
            f.seek(SeekFrom::Start(start)).and_then(|_| f.read_exact(&mut buf)).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
            let mut skip = 0usize;
            if start > 0 {
                skip = buf.iter().position(|b| *b == b'\n').map(|i| i + 1).unwrap_or(buf.len());
            }
            let mut st = TailState::default();
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

    pub fn cv_commands(&self, sid: &Id) -> Vec<CvCommand> {
        let mut out: Vec<CvCommand> =
            BUILTIN.iter().map(|(n, d)| CvCommand { name: (*n).into(), description: (*d).into(), source: "builtin".into() }).collect();
        let cwd = self.read(|s| s.sessions.get(sid).map(|x| x.cwd.clone())).unwrap_or_default();
        if let Some(c) = claude_dir() {
            collect_commands(&c.join("commands"), "", "user", &mut out, 0);
            collect_skills(&c.join("skills"), "skill", &mut out);
        }
        if !cwd.is_empty() {
            collect_commands(&Path::new(&cwd).join(".claude/commands"), "", "project", &mut out, 0);
            collect_skills(&Path::new(&cwd).join(".claude/skills"), "skill", &mut out);
        }
        // Skills (also from plugins) as the session itself listed them.
        if let Some(t) = self.cv.tails.lock().get(sid) {
            let have: HashSet<String> = out.iter().map(|c| c.name.clone()).collect();
            for (n, d) in t.st.lock().skills.iter() {
                if !have.contains(n) {
                    out.push(CvCommand {
                        name: n.clone(),
                        description: d.chars().take(160).collect(),
                        source: if n.contains(':') { "plugin" } else { "skill" }.into(),
                    });
                }
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out.dedup_by(|a, b| a.name == b.name);
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
            Request::CvHistory { sid, before } => {
                let core = self.clone();
                match tokio::task::spawn_blocking(move || core.cv_history(&sid, before)).await {
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
        assert_eq!(kinds, ["command", "output", "compact"]);
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
        assert!(matches!(&st.msgs[0].blocks[1], CvBlock::Image { media_type } if media_type == "image/png"));
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

    #[tokio::test]
    async fn statusline_effort_is_kept_before_the_view_opens() {
        let root = std::env::temp_dir().join(format!("na-cv-test-{}-{}", std::process::id(), rand::random::<u32>()));
        std::fs::create_dir_all(&root).unwrap();
        let env = crate::env::LoginEnv { vars: Default::default(), shell: "/bin/sh".into(), home: root.clone() };
        let core = Core::load(crate::paths::Paths { root: root.clone() }, env);
        let sid: Id = "s1".into();
        core.cv_status_effort(&sid, "medium");
        assert_eq!(core.cv_tail(&sid).st.lock().meta.effort.as_deref(), Some("medium"));
        core.cv_status_effort(&sid, "bogus");
        assert_eq!(core.cv_tail(&sid).st.lock().meta.effort.as_deref(), Some("medium"));
        let _ = std::fs::remove_dir_all(root);
    }
}
