//! `neuralagent --service [--mode app|login|boot]`: the host that keeps `neuralagentd` running
//! (D59). It is the app's own signed executable started without a window:
//!
//! - **One macOS identity.** macOS asks for permissions per app, and counts every process as the
//!   app that is "responsible" for it. The daemon used to be a child of the app window; once the
//!   window quit or updated, the daemon and every agent counted as themselves (a bare binary at a
//!   new path each version), so the folder dialogs came back after every update and nobody could
//!   answer them from the phone. The host disclaims responsibility when the app starts it (it is
//!   its own responsible process, the bundle's main executable, so "NeuralAgent") and the daemon
//!   and the agents inherit it for as long as the host lives, which is as long as they do.
//! - **It comes back.** The host starts the daemon again when it stops unexpectedly, and starts
//!   the newest installed version when asked (`host.restart`: app update, "Restart" on the phone).
//! - **Autostart.** launchd / systemd / Windows start the same host at login or at boot
//!   (autostart.rs); `--mode` says which.
//!
//! One host per data dir (`host.lock`). Files it shares with the daemon (crates/na-daemon/src/
//! service.rs) and the app: `host.json` (about the host), `host.restart`, `host.handover`,
//! `host.stop` (the app stopped the service on purpose: the app's own host ends, a launchd/systemd
//! host waits until the app wants it again, see `idles_on_stop`).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use crate::daemon;

pub const LOCK: &str = "host.lock";
pub const STOP: &str = "host.stop";
pub const RESTART: &str = "host.restart";
pub const HANDOVER: &str = "host.handover";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    App,
    Login,
    Boot,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::App => "app",
            Mode::Login => "login",
            Mode::Boot => "boot",
        }
    }
    fn parse(s: &str) -> Option<Mode> {
        Some(match s {
            "app" => Mode::App,
            "login" => Mode::Login,
            "boot" => Mode::Boot,
            _ => return None,
        })
    }
}

