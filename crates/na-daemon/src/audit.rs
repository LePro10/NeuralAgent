//! Audit log: what phones, browsers and the orchestrator did on this computer.
//!
//! One JSON line per action in `audit.jsonl`; reads and terminal resizes are not logged, typing
//! is logged once a minute per device and agent. The desktop window is the user at the
//! keyboard and is not logged.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use na_protocol::{ApiError, AuditEntry, ClientInfo, ClientKind, Request, State};

use crate::core::Core;
use parking_lot::Mutex;
use serde_json::Value;

use crate::core::now_ms;

/// Past this size the file is cut to its newer half.
const MAX_BYTES: u64 = 1 << 20;
const TYPING_EVERY: Duration = Duration::from_secs(60);

pub struct Audit {
    file: PathBuf,
    lock: Mutex<HashMap<(String, String), Instant>>,
}

impl Audit {
    pub fn new(file: PathBuf) -> Self {
        Self { file, lock: Default::default() }
    }

    /// Records a request once its result is known (also refused ones).
    pub fn record(&self, core: &Core, client: &ClientInfo, req: &Request, result: Result<(), &ApiError>) {
        if client.kind == ClientKind::Desktop {
            return;
        }
        let v = serde_json::to_value(req).unwrap_or_default();
        let action = v["m"].as_str().unwrap_or("").to_string();
        if SKIP.contains(&action.as_str()) {
            return;
        }
        let p = &v["p"];
        let target = core.read(|s| describe(s, p));
        let who = client.device_id.clone().unwrap_or_else(|| client.name.clone());
        let mut seen = self.lock.lock();
        if action == "term_write" && result.is_ok() {
            let key = (who, target.clone().unwrap_or_default());
            if seen.get(&key).is_some_and(|t| t.elapsed() < TYPING_EVERY) {
                return;
            }
            seen.insert(key, Instant::now());
        }
        let entry = AuditEntry {
            at: now_ms(),
            client: client.kind,
            device: client.name.clone(),
            action,
            target,
            ok: result.is_ok(),
            error: result.err().map(|e| e.message.clone()),
        };
        // Written under the lock so lines never interleave.
        if let Err(e) = self.append(&entry) {
            tracing::warn!("audit log: {e:#}");
        }
    }

    fn append(&self, entry: &AuditEntry) -> anyhow::Result<()> {
        if std::fs::metadata(&self.file).is_ok_and(|m| m.len() > MAX_BYTES) {
            let text = std::fs::read_to_string(&self.file).unwrap_or_default();
            let lines: Vec<&str> = text.lines().collect();
            let keep = lines[lines.len() / 2..].join("\n") + "\n";
            crate::paths::write_private(&self.file, keep.as_bytes())?;
        }
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.file)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = f.set_permissions(std::fs::Permissions::from_mode(0o600));
        }
        writeln!(f, "{}", serde_json::to_string(entry)?)?;
        Ok(())
    }

    /// Newest first.
    pub fn list(&self, limit: usize) -> Vec<AuditEntry> {
        let _g = self.lock.lock();
        let text = std::fs::read_to_string(&self.file).unwrap_or_default();
        text.lines().rev().filter_map(|l| serde_json::from_str(l).ok()).take(limit).collect()
    }
}

/// Requests that only read, or are too frequent to matter.
const SKIP: &[&str] =
    &["fs_list", "fs_roots", "git_changes", "git_diff", "usage_report", "history_search", "term_resize", "catalog_refresh", "audit_list", "host_models", "host_update_check", "host_notice"];

/// "Japan Map — Claude" for a session, the workspace name, or a path.
fn describe(state: &State, p: &Value) -> Option<String> {
    let session = ["sid", "id", "session_id"].iter().find_map(|k| p[k].as_str()).and_then(|id| state.sessions.get(id));
    if let Some(s) = session {
        let ws = state.workspaces.iter().find(|w| w.id == s.workspace_id).map(|w| w.name.as_str()).unwrap_or("?");
        return Some(format!("{ws} — {}", s.title));
    }
    let ws_id = p["workspace_id"].as_str().or_else(|| p["id"].as_str());
    if let Some(w) = ws_id.and_then(|id| state.workspaces.iter().find(|w| w.id == id)) {
        return Some(w.name.clone());
    }
    p["path"].as_str().or_else(|| p["device_id"].as_str()).map(str::to_string)
}
