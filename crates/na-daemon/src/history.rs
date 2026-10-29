//! Search over past agent conversations on this computer, so they can be resumed: Claude Code
//! (`~/.claude/projects/<folder>/<id>.jsonl`) and Codex (`~/.codex/sessions/Y/M/D/*.jsonl`).
//! Only titles and the user's own prompts are indexed, never tool output or answers. The index
//! lives in memory and re-reads a file only when it changed.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use na_protocol::HistoryEntry;
use parking_lot::Mutex;
use serde_json::Value;

/// Prompts kept per conversation and characters per prompt.
const MAX_PROMPTS: usize = 200;
const MAX_PROMPT_CHARS: usize = 600;
/// Lines longer than this are tool output or attachments, never a typed prompt.
const MAX_LINE: usize = 64 * 1024;

#[derive(Clone)]
struct Convo {
    engine: &'static str,
    id: String,
    cwd: String,
    title: Option<String>,
    prompts: Vec<String>,
    updated_at: i64,
}

/// Per transcript file: modified time and size when read, and what it contained.
type Indexed = (SystemTime, u64, Option<Convo>);

#[derive(Default)]
pub struct History {
    files: Mutex<HashMap<PathBuf, Indexed>>,
}

impl History {
    /// Newest first; every word of `query` must appear (case-insensitive). `allow` filters by cwd.
    pub fn search(&self, home: &Path, query: &str, limit: usize, allow: impl Fn(&str) -> bool) -> Vec<HistoryEntry> {
        self.refresh(home);
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let files = self.files.lock();
        let mut hits: Vec<HistoryEntry> = files
            .values()
            .filter_map(|(_, _, c)| c.as_ref())
            .filter(|c| !c.prompts.is_empty() && allow(&c.cwd))
            .filter_map(|c| matches(c, &words))
            .collect();
        hits.sort_by_key(|h| std::cmp::Reverse(h.updated_at));
        hits.truncate(limit);
        hits
    }

    fn refresh(&self, home: &Path) {
        let mut found = vec![];
        for dir in subdirs(&home.join(".claude/projects")) {
            found.extend(jsonl(&dir).into_iter().map(|p| (p, "claude")));
        }
        for y in subdirs(&home.join(".codex/sessions")) {
            for m in subdirs(&y) {
                for d in subdirs(&m) {
                    found.extend(jsonl(&d).into_iter().map(|p| (p, "codex")));
                }
            }
        }
        let mut files = self.files.lock();
        let live: std::collections::HashSet<&PathBuf> = found.iter().map(|(p, _)| p).collect();
        files.retain(|p, _| live.contains(p));
        for (path, engine) in &found {
            let Ok(meta) = std::fs::metadata(path) else { continue };
            let (mtime, len) = (meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), meta.len());
            if files.get(path).is_some_and(|(t, l, _)| *t == mtime && *l == len) {
                continue;
            }
            let convo = read(path, engine, mtime).map_err(|e| tracing::debug!("history {}: {e}", path.display())).ok().flatten();
            files.insert(path.clone(), (mtime, len, convo));
        }
    }
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()
}

fn jsonl(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .collect()
}

fn read(path: &Path, engine: &'static str, mtime: SystemTime) -> std::io::Result<Option<Convo>> {
    let mut c = Convo {
        engine,
        id: String::new(),
        cwd: String::new(),
        title: None,
        prompts: vec![],
        updated_at: mtime.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64),
    };
    if engine == "claude" {
        c.id = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    }
    let mut r = BufReader::new(std::fs::File::open(path)?);
    let mut line = Vec::new();
    loop {
        line.clear();
        if r.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        if line.len() > MAX_LINE {
            continue;
        }
        match engine {
            "claude" => claude_line(&mut c, &line),
            _ => codex_line(&mut c, &line),
        }
    }
    Ok((!c.id.is_empty()).then_some(c))
}

fn has(line: &[u8], needle: &str) -> bool {
    line.windows(needle.len()).any(|w| w == needle.as_bytes())
}

fn claude_line(c: &mut Convo, line: &[u8]) {
    if has(line, "\"type\":\"ai-title\"") {
        if let Ok(v) = serde_json::from_slice::<Value>(line)
            && let Some(t) = v["aiTitle"].as_str()
        {
            c.title = Some(t.to_string());
        }
        return;
    }
    if !has(line, "\"type\":\"user\"") || has(line, "tool_result") {
        return;
    }
    let Ok(v) = serde_json::from_slice::<Value>(line) else { return };
    if v["type"] != "user" || v["isMeta"] == true || v["isSidechain"] == true || v["isCompactSummary"] == true {
        return;
    }
    if c.cwd.is_empty()
        && let Some(cwd) = v["cwd"].as_str()
    {
        c.cwd = cwd.to_string();
    }
    let content = &v["message"]["content"];
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => {
            items.iter().filter_map(|i| (i["type"] == "text").then(|| i["text"].as_str()).flatten()).collect::<Vec<_>>().join("\n")
        }
        _ => return,
    };
    push_prompt(c, &text);
}

