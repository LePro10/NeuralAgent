//! Read-only folder browsing for picking workspaces (also from the phone).

use std::path::{Path, PathBuf};

use na_protocol::{ApiError, ClientInfo, ClientKind, ErrorCode, FsEntry};
use serde_json::{Value, json};

use crate::core::err;

pub fn expand(home: &Path, p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    let out = if s == "~" {
        home.to_path_buf()
    } else if let Some(rest) = s.strip_prefix("~/") {
        home.join(rest)
    } else {
        p.to_path_buf()
    };
    out.canonicalize().unwrap_or(out)
}

pub fn list(home: &Path, client: &ClientInfo, path: &str) -> Result<Value, ApiError> {
    let dir = expand(home, Path::new(if path.is_empty() { "~" } else { path }));
    // Remote clients only see the home folder tree.
    if client.kind != ClientKind::Desktop && !dir.starts_with(home) {
        return Err(err(ErrorCode::Forbidden, "only folders inside your home folder can be browsed remotely"));
    }
    let rd = std::fs::read_dir(&dir).map_err(|e| err(ErrorCode::NotFound, format!("{}: {e}", dir.display())))?;
    let mut entries: Vec<FsEntry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let path = e.path();
            let is_dir = e.file_type().ok()?.is_dir() || path.is_dir();
            Some(FsEntry { git: is_dir && path.join(".git").exists(), dir: is_dir, name, path: path.to_string_lossy().into_owned() })
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(json!({ "path": dir.to_string_lossy(), "parent": dir.parent().map(|p| p.to_string_lossy().into_owned()), "entries": entries }))
}
