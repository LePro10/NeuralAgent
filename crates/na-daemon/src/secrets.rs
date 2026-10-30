//! Keys the user typed in (LLM providers): the OS keychain in release builds on macOS and
//! Windows; a file only the user can read in development builds and on Linux (keychain prompts
//! would appear after every rebuild of an unsigned binary).

const SERVICE: &str = "dev.neuralhub.neuralagent.keys";

#[cfg(all(not(debug_assertions), any(target_os = "macos", target_os = "windows")))]
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
}

#[cfg(not(all(not(debug_assertions), any(target_os = "macos", target_os = "windows"))))]
mod store {
    use std::collections::BTreeMap;

    fn path(root: &std::path::Path) -> std::path::PathBuf {
        root.join("keys.json")
    }
    fn all(root: &std::path::Path) -> BTreeMap<String, String> {
        let _ = super::SERVICE;
        std::fs::read_to_string(path(root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    pub fn get(root: &std::path::Path, account: &str) -> Option<String> {
        all(root).remove(account)
    }
    pub fn set(root: &std::path::Path, account: &str, v: Option<&str>) -> anyhow::Result<()> {
        let mut m = all(root);
        match v {
            Some(v) => m.insert(account.to_string(), v.to_string()),
            None => m.remove(account),
        };
        crate::paths::write_private(&path(root), serde_json::to_string(&m)?.as_bytes())
    }
}

pub use store::{get, set};
