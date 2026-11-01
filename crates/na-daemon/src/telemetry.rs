//! Anonymous usage stats and problem reports (Settings → Privacy, docs/notes/insights.md).
//!
//! Usage ping: once a day, if `settings.usage_stats` is not `false`, the daemon posts to
//! `<relay>/api/telemetry` a random install id (made up here, never tied to the account), the
//! app version, OS, architecture, language and how often features were used (counters only:
//! "agents started: 4", never names, paths, prompts or output). Debug builds send nothing
//! unless `NEURALAGENT_TELEMETRY=1`; `NEURALAGENT_TELEMETRY=0` always turns it off.
//!
//! Problem report: only when the user presses Send. It holds what the user wrote plus a
//! diagnostics snapshot (versions, OS, settings without secrets, agent CLIs, session states,
//! permissions, the redacted end of the daemon log, and Neural's recent requests only if the user
//! ticked that box). The user sees the exact JSON before sending (`DiagnosticsPreview`).

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use na_protocol::{ApiError, ErrorCode, OrchRole};
use parking_lot::Mutex;
use serde_json::{Value, json};

use crate::core::{Core, err};

/// Feature counters since the last ping.
#[derive(Default)]
pub struct Telemetry {
    counts: Mutex<BTreeMap<String, i64>>,
    dirty: AtomicBool,
}

const PING_EVERY: i64 = 24 * 3600;
const TICK: Duration = Duration::from_secs(10 * 60);
/// Log lines a report carries at most.
const LOG_LINES: usize = 400;
/// Neural requests a report carries at most (only when the user allowed it).
const PROMPTS: usize = 20;

impl Telemetry {
    /// Counts a use of a feature (`agents_started`, `agent.claude`, `neural_turns`, …).
    pub fn count(&self, key: &str, n: i64) {
        *self.counts.lock().entry(key.to_string()).or_default() += n;
        self.dirty.store(true, Ordering::Relaxed);
    }

    fn snapshot(&self) -> BTreeMap<String, i64> {
        self.counts.lock().clone()
    }

    /// Forgets what a successful ping sent (counts made meanwhile stay).
    fn sent(&self, sent: &BTreeMap<String, i64>) {
        let mut c = self.counts.lock();
        for (k, n) in sent {
            if let Some(v) = c.get_mut(k) {
                *v -= n;
            }
        }
        c.retain(|_, v| *v > 0);
        self.dirty.store(true, Ordering::Relaxed);
    }

    fn clear(&self) {
        self.counts.lock().clear();
        self.dirty.store(true, Ordering::Relaxed);
    }
}

fn file(core: &Core, name: &str) -> std::path::PathBuf {
    core.paths.root.join(name)
}

/// Whether the usage ping is on (setting, build type, environment).
pub fn enabled(core: &Core) -> bool {
    match std::env::var("NEURALAGENT_TELEMETRY").as_deref() {
        Ok("0") => return false,
        Ok("1") => {}
        _ if cfg!(debug_assertions) => return false,
        _ => {}
    }
    core.read(|s| s.settings.usage_stats) != Some(false)
}

/// The random install id; a new one is made when missing. Not secret, but not the account.
fn install_id(root: &Path) -> String {
    let path = root.join("install-id");
    if let Ok(s) = std::fs::read_to_string(&path) {
        let s = s.trim();
        if s.len() >= 16 && s.len() <= 64 {
            return s.to_string();
        }
    }
    let id: String = rand::random::<[u8; 16]>().iter().map(|b| format!("{b:02x}")).collect();
    let _ = crate::paths::write_private(&path, id.as_bytes());
    id
}

fn os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        _ => "other",
    }
}

/// The OS version ("15.1", "10.0.26100", "Ubuntu 24.04"), cached.
pub fn os_version() -> Option<String> {
    static V: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    V.get_or_init(|| {
        let out = |cmd: &str, args: &[&str]| {
            std::process::Command::new(cmd)
                .args(args)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        };
        let v = match std::env::consts::OS {
            "macos" => out("sw_vers", &["-productVersion"]),
            "windows" => {
                out("cmd", &["/C", "ver"]).and_then(|s| s.split("Version ").nth(1).map(|v| v.trim_end_matches(']').trim().to_string()))
            }
            _ => std::fs::read_to_string("/etc/os-release")
                .ok()
                .and_then(|t| t.lines().find_map(|l| l.strip_prefix("PRETTY_NAME=")).map(|v| v.trim_matches('"').to_string())),
        };
        v.map(|s| s.chars().filter(|c| c.is_ascii_alphanumeric() || " ._-".contains(*c)).take(32).collect())
    })
    .clone()
}

/// "macos 15.1": what the relay shows the admin next to a device.
pub fn os_label() -> String {
    match os_version() {
        Some(v) => format!("{} {v}", os()),
        None => os().into(),
    }
}

fn locale() -> Option<String> {
    let v = std::env::var("LC_ALL").ok().or_else(|| std::env::var("LANG").ok()).filter(|v| !v.is_empty() && v != "C")?;
    Some(v.split('.').next().unwrap_or_default().replace('_', "-").chars().take(16).collect())
}

