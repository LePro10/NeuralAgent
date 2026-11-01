//! Keys the user typed in (LLM providers). Windows release builds keep them in the Credential
//! Manager (no per-binary prompts there). Everywhere else they live in `<data>/keys.json`, a
//! file only the user can read: the macOS keychain ties an item to the exact binary, so every
//! update (and every settings change, which re-checks all providers) stopped at a password
//! prompt, and the daemon's start waited on it (D43, D80). Linux has no keychain we can rely on.

const SERVICE: &str = "dev.neuralhub.neuralagent.keys";

#[cfg(all(not(debug_assertions), target_os = "windows"))]
mod store {
    pub fn get(_: &std::path::Path, account: &str) -> Option<String> {
        keyring::Entry::new(super::SERVICE, account).ok()?.get_password().ok()
    }
    pub fn set(_: &std::path::Path, account: &str, v: Option<&str>) -> anyhow::Result<()> {
        let e = keyring::Entry::new(super::SERVICE, account)?;
        match v {
            Some(v) => e.set_password(v)?,
            None => {
                let _ = e.delete_credential();
            }
        }
        Ok(())
    }
    pub fn migrate(_: &std::path::Path, _: &[String]) -> bool {
        false
    }
}

#[cfg(not(all(not(debug_assertions), target_os = "windows")))]
mod store {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    fn path(root: &Path) -> PathBuf {
        root.join("keys.json")
    }
    fn all(root: &Path) -> BTreeMap<String, String> {
        std::fs::read_to_string(path(root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    fn save(root: &Path, m: &BTreeMap<String, String>) -> anyhow::Result<()> {
        crate::paths::write_private(&path(root), serde_json::to_string(m)?.as_bytes())
    }
    pub fn get(root: &Path, account: &str) -> Option<String> {
        all(root).remove(account)
    }
    pub fn set(root: &Path, account: &str, v: Option<&str>) -> anyhow::Result<()> {
        let mut m = all(root);
        match v {
            Some(v) => m.insert(account.to_string(), v.to_string()),
            None => m.remove(account),
        };
        save(root, &m)
    }

    /// 0.4.0 and older kept keys in the macOS keychain: copy them into the file once. Never on
    /// the startup path (it may show one last keychain prompt); a marker makes sure it is the
    /// last. Returns true when keys moved.
    #[cfg(all(not(debug_assertions), target_os = "macos"))]
    pub fn migrate(root: &Path, accounts: &[String]) -> bool {
        let marker = root.join("keys.migrated");
        if marker.exists() {
            return false;
        }
        let _ = std::fs::write(&marker, b"");
        let mut m = all(root);
        let mut moved = false;
        for a in accounts {
            if m.contains_key(a) {
                continue;
            }
            let Ok(e) = keyring::Entry::new(super::SERVICE, a) else { continue };
            if let Ok(v) = e.get_password() {
                m.insert(a.clone(), v);
                moved = true;
            }
        }
        moved && save(root, &m).is_ok()
    }
    #[cfg(not(all(not(debug_assertions), target_os = "macos")))]
    pub fn migrate(_: &Path, _: &[String]) -> bool {
        let _ = super::SERVICE;
        false
    }
}

pub use store::{get, migrate, set};

#[cfg(all(test, debug_assertions))]
mod tests {
    #[test]
    fn keys_round_trip_in_a_private_file() {
        let root = std::env::temp_dir().join(format!("na-secrets-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        super::set(&root, "llm:anthropic", Some("k1")).unwrap();
        assert_eq!(super::get(&root, "llm:anthropic").as_deref(), Some("k1"));
        assert_eq!(super::get(&root, "llm:openai"), None);
        super::set(&root, "llm:anthropic", None).unwrap();
        assert_eq!(super::get(&root, "llm:anthropic"), None);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(root.join("keys.json")).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0, "keys.json readable by others");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }
}
