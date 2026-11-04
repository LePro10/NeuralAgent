//! What is saved about connectors: `<home>/connectors.json` (enabled, setup values, the agent
//! building it) and `<home>/connector-secrets.json` (secret values, owner-only like
//! `mcp-secrets.json`). The connector folders themselves hold the code and `connector.json`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::Result;
use na_protocol::Id;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paths::write_private;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub config: BTreeMap<String, Value>,
    /// The coding agent building or changing it (gone after a restart).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_session: Option<Id>,
}

pub type SavedMap = BTreeMap<Id, Saved>;
/// connector id → setup key → value
pub type Secrets = BTreeMap<Id, BTreeMap<String, String>>;

pub fn saved_path(root: &Path) -> PathBuf {
    root.join("connectors.json")
}

pub fn secrets_path(root: &Path) -> PathBuf {
    root.join("connector-secrets.json")
}

pub fn load_saved(root: &Path) -> SavedMap {
    std::fs::read_to_string(saved_path(root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_saved(root: &Path, s: &SavedMap) -> Result<()> {
    write_private(&saved_path(root), &serde_json::to_vec_pretty(s)?)
}

pub fn load_secrets(root: &Path) -> Secrets {
    std::fs::read_to_string(secrets_path(root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_secrets(root: &Path, s: &Secrets) -> Result<()> {
    write_private(&secrets_path(root), &serde_json::to_vec_pretty(s)?)
}

/// Letters, digits, `-` and `_`; not a name the daemon keeps for itself.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 48
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !id.starts_with('_')
        && !matches!(id, "builtin" | "state")
}

/// "My Discord Bot!" → "my-discord-bot".
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-');
    let out: String = out.chars().take(40).collect();
    if out.is_empty() { "connector".into() } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_ids() {
        assert_eq!(slug("My Discord Bot!"), "my-discord-bot");
        assert_eq!(slug("  "), "connector");
        assert!(valid_id("discord") && valid_id("my_one-2"));
        assert!(!valid_id("builtin") && !valid_id("_lib") && !valid_id("a b") && !valid_id("../x") && !valid_id(""));
    }

    #[test]
    fn secrets_file_is_private() {
        let dir = std::env::temp_dir().join(format!("na-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut s = Secrets::new();
        s.entry("d".into()).or_default().insert("bot_token".into(), "x".into());
        save_secrets(&dir, &s).unwrap();
        assert_eq!(load_secrets(&dir), s);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(secrets_path(&dir)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