/// The usage ping, exactly as sent.
pub fn ping_body(core: &Core) -> Value {
    json!({
        "install": install_id(&core.paths.root),
        "app": "desktop",
        "version": env!("CARGO_PKG_VERSION"),
        "os": os(),
        "os_version": os_version(),
        "arch": std::env::consts::ARCH,
        "locale": locale(),
        "counts": core.telemetry.snapshot(),
    })
}

async fn send_ping(core: &Arc<Core>) -> anyhow::Result<()> {
    let body = ping_body(core);
    let sent: BTreeMap<String, i64> = serde_json::from_value(body["counts"].clone()).unwrap_or_default();
    let url = format!("{}/api/telemetry", crate::remote::relay_url(core));
    crate::remote::http(core).post(url).json(&body).timeout(Duration::from_secs(20)).send().await?.error_for_status()?;
    core.telemetry.sent(&sent);
    Ok(())
}

fn last_ping(core: &Core) -> i64 {
    std::fs::read_to_string(file(core, "usage-ping")).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

fn now_s() -> i64 {
    crate::core::now_ms() / 1000
}

/// Loads unsent counters, then saves them every few minutes and pings once a day.
pub fn start(core: &Arc<Core>) {
    if let Some(saved) =
        std::fs::read(file(core, "usage-counts.json")).ok().and_then(|b| serde_json::from_slice::<BTreeMap<String, i64>>(&b).ok())
    {
        for (k, n) in saved {
            core.telemetry.count(&k, n);
        }
    }
    let core = core.clone();
    tokio::spawn(async move {
        // Not right at start: the first minutes belong to the user.
        tokio::time::sleep(Duration::from_secs(120)).await;
        loop {
            if !enabled(&core) {
                core.telemetry.clear();
            } else if now_s() - last_ping(&core) >= PING_EVERY {
                match send_ping(&core).await {
                    Ok(()) => {
                        let _ = crate::paths::write_private(&file(&core, "usage-ping"), now_s().to_string().as_bytes());
                        tracing::info!("usage ping sent");
                    }
                    Err(e) => tracing::debug!("usage ping failed: {e:#}"),
                }
            }
            if core.telemetry.dirty.swap(false, Ordering::Relaxed) {
                let snap = core.telemetry.snapshot();
                let _ = crate::paths::write_private(&file(&core, "usage-counts.json"), &serde_json::to_vec(&snap).unwrap_or_default());
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

// ───────────── problem reports ─────────────

/// Removes what must never leave the computer from a log line: tokens, keys, the user's name.
pub fn redact(line: &str, home: &str) -> String {
    let sep = |c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ',';
    let mut out = String::with_capacity(line.len());
    // The word after "Bearer" / "Authorization:" is the secret itself.
    let mut next_secret = false;
    for word in line.split_inclusive(sep) {
        let (w, tail) = match word.char_indices().last() {
            Some((i, c)) if sep(c) => (&word[..i], &word[i..]),
            _ => (word, ""),
        };
        let lower = w.to_ascii_lowercase();
        let after_key = ["token=", "key=", "secret=", "password=", "refresh=", "access=", "code=", "token:", "key:"]
            .iter()
            .find_map(|k| lower.find(k).map(|i| i + k.len()))
            .filter(|i| *i < w.len());
        let long_random = w.len() >= 32
            && w.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=+/".contains(c))
            && w.chars().any(|c| c.is_ascii_digit())
            && !w.contains('/');
        if w.is_empty() {
        } else if next_secret && lower != "bearer" {
            out.push_str("[redacted]");
            next_secret = false;
        } else if let Some(i) = after_key {
            out.push_str(&w[..i]);
            out.push_str("[redacted]");
        } else if lower.starts_with("sk-") || long_random {
            out.push_str("[redacted]");
        } else {
            next_secret = lower == "bearer" || lower == "authorization:";
            out.push_str(w);
        }
        out.push_str(tail);
    }
    if home.len() > 1 { out.replace(home, "~") } else { out }
}

fn log_tail(core: &Core, n: usize) -> Vec<String> {
    let home = core.env.home.to_string_lossy().to_string();
    let path = core.paths.log();
    let Ok(text) = std::fs::read_to_string(&path) else { return vec![] };
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].iter().map(|l| redact(&l.chars().take(600).collect::<String>(), &home)).collect()
}

/// The diagnostics part of a report: what helps to find a problem, nothing private.
pub fn diagnostics(core: &Core, include_logs: bool, include_prompts: bool) -> Value {
    let home = core.env.home.to_string_lossy().to_string();
    let (settings, agents, sessions, remote, prompts) = core.read(|s| {
        let st = &s.settings;
        let settings = json!({
            "theme": st.theme, "keep_awake": st.keep_awake, "resume_on_start": st.resume_on_start,
            "default_profile": st.default_profile, "discord_presence": st.discord_presence,
            "neural": { "provider": st.llm.provider, "model": st.llm.model, "call_model": st.llm.call_model,
                "custom_url": !st.llm.base_url.is_empty() },
            "remote_files_home": st.remote_files_home, "usage_stats": st.usage_stats != Some(false),
            "workspaces": s.workspaces.len(), "mcp_servers": s.mcp.len(),
        });
        let agents: Vec<Value> = s
            .catalog
            .iter()
            .filter(|c| c.installed)
            .map(|c| json!({ "id": c.id, "name": c.name, "version": c.version, "hooks": c.hooks }))
            .collect();
        let mut by_status: BTreeMap<String, usize> = BTreeMap::new();
        let mut by_profile: BTreeMap<String, usize> = BTreeMap::new();
        let mut exits: Vec<Value> = vec![];
        for x in s.sessions.values() {
            *by_status
                .entry(serde_json::to_value(&x.status).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default())
                .or_default() += 1;
            *by_profile.entry(x.profile_id.clone()).or_default() += 1;
            if let Some(code) = x.exit_code.filter(|c| *c != 0) {
                exits.push(json!({ "profile": x.profile_id, "exit_code": code }));
            }
        }
        let sessions = json!({ "total": s.sessions.len(), "alive": s.sessions.values().filter(|x| x.alive).count(),
            "by_status": by_status, "by_profile": by_profile, "failed_exits": exits.into_iter().take(20).collect::<Vec<_>>() });
        let remote = json!({ "status": s.remote.status, "relay": s.remote.relay, "paused": s.remote.paused,
            "signed_in": s.remote.account.is_some(), "devices": s.remote.devices.len(), "error": s.remote.error });
        let prompts: Vec<Value> = if include_prompts {
            let mut v: Vec<Value> = s
                .orchestrator
                .messages
                .iter()
                .rev()
                .filter(|m| m.role == OrchRole::User)
                .take(PROMPTS)
                .map(|m| json!({ "at": m.at, "text": redact(&m.text.chars().take(2000).collect::<String>(), &home) }))
                .collect();
            v.reverse();
            v
        } else {
            vec![]
        };
        (settings, agents, sessions, remote, prompts)
    });
    let mut d = json!({
        "generated_at": crate::core::now_ms(),
        "app": { "version": env!("CARGO_PKG_VERSION"), "protocol": na_protocol::PROTOCOL_VERSION,
            "build": if cfg!(debug_assertions) { "debug" } else { "release" } },
        "system": {
            "os": os(), "os_version": os_version(), "arch": std::env::consts::ARCH, "locale": locale(),
            "host_mode": crate::service::host_mode(), "cpus": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
            "full_disk_access": crate::permissions::full_disk_access(&core.env.home),
        },
        "settings": settings,
        "remote": remote,
        "agents": agents,
        "sessions": sessions,
        "usage_counts": core.telemetry.snapshot(),
    });
    if include_logs {
        d["log"] = log_tail(core, LOG_LINES).into();
    }
    if include_prompts {
        d["neural_prompts"] = prompts.into();
    }
    d
}

/// Sends a problem report; the answer is the id to quote ("R-7F3K2Q").
pub async fn send_report(
    core: &Arc<Core>,
    summary: String,
    details: String,
    contact: Option<String>,
    include_logs: bool,
    include_prompts: bool,
) -> Result<String, ApiError> {
    if summary.trim().is_empty() {
        return Err(err(ErrorCode::BadRequest, "describe the problem in a few words"));
    }
    let body = json!({
        "app": "desktop",
        "version": env!("CARGO_PKG_VERSION"),
        "os": os(),
        "summary": summary,
        "details": details,
        "contact": contact,
        "diagnostics": diagnostics(core, include_logs, include_prompts),
    });
    let url = format!("{}/api/reports", crate::remote::relay_url(core));
    let mut req = crate::remote::http(core).post(url).json(&body).timeout(Duration::from_secs(30));
    if let Some(token) = crate::remote::access_token(core).await {
        req = req.bearer_auth(token);
    }
    let res =
        req.send().await.map_err(|e| err(ErrorCode::Internal, format!("could not reach the NeuralAgent server ({})", e.without_url())))?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let msg = res.json::<Value>().await.ok().and_then(|v| v["error"].as_str().map(str::to_string)).unwrap_or_default();
        return Err(err(ErrorCode::Internal, format!("the server answered {status} {msg}").trim().to_string()));
    }
    let v: Value = res.json().await.map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    let id = v["id"].as_str().unwrap_or_default().to_string();
    tracing::info!(%id, "problem report sent");
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction() {
        let home = "/Users/ann";
        assert_eq!(redact("GET /x?token=abc123 ok", home), "GET /x?token=[redacted] ok");
        assert_eq!(redact("key sk-ant-12345 used", home), "key [redacted] used");
        assert_eq!(redact("Authorization: Bearer abcdefg", home), "Authorization: Bearer [redacted]");
        assert_eq!(redact("opened /Users/ann/code/app", home), "opened ~/code/app");
        assert_eq!(redact("id 0123456789abcdef0123456789abcdef9 end", home), "id [redacted] end");
        assert_eq!(redact("plain words stay, as they are", home), "plain words stay, as they are");
    }
}
