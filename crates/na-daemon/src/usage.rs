//! Token use and cost from the CLIs' own transcripts, so it covers every conversation on this
//! computer, also those started outside NeuralAgent:
//! - Claude Code: `~/.claude/projects/<folder>/<id>.jsonl` (+ `<id>/subagents/*.jsonl`), one
//!   `message.usage` per API call, repeated on every line of that message (deduplicated by id).
//! - Codex: `~/.codex/sessions/Y/M/D/*.jsonl`, `token_count` events with running totals and the
//!   subscription limits.
//!
//! Files are read incrementally (only bytes appended since the last pass). Cost is what the
//! tokens would cost at API list prices; models without a known price get none.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use na_protocol::{Millis, SessionUsage, TokenCounts, UsageLimit, UsageRow};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::Value;

/// Longer lines are skipped (huge tool results); usage lines are far smaller.
const MAX_LINE: usize = 8 << 20;

/// USD per million tokens.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Price {
    input: f64,
    output: f64,
    cache_read: f64,
    /// Long prompts (over this many input tokens, cached included) cost more on some models.
    over: Option<(u64, f64, f64)>,
}

const fn p(input: f64, output: f64, cache_read: f64) -> Price {
    Price { input, output, cache_read, over: None }
}

/// List prices (Anthropic first-party API and OpenAI API). Cache writes are 1.25× input for the
/// 5-minute cache and 2× for the 1-hour cache. Keep in sync with the providers' pricing pages.
const PRICES: &[(&str, Price)] = &[
    ("claude-fable-5-1", p(10.0, 50.0, 0.25)),
    ("claude-fable-5", p(10.0, 50.0, 1.0)),
    ("claude-opus-5-5", p(4.0, 20.0, 0.20)),
    ("claude-opus-5", p(5.0, 25.0, 0.50)),
    ("claude-opus-4-8", p(5.0, 25.0, 0.50)),
    ("claude-opus-4-7", p(5.0, 25.0, 0.50)),
    ("claude-opus-4-6", p(5.0, 25.0, 0.50)),
    ("claude-opus-4-5", p(5.0, 25.0, 0.50)),
    ("claude-opus-4-1", p(15.0, 75.0, 1.50)),
    ("claude-opus-4", p(15.0, 75.0, 1.50)),
    ("claude-sonnet-5-5", p(2.0, 10.0, 0.20)),
    ("claude-sonnet-5", p(2.0, 10.0, 0.20)),
    ("claude-sonnet-4-6", p(3.0, 15.0, 0.30)),
    ("claude-sonnet-4-5", p(3.0, 15.0, 0.30)),
    ("claude-sonnet-4", p(3.0, 15.0, 0.30)),
    ("claude-haiku-5-5", Price { input: 0.10, output: 0.50, cache_read: 0.01, over: Some((100_000, 0.50, 2.50)) }),
    ("claude-haiku-4-5", p(1.0, 5.0, 0.10)),
    ("claude-3-5-haiku", p(0.80, 4.0, 0.08)),
    ("gpt-5", p(1.25, 10.0, 0.125)),
    ("gpt-5-codex", p(1.25, 10.0, 0.125)),
    ("gpt-5-mini", p(0.25, 2.0, 0.025)),
    ("gpt-5-nano", p(0.05, 0.40, 0.005)),
];

/// The price of a model id as the CLIs write it (`claude-haiku-4-5-20251001`,
/// `claude/claude-opus-5-5`, `claude-opus-4-6[1m]`). Only an exact id or one with a date suffix
/// matches, so a new model never silently gets an older model's price.
pub fn price(model: &str) -> Option<Price> {
    let m = model.rsplit('/').next().unwrap_or(model).to_ascii_lowercase();
    let m = m.strip_prefix("anthropic.").unwrap_or(&m);
    let m = m.split('[').next().unwrap_or(m);
    PRICES.iter().find_map(|(id, price)| {
        let rest = m.strip_prefix(id)?;
        let dated = |r: &str| r.len() == 9 && (r.starts_with('-') || r.starts_with('@')) && r[1..].bytes().all(|b| b.is_ascii_digit());
        (rest.is_empty() || dated(rest)).then_some(*price)
    })
}

