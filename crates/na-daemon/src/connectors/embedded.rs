//! The connectors that ship with NeuralAgent. The JS ones are embedded (`include_str!`, no build
//! step) and written to `<home>/connectors/builtin/<id>/` when their content changes; `browser`
//! and `reddit` live inside the daemon and only have a manifest here.

use std::path::Path;

use anyhow::Result;

pub struct Builtin {
    pub id: &'static str,
    /// (relative path, content)
    pub files: &'static [(&'static str, &'static str)],
}

macro_rules! b {
    ($id:literal) => {
        Builtin {
            id: $id,
            files: &[
                ("connector.json", include_str!(concat!("../../../../connectors/", $id, "/connector.json"))),
                ("index.mjs", include_str!(concat!("../../../../connectors/", $id, "/index.mjs"))),
            ],
        }
    };
}

pub const JS: &[Builtin] = &[b!("discord"), b!("github"), b!("feed"), b!("web-api")];

/// Shared helper the built-in connectors import as `../_lib/connector.mjs`.
pub const LIB: &str = include_str!("../../../../connectors/_lib/connector.mjs");

/// The template a new connector starts from; the folder is self-contained.
pub const TEMPLATE: &[(&str, &str)] = &[
    ("connector.json", include_str!("../../../../connectors/_template/connector.json")),
    ("index.mjs", include_str!("../../../../connectors/_template/index.mjs")),
    ("connector.test.mjs", include_str!("../../../../connectors/_template/connector.test.mjs")),
    ("CLAUDE.md", include_str!("../../../../connectors/_template/CLAUDE.md")),
    ("lib/connector.mjs", include_str!("../../../../connectors/_template/lib/connector.mjs")),
];

/// Inside the daemon: they have no folder, only a manifest.
pub const VIRTUAL: &[(&str, &str)] = &[("browser", BROWSER), ("reddit", REDDIT)];

const BROWSER: &str = r#"{
  "name": "Browser",
  "icon": "globe",
  "description": "Opens and reads pages in your own Chrome through the NeuralAgent extension, with your real logins.",
  "kind": "browser",
  "version": "1.0.0",
  "guide": [
    "Install the NeuralAgent extension in Chrome (ideally in a second Chrome profile that you only use for this). Until it is in the Chrome Web Store, open `chrome://extensions`, switch on **Developer mode** and choose **Load unpacked** with the folder `apps/browser-extension`.",
    "Press **Pair browser** here. A code like `NA-47619-K7M2QX4P` appears; it works for 10 minutes.",
    "Click the extension icon in Chrome, paste the code and press **Pair**. This page shows the browser as connected."
  ],
  "setup": [],
  "tools": { "open": "read", "read": "read", "links": "read", "click": "write", "type": "write", "scroll": "read", "close": "read" },
  "events": []
}"#;

const REDDIT: &str = r#"{
  "name": "Reddit",
  "icon": "reddit",
  "description": "Finds and reads Reddit posts about your project through your browser. It never posts.",
  "kind": "browser",
  "version": "1.0.0",
  "guide": [
    "Set up the **Browser** connector first and pair the extension.",
    "Enter the subreddits to watch (for example `rust`) and optionally keywords. New posts that match land in the inbox.",
    "Reddit is read through your normal browser, so stay logged in there if you want to see everything."
  ],
  "setup": [
    { "key": "subreddits", "label": "Subreddits", "type": "list", "placeholder": "rust", "help": "Without the r/. The newest posts of each are checked." },
    { "key": "keywords", "label": "Keywords", "type": "list", "help": "Only posts with one of these words in the title. Leave empty for all new posts." }
  ],
  "tools": { "search": "read", "read_post": "read", "subreddit_new": "read" },
  "events": ["post"],
  "poll": { "tool": "subreddit_new", "minutes": 30 }
}"#;

fn write_if_changed(path: &Path, content: &str) -> Result<()> {
    if std::fs::read_to_string(path).is_ok_and(|c| c == content) {
        return Ok(());
    }
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

/// Writes the embedded connectors under `<root>/connectors/builtin/`.
pub fn install(root: &Path) -> Result<()> {
    let base = root.join("connectors").join("builtin");
    write_if_changed(&base.join("_lib").join("connector.mjs"), LIB)?;
    for b in JS {
        for (rel, content) in b.files {
            write_if_changed(&base.join(b.id).join(rel), content)?;
        }
    }
    Ok(())
}

/// Writes the template into a new connector folder.
pub fn write_template(dir: &Path) -> Result<()> {
    for (rel, content) in TEMPLATE {
        write_if_changed(&dir.join(rel), content)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_embedded_manifest_is_valid() {
        for b in JS {
            let (_, m) = b.files.iter().find(|(p, _)| *p == "connector.json").unwrap();
            let m = super::super::manifest::parse(m).unwrap_or_else(|e| panic!("{}: {e:#}", b.id));
            assert!(!m.tools.is_empty(), "{}", b.id);
        }
        for (id, m) in VIRTUAL {
            super::super::manifest::parse(m).unwrap_or_else(|e| panic!("{id}: {e:#}"));
        }
    }

    #[test]
    fn installs_and_does_not_rewrite() {
        let dir = std::env::temp_dir().join(format!("na-emb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        install(&dir).unwrap();
        let p = dir.join("connectors/builtin/discord/index.mjs");
        assert!(p.is_file() && dir.join("connectors/builtin/_lib/connector.mjs").is_file());
        let t0 = std::fs::metadata(&p).unwrap().modified().unwrap();
        install(&dir).unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().modified().unwrap(), t0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
