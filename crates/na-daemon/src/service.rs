//! The service's side of the host that keeps it running (D59).
//!
//! The desktop app does not start `neuralagentd` itself any more but `neuralagent --service`
//! (apps/desktop/src-tauri/src/service.rs): a small host process that starts this service, starts
//! it again when it stops unexpectedly, and is what macOS sees as "NeuralAgent" for permissions.
//! The same host runs at login or at boot when autostart is on. It tells us how it runs through
//! the environment (`NEURALAGENT_HOST_MODE` = `boot` | `login` | `app`) and `<data>/host.json`;
//! we talk back with marker files in the data dir, which the host reads when we exit:
//! - `host.restart`: start the service again from the newest installed app (`HostRestart`).
//! - `host.handover`: a service that started before login steps aside for the one in the user's
//!   session (keychain and microphone work there).
//! - `host.stop` (written by the app): stopped on purpose, do not start again.

use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use na_protocol::{HostSystem, Millis};
use serde::Deserialize;
use tokio::sync::Notify;

use crate::core::{Core, now_ms};

pub const RESTART: &str = "host.restart";
pub const HANDOVER: &str = "host.handover";

/// Ends `serve()` like SIGTERM does (graceful: state saved, agents marked for resume).
pub static SHUTDOWN: Notify = Notify::const_new();
static STARTED: OnceLock<Millis> = OnceLock::new();

/// What the host wrote about itself.
#[derive(Debug, Default, Deserialize)]
struct HostFile {
    #[serde(default)]
    started_at: Option<Millis>,
    #[serde(default)]
    restarts: u32,
}

pub fn init() {
    let _ = STARTED.set(now_ms());
}

/// `boot`, `login` or `app` when a host started us.
pub fn host_mode() -> Option<String> {
    std::env::var("NEURALAGENT_HOST_MODE").ok().filter(|m| matches!(m.as_str(), "boot" | "login" | "app"))
}

fn host_file(root: &Path) -> HostFile {
    std::fs::read(root.join("host.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// The computer's boot time.
pub fn booted_at() -> Option<Millis> {
    #[cfg(target_os = "macos")]
    {
        // "{ sec = 1730000000, usec = 123 } Thu Oct 31 …"
        let out = std::process::Command::new("/usr/sbin/sysctl").args(["-n", "kern.boottime"]).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        let sec: i64 = s.split("sec = ").nth(1)?.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()?;
        Some(sec * 1000)
    }
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string("/proc/stat").ok()?;
        let sec: i64 = stat.lines().find_map(|l| l.strip_prefix("btime "))?.trim().parse().ok()?;
        Some(sec * 1000)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// Nobody is logged in on the screen (macOS: the console belongs to someone else, i.e. root at
/// the login window). Only a host started at boot can run like that.
pub fn before_login(home: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::MetadataExt;
        if host_mode().as_deref() != Some("boot") {
            return false;
        }
        let me = std::fs::metadata(home).map(|m| m.uid()).ok();
        let console = std::fs::metadata("/dev/console").map(|m| m.uid()).ok();
        me.is_some() && console != me
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = home;
        false
    }
}

pub fn system(core: &Core) -> HostSystem {
    let mode = host_mode();
    let file = if mode.is_some() { host_file(&core.paths.root) } else { HostFile::default() };
    let home = &core.env.home;
    let fda = crate::permissions::full_disk_access(home);
    let before_login = before_login(home);
    let mut warnings = Vec::new();
    if fda == Some(false) {
        warnings.push(if mode.is_some() {
            "Full Disk Access is off: agents working in Documents, Desktop or Downloads can stop at a macOS dialog on the computer's screen. Turn it on once at the computer: Settings → System."
                .to_string()
        } else {
            "This service was started by an older version, so macOS does not count it as NeuralAgent for permissions. Restart the service once (at the computer: quit NeuralAgent and stop the agents, then open it again)."
                .to_string()
        });
    }
    if before_login {
        warnings.push(
            "Running before anyone logged in: the keychain is still locked, so agents that keep their login there (Claude Code on macOS) and saved Neural keys work after you log in."
                .into(),
        );
    }
    HostSystem {
        started_at: *STARTED.get().unwrap_or(&0),
        booted_at: booted_at(),
        can_restart: mode.is_some(),
        host_since: file.started_at,
        restarts: file.restarts,
        host_mode: mode,
        before_login,
        full_disk_access: fda,
        warnings,
    }
}

/// `HostRestart`: leave a note for the host and shut down; the host starts the newest version.
pub fn restart(root: &Path) -> anyhow::Result<()> {
    if host_mode().is_none() {
        anyhow::bail!("This service was started without the host, so it would not come back. Restart it at the computer.");
    }
    std::fs::write(root.join(RESTART), b"")?;
    tracing::info!("restart asked for");
    tokio::spawn(async {
        // Let the answer reach the client first.
        tokio::time::sleep(Duration::from_millis(400)).await;
        SHUTDOWN.notify_one();
    });
    Ok(())
}

/// A service started at boot hands over to the login host once its user is at the screen and no
/// agent runs, so agents get the keychain and the microphone. Only when a login host exists
/// (`NEURALAGENT_HOST_HANDOVER=1`), otherwise nobody would take over.
pub fn watch_handover(core: std::sync::Arc<Core>) {
    if host_mode().as_deref() != Some("boot") || std::env::var("NEURALAGENT_HOST_HANDOVER").as_deref() != Ok("1") {
        return;
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(30));
            let busy = core.read(|s| s.sessions.values().any(|x| x.alive));
            if !busy && !before_login(&core.env.home) {
                tracing::info!("user logged in and no agent runs: handing over to the login service");
                if std::fs::write(core.paths.root.join(HANDOVER), b"").is_ok() {
                    SHUTDOWN.notify_one();
                }
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_host_file() {
        let dir = std::env::temp_dir().join(format!("na-host-file-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(host_file(&dir).started_at.is_none());
        std::fs::write(dir.join("host.json"), r#"{"pid":1,"mode":"login","started_at":5,"restarts":2,"app":"/x"}"#).unwrap();
        let f = host_file(&dir);
        assert_eq!((f.started_at, f.restarts), (Some(5), 2));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn boot_time_is_in_the_past() {
        if let Some(b) = booted_at() {
            assert!(b > 1_500_000_000_000 && b <= now_ms());
        }
    }
}
