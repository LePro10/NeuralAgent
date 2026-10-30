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

/// `dir` (already resolved) is the home folder or below it; a symlinked home counts too.
fn inside(home: &Path, dir: &Path) -> bool {
    dir.starts_with(home) || home.canonicalize().is_ok_and(|h| dir.starts_with(h))
}

pub fn list(home: &Path, client: &ClientInfo, path: &str) -> Result<Value, ApiError> {
    let dir = expand(home, Path::new(if path.is_empty() { "~" } else { path }));
    // Remote clients only see the home folder tree.
    if client.kind != ClientKind::Desktop && !inside(home, &dir) {
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
    Ok(json!({ "path": dir.to_string_lossy(), "git": dir.join(".git").exists(), "parent": dir.parent().map(|p| p.to_string_lossy().into_owned()), "entries": entries }))
}

/// Where to start: the home folder and the places projects usually live.
pub fn roots(home: &Path) -> Value {
    let projects: Vec<FsEntry> = ["Projects", "Developer", "Code", "dev", "src", "repos", "GitHub", "Documents", "Desktop"]
        .iter()
        .map(|n| home.join(n))
        .filter(|p| p.is_dir())
        .map(|p| FsEntry {
            git: p.join(".git").exists(),
            dir: true,
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            path: p.to_string_lossy().into_owned(),
        })
        .collect();
    json!({ "home": home.to_string_lossy(), "projects": projects })
}

/// Makes one new folder. Remote clients stay inside the home folder, like browsing.
pub fn mkdir(home: &Path, client: &ClientInfo, parent: &str, name: &str) -> Result<Value, ApiError> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err(err(ErrorCode::BadRequest, "A folder name cannot be empty or contain slashes"));
    }
    let dir = expand(home, Path::new(parent));
    if client.kind != ClientKind::Desktop && !inside(home, &dir) {
        return Err(err(ErrorCode::Forbidden, "only folders inside your home folder can be changed remotely"));
    }
    let new = dir.join(name);
    std::fs::create_dir(&new).map_err(|e| {
        let code = if e.kind() == std::io::ErrorKind::AlreadyExists { ErrorCode::Conflict } else { ErrorCode::BadRequest };
        err(code, format!("could not create {}: {e}", new.display()))
    })?;
    Ok(json!(FsEntry { git: false, dir: true, name: name.to_string(), path: new.to_string_lossy().into_owned() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(kind: ClientKind) -> ClientInfo {
        ClientInfo { kind, name: "t".into(), device_id: None }
    }

    #[test]
    fn makes_folders_inside_home_only_for_remotes() {
        let home = std::env::temp_dir().join(format!("na-fs-{}", std::process::id()));
        std::fs::create_dir_all(home.join("Projects")).unwrap();
        let home = home.canonicalize().unwrap();
        let web = client(ClientKind::Web);
        let r = mkdir(&home, &web, "~/Projects", "new app").unwrap();
        assert!(home.join("Projects/new app").is_dir() && r["name"] == "new app");
        assert_eq!(mkdir(&home, &web, "~/Projects", "new app").unwrap_err().code, ErrorCode::Conflict);
        assert_eq!(mkdir(&home, &web, "~/Projects", "../x").unwrap_err().code, ErrorCode::BadRequest);
        assert_eq!(mkdir(&home, &web, "/tmp", "x").unwrap_err().code, ErrorCode::Forbidden);
        assert_eq!(roots(&home)["projects"][0]["name"], "Projects");
        let _ = std::fs::remove_dir_all(&home);
    }
}
