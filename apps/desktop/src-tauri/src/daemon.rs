//! Finds or starts `neuralagentd`.
//!
//! The daemon runs from a versioned copy in the data dir, detached from the app, so quitting or
//! updating the app never stops running agents. A newer app keeps talking to an older daemon as
//! long as the protocol matches.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

pub const APP_ID: &str = "dev.neuralhub.neuralagent";
pub const PROTOCOL: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonInfo {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub version: String,
    pub protocol: u32,
}

pub fn data_dir() -> Result<PathBuf> {
    Ok(match std::env::var_os("NEURALAGENT_HOME") {
        Some(p) => PathBuf::from(p),
        None => dirs::data_dir().context("no data dir")?.join(APP_ID),
    })
}

fn read_info(dir: &Path) -> Option<DaemonInfo> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("daemon.json")).ok()?).ok()
}

fn healthy(port: u16) -> bool {
    let Ok(mut s) = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
    if s.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.1 200") && buf.contains("\"ok\":true")
}

/// Returns connection info for a running daemon, starting one if needed.
pub fn ensure() -> Result<DaemonInfo> {
    let dir = data_dir()?;
    if let Some(info) = read_info(&dir)
        && healthy(info.port)
    {
        if info.protocol != PROTOCOL {
            bail!(
                "the running NeuralAgent service speaks protocol {} (this app: {PROTOCOL}); quit it from the menu bar and restart",
                info.protocol
            );
        }
        return Ok(info);
    }
    let bin = install_binary(&dir)?;
    let before = read_info(&dir).map(|i| i.pid);
    spawn_detached(&bin)?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(15) {
        std::thread::sleep(Duration::from_millis(100));
        if let Some(info) = read_info(&dir)
            && Some(info.pid) != before
            && healthy(info.port)
        {
            return Ok(info);
        }
    }
    bail!("the NeuralAgent service did not start; see {}", dir.join("logs/daemon.log").display())
}

/// The daemon binary shipped next to the app executable (Tauri sidecar, or the cargo target dir in
/// development), copied to `<data>/bin/neuralagentd-<version>` so app updates can replace the
/// bundle while it runs.
fn install_binary(dir: &Path) -> Result<PathBuf> {
    let exe_name = if cfg!(windows) { "neuralagentd.exe" } else { "neuralagentd" };
    let src = match std::env::var_os("NEURALAGENT_DAEMON_BIN") {
        Some(p) => PathBuf::from(p),
        None => std::env::current_exe()?.parent().context("exe dir")?.join(exe_name),
    };
    if !src.exists() {
        bail!("service binary missing at {}", src.display());
    }
    if cfg!(debug_assertions) {
        return Ok(src); // dev: run the freshly built binary in place
    }
    let version = env!("CARGO_PKG_VERSION");
    let bin_dir = dir.join("bin");
    std::fs::create_dir_all(&bin_dir)?;
    let dst = bin_dir.join(if cfg!(windows) { format!("neuralagentd-{version}.exe") } else { format!("neuralagentd-{version}") });
    let same = std::fs::metadata(&dst).ok().zip(std::fs::metadata(&src).ok()).is_some_and(|(a, b)| a.len() == b.len());
    if !same {
        let tmp = dst.with_extension("partial");
        std::fs::copy(&src, &tmp)?;
        std::fs::rename(&tmp, &dst)?;
    }
    prune_old(&bin_dir, 3);
    Ok(dst)
}

/// Keeps the newest `keep` daemon binaries.
fn prune_old(bin_dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(bin_dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("neuralagentd-"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    for (_, p) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(p); // fails harmlessly while that version still runs
    }
}

fn spawn_detached(bin: &Path) -> Result<()> {
    let mut cmd = Command::new(bin);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
    cmd.spawn().with_context(|| format!("start {}", bin.display()))?;
    Ok(())
}

/// Waits up to 5 s until a stopped daemon no longer answers.
pub fn wait_gone(info: &DaemonInfo) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) && healthy(info.port) {
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Stops the daemon (and with it every agent). Used by "Quit NeuralAgent and stop agents".
pub fn stop() -> Result<()> {
    let dir = data_dir()?;
    let Some(info) = read_info(&dir) else { return Ok(()) };
    #[cfg(unix)]
    {
        Command::new("kill").arg("-TERM").arg(info.pid.to_string()).status()?;
    }
    #[cfg(windows)]
    {
        Command::new("taskkill").args(["/PID", &info.pid.to_string(), "/T", "/F"]).status()?;
    }
    Ok(())
}