/// Cost of one call. `write_1h` is the part of `t.cache_write` that went to the 1-hour cache.
fn cost(price: Price, t: &TokenCounts, write_1h: u64) -> f64 {
    let (mut input, mut output, mut read) = (price.input, price.output, price.cache_read);
    if let Some((limit, i, o)) = price.over
        && t.input + t.cache_read + t.cache_write > limit
    {
        read *= i / input;
        (input, output) = (i, o);
    }
    let write_5m = t.cache_write.saturating_sub(write_1h);
    (t.input as f64 * input
        + t.output as f64 * output
        + t.cache_read as f64 * read
        + write_5m as f64 * input * 1.25
        + write_1h as f64 * input * 2.0)
        / 1e6
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Bucket {
    tokens: TokenCounts,
    cost: f64,
    /// Some calls had no known price: `cost` is incomplete.
    unpriced: bool,
    calls: u32,
}

impl Bucket {
    fn add(&mut self, t: &TokenCounts, c: Option<f64>) {
        let s = &mut self.tokens;
        s.input += t.input;
        s.output += t.output;
        s.cache_read += t.cache_read;
        s.cache_write += t.cache_write;
        match c {
            Some(c) => self.cost += c,
            None => self.unpriced = true,
        }
        self.calls += 1;
    }
    fn merge(&mut self, o: &Bucket) {
        let s = &mut self.tokens;
        s.input += o.tokens.input;
        s.output += o.tokens.output;
        s.cache_read += o.tokens.cache_read;
        s.cache_write += o.tokens.cache_write;
        self.cost += o.cost;
        self.unpriced |= o.unpriced;
        self.calls += o.calls;
    }
    fn cost_usd(&self) -> Option<f64> {
        (!self.unpriced).then_some((self.cost * 1e6).round() / 1e6)
    }
}

#[derive(Default)]
struct FileUsage {
    engine: &'static str,
    offset: u64,
    /// The conversation (Claude session id / Codex thread id); subagents count to their parent.
    conv: String,
    cwd: String,
    /// (day, model) → usage.
    buckets: BTreeMap<(String, String), Bucket>,
    model: Option<String>,
    /// Claude message ids counted from this file.
    ids: Vec<String>,
    /// Codex running total at the last `token_count`.
    codex_total: TokenCounts,
}

#[derive(Default)]
struct Inner {
    files: HashMap<PathBuf, FileUsage>,
    /// Claude message ids already counted (a resumed or forked conversation repeats them).
    seen: HashSet<String>,
    /// Codex limits from the newest `token_count` (timestamp, limits).
    codex_limits: Option<(Millis, Vec<UsageLimit>)>,
}

#[derive(Default)]
pub struct Usage {
    inner: Mutex<Inner>,
}

impl Usage {
    /// Reads what was appended to the transcripts since the last call.
    pub fn refresh(&self, home: &Path) {
        let found = transcripts(home);
        let mut g = self.inner.lock();
        let Inner { files, seen, codex_limits } = &mut *g;
        let live: HashSet<&PathBuf> = found.iter().map(|(p, _, _)| p).collect();
        files.retain(|p, f| {
            let keep = live.contains(p);
            if !keep {
                f.ids.iter().for_each(|id| {
                    seen.remove(id);
                });
            }
            keep
        });
        for (path, engine, conv) in &found {
            let Ok(len) = std::fs::metadata(path).map(|m| m.len()) else { continue };
            let f = files.entry(path.clone()).or_insert_with(|| FileUsage { engine, conv: conv.clone(), ..Default::default() });
            if len < f.offset {
                // rewritten: count it again from the start
                f.ids.iter().for_each(|id| {
                    seen.remove(id);
                });
                *f = FileUsage { engine, conv: conv.clone(), ..Default::default() };
            }
            if len == f.offset {
                continue;
            }
            if let Err(e) = read_from(path, f, seen, codex_limits) {
                tracing::debug!("usage {}: {e}", path.display());
            }
        }
    }

    /// Rows for days `>= since_day` (`YYYY-MM-DD`); `workspace` maps a folder to a workspace.
    pub fn rows(&self, since_day: &str, workspace: impl Fn(&str) -> Option<String>) -> Vec<UsageRow> {
        let g = self.inner.lock();
        let mut agg: BTreeMap<(String, &'static str, String, Option<String>), Bucket> = BTreeMap::new();
        for f in g.files.values() {
            let ws = workspace(&f.cwd);
            for ((day, model), b) in f.buckets.range((since_day.to_string(), String::new())..) {
                agg.entry((day.clone(), f.engine, model.clone(), ws.clone())).or_default().merge(b);
            }
        }
        agg.into_iter()
            .map(|((day, engine, model, workspace_id), b)| UsageRow {
                day,
                engine: engine.into(),
                model,
                workspace_id,
                tokens: b.tokens,
                cost_usd: b.cost_usd(),
                calls: b.calls,
            })
            .collect()
    }

    /// Everything one conversation used (subagents included).
    pub fn conversation(&self, conv: &str) -> Option<SessionUsage> {
        let g = self.inner.lock();
        let mut total = Bucket::default();
        // the model of the file with the most calls (the main conversation, not a subagent)
        let mut model: Option<(u32, String)> = None;
        for f in g.files.values().filter(|f| f.conv == conv) {
            let mut b = Bucket::default();
            f.buckets.values().for_each(|x| b.merge(x));
            total.merge(&b);
            if let Some(m) = &f.model
                && model.as_ref().is_none_or(|(n, _)| b.calls > *n)
            {
                model = Some((b.calls, m.clone()));
            }
        }
        let model = model.map(|(_, m)| m);
        (total.calls > 0).then(|| SessionUsage { tokens: total.tokens, cost_usd: total.cost_usd(), model })
    }

    pub fn codex_limits(&self) -> Vec<UsageLimit> {
        self.inner.lock().codex_limits.as_ref().map(|(_, l)| l.clone()).unwrap_or_default()
    }
}

/// (file, engine, conversation id). Codex ids come from the file's `session_meta`.
fn transcripts(home: &Path) -> Vec<(PathBuf, &'static str, String)> {
    let stem = |p: &Path| p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut out = vec![];
    for dir in subdirs(&home.join(".claude/projects")) {
        for f in jsonl(&dir) {
            let id = stem(&f);
            out.push((f, "claude", id));
        }
        for conv in subdirs(&dir) {
            let id = conv.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            for f in jsonl(&conv.join("subagents")) {
                out.push((f, "claude", id.clone()));
            }
        }
    }
    for y in subdirs(&home.join(".codex/sessions")) {
        for m in subdirs(&y) {
            for d in subdirs(&m) {
                out.extend(jsonl(&d).into_iter().map(|f| (f, "codex", String::new())));
            }
        }
    }
    out
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

fn read_from(
    path: &Path,
    f: &mut FileUsage,
    seen: &mut HashSet<String>,
    limits: &mut Option<(Millis, Vec<UsageLimit>)>,
) -> std::io::Result<()> {
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(f.offset))?;
    let mut r = BufReader::new(file);
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = r.read_until(b'\n', &mut line)?;
        // a line still being written is read next time
        if n == 0 || line.last() != Some(&b'\n') {
            break;
        }
        f.offset += n as u64;
        if line.len() > MAX_LINE {
            continue;
        }
        match f.engine {
            "claude" => claude_line(f, &line, seen),
            _ => codex_line(f, &line, limits),
        }
    }
    Ok(())
}

fn has(line: &[u8], needle: &str) -> bool {
    line.windows(needle.len()).any(|w| w == needle.as_bytes())
}

/// Local calendar day of an RFC 3339 timestamp.
fn day(ts: Option<&str>) -> Option<String> {
    let t = DateTime::parse_from_rfc3339(ts?).ok()?;
    Some(t.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

#[derive(Deserialize)]
struct ClaudeLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    cwd: Option<String>,
    message: Option<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ClaudeUsage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_input_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_creation: Option<CacheCreation>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CacheCreation {
    ephemeral_1h_input_tokens: u64,
}

fn claude_line(f: &mut FileUsage, line: &[u8], seen: &mut HashSet<String>) {
    if !has(line, "\"usage\"") {
        if f.cwd.is_empty()
            && has(line, "\"cwd\"")
            && let Ok(v) = serde_json::from_slice::<ClaudeLine>(line)
        {
            f.cwd = v.cwd.unwrap_or_default();
        }
        return;
    }
    let Ok(v) = serde_json::from_slice::<ClaudeLine>(line) else { return };
    if f.cwd.is_empty()
        && let Some(c) = &v.cwd
    {
        f.cwd = c.clone();
    }
    let (Some("assistant"), Some(m)) = (v.kind.as_deref(), v.message) else { return };
    let (Some(u), Some(model)) = (m.usage, m.model) else { return };
    if model.starts_with('<') {
        return; // "<synthetic>": messages the CLI made up itself, no API call
    }
    if let Some(id) = m.id {
        if !seen.insert(id.clone()) {
            return;
        }
        f.ids.push(id);
    }
    let Some(day) = day(v.timestamp.as_deref()) else { return };
    let t = TokenCounts {
        input: u.input_tokens,
        output: u.output_tokens,
        cache_read: u.cache_read_input_tokens,
        cache_write: u.cache_creation_input_tokens,
    };
    let write_1h = u.cache_creation.map_or(0, |c| c.ephemeral_1h_input_tokens);
    let c = price(&model).map(|p| cost(p, &t, write_1h));
    f.buckets.entry((day, model.clone())).or_default().add(&t, c);
    f.model = Some(model);
}

fn codex_line(f: &mut FileUsage, line: &[u8], limits: &mut Option<(Millis, Vec<UsageLimit>)>) {
    let meta = has(line, "\"session_meta\"");
    let ctx = has(line, "\"turn_context\"");
    if !meta && !ctx && !has(line, "\"token_count\"") {
        return;
    }
    let Ok(v) = serde_json::from_slice::<Value>(line) else { return };
    let p = &v["payload"];
    let ts = v["timestamp"].as_str();
    if meta && v["type"] == "session_meta" {
        f.conv = p["id"].as_str().unwrap_or_default().to_string();
        f.cwd = p["cwd"].as_str().unwrap_or_default().to_string();
        return;
    }
    if ctx && v["type"] == "turn_context" {
        if let Some(m) = p["model"].as_str() {
            f.model = Some(m.to_string());
        }
        return;
    }
    if p["type"] != "token_count" {
        return;
    }
    if let Some(l) = codex_limits(&p["rate_limits"], ts) {
        let at = l.first().map_or(0, |x| x.updated_at);
        if limits.as_ref().is_none_or(|(t, _)| at >= *t) {
            *limits = Some((at, l));
        }
    }
    let u = &p["info"]["total_token_usage"];
    if !u.is_object() {
        return;
    }
    let n = |k: &str| u[k].as_u64().unwrap_or(0);
    // OpenAI counts cached input inside input_tokens.
    let total = TokenCounts {
        input: n("input_tokens").saturating_sub(n("cached_input_tokens")),
        output: n("output_tokens"),
        cache_read: n("cached_input_tokens"),
        cache_write: 0,
    };
    let prev = f.codex_total;
    let d = if total.input < prev.input || total.output < prev.output || total.cache_read < prev.cache_read {
        total
    } else {
        TokenCounts {
            input: total.input - prev.input,
            output: total.output - prev.output,
            cache_read: total.cache_read - prev.cache_read,
            cache_write: 0,
        }
    };
    f.codex_total = total;
    if d == TokenCounts::default() {
        return; // the same totals reported again
    }
    let Some(day) = day(ts) else { return };
    let model = f.model.clone().unwrap_or_else(|| "codex".into());
    let c = price(&model).map(|p| cost(p, &d, 0));
    f.buckets.entry((day, model)).or_default().add(&d, c);
}

/// `rate_limits.primary/secondary` of a Codex `token_count`.
fn codex_limits(r: &Value, ts: Option<&str>) -> Option<Vec<UsageLimit>> {
    let at = DateTime::parse_from_rfc3339(ts?).ok()?.timestamp_millis();
    let out: Vec<UsageLimit> = ["primary", "secondary"]
        .iter()
        .filter_map(|k| {
            let w = &r[*k];
            let used = w["used_percent"].as_f64()?;
            let minutes = w["window_minutes"].as_u64().map(|m| m as u32);
            let resets_at = w["resets_at"].as_i64().map(|s| s * 1000).or_else(|| w["resets_in_seconds"].as_i64().map(|s| at + s * 1000));
            Some(UsageLimit {
                engine: "codex".into(),
                window: window_name(minutes, k),
                window_minutes: minutes,
                used_percent: used,
                resets_at,
                updated_at: at,
            })
        })
        .collect();
    (!out.is_empty()).then_some(out)
}

fn window_name(minutes: Option<u32>, fallback: &str) -> String {
    match minutes {
        Some(300) => "5h".into(),
        Some(10080) => "7d".into(),
        Some(m) if m % 1440 == 0 => format!("{}d", m / 1440),
        Some(m) if m % 60 == 0 => format!("{}h", m / 60),
        Some(m) => format!("{m}m"),
        None => fallback.into(),
    }
}

/// Claude Code's statusline input: `rate_limits.five_hour / seven_day / seven_day_opus / ...`
/// with `used_percentage` and `resets_at` (ISO time or Unix seconds).
pub fn claude_limits(payload: &Value, now: Millis) -> Vec<UsageLimit> {
    let Some(r) = payload["rate_limits"].as_object() else { return vec![] };
    r.iter()
        .filter_map(|(k, w)| {
            let used = w["used_percentage"].as_f64().or_else(|| w["utilization"].as_f64())?;
            let (window, minutes) = match k.as_str() {
                "five_hour" => ("5h".to_string(), Some(300)),
                "seven_day" => ("7d".to_string(), Some(10080)),
                other => (
                    other.strip_prefix("seven_day_").map_or_else(|| other.to_string(), |m| format!("7d_{m}")),
                    other.starts_with("seven_day").then_some(10080),
                ),
            };
            let resets_at = match &w["resets_at"] {
                Value::Number(n) => n.as_i64().map(|s| if s < 100_000_000_000 { s * 1000 } else { s }),
                Value::String(s) => DateTime::parse_from_rfc3339(s).ok().map(|t| t.timestamp_millis()),
                _ => None,
            };
            Some(UsageLimit { engine: "claude".into(), window, window_minutes: minutes, used_percent: used, resets_at, updated_at: now })
        })
        .collect()
}

/// Today minus `days - 1`, as `YYYY-MM-DD` (local time).
pub fn since_day(days: u32) -> String {
    let d = Local::now().date_naive() - chrono::Duration::days(i64::from(days.max(1)) - 1);
    d.format("%Y-%m-%d").to_string()
}

pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn prices_match_exact_or_dated_ids_only() {
        assert_eq!(price("claude-opus-5-5"), Some(PRICES[2].1));
        assert_eq!(price("claude-haiku-4-5-20251001").map(|p| p.input), Some(1.0));
        assert_eq!(price("claude/claude-haiku-4-5-20251001").map(|p| p.input), Some(1.0));
        assert_eq!(price("claude-opus-4-6[1m]").map(|p| p.input), Some(5.0));
        assert_eq!(price("gpt-5-codex").map(|p| p.input), Some(1.25));
        // a newer model must not get an older one's price
        assert_eq!(price("gpt-5.5"), None);
        assert_eq!(price("claude-opus-6"), None);
        assert_eq!(price("claude-opus-5-7"), None);
    }

    #[test]
    fn cost_of_a_call() {
        let t = TokenCounts { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 1_000_000 };
        // Opus 5.5: 4 + 20 + 0.2 + (half 5m: 0.5M*4*1.25 = 2.5) + (half 1h: 0.5M*4*2 = 4)
        let c = cost(price("claude-opus-5-5").unwrap(), &t, 500_000);
        assert!((c - 30.7).abs() < 1e-9, "{c}");
        // Haiku 5.5 above 100k input tokens: long-prompt prices
        let t = TokenCounts { input: 200_000, output: 0, cache_read: 0, cache_write: 0 };
        assert!((cost(price("claude-haiku-5-5").unwrap(), &t, 0) - 0.1).abs() < 1e-9);
    }

    #[test]
    fn reads_claude_and_codex_transcripts() {
        let home = std::env::temp_dir().join(format!("na-usage-{}", rand::random::<u32>()));
        let proj = home.join(".claude/projects/-tmp-p");
        std::fs::create_dir_all(proj.join("conv1/subagents")).unwrap();
        let ts = "2026-10-29T12:00:00.000Z";
        let msg = |id: &str, out: u64| {
            format!(
                r#"{{"type":"assistant","timestamp":"{ts}","cwd":"/tmp/p","message":{{"id":"{id}","model":"claude-opus-5-5","usage":{{"input_tokens":10,"output_tokens":{out},"cache_read_input_tokens":100,"cache_creation_input_tokens":0}}}}}}"#
            )
        };
        // the same message twice (one line per content block), then another one
        let main = format!("{}\n{}\n{}\n", msg("m1", 5), msg("m1", 5), msg("m2", 7));
        std::fs::write(proj.join("conv1.jsonl"), &main).unwrap();
        std::fs::write(proj.join("conv1/subagents/agent-a.jsonl"), format!("{}\n", msg("s1", 3))).unwrap();
        let codex = home.join(".codex/sessions/2026/10/29");
        std::fs::create_dir_all(&codex).unwrap();
        let tc = |inp: u64, cached: u64, out: u64, used: f64| {
            format!(
                r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{inp},"cached_input_tokens":{cached},"output_tokens":{out}}}}},"rate_limits":{{"primary":{{"used_percent":{used},"window_minutes":300,"resets_at":1793400000}},"secondary":{{"used_percent":3.0,"window_minutes":10080}}}}}}}}"#
            )
        };
        let rollout = codex.join("rollout-x.jsonl");
        std::fs::write(
            &rollout,
            format!(
                "{}\n{}\n{}\n{}\n",
                format_args!(r#"{{"timestamp":"{ts}","type":"session_meta","payload":{{"id":"thread-1","cwd":"/tmp/q"}}}}"#),
                format_args!(r#"{{"timestamp":"{ts}","type":"turn_context","payload":{{"model":"gpt-5-codex"}}}}"#),
                tc(1000, 400, 50, 10.0),
                tc(1000, 400, 50, 10.0),
            ),
        )
        .unwrap();

        let u = Usage::default();
        u.refresh(&home);
        let c = u.conversation("conv1").unwrap();
        assert_eq!(c.tokens, TokenCounts { input: 30, output: 15, cache_read: 300, cache_write: 0 });
        assert!(c.cost_usd.unwrap() > 0.0);
        let x = u.conversation("thread-1").unwrap();
        assert_eq!(x.tokens, TokenCounts { input: 600, output: 50, cache_read: 400, cache_write: 0 });
        assert_eq!(x.model.as_deref(), Some("gpt-5-codex"));

        // appended later: only the new part is counted
        let mut fh = std::fs::OpenOptions::new().append(true).open(&rollout).unwrap();
        writeln!(fh, "{}", tc(1500, 400, 80, 12.5)).unwrap();
        u.refresh(&home);
        assert_eq!(u.conversation("thread-1").unwrap().tokens.output, 80);
        let l = u.codex_limits();
        assert_eq!((l[0].window.as_str(), l[0].used_percent, l[0].resets_at), ("5h", 12.5, Some(1_793_400_000_000)));
        assert_eq!(l[1].window, "7d");

        let day = day(Some(ts)).unwrap();
        let rows = u.rows(&day, |cwd| (cwd == "/tmp/p").then(|| "ws1".to_string()));
        let claude: Vec<_> = rows.iter().filter(|r| r.engine == "claude").collect();
        assert_eq!((claude.len(), claude[0].calls, claude[0].workspace_id.as_deref()), (1, 3, Some("ws1")));
        assert!(rows.iter().any(|r| r.engine == "codex" && r.workspace_id.is_none()));
        assert!(u.rows("2999-01-01", |_| None).is_empty());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn claude_statusline_limits() {
        let v = serde_json::json!({ "rate_limits": {
            "five_hour": { "used_percentage": 42.0, "resets_at": "2026-10-29T23:00:00Z" },
            "seven_day": { "used_percentage": 7.5, "resets_at": 1793400000 },
            "seven_day_opus": { "used_percentage": 1.0 }
        }});
        let l = claude_limits(&v, 5);
        let five = l.iter().find(|x| x.window == "5h").unwrap();
        assert_eq!((five.used_percent, five.resets_at), (42.0, Some(1_793_314_800_000)));
        assert_eq!(l.iter().find(|x| x.window == "7d").unwrap().resets_at, Some(1_793_400_000_000));
        assert!(l.iter().any(|x| x.window == "7d_opus" && x.window_minutes == Some(10080)));
    }
}