/// `--mode x` from the arguments after `--service` (default `app`).
pub fn parse_mode(args: &[String]) -> Mode {
    args.iter().position(|a| a == "--mode").and_then(|i| args.get(i + 1)).and_then(|m| Mode::parse(m)).unwrap_or(Mode::App)
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn log(data: &Path, msg: &str) {
    use std::io::Write;
    let dir = data.join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("host.log");
    if std::fs::metadata(&path).map(|m| m.len() > 1 << 20).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("host.old.log"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{now} [{}] {msg}", std::process::id());
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Removes `name` from the data dir; true when it was there.
fn take(data: &Path, name: &str) -> bool {
    std::fs::remove_file(data.join(name)).is_ok()
}

static INSTALLED_APP: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// The installed app's executable when this host runs from a copy (`--app`, Windows), else None.
pub fn installed_app() -> Option<PathBuf> {
    INSTALLED_APP.get().cloned()
}

/// Is a host running for this data dir (someone holds the lock)?
pub fn running(data: &Path) -> bool {
    let Ok(f) = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(data.join(LOCK)) else { return false };
    match f.try_lock() {
        Ok(()) => {
            let _ = f.unlock();
            false
        }
        Err(_) => true,
    }
}

/// How the host that runs the service now was started (`app` | `login` | `boot`), if one runs.
pub fn active_mode(data: &Path) -> Option<String> {
    if !running(data) {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(data.join("host.json")).ok()?).ok()?;
    v.get("mode")?.as_str().map(str::to_string)
}

/// The program that starts this app again later: on Linux the AppImage file (the running binary
/// lives in a mount that goes away), otherwise this executable.
pub fn app_program() -> std::io::Result<PathBuf> {
    if cfg!(target_os = "linux")
        && let Some(p) = std::env::var_os("APPIMAGE").filter(|p| !p.is_empty())
    {
        return Ok(PathBuf::from(p));
    }
    std::env::current_exe()
}

/// The app starts its host (mode `app`), detached, so it outlives the window.
pub fn start_from_app() -> std::io::Result<()> {
    let program = app_program()?;
    let args = ["--service", "--mode", "app"];
    #[cfg(target_os = "macos")]
    {
        macos::spawn_disclaimed(&program, &args).map(|_| ())
    }
    #[cfg(not(target_os = "macos"))]
    {
        spawn_detached(&program, &args)
    }
}

#[cfg(not(target_os = "macos"))]
fn spawn_detached(program: &Path, args: &[&str]) -> std::io::Result<()> {
    use std::process::Stdio;
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0008 | 0x0000_0200 | 0x0800_0000); // detached, new group, no window
    }
    cmd.spawn().map(|_| ())
}

/// Runs the host. Returns the exit code.
pub fn main(args: &[String]) -> i32 {
    let mode = parse_mode(args);
    let Ok(data) = daemon::data_dir() else { return 1 };
    let _ = std::fs::create_dir_all(&data);

    // Windows cannot replace a running .exe, so the host runs from a copy in the data dir and
    // the installer can update the app while agents run.
    #[cfg(windows)]
    if let Some(code) = windows::relaunch_from_copy(&data, args) {
        return code;
    }

    let lock = match std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(data.join(LOCK)) {
        Ok(f) => f,
        Err(e) => {
            log(&data, &format!("cannot open the lock: {e}"));
            return 1;
        }
    };
    // Another host (the app's, or the boot one) runs: login and boot hosts wait their turn, the
    // app's gives up (the other one keeps the service running).
    let deadline = Instant::now() + Duration::from_secs(20);
    while lock.try_lock().is_err() {
        if mode == Mode::App && Instant::now() > deadline {
            return 0;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    // A new start: old notes do not count (a stop from before a reboot must not keep the
    // service down).
    for m in [STOP, RESTART, HANDOVER] {
        take(&data, m);
    }
    if let Some(a) = arg_value(args, "--app") {
        let _ = INSTALLED_APP.set(PathBuf::from(a));
    }
    let app = installed_app().or_else(|| app_program().ok());
    let mut host = HostFile {
        pid: std::process::id(),
        mode: mode.as_str().into(),
        started_at: now_ms(),
        restarts: 0,
        app,
        version: env!("CARGO_PKG_VERSION").into(),
    };
    host.write(&data);
    log(&data, &format!("host {} started ({})", host.version, mode.as_str()));
    run(&data, mode, &mut host, lock)
}

#[derive(serde::Serialize)]
struct HostFile {
    pid: u32,
    mode: String,
    started_at: i64,
    restarts: u32,
    app: Option<PathBuf>,
    version: String,
}

impl HostFile {
    fn write(&self, data: &Path) {
        let tmp = data.join("host.json.partial");
        if std::fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, data.join("host.json"));
        }
    }
}

/// What to do after the daemon exited.
#[derive(Debug, PartialEq, Eq)]
enum Next {
    /// Start the newest installed app's host in place of this one.
    Upgrade,
    /// Give the data dir to the login host (boot only).
    HandOver,
    /// Stopped on purpose: wait until the app wants it again.
    Idle,
    /// Another daemon holds the data dir: watch it.
    Watch,
    /// Unexpected: start it again after `Duration`.
    Again(Duration),
}

/// Decides from the notes left behind and the exit code. `ran` is how long it ran, `crashes`
/// how many unexpected stops came in a row.
fn next(restart: bool, handover: bool, stop: bool, code: Option<i32>, ran: Duration, crashes: u32) -> Next {
    if restart {
        return Next::Upgrade;
    }
    if handover {
        return Next::HandOver;
    }
    if stop {
        return Next::Idle;
    }
    if code == Some(3) {
        return Next::Watch;
    }
    if ran > Duration::from_secs(300) {
        return Next::Again(Duration::from_secs(1));
    }
    Next::Again(Duration::from_secs((1u64 << crashes.min(6)).min(60)))
}

/// Does a host stay (idle) after the app stopped the service on purpose? The app's own host ends
/// with it: an idle host would keep the old app's executable running after Quit (and after an
/// update, until it was killed by hand). A launchd/systemd host stays: with `KeepAlive` it would
/// be started again at once, and a fresh host clears `host.stop`, so the service would come back.
fn idles_on_stop(mode: Mode) -> bool {
    mode != Mode::App
}

fn run(data: &Path, mode: Mode, host: &mut HostFile, lock: std::fs::File) -> i32 {
    let mut crashes = 0u32;
    let mut lock = Some(lock);
    loop {
        if data.join(STOP).exists() {
            if !idles_on_stop(mode) {
                log(data, "stopped on purpose: host ends");
                return 0;
            }
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        if daemon::running_daemon(data).is_some() {
            // Started by something else (an older app): keep an eye on it, take over when it ends.
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        // "Start the newest version" arrived while no service of ours ran (the app upgraded an
        // older app's service that this host only watched): become the newest app's host first.
        if take(data, RESTART) {
            if let Some(code) = upgrade(data, mode, host) {
                return code;
            }
            log(data, "keeping this version running");
        }
        let bin = match daemon::install_binary(data) {
            Ok(b) => b,
            Err(e) => {
                log(data, &format!("service binary: {e:#}"));
                std::thread::sleep(Duration::from_secs(10));
                continue;
            }
        };
        let mut cmd = Command::new(&bin);
        cmd.env("NEURALAGENT_HOST_MODE", mode.as_str()).env("NEURALAGENT_HOST_PID", std::process::id().to_string());
        if mode == Mode::Boot && crate::autostart::login_host_installed() {
            cmd.env("NEURALAGENT_HOST_HANDOVER", "1");
        }
        daemon::detach(&mut cmd);
        daemon::lean(&mut cmd);
        let started = Instant::now();
        let status = match cmd.spawn().and_then(|mut c| c.wait()) {
            Ok(s) => s,
            Err(e) => {
                log(data, &format!("start {}: {e}", bin.display()));
                std::thread::sleep(Duration::from_secs(10));
                continue;
            }
        };
        let n = next(take(data, RESTART), take(data, HANDOVER), data.join(STOP).exists(), status.code(), started.elapsed(), crashes);
        log(data, &format!("service exited ({status}) after {:?}: {n:?}", started.elapsed()));
        match n {
            Next::Upgrade => {
                // The lock stays held: exec closes it (close-on-exec), Windows exits after the
                // spawn. When the new app cannot start (deleted, half-swapped), keep this one.
                if let Some(code) = upgrade(data, mode, host) {
                    return code;
                }
                log(data, "keeping this version running");
            }
            Next::HandOver => {
                // Let the login host take the data dir; take it back when that session ends.
                drop(lock.take());
                std::thread::sleep(Duration::from_secs(15));
                let f = match std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(data.join(LOCK)) {
                    Ok(f) => f,
                    Err(_) => return 1,
                };
                while f.try_lock().is_err() {
                    std::thread::sleep(Duration::from_secs(5));
                }
                log(data, "the login host is gone: running again");
                host.write(data);
                lock = Some(f);
            }
            Next::Idle => crashes = 0,
            Next::Watch => {
                // Another service holds the data dir but may not answer yet (starting, busy):
                // look again in a moment instead of starting a new one in a tight loop.
                crashes = 0;
                std::thread::sleep(Duration::from_secs(2));
            }
            Next::Again(wait) => {
                crashes = if started.elapsed() > Duration::from_secs(300) { 1 } else { crashes + 1 };
                host.restarts += 1;
                host.write(data);
                std::thread::sleep(wait);
            }
        }
    }
}

/// Becomes the newest installed app's host: on Unix the same process (`exec`, so launchd and
/// macOS keep seeing the same job and responsible process), on Windows a new one. Tries for a
/// while because an update may still be moving the app into place; `None` when it never worked.
fn upgrade(data: &Path, mode: Mode, host: &HostFile) -> Option<i32> {
    let app = host.app.clone()?;
    log(data, &format!("restarting from {}", app.display()));
    for attempt in 0..15 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_secs(2));
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let e = Command::new(&app).args(["--service", "--mode", mode.as_str()]).exec();
            log(data, &format!("exec failed: {e}"));
        }
        #[cfg(windows)]
        match spawn_detached(&app, &["--service", "--mode", mode.as_str()]) {
            Ok(()) => return Some(0),
            Err(e) => log(data, &format!("start failed: {e}")),
        }
    }
    None
}

