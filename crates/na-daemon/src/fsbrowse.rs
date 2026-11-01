//! Read-only folder browsing for picking workspaces (also from the phone).

use std::path::{Path, PathBuf};

use na_protocol::{ApiError, ClientInfo, ClientKind, ErrorCode, FsEntry};
use serde_json::{Value, json};

use crate::core::err;
use crate::permissions::Gate;

pub fn expand(home: &Path, p: &Path) -> PathBuf {
    let out = expand_lexical(home, &p.to_string_lossy());
    out.canonicalize().unwrap_or(out)
}

/// `~` expanded and `.`/`..` folded, without the disk (resolving could already look inside a
/// folder macOS guards).
pub fn expand_lexical(home: &Path, s: &str) -> PathBuf {
    let p = if s == "~" {
        home.to_path_buf()
    } else if let Some(rest) = s.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(s)
    };
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            c => out.push(c),
        }
    }
    out
}

/// `dir` (already resolved) is the home folder or below it; a symlinked home counts too.
fn inside(home: &Path, dir: &Path) -> bool {
    dir.starts_with(home) || home.canonicalize().is_ok_and(|h| dir.starts_with(h))
}

/// One folder of a listing in `parent` (the guarded folder the listed folder lies in). A
/// folder that leads into another guarded folder (Documents itself, a link into Desktop, …) is
/// not looked into for its `.git`, and is marked when the caller may not open it (`gate`).
fn entry(path: PathBuf, name: String, dir: bool, gate: &Gate, parent: Option<&PathBuf>) -> FsEntry {
    let root = if dir { gate.root(&path) } else { None };
    let shut = gate.is_shut(root.as_ref());
    let git = dir && root.as_ref() == parent && path.join(".git").exists();
    FsEntry { git, dir, name, path: path.to_string_lossy().into_owned(), needs_fda: shut.then_some(true) }
}

pub fn list(home: &Path, client: &ClientInfo, path: &str, gate: &Gate) -> Result<Value, ApiError> {
    let given = expand_lexical(home, if path.is_empty() { "~" } else { path });
    if !given.is_absolute() {
        return Err(err(ErrorCode::BadRequest, "Use a full path"));
    }
    // Before resolving: that alone could look inside a guarded folder.
    gate.check(&given)?;
    let dir = given.canonicalize().unwrap_or(given);
    // Remote clients only see the home folder tree.
    if client.kind != ClientKind::Desktop && !inside(home, &dir) {
        return Err(err(ErrorCode::Forbidden, "only folders inside your home folder can be browsed remotely"));
    }
    let rd = std::fs::read_dir(&dir);
    gate.answered(&dir, &rd);
    let parent = gate.root(&dir);
    let rd = rd.map_err(|e| err(ErrorCode::NotFound, format!("{}: {e}", dir.display())))?;
    let mut entries: Vec<FsEntry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let path = e.path();
            let ft = e.file_type().ok()?;
            // A link is followed only when that does not lead into another guarded folder.
            let is_dir = ft.is_dir() || (ft.is_symlink() && (gate.root(&path).as_ref() != parent.as_ref() || path.is_dir()));
            Some(entry(path, name, is_dir, gate, parent.as_ref()))
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(json!({
        "path": dir.to_string_lossy(),
        "git": dir.join(".git").exists(),
        "parent": dir.parent().map(|p| p.to_string_lossy().into_owned()),
        "entries": entries,
    }))
}

/// Where to start: the home folder and the places projects usually live.
pub fn roots(home: &Path, gate: &Gate) -> Value {
    let projects: Vec<FsEntry> = ["Projects", "Developer", "Code", "dev", "src", "repos", "GitHub", "Documents", "Desktop"]
        .iter()
        .map(|n| (home.join(n), n.to_string()))
        // A stat of the folder itself never asks; its `.git` would (see `entry`).
        .filter(|(p, _)| p.is_dir())
        .map(|(p, n)| entry(p, n, true, gate, None))
        .collect();
    json!({ "home": home.to_string_lossy(), "projects": projects })
}

