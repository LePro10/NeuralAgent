//! Finds or starts `neuralagentd`.
//!
//! The daemon runs from a versioned copy in the data dir, detached from the app, so quitting or
//! updating the app never stops running agents. A newer app keeps talking to an older daemon as
//! long as the protocol matches. The app does not start it directly but through its host
//! (`neuralagent --service`, service.rs), which keeps it running and is what macOS sees as
//! NeuralAgent for permissions (D59). `NEURALAGENT_NO_HOST=1` starts it directly as before.

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

/// The daemon of this data dir if it answers.
pub fn running_daemon(dir: &Path) -> Option<DaemonInfo> {
    read_info(dir).filter(|i| healthy(i.port))
}

/// Returns connection info for a running daemon, starting one if needed.
pub fn ensure() -> Result<DaemonInfo> {
    let dir = data_dir()?;
    // The app wants the service: a stop from "Quit and stop agents" is over.
    let _ = std::fs::remove_file(dir.join(crate::service::STOP));
    if let Some(info) = read_info(&dir)
        && healthy(info.port)
    {
        if info.protocol != PROTOCOL {
            bail!(
                "the running NeuralAgent service speaks protocol {} (this app: {PROTOCOL}); quit it from the menu bar and restart",
                info.protocol
            );
        }
        // It runs without a host (an older app started it, or its host died): start one that
        // watches it and takes over when it ends, so it comes back and counts as NeuralAgent.
        if std::env::var("NEURALAGENT_NO_HOST").as_deref() != Ok("1")
            && !crate::service::running(&dir)
            && let Err(e) = crate::service::start_from_app()
        {
            tracing::warn!("starting the host failed: {e}");
        }
        return Ok(info);
    }
    let before = read_info(&dir).map(|i| i.pid);
    start(&dir)?;
    let start_at = Instant::now();
    let mut started_again = false;
    while start_at.elapsed() < Duration::from_secs(15) {
        std::thread::sleep(Duration::from_millis(100));
        // A host that was just ending after a stop (it held the lock a moment ago, so `start`
        // left it to that host): start a new one.
        if !started_again && start_at.elapsed() > Duration::from_secs(2) && !crate::service::running(&dir) {
            started_again = true;
            start(&dir)?;
        }
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
pub fn install_binary(dir: &Path) -> Result<PathBuf> {
    let exe_name = if cfg!(windows) { "neuralagentd.exe" } else { "neuralagentd" };
    // Next to the installed app, also when the host runs from its copy in <data>/bin (Windows).
    let app = match crate::service::installed_app() {
        Some(p) => p,
        None => std::env::current_exe()?,
    };
    let src = match std::env::var_os("NEURALAGENT_DAEMON_BIN") {
        Some(p) => PathBuf::from(p),
        None => app.parent().context("exe dir")?.join(exe_name),
    };
    if cfg!(debug_assertions) && src.exists() {
        return Ok(src); // dev: run the freshly built binary in place
    }
    let version = env!("CARGO_PKG_VERSION");
    let bin_dir = dir.join("bin");
    let dst = bin_dir.join(if cfg!(windows) { format!("neuralagentd-{version}.exe") } else { format!("neuralagentd-{version}") });
    if !src.exists() {
        // The app was deleted or moved while its host runs: this version's copy still starts.
        if !cfg!(debug_assertions) && dst.exists() {
            return Ok(dst);
        }
        bail!("service binary missing at {}", src.display());
    }
    std::fs::create_dir_all(&bin_dir)?;
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

/// Starts the host, which starts the daemon (unless one already runs and will do so).
fn start(dir: &Path) -> Result<()> {
    if std::env::var("NEURALAGENT_NO_HOST").as_deref() != Ok("1") {
        if crate::service::running(dir) {
            return Ok(());
        }
        match crate::service::start_from_app() {
            Ok(()) => return Ok(()),
            Err(e) => tracing::warn!("starting the host failed ({e}); starting the service directly"),
        }
    }
    let mut cmd = Command::new(install_binary(dir)?);
    detach(&mut cmd);
    lean(&mut cmd);
    cmd.spawn().with_context(|| "start the service")?;
    Ok(())
}

/// macOS: the service's allocator hands freed memory back at once (speech models free about
/// 1 GB when they unload; without this macOS keeps much of it until memory runs low). The service
/// removes the variable at start, so agents never see it (D75).
pub fn lean(cmd: &mut Command) {
    if cfg!(target_os = "macos") {
        cmd.env("MallocSpaceEfficient", "1");
    }
}

/// No stdio, own process group (survives its parent), no console window on Windows.
pub fn detach(cmd: &mut Command) {
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
}

/// Waits up to 5 s until a stopped daemon no longer answers.
pub fn wait_gone(info: &DaemonInfo) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) && healthy(info.port) {
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Stops the daemon (and with it every agent). Used by "Quit NeuralAgent and stop agents": the
/// host then waits until the app wants the service again (or the next login or boot).
pub fn stop() -> Result<()> {
    let dir = data_dir()?;
    let _ = std::fs::write(dir.join(crate::service::STOP), b"");
    kill(&dir)
}

/// Set right before the app exits on purpose while the service should keep running ("Quit (agents
/// keep running)" in the menu bar, the relaunch after an update).
static KEEP_SERVICE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn keep_service_on_exit() {
    KEEP_SERVICE.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Does quitting the app also stop the service? On macOS a plain Quit (Dock menu, Cmd+Q, the app
/// menu) stops everything, the app's host included, so no old process stays behind (an update
/// then needs no kill by hand). Not when the app asked to keep it, and not for a service started
/// at boot: that one is meant to outlive the session (a logout quits the app too).
fn quit_stops_service(macos: bool, keep: bool, host_mode: Option<&str>) -> bool {
    macos && !keep && host_mode != Some("boot")
}

/// Called once when the app exits (`RunEvent::Exit`).
pub fn on_app_exit() {
    let keep = KEEP_SERVICE.load(std::sync::atomic::Ordering::SeqCst);
    let Ok(dir) = data_dir() else { return };
    let mode = crate::service::active_mode(&dir);
    if quit_stops_service(cfg!(target_os = "macos"), keep, mode.as_deref()) {
        tracing::info!("quit: stopping the service");
        if let Err(e) = stop() {
            tracing::warn!("stopping the service: {e:#}");
        }
    }
}

/// Stops the daemon so that its host starts the newest installed version (after an update).
pub fn restart_newest() -> Result<()> {
    let dir = data_dir()?;
    let _ = std::fs::write(dir.join(crate::service::RESTART), b"");
    kill(&dir)
}

fn kill(dir: &Path) -> Result<()> {
    let Some(info) = read_info(dir) else { return Ok(()) };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_quit_stops_the_service() {
        // macOS: a plain Quit stops it, with or without a login autostart host.
        assert!(quit_stops_service(true, false, None));
        assert!(quit_stops_service(true, false, Some("app")));
        assert!(quit_stops_service(true, false, Some("login")));
        // "Quit (agents keep running)" and the relaunch after an update keep it.
        assert!(!quit_stops_service(true, true, Some("app")));
        // A service started at boot outlives the session.
        assert!(!quit_stops_service(true, false, Some("boot")));
        // Windows/Linux keep their behaviour (no Dock; the tray offers both choices).
        assert!(!quit_stops_service(false, false, Some("app")));
    }
}