fn codex_line(c: &mut Convo, line: &[u8]) {
    let meta = has(line, "\"type\":\"session_meta\"");
    if !meta && !has(line, "\"role\":\"user\"") {
        return;
    }
    let Ok(v) = serde_json::from_slice::<Value>(line) else { return };
    let p = &v["payload"];
    if meta {
        c.id = p["id"].as_str().unwrap_or_default().to_string();
        c.cwd = p["cwd"].as_str().unwrap_or_default().to_string();
        return;
    }
    if v["type"] == "response_item" && p["role"] == "user" {
        let text = p["content"].as_array().into_iter().flatten().filter_map(|i| i["text"].as_str()).collect::<Vec<_>>().join("\n");
        push_prompt(c, &text);
    }
}

/// Keeps what the user typed; drops wrapper messages the CLIs inject (`<command-name>`,
/// `<environment_context>` and the like).
fn push_prompt(c: &mut Convo, text: &str) {
    let t = text.trim();
    if t.is_empty() || t.starts_with('<') || c.prompts.len() >= MAX_PROMPTS {
        return;
    }
    c.prompts.push(t.chars().take(MAX_PROMPT_CHARS).collect());
}

fn matches(c: &Convo, words: &[String]) -> Option<HistoryEntry> {
    let title = c.title.clone().unwrap_or_else(|| one_line(&c.prompts[0], 90));
    let mut snippet = None;
    if !words.is_empty() {
        let hay = format!("{}\n{}\n{}", title, c.cwd, c.prompts.join("\n")).to_lowercase();
        if !words.iter().all(|w| hay.contains(w.as_str())) {
            return None;
        }
        snippet = c.prompts.iter().find_map(|p| around(p, &words[0]));
    }
    Some(HistoryEntry {
        engine: c.engine.into(),
        id: c.id.clone(),
        cwd: c.cwd.clone(),
        title,
        snippet,
        prompts: c.prompts.len() as u32,
        updated_at: c.updated_at,
    })
}

fn one_line(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max { flat } else { format!("{}…", flat.chars().take(max).collect::<String>().trim_end()) }
}

/// The prompt shortened to ~120 characters around the first match of `word`.
fn around(prompt: &str, word: &str) -> Option<String> {
    let flat = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = flat.chars().collect();
    let lower: Vec<char> = flat.to_lowercase().chars().collect();
    let w: Vec<char> = word.chars().collect();
    // Lowercasing can change the length of some characters; then just show the start.
    let at = if lower.len() == chars.len() { lower.windows(w.len()).position(|x| x == w.as_slice())? } else { 0 };
    let start = at.saturating_sub(40);
    let end = (start + 120).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    if start > 0 {
        s = format!("…{s}");
    }
    if end < chars.len() {
        s.push('…');
    }
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_prompts_and_finds_them() {
        let home = std::env::temp_dir().join(format!("na-history-{}", std::process::id()));
        let claude = home.join(".claude/projects/-w");
        let codex = home.join(".codex/sessions/2026/10/29");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::create_dir_all(&codex).unwrap();
        let lines = [
            r#"{"type":"user","cwd":"/w","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>x"}}"#,
            r#"{"type":"user","cwd":"/w","message":{"role":"user","content":"Fix the login redirect bug on the website"}}"#,
            r#"{"type":"user","cwd":"/w","message":{"role":"user","content":[{"type":"tool_result","content":"secret tool output"}]}}"#,
            r#"{"type":"assistant","message":{"content":"answer text"}}"#,
            r#"{"type":"ai-title","aiTitle":"Login redirect fix","sessionId":"abc"}"#,
        ];
        std::fs::write(claude.join("abc.jsonl"), lines.join("\n")).unwrap();
        let codex_lines = [
            r#"{"type":"session_meta","payload":{"id":"019a","cwd":"/api"}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>..."}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Add rate limiting to the API"}]}}"#,
        ];
        std::fs::write(codex.join("rollout-1.jsonl"), codex_lines.join("\n")).unwrap();

        let h = History::default();
        let all = h.search(&home, "", 10, |_| true);
        assert_eq!(all.len(), 2);
        let hit = h.search(&home, "LOGIN website", 10, |_| true);
        assert_eq!(hit.len(), 1);
        assert_eq!((hit[0].engine.as_str(), hit[0].id.as_str(), hit[0].title.as_str()), ("claude", "abc", "Login redirect fix"));
        assert_eq!(hit[0].prompts, 1, "wrapper messages and tool output are not prompts");
        assert!(hit[0].snippet.as_deref().unwrap().contains("login redirect"));
        assert!(h.search(&home, "secret", 10, |_| true).is_empty(), "tool output is not indexed");
        assert!(h.search(&home, "answer", 10, |_| true).is_empty(), "answers are not indexed");
        let codex_hit = h.search(&home, "rate limiting", 10, |_| true);
        assert_eq!((codex_hit[0].engine.as_str(), codex_hit[0].id.as_str(), codex_hit[0].cwd.as_str()), ("codex", "019a", "/api"));
        assert!(h.search(&home, "", 10, |cwd| cwd == "/api").iter().all(|e| e.cwd == "/api"));
        let _ = std::fs::remove_dir_all(home);
    }
}