#[cfg(windows)]
mod windows {
    use std::path::Path;

    /// From the installed exe: copy it to `<data>/bin/neuralagent-host-<version>.exe`, start the
    /// copy with `--app <installed exe>` and return; from the copy: None (run).
    pub fn relaunch_from_copy(data: &Path, args: &[String]) -> Option<i32> {
        let exe = std::env::current_exe().ok()?;
        let bin = data.join("bin");
        if exe.starts_with(&bin) {
            return None;
        }
        let _ = std::fs::create_dir_all(&bin);
        let copy = bin.join(format!("neuralagent-host-{}.exe", env!("CARGO_PKG_VERSION")));
        if !copy.exists() {
            let tmp = copy.with_extension("partial");
            if std::fs::copy(&exe, &tmp).and_then(|_| std::fs::rename(&tmp, &copy)).is_err() {
                return None; // run from here then
            }
        }
        let mode = super::parse_mode(args);
        let exe_s = exe.to_string_lossy().into_owned();
        let ok = super::spawn_detached(&copy, &["--service", "--mode", mode.as_str(), "--app", &exe_s]).is_ok();
        Some(if ok { 0 } else { 1 })
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{CString, c_char, c_int};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    unsafe extern "C" {
        static environ: *const *const c_char;
    }
    type SetDisclaim = unsafe extern "C" fn(*mut libc::posix_spawnattr_t, c_int) -> c_int;

    /// posix_spawn with "disclaim responsibility": the child is its own responsible process for
    /// macOS privacy (the same as a normal app launch), not this window's process, which may quit
    /// long before it. Also its own process group, stdio to /dev/null.
    pub fn spawn_disclaimed(program: &Path, args: &[&str]) -> std::io::Result<i32> {
        let prog = CString::new(program.as_os_str().as_bytes())?;
        let mut argv_c = vec![prog.clone()];
        for a in args {
            argv_c.push(CString::new(*a)?);
        }
        let mut argv: Vec<*mut c_char> = argv_c.iter().map(|a| a.as_ptr() as *mut c_char).collect();
        argv.push(std::ptr::null_mut());
        let null = CString::new("/dev/null").unwrap();
        // SAFETY: plain libc calls on locals that live until posix_spawn returned; the private
        // symbol is looked up and only called when present.
        unsafe {
            let mut attr: libc::posix_spawnattr_t = std::mem::zeroed();
            libc::posix_spawnattr_init(&mut attr);
            libc::posix_spawnattr_setflags(&mut attr, libc::POSIX_SPAWN_SETPGROUP as _);
            libc::posix_spawnattr_setpgroup(&mut attr, 0);
            let sym = libc::dlsym(libc::RTLD_DEFAULT, c"responsibility_spawnattrs_setdisclaim".as_ptr());
            if sym.is_null() {
                tracing::warn!("cannot disclaim responsibility: the service counts as this window for permissions");
            } else {
                let f: SetDisclaim = std::mem::transmute(sym);
                f(&mut attr, 1);
            }
            let mut fa: libc::posix_spawn_file_actions_t = std::mem::zeroed();
            libc::posix_spawn_file_actions_init(&mut fa);
            for fd in 0..3 {
                libc::posix_spawn_file_actions_addopen(
                    &mut fa,
                    fd,
                    null.as_ptr(),
                    if fd == 0 { libc::O_RDONLY } else { libc::O_WRONLY },
                    0,
                );
            }
            let mut pid: libc::pid_t = 0;
            let r = libc::posix_spawn(&mut pid, prog.as_ptr(), &fa, &attr, argv.as_ptr(), environ as *const *mut c_char);
            libc::posix_spawn_file_actions_destroy(&mut fa);
            libc::posix_spawnattr_destroy(&mut attr);
            if r != 0 {
                return Err(std::io::Error::from_raw_os_error(r));
            }
            // Reap it whenever it ends so it does not stay a zombie of this window.
            std::thread::spawn(move || {
                let mut st = 0;
                libc::waitpid(pid, &mut st, 0);
            });
            Ok(pid)
        }
    }

    #[cfg(test)]
    mod tests {
        type Responsible = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

        #[test]
        fn the_child_is_its_own_responsible_process() {
            // SAFETY: looks the private function up; only called when it exists.
            let f = unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"responsibility_get_pid_responsible_for_pid".as_ptr()) };
            if f.is_null() {
                return;
            }
            let responsible: Responsible = unsafe { std::mem::transmute(f) };
            // The host's own children (the daemon) must count as the host, so check a grandchild:
            // without the disclaim it would inherit this test's responsible process instead.
            let file = std::env::temp_dir().join(format!("na-disclaim-{}", std::process::id()));
            let script = format!("sleep 3 & echo $! > '{}'; wait", file.display());
            let pid = super::spawn_disclaimed(std::path::Path::new("/bin/sh"), &["-c", &script]).unwrap();
            let mut child = None;
            for _ in 0..50 {
                std::thread::sleep(std::time::Duration::from_millis(50));
                child = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse::<libc::pid_t>().ok());
                if child.is_some() {
                    break;
                }
            }
            let child = child.expect("grandchild pid");
            // SAFETY: plain queries and signals by pid.
            unsafe {
                assert_eq!(responsible(pid), pid);
                assert_eq!(responsible(child), pid);
                libc::kill(child, libc::SIGTERM);
            }
            let _ = std::fs::remove_file(&file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(parse_mode(&a(&["--mode", "boot"])), Mode::Boot);
        assert_eq!(parse_mode(&a(&["--mode", "login"])), Mode::Login);
        assert_eq!(parse_mode(&a(&[])), Mode::App);
        assert_eq!(parse_mode(&a(&["--mode", "nope"])), Mode::App);
    }

