//! Recovering a connector whose build did not finish (D92): the last working version is kept
//! outside the connector's folder (`<home>/connectors/.backup/<id>`), so the check, `node --test`
//! and copies never see it. Reset and restore first park what was in the folder in
//! `<home>/connectors/.discarded/<id>`, so nothing the user wrote is lost by a button.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::embedded;

/// Never copied or deleted: installed dependencies and git history stay where they are.
fn kept(name: &str) -> bool {
    name == "node_modules" || name == ".git"
}

pub fn backup_dir(root: &Path, id: &str) -> PathBuf {
    root.join("connectors").join(".backup").join(id)
}

pub fn discarded_dir(root: &Path, id: &str) -> PathBuf {
    root.join("connectors").join(".discarded").join(id)
}

/// A last working version exists.
pub fn has_backup(root: &Path, id: &str) -> bool {
    backup_dir(root, id).join("connector.json").is_file()
}

pub fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let name = e.file_name();
        if kept(&name.to_string_lossy()) {
            continue;
        }
        let t = e.file_type()?;
        if t.is_dir() {
            copy_dir(&e.path(), &to.join(&name))?;
        } else if t.is_file() {
            std::fs::copy(e.path(), to.join(&name))?;
        }
    }
    Ok(())
}

/// Replaces `dest` with a copy of `dir` (written beside it first, so a crash keeps the old one).
pub fn snapshot(dir: &Path, dest: &Path) -> io::Result<()> {
    let tmp = dest.with_extension("tmp");
    let _ = std::fs::remove_dir_all(&tmp);
    copy_dir(dir, &tmp)?;
    let _ = std::fs::remove_dir_all(dest);
    std::fs::rename(&tmp, dest)
}

fn clear(dir: &Path) -> io::Result<()> {
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        if kept(&e.file_name().to_string_lossy()) {
            continue;
        }
        if e.file_type()?.is_dir() {
            std::fs::remove_dir_all(e.path())?;
        } else {
            std::fs::remove_file(e.path())?;
        }
    }
    Ok(())
}

/// The folder's content becomes `src`'s; what was in it is parked in `discarded`.
fn replace_with(dir: &Path, src: &Path, discarded: &Path) -> io::Result<()> {
    if dir.is_dir() {
        snapshot(dir, discarded)?;
        clear(dir)?;
    }
    copy_dir(src, dir)
}

/// Back to the last working version.
pub fn restore(dir: &Path, backup: &Path, discarded: &Path) -> io::Result<()> {
    if !backup.join("connector.json").is_file() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "there is no working version to go back to"));
    }
    replace_with(dir, backup, discarded)
}

/// Back to the template; name and description stay.
pub fn reset(dir: &Path, discarded: &Path, name: &str, description: &str) -> io::Result<()> {
    let tpl = discarded.with_extension("tpl");
    let _ = std::fs::remove_dir_all(&tpl);
    let r = (|| {
        embedded::write_template(&tpl).map_err(|e| io::Error::other(format!("{e:#}")))?;
        let file = tpl.join("connector.json");
        if let Ok(text) = std::fs::read_to_string(&file)
            && let Ok(mut v) = serde_json::from_str::<Value>(&text)
        {
            v["name"] = Value::from(name);
            v["description"] = Value::from(description);
            std::fs::write(&file, serde_json::to_vec_pretty(&v).unwrap_or_default())?;
        }
        replace_with(dir, &tpl, discarded)
    })();
    let _ = std::fs::remove_dir_all(&tpl);
    r
}

/// A hash of every file in the folder: did the agent change anything?
pub fn fingerprint(dir: &Path) -> u64 {
    fn walk(dir: &Path, h: &mut DefaultHasher) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if kept(&name) {
                continue;
            }
            name.hash(h);
            let p = e.path();
            if p.is_dir() {
                walk(&p, h);
            } else if let Ok(b) = std::fs::read(&p) {
                b.hash(h);
            }
        }
    }
    let mut h = DefaultHasher::new();
    walk(dir, &mut h);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("na-rec-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn snapshot_then_restore_brings_the_old_files_back() {
        let root = tmp("restore");
        let dir = root.join("connectors/mine");
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("connector.json"), "{\"name\":\"good\"}").unwrap();
        std::fs::write(dir.join("index.mjs"), "export const a = 1;\n").unwrap();
        assert!(!has_backup(&root, "mine"));
        snapshot(&dir, &backup_dir(&root, "mine")).unwrap();
        assert!(has_backup(&root, "mine"));
        // The agent leaves a half-written file and an extra one.
        std::fs::write(dir.join("index.mjs"), "export const a = (\n").unwrap();
        std::fs::write(dir.join("extra.mjs"), "x").unwrap();
        restore(&dir, &backup_dir(&root, "mine"), &discarded_dir(&root, "mine")).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("index.mjs")).unwrap(), "export const a = 1;\n");
        assert!(!dir.join("extra.mjs").exists());
        assert!(dir.join("node_modules").is_dir(), "dependencies stay");
        // What was in the folder is parked, not lost.
        assert_eq!(std::fs::read_to_string(discarded_dir(&root, "mine").join("index.mjs")).unwrap(), "export const a = (\n");
        // The backup is not part of the folder.
        assert!(!dir.join(".backup").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_without_a_backup_fails_and_changes_nothing() {
        let root = tmp("nobackup");
        let dir = root.join("connectors/mine");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.mjs"), "keep").unwrap();
        assert!(restore(&dir, &backup_dir(&root, "mine"), &discarded_dir(&root, "mine")).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("index.mjs")).unwrap(), "keep");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reset_writes_the_template_and_keeps_name_and_description() {
        let root = tmp("reset");
        let dir = root.join("connectors/mine");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.mjs"), "broken (").unwrap();
        std::fs::write(dir.join("mine.txt"), "mine").unwrap();
        reset(&dir, &discarded_dir(&root, "mine"), "My app", "Reads my app").unwrap();
        let m: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("connector.json")).unwrap()).unwrap();
        assert_eq!(m["name"], "My app");
        assert_eq!(m["description"], "Reads my app");
        assert_ne!(std::fs::read_to_string(dir.join("index.mjs")).unwrap(), "broken (");
        assert!(!dir.join("mine.txt").exists());
        assert_eq!(std::fs::read_to_string(discarded_dir(&root, "mine").join("mine.txt")).unwrap(), "mine");
        assert!(!discarded_dir(&root, "mine").with_extension("tpl").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn fingerprint_notices_changes() {
        let d = tmp("fp");
        std::fs::write(d.join("a.mjs"), "1").unwrap();
        let a = fingerprint(&d);
        assert_eq!(a, fingerprint(&d));
        std::fs::write(d.join("a.mjs"), "2").unwrap();
        assert_ne!(a, fingerprint(&d));
        let _ = std::fs::remove_dir_all(&d);
    }
}