/// Makes one new folder. Remote clients stay inside the home folder, like browsing.
pub fn mkdir(home: &Path, client: &ClientInfo, parent: &str, name: &str, gate: &Gate) -> Result<Value, ApiError> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err(err(ErrorCode::BadRequest, "A folder name cannot be empty or contain slashes"));
    }
    let given = expand_lexical(home, parent);
    gate.check(&given)?;
    let dir = given.canonicalize().unwrap_or(given);
    if client.kind != ClientKind::Desktop && !inside(home, &dir) {
        return Err(err(ErrorCode::Forbidden, "only folders inside your home folder can be changed remotely"));
    }
    let new = dir.join(name);
    std::fs::create_dir(&new).map_err(|e| {
        let code = if e.kind() == std::io::ErrorKind::AlreadyExists { ErrorCode::Conflict } else { ErrorCode::BadRequest };
        err(code, format!("could not create {}: {e}", new.display()))
    })?;
    Ok(json!(FsEntry { git: false, dir: true, name: name.to_string(), path: new.to_string_lossy().into_owned(), needs_fda: None }))
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
        let open = Gate::open();
        let r = mkdir(&home, &web, "~/Projects", "new app", &open).unwrap();
        assert!(home.join("Projects/new app").is_dir() && r["name"] == "new app");
        assert_eq!(mkdir(&home, &web, "~/Projects", "new app", &open).unwrap_err().code, ErrorCode::Conflict);
        assert_eq!(mkdir(&home, &web, "~/Projects", "../x", &open).unwrap_err().code, ErrorCode::BadRequest);
        assert_eq!(mkdir(&home, &web, "/tmp", "x", &open).unwrap_err().code, ErrorCode::Forbidden);
        assert_eq!(roots(&home, &open)["projects"][0]["name"], "Projects");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn guarded_folders_stay_shut_for_a_phone_without_full_disk_access() {
        let home = std::env::temp_dir().join(format!("na-fsg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for d in ["Documents/app/.git", "Desktop", "code/.git"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(home.join("Documents/app"), home.join("code-link")).unwrap();
        let home = home.canonicalize().unwrap();
        let web = client(ClientKind::Web);
        let gate = Gate::remote_without_fda(&home);
        let l = list(&home, &web, "~", &gate).unwrap();
        let by = |n: &str| l["entries"].as_array().unwrap().iter().find(|e| e["name"] == n).cloned().unwrap();
        assert_eq!(by("Documents")["needs_fda"], true);
        assert_eq!(by("Documents")["git"], false, "no .git probe inside a guarded folder");
        assert_eq!(by("code")["git"], true);
        assert!(by("code").get("needs_fda").is_none());
        #[cfg(unix)]
        assert_eq!((by("code-link")["needs_fda"].clone(), by("code-link")["dir"].clone()), (json!(true), json!(true)));
        for p in ["~/Documents", "~/documents/app", "~/code/../Documents", "~/code-link"] {
            assert_eq!(list(&home, &web, p, &gate).unwrap_err().message, crate::permissions::NEEDS_FDA, "{p}");
        }
        assert_eq!(mkdir(&home, &web, "~/Desktop", "x", &gate).unwrap_err().message, crate::permissions::NEEDS_FDA);
        let r = roots(&home, &gate);
        assert!(r["projects"].as_array().unwrap().iter().any(|p| p["name"] == "Documents" && p["needs_fda"] == true && p["git"] == false));
        // The desktop (someone at the computer) may open it; the .git inside is still not probed from home.
        let desk = list(&home, &client(ClientKind::Desktop), "~/Documents", &Gate::open()).unwrap();
        assert_eq!(desk["entries"][0]["git"], true);
        let _ = std::fs::remove_dir_all(&home);
    }
}