    #[test]
    fn what_happens_after_an_exit() {
        let s = Duration::from_secs;
        assert_eq!(next(true, false, false, Some(0), s(5), 0), Next::Upgrade);
        assert_eq!(next(false, true, false, Some(0), s(5), 0), Next::HandOver);
        assert_eq!(next(false, false, true, Some(0), s(5), 0), Next::Idle);
        assert_eq!(next(false, false, false, Some(3), s(1), 0), Next::Watch);
        // Unexpected stops: quickly at first, then backing off up to a minute.
        assert_eq!(next(false, false, false, Some(0), s(5), 0), Next::Again(s(1)));
        assert_eq!(next(false, false, false, None, s(5), 3), Next::Again(s(8)));
        assert_eq!(next(false, false, false, Some(101), s(5), 20), Next::Again(s(60)));
        // After a long run, a crash restarts at once.
        assert_eq!(next(false, false, false, Some(101), s(900), 5), Next::Again(s(1)));
    }

    #[test]
    fn only_autostart_hosts_stay_after_a_stop() {
        assert!(!idles_on_stop(Mode::App));
        assert!(idles_on_stop(Mode::Login));
        assert!(idles_on_stop(Mode::Boot));
    }

    /// "Quit and stop all agents" leaves `host.stop`: the app's host returns instead of idling.
    #[test]
    fn app_host_ends_on_stop() {
        let dir = std::env::temp_dir().join(format!("na-host-stop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(STOP), b"").unwrap();
        let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join(LOCK)).unwrap();
        lock.lock().unwrap();
        let mut host = HostFile { pid: 1, mode: "app".into(), started_at: 0, restarts: 0, app: None, version: "test".into() };
        assert_eq!(run(&dir, Mode::App, &mut host, lock), 0);
        assert!(!running(&dir), "the lock is released");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lock_tells_whether_a_host_runs() {
        let dir = std::env::temp_dir().join(format!("na-host-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!running(&dir));
        let f = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join(LOCK)).unwrap();
        f.lock().unwrap();
        assert!(running(&dir));
        drop(f);
        assert!(!running(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
