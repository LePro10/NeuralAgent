//! Where the daemon keeps its files.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub const APP_ID: &str = "dev.neuralhub.neuralagent";

#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    /// `NEURALAGENT_HOME` overrides the location (dev builds, tests).
    pub fn resolve() -> Result<Self> {
        let root = match std::env::var_os("NEURALAGENT_HOME") {
            Some(p) => PathBuf::from(p),
            None => dirs::data_dir().context("no data dir")?.join(APP_ID),
        };
        std::fs::create_dir_all(&root).with_context(|| format!("create {}", root.display()))?;
        Ok(Self { root })
    }

    pub fn daemon_json(&self) -> PathBuf {
        self.root.join("daemon.json")
    }
    pub fn lock(&self) -> PathBuf {
        self.root.join("daemon.lock")
    }
    pub fn state(&self) -> PathBuf {
        self.root.join("state.json")
    }
    pub fn log(&self) -> PathBuf {
        self.root.join("logs").join("daemon.log")
    }
    pub fn hooks_dir(&self) -> PathBuf {
        self.root.join("hooks")
    }
}

/// Written at startup, read by the desktop shell and by `neuralagentd hook`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonInfo {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub version: String,
    pub protocol: u32,
}

impl DaemonInfo {
    pub fn read(paths: &Paths) -> Result<Self> {
        let s = std::fs::read_to_string(paths.daemon_json())?;
        Ok(serde_json::from_str(&s)?)
    }
}

/// Write `data` so that a crash never leaves a half file; on Unix the file is private (0600).
pub fn write_private(path: &Path, data: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).with_context(|| format!("open {}", tmp.display()))?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}
