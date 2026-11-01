//! Starting NeuralAgent without anyone at the computer (D60): Settings → System → "Start
//! automatically". Two independent choices:
//!
//! - **Background service**: `off`, `login` (when you log in) or `boot` (when the computer starts,
//!   before anyone logs in). What starts is the host (`neuralagent --service`, service.rs), which
//!   starts the daemon and remote access and keeps them running.
//!   - macOS: a LaunchAgent in `~/Library/LaunchAgents` (login), plus a LaunchDaemon with
//!     `UserName` in `/Library/LaunchDaemons` (boot; one administrator password). The boot host
//!     hands over to the login one when you log in and no agent runs (keychain, microphone).
//!   - Windows: a `Run` value in HKCU (login); a Task Scheduler task at startup that runs whether
//!     you are logged on or not, without a stored password (boot; one UAC prompt).
//!   - Linux: a systemd user service (login); the same plus `loginctl enable-linger` (boot).
//! - **Open the window at login**: a LaunchAgent running `open -a`, a `Run` value, or an XDG
//!   autostart entry.
//!
//! Everything is a list of `Step`s (pure, tested for all three systems on any machine), applied
//! by `apply`. `NEURALAGENT_SERVICE_ROOT=/tmp/x` puts every file under that folder and only logs
//! the commands to `<root>/commands.log` (tests, dry runs); it never touches the real system.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

pub const LOGIN_LABEL: &str = "dev.neuralhub.neuralagent.service";
pub const BOOT_LABEL: &str = "dev.neuralhub.neuralagent.boot";
pub const WINDOW_LABEL: &str = "dev.neuralhub.neuralagent.window";
const BUNDLE_ID: &str = "dev.neuralhub.neuralagent";
const WIN_RUN: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const WIN_TASK: &str = r"NeuralAgent\Service at startup";
const LINUX_UNIT: &str = "neuralagent.service";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStart {
    Off,
    Login,
    Boot,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Autostart {
    pub service: ServiceStart,
    pub window: bool,
}

impl Autostart {
    pub const OFF: Autostart = Autostart { service: ServiceStart::Off, window: false };
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

impl Os {
    pub fn this() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// Where things are on this computer.
#[derive(Clone, Debug)]
pub struct Ctx {
    pub os: Os,
    /// What autostart runs: the app's executable (the AppImage file on Linux).
    pub exe: PathBuf,
    /// macOS: the `.app` around `exe`.
    pub bundle: Option<PathBuf>,
    pub home: PathBuf,
    pub data: PathBuf,
    pub user: String,
    pub uid: u32,
    /// `NEURALAGENT_HOME` of this app, passed on so the service uses the same data.
    pub na_home: Option<String>,
    /// Test/dry-run root (see the module docs).
    pub root: Option<PathBuf>,
    /// Mode of the host that runs the service right now (`login`, `boot`, `app`): launchd must
    /// not unload that one, or the service and the agents would lose their "NeuralAgent" identity.
    pub active_host: Option<String>,
}

impl Ctx {
    pub fn detect() -> Result<Ctx> {
        let exe = crate::service::app_program()?;
        let bundle = exe
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .filter(|b| b.extension().is_some_and(|e| e == "app"))
            .map(Path::to_path_buf);
        Ok(Ctx {
            os: Os::this(),
            bundle: if cfg!(target_os = "macos") { bundle } else { None },
            exe,
            home: dirs::home_dir().context("no home folder")?,
            data: crate::daemon::data_dir()?,
            active_host: crate::daemon::data_dir().ok().and_then(|d| crate::service::active_mode(&d)),
            user: std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default(),
            uid: uid(),
            na_home: std::env::var("NEURALAGENT_HOME").ok().filter(|h| !h.is_empty()),
            root: std::env::var_os("NEURALAGENT_SERVICE_ROOT").filter(|r| !r.is_empty()).map(PathBuf::from),
        })
    }

    /// `path` as it is used for files (under the test root, if any).
    pub fn at(&self, path: &Path) -> PathBuf {
        match &self.root {
            Some(r) => r.join(path.strip_prefix("/").unwrap_or(path).to_string_lossy().replace(':', "")),
            None => path.to_path_buf(),
        }
    }

    fn login_plist(&self) -> PathBuf {
        self.home.join("Library/LaunchAgents").join(format!("{LOGIN_LABEL}.plist"))
    }
    fn window_plist(&self) -> PathBuf {
        self.home.join("Library/LaunchAgents").join(format!("{WINDOW_LABEL}.plist"))
    }
    fn boot_plist(&self) -> PathBuf {
        PathBuf::from("/Library/LaunchDaemons").join(format!("{BOOT_LABEL}.plist"))
    }
    fn staged(&self, name: &str) -> PathBuf {
        self.data.join("service").join(name)
    }
    fn unit(&self) -> PathBuf {
        self.home.join(".config/systemd/user").join(LINUX_UNIT)
    }
    fn desktop_entry(&self) -> PathBuf {
        self.home.join(".config/autostart/neuralagent.desktop")
    }
    fn linger(&self) -> PathBuf {
        PathBuf::from("/var/lib/systemd/linger").join(&self.user)
    }
    fn exe_s(&self) -> String {
        self.exe.to_string_lossy().into_owned()
    }
    fn host_args(&self, mode: &str) -> Vec<String> {
        vec![self.exe_s(), "--service".into(), "--mode".into(), mode.into()]
    }
}

fn uid() -> u32 {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: getuid cannot fail.
        unsafe { libc::getuid() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    Write {
        path: PathBuf,
        text: String,
    },
    Remove {
        path: PathBuf,
    },
    /// A command; `check`: fail when it fails.
    Run {
        cmd: Vec<String>,
        check: bool,
    },
    /// Commands that need the administrator, behind one password / UAC / polkit prompt.
    Admin {
        cmds: Vec<Vec<String>>,
    },
}

fn run(cmd: &[&str], check: bool) -> Step {
    Step::Run { cmd: cmd.iter().map(|s| s.to_string()).collect(), check }
}

fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/* ── file contents ──────────────────────────────────────────────────── */

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[derive(Default)]
struct Plist<'a> {
    label: &'a str,
    args: Vec<String>,
    keep_alive: bool,
    aqua_only: bool,
    user: Option<&'a str>,
    env: Vec<(&'a str, String)>,
    log: Option<PathBuf>,
}

fn plist(p: &Plist) -> String {
    let mut s = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n",
    );
    let kv = |s: &mut String, k: &str, v: &str| s.push_str(&format!("  <key>{k}</key>\n  <string>{}</string>\n", xml(v)));
    kv(&mut s, "Label", p.label);
    s.push_str("  <key>ProgramArguments</key>\n  <array>\n");
    for a in &p.args {
        s.push_str(&format!("    <string>{}</string>\n", xml(a)));
    }
    s.push_str("  </array>\n  <key>RunAtLoad</key>\n  <true/>\n");
    if p.keep_alive {
        s.push_str("  <key>KeepAlive</key>\n  <true/>\n  <key>ThrottleInterval</key>\n  <integer>10</integer>\n");
        // The service host and its agents: no launchd CPU/IO throttling, the same as when the
        // app starts them (without a ProcessType launchd applies light limits).
        kv(&mut s, "ProcessType", "Interactive");
    }
    if p.aqua_only {
        kv(&mut s, "LimitLoadToSessionType", "Aqua");
    }
    // Shows the item as NeuralAgent in System Settings → General → Login Items.
    s.push_str(&format!("  <key>AssociatedBundleIdentifiers</key>\n  <array>\n    <string>{BUNDLE_ID}</string>\n  </array>\n"));
    if let Some(u) = p.user {
        kv(&mut s, "UserName", u);
        kv(&mut s, "GroupName", "staff");
    }
    if !p.env.is_empty() {
        s.push_str("  <key>EnvironmentVariables</key>\n  <dict>\n");
        for (k, v) in &p.env {
            s.push_str(&format!("    <key>{k}</key>\n    <string>{}</string>\n", xml(v)));
        }
        s.push_str("  </dict>\n");
    }
    if let Some(l) = &p.log {
        let l = l.to_string_lossy();
        kv(&mut s, "StandardOutPath", &l);
        kv(&mut s, "StandardErrorPath", &l);
    }
    s.push_str("</dict>\n</plist>\n");
    s
}

fn mac_login_plist(c: &Ctx) -> String {
    let mut env = vec![];
    if let Some(h) = &c.na_home {
        env.push(("NEURALAGENT_HOME", h.clone()));
    }
    plist(&Plist {
        label: LOGIN_LABEL,
        args: c.host_args("login"),
        keep_alive: true,
        aqua_only: true,
        env,
        log: Some(c.data.join("logs/launchd.log")),
        ..Default::default()
    })
}

fn mac_boot_plist(c: &Ctx) -> String {
    // launchd gives a daemon almost no environment; the service reads the login shell's itself.
    let home = c.home.to_string_lossy().into_owned();
    let mut env = vec![
        ("HOME", home),
        ("USER", c.user.clone()),
        ("LOGNAME", c.user.clone()),
        ("PATH", "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin".into()),
    ];
    if let Some(h) = &c.na_home {
        env.push(("NEURALAGENT_HOME", h.clone()));
    }
    plist(&Plist {
        label: BOOT_LABEL,
        args: c.host_args("boot"),
        keep_alive: true,
        user: Some(&c.user),
        env,
        log: Some(c.data.join("logs/launchd-boot.log")),
        ..Default::default()
    })
}

fn mac_window_plist(c: &Ctx) -> String {
    let app = c.bundle.as_ref().map(|b| b.to_string_lossy().into_owned()).unwrap_or_else(|| c.exe_s());
    plist(&Plist { label: WINDOW_LABEL, args: strings(&["/usr/bin/open", "-a", &app]), aqua_only: true, ..Default::default() })
}

fn systemd_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('%', "%%"))
}

fn linux_unit(c: &Ctx, mode: &str) -> String {
    let mut s = format!(
        "[Unit]\nDescription=NeuralAgent service (agents and remote access)\n\n[Service]\nExecStart={} --service --mode {mode}\nRestart=always\nRestartSec=5\n# Stopping the unit stops only the host; running agents keep going.\nKillMode=process\n",
        systemd_quote(&c.exe_s())
    );
    if let Some(h) = &c.na_home {
        s.push_str(&format!("Environment={}\n", systemd_quote(&format!("NEURALAGENT_HOME={h}"))));
    }
    s.push_str("\n[Install]\nWantedBy=default.target\n");
    s
}

fn linux_desktop_entry(c: &Ctx) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=NeuralAgent\nExec={}\nX-GNOME-Autostart-enabled=true\n",
        // Quoted like systemd; "%" stays "%%" (a literal percent sign in Exec).
        systemd_quote(&c.exe_s())
    )
}

fn windows_task(c: &Ctx) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>NeuralAgent service (agents and remote access), from startup</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>{}</UserId><LogonType>S4U</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>{}</Command><Arguments>--service --mode boot</Arguments></Exec></Actions>
</Task>
"#,
        xml(&c.user),
        xml(&c.exe_s())
    )
}

/* ── status and plan ────────────────────────────────────────────────── */

/// What is set up now (from the files; Windows asks the registry and Task Scheduler).
pub fn status(c: &Ctx) -> Autostart {
    let has = |p: &Path| c.at(p).exists();
    match c.os {
        Os::Mac => Autostart {
            service: if has(&c.boot_plist()) {
                ServiceStart::Boot
            } else if has(&c.login_plist()) {
                ServiceStart::Login
            } else {
                ServiceStart::Off
            },
            window: has(&c.window_plist()),
        },
        Os::Linux => {
            let unit = std::fs::read_to_string(c.at(&c.unit())).ok();
            Autostart {
                service: match unit {
                    Some(u) if u.contains("--mode boot") && has(&c.linger()) => ServiceStart::Boot,
                    Some(_) => ServiceStart::Login,
                    None => ServiceStart::Off,
                },
                window: has(&c.desktop_entry()),
            }
        }
        Os::Windows if c.root.is_some() => Autostart::OFF,
        Os::Windows => {
            let ok = |args: &[&str]| quiet(args[0]).args(&args[1..]).status().is_ok_and(|s| s.success());
            Autostart {
                service: if ok(&["schtasks", "/Query", "/TN", WIN_TASK]) {
                    ServiceStart::Boot
                } else if ok(&["reg", "query", WIN_RUN, "/v", "NeuralAgent Service"]) {
                    ServiceStart::Login
                } else {
                    ServiceStart::Off
                },
                window: ok(&["reg", "query", WIN_RUN, "/v", "NeuralAgent"]),
            }
        }
    }
}

/// The steps from `cur` to `want`. Only what changes is touched: a running host is never
/// stopped (that would take the agents' "NeuralAgent" identity away until the next restart);
/// switching something off takes effect at the next login or boot.
pub fn plan(c: &Ctx, cur: Autostart, want: Autostart) -> Vec<Step> {
    let mut steps = Vec::new();
    let (was, will) = (cur.service, want.service);
    match c.os {
        Os::Mac => {
            let gui = format!("gui/{}", c.uid);
            // The login host also runs with "boot": it takes over in your session.
            let (login_was, login_will) = (was != ServiceStart::Off, will != ServiceStart::Off);
            // A host that runs the service now stays loaded: unloading it would leave the service
            // and its agents without the host, so macOS would count them as themselves again.
            let (login_runs, boot_runs) = (c.active_host.as_deref() == Some("login"), c.active_host.as_deref() == Some("boot"));
            if login_will && !login_was {
                let path = c.login_plist();
                steps.push(Step::Write { path: path.clone(), text: mac_login_plist(c) });
                if !login_runs {
                    steps.push(run(&["launchctl", "bootout", &format!("{gui}/{LOGIN_LABEL}")], false));
                    steps.push(run(&["launchctl", "bootstrap", &gui, &path.to_string_lossy()], true));
                }
            } else if login_was && !login_will {
                steps.push(Step::Remove { path: c.login_plist() });
            }
            let boot = c.boot_plist();
            let boot_s = boot.to_string_lossy().into_owned();
            if will == ServiceStart::Boot && was != ServiceStart::Boot {
                let staged = c.staged(&format!("{BOOT_LABEL}.plist"));
                steps.push(Step::Write { path: staged.clone(), text: mac_boot_plist(c) });
                let mut cmds = vec![
                    strings(&["/bin/cp", &staged.to_string_lossy(), &boot_s]),
                    strings(&["/usr/sbin/chown", "root:wheel", &boot_s]),
                    strings(&["/bin/chmod", "644", &boot_s]),
                ];
                if !boot_runs {
                    cmds.insert(0, strings(&["/bin/launchctl", "bootout", &format!("system/{BOOT_LABEL}")]));
                    cmds.push(strings(&["/bin/launchctl", "bootstrap", "system", &boot_s]));
                }
                steps.push(Step::Admin { cmds });
            } else if was == ServiceStart::Boot && will != ServiceStart::Boot {
                // The running boot host stays until the next restart of the computer.
                let mut cmds = vec![strings(&["/bin/rm", "-f", &boot_s])];
                if !boot_runs {
                    cmds.insert(0, strings(&["/bin/launchctl", "bootout", &format!("system/{BOOT_LABEL}")]));
                }
                steps.push(Step::Admin { cmds });
            }
            if want.window && !cur.window {
                steps.push(Step::Write { path: c.window_plist(), text: mac_window_plist(c) });
            } else if cur.window && !want.window {
                steps.push(Step::Remove { path: c.window_plist() });
                steps.push(run(&["launchctl", "bootout", &format!("{gui}/{WINDOW_LABEL}")], false));
            }
        }
        Os::Windows => {
            let exe = format!("\"{}\"", c.exe_s());
            if will == ServiceStart::Login && was != ServiceStart::Login {
                steps.push(run(
                    &[
                        "reg",
                        "add",
                        WIN_RUN,
                        "/v",
                        "NeuralAgent Service",
                        "/t",
                        "REG_SZ",
                        "/d",
                        &format!("{exe} --service --mode login"),
                        "/f",
                    ],
                    true,
                ));
            } else if was == ServiceStart::Login && will != ServiceStart::Login {
                steps.push(run(&["reg", "delete", WIN_RUN, "/v", "NeuralAgent Service", "/f"], false));
            }
            if will == ServiceStart::Boot && was != ServiceStart::Boot {
                let xml = c.staged("boot-task.xml");
                steps.push(Step::Write { path: xml.clone(), text: windows_task(c) });
                steps.push(Step::Admin {
                    cmds: vec![strings(&["schtasks", "/Create", "/TN", WIN_TASK, "/XML", &xml.to_string_lossy(), "/F"])],
                });
            } else if was == ServiceStart::Boot && will != ServiceStart::Boot {
                steps.push(Step::Admin { cmds: vec![strings(&["schtasks", "/Delete", "/TN", WIN_TASK, "/F"])] });
            }
            if want.window && !cur.window {
                steps.push(run(&["reg", "add", WIN_RUN, "/v", "NeuralAgent", "/t", "REG_SZ", "/d", &exe, "/f"], true));
            } else if cur.window && !want.window {
                steps.push(run(&["reg", "delete", WIN_RUN, "/v", "NeuralAgent", "/f"], false));
            }
        }
        Os::Linux => {
            let user = c.user.as_str();
            if will != ServiceStart::Off && will != was {
                steps.push(Step::Write { path: c.unit(), text: linux_unit(c, if will == ServiceStart::Boot { "boot" } else { "login" }) });
                steps.push(run(&["systemctl", "--user", "daemon-reload"], true));
                steps.push(run(&["systemctl", "--user", "enable", LINUX_UNIT], true));
                if was == ServiceStart::Off {
                    steps.push(run(&["systemctl", "--user", "start", LINUX_UNIT], false));
                }
            } else if will == ServiceStart::Off && was != ServiceStart::Off {
                steps.push(run(&["systemctl", "--user", "disable", LINUX_UNIT], false));
                steps.push(Step::Remove { path: c.unit() });
                steps.push(run(&["systemctl", "--user", "daemon-reload"], false));
            }
            if will == ServiceStart::Boot && was != ServiceStart::Boot {
                steps.push(run(&["loginctl", "enable-linger", user], true));
            } else if was == ServiceStart::Boot && will != ServiceStart::Boot {
                steps.push(run(&["loginctl", "disable-linger", user], false));
            }
            if want.window && !cur.window {
                steps.push(Step::Write { path: c.desktop_entry(), text: linux_desktop_entry(c) });
            } else if cur.window && !want.window {
                steps.push(Step::Remove { path: c.desktop_entry() });
            }
        }
    }
    steps
}

/// Files that point at another copy of the app (it moved, or an older install) are written
/// again; ones that need the administrator are only reported. Returns "needs setting up again".
pub fn refresh(c: &Ctx) -> Result<bool> {
    let now = status(c);
    let mut stale = false;
    if c.os == Os::Mac {
        for (on, path, text) in
            [(now.service != ServiceStart::Off, c.login_plist(), mac_login_plist(c)), (now.window, c.window_plist(), mac_window_plist(c))]
        {
            if on && std::fs::read_to_string(c.at(&path)).is_ok_and(|t| t != text) {
                apply(c, &[Step::Write { path, text }])?;
            }
        }
        if now.service == ServiceStart::Boot {
            stale =
                std::fs::read_to_string(c.at(&c.boot_plist())).is_ok_and(|t| !t.contains(&format!("<string>{}</string>", xml(&c.exe_s()))));
        }
    }
    if c.os == Os::Linux && now.service != ServiceStart::Off {
        let mode = if now.service == ServiceStart::Boot { "boot" } else { "login" };
        let text = linux_unit(c, mode);
        if std::fs::read_to_string(c.at(&c.unit())).is_ok_and(|t| t != text) {
            apply(c, &[Step::Write { path: c.unit(), text }, run(&["systemctl", "--user", "daemon-reload"], false)])?;
        }
    }
    Ok(stale)
}

/// macOS: can autostart point at this copy of the app?
pub fn installable(c: &Ctx) -> Result<()> {
    if c.os != Os::Mac || c.root.is_some() {
        return Ok(());
    }
    let Some(b) = &c.bundle else { bail!("Autostart needs the installed app (NeuralAgent.app).") };
    let s = b.to_string_lossy();
    if s.contains("/AppTranslocation/") || s.starts_with("/Volumes/") {
        bail!("Move NeuralAgent into your Applications folder first, open it from there and try again.");
    }
    Ok(())
}

pub fn set(c: &Ctx, want: Autostart) -> Result<Autostart> {
    let cur = status(c);
    if cur == want {
        return Ok(cur);
    }
    if want.service != ServiceStart::Off || want.window {
        installable(c)?;
    }
    apply(c, &plan(c, cur, want))?;
    Ok(status(c))
}

/// Is a login host set up (the boot host may hand over to it)? Read by the host itself.
pub fn login_host_installed() -> bool {
    Ctx::detect().is_ok_and(|c| c.os == Os::Mac && c.at(&c.login_plist()).exists())
}

/* ── doing it ───────────────────────────────────────────────────────── */

fn quiet(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    cmd
}

fn sh_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "/-_.:=@".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// The shell script behind the one administrator prompt (macOS / Linux).
fn admin_script(cmds: &[Vec<String>]) -> String {
    cmds.iter()
        .enumerate()
        .map(|(i, c)| {
            let line = c.iter().map(|a| sh_quote(a)).collect::<Vec<_>>().join(" ");
            // Unloading something that is not loaded is fine.
            if i == 0 && c.iter().any(|a| a == "bootout") { format!("{line} 2>/dev/null; true") } else { line }
        })
        .collect::<Vec<_>>()
        .join(" && ")
}

fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn log_command(c: &Ctx, line: &str) -> Result<()> {
    use std::io::Write;
    let root = c.root.as_ref().context("no root")?;
    std::fs::create_dir_all(root)?;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(root.join("commands.log"))?;
    writeln!(f, "{line}")?;
    Ok(())
}

pub fn apply(c: &Ctx, steps: &[Step]) -> Result<()> {
    for step in steps {
        match step {
            Step::Write { path, text } => {
                let p = c.at(path);
                if let Some(d) = p.parent() {
                    std::fs::create_dir_all(d)?;
                }
                if c.os == Os::Windows && p.extension().is_some_and(|e| e == "xml") {
                    // Task Scheduler wants UTF-16 with a byte order mark.
                    let mut b = vec![0xff, 0xfe];
                    b.extend(text.encode_utf16().flat_map(|u| u.to_le_bytes()));
                    std::fs::write(&p, b)?;
                } else {
                    std::fs::write(&p, text)?;
                }
            }
            Step::Remove { path } => match std::fs::remove_file(c.at(path)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                _ => {}
            },
            Step::Run { cmd, check } => {
                if c.root.is_some() {
                    log_command(c, &cmd.join(" "))?;
                    continue;
                }
                let ok = quiet(&cmd[0]).args(&cmd[1..]).status().is_ok_and(|s| s.success());
                if *check && !ok {
                    bail!("{} failed", cmd.join(" "));
                }
            }
            Step::Admin { cmds } => {
                if c.root.is_some() {
                    log_command(c, &format!("ADMIN {}", admin_script(cmds)))?;
                    continue;
                }
                admin(c, cmds)?;
            }
        }
    }
    Ok(())
}

fn admin(c: &Ctx, cmds: &[Vec<String>]) -> Result<()> {
    let ok = match c.os {
        Os::Mac => {
            let script = format!(
                "do shell script {} with administrator privileges with prompt {}",
                applescript_string(&admin_script(cmds)),
                applescript_string("NeuralAgent wants to start with the computer, before anyone logs in.")
            );
            let out = quiet("/usr/bin/osascript").args(["-e", &script]).output()?;
            if String::from_utf8_lossy(&out.stderr).contains("-128") {
                bail!("Cancelled.");
            }
            out.status.success()
        }
        Os::Linux => quiet("pkexec").args(["sh", "-c", &admin_script(cmds)]).status().is_ok_and(|s| s.success()),
        Os::Windows => cmds.iter().all(|cmd| {
            let args = cmd[1..].iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }).collect::<Vec<_>>().join(" ");
            let ps = format!(
                "$p = Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode",
                ps_quote(&cmd[0]),
                ps_quote(&args)
            );
            quiet("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &ps]).status().is_ok_and(|s| s.success())
        }),
    };
    if !ok {
        bail!("The administrator step did not finish.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(os: Os, root: &Path) -> Ctx {
        Ctx {
            os,
            exe: PathBuf::from(match os {
                Os::Mac => "/Applications/NeuralAgent.app/Contents/MacOS/neuralagent",
                Os::Windows => r"C:\Users\me\AppData\Local\NeuralAgent\neuralagent.exe",
                Os::Linux => "/home/me/Apps/NeuralAgent 1.AppImage",
            }),
            bundle: (os == Os::Mac).then(|| PathBuf::from("/Applications/NeuralAgent.app")),
            home: PathBuf::from(if os == Os::Mac { "/Users/me" } else { "/home/me" }),
            data: PathBuf::from("/Users/me/Library/Application Support/dev.neuralhub.neuralagent"),
            user: "me".into(),
            uid: 501,
            na_home: None,
            root: Some(root.to_path_buf()),
            active_host: None,
        }
    }

    fn root(name: &str) -> PathBuf {
        let r = std::env::temp_dir().join(format!("na-autostart-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&r);
        r
    }

    const LOGIN: Autostart = Autostart { service: ServiceStart::Login, window: false };
    const BOOT: Autostart = Autostart { service: ServiceStart::Boot, window: true };

    #[test]
    fn mac_round_trip() {
        let r = root("mac");
        let c = ctx(Os::Mac, &r);
        assert_eq!(status(&c), Autostart::OFF);
        assert_eq!(set(&c, LOGIN).unwrap(), LOGIN);
        // The admin step is only logged in a dry run, so the boot plist is not there yet.
        assert_eq!(set(&c, BOOT).unwrap(), Autostart { service: ServiceStart::Login, window: true });
        let boot = std::fs::read_to_string(c.at(&c.staged(&format!("{BOOT_LABEL}.plist")))).unwrap();
        assert!(boot.contains("<string>boot</string>") && boot.contains("<key>UserName</key>\n  <string>me</string>"));
        std::fs::create_dir_all(c.at(Path::new("/Library/LaunchDaemons"))).unwrap();
        std::fs::write(c.at(&c.boot_plist()), &boot).unwrap();
        assert_eq!(status(&c), BOOT);
        assert!(!refresh(&c).unwrap());
        assert_eq!(set(&c, Autostart::OFF).unwrap().window, false);
        let log = std::fs::read_to_string(r.join("commands.log")).unwrap();
        assert!(
            log.contains("launchctl bootstrap gui/501 /Users/me/Library/LaunchAgents/dev.neuralhub.neuralagent.service.plist"),
            "{log}"
        );
        assert!(log.contains("ADMIN /bin/launchctl bootout system/dev.neuralhub.neuralagent.boot 2>/dev/null; true && /bin/cp '/Users/me/Library/Application Support/dev.neuralhub.neuralagent/service/dev.neuralhub.neuralagent.boot.plist' /Library/LaunchDaemons/dev.neuralhub.neuralagent.boot.plist && /usr/sbin/chown root:wheel"), "{log}");
        assert!(
            log.contains("ADMIN /bin/launchctl bootout system/dev.neuralhub.neuralagent.boot 2>/dev/null; true && /bin/rm -f"),
            "{log}"
        );
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn mac_plists_are_valid() {
        let r = root("lint");
        let mut c = ctx(Os::Mac, &r);
        c.na_home = Some("/tmp/na <&> test".into());
        for (name, text) in [("login", mac_login_plist(&c)), ("boot", mac_boot_plist(&c)), ("window", mac_window_plist(&c))] {
            let p = r.join(format!("{name}.plist"));
            std::fs::create_dir_all(&r).unwrap();
            std::fs::write(&p, &text).unwrap();
            if Path::new("/usr/bin/plutil").exists() {
                let out = std::process::Command::new("/usr/bin/plutil").arg("-lint").arg(&p).output().unwrap();
                assert!(out.status.success(), "{name}: {}", String::from_utf8_lossy(&out.stdout));
            }
        }
        assert!(mac_login_plist(&c).contains("&lt;&amp;&gt;"));
        // Service hosts run unthrottled; the window opener is a plain job.
        let interactive = "<key>ProcessType</key>\n  <string>Interactive</string>";
        assert!(mac_login_plist(&c).contains(interactive) && mac_boot_plist(&c).contains(interactive));
        assert!(!mac_window_plist(&c).contains("ProcessType"));
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn nothing_changes_nothing_runs() {
        let r = root("same");
        let c = ctx(Os::Mac, &r);
        assert!(plan(&c, LOGIN, LOGIN).is_empty());
        // Login → boot keeps the login host as it is and only adds the boot one.
        let p = plan(&c, LOGIN, Autostart { service: ServiceStart::Boot, window: false });
        assert_eq!(p.len(), 2);
        assert!(matches!(&p[1], Step::Admin { .. }));
        // Switching off never stops a running host.
        let p = plan(&c, LOGIN, Autostart::OFF);
        assert_eq!(p, vec![Step::Remove { path: c.login_plist() }]);
        // Neither does switching back on, or off "at boot", while that host runs the service.
        let busy = |mode: &str| Ctx { active_host: Some(mode.into()), ..c.clone() };
        let p = plan(&busy("login"), Autostart::OFF, LOGIN);
        assert!(matches!(p.as_slice(), [Step::Write { .. }]), "{p:?}");
        let p = plan(&busy("boot"), Autostart { service: ServiceStart::Boot, window: false }, LOGIN);
        assert!(matches!(p.as_slice(), [Step::Admin { cmds }] if cmds.len() == 1 && cmds[0][0] == "/bin/rm"), "{p:?}");
        let p = plan(&busy("boot"), LOGIN, Autostart { service: ServiceStart::Boot, window: false });
        assert!(matches!(&p[1], Step::Admin { cmds } if !cmds.iter().flatten().any(|a| a == "bootout" || a == "bootstrap")), "{p:?}");
    }

    #[test]
    fn linux_round_trip() {
        let r = root("linux");
        let c = ctx(Os::Linux, &r);
        assert_eq!(
            set(&c, Autostart { service: ServiceStart::Login, window: true }).unwrap(),
            Autostart { service: ServiceStart::Login, window: true }
        );
        let unit = std::fs::read_to_string(c.at(&c.unit())).unwrap();
        assert!(unit.contains("ExecStart=\"/home/me/Apps/NeuralAgent 1.AppImage\" --service --mode login"), "{unit}");
        assert!(unit.contains("KillMode=process") && unit.contains("WantedBy=default.target"));
        let steps = plan(&c, LOGIN, Autostart { service: ServiceStart::Boot, window: false });
        assert!(steps.contains(&run(&["loginctl", "enable-linger", "me"], true)));
        set(&c, Autostart::OFF).unwrap();
        assert_eq!(status(&c), Autostart::OFF);
        let log = std::fs::read_to_string(r.join("commands.log")).unwrap();
        assert!(
            log.contains("systemctl --user enable neuralagent.service") && log.contains("systemctl --user disable neuralagent.service"),
            "{log}"
        );
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn windows_plan() {
        let r = root("win");
        let c = ctx(Os::Windows, &r);
        let p = plan(&c, Autostart::OFF, Autostart { service: ServiceStart::Boot, window: true });
        let Step::Write { text, .. } = &p[0] else { panic!("{p:?}") };
        assert!(
            text.contains("<LogonType>S4U</LogonType>")
                && text.contains("<BootTrigger>")
                && text.contains("<Arguments>--service --mode boot</Arguments>")
                // Normal priority: the default (7) runs the service and every agent below normal.
                && text.contains("<Priority>5</Priority>")
        );
        assert!(matches!(&p[1], Step::Admin { cmds } if cmds[0][0] == "schtasks" && cmds[0].contains(&WIN_TASK.to_string())));
        assert!(matches!(&p[2], Step::Run { cmd, .. } if cmd.contains(&"NeuralAgent".to_string())));
        let p = plan(&c, Autostart::OFF, LOGIN);
        assert!(matches!(&p[0], Step::Run { cmd, .. } if cmd.iter().any(|a| a.ends_with("neuralagent.exe\" --service --mode login"))));
        // The task file is UTF-16 for schtasks.
        let w = plan(&c, Autostart::OFF, Autostart { service: ServiceStart::Boot, window: false });
        apply(&c, &w).unwrap();
        let b = std::fs::read(c.at(&c.staged("boot-task.xml"))).unwrap();
        assert_eq!(&b[..2], &[0xff, 0xfe]);
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn quoting() {
        assert_eq!(sh_quote("/bin/cp"), "/bin/cp");
        assert_eq!(sh_quote("/Users/me/Application Support/x"), "'/Users/me/Application Support/x'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(applescript_string(r#"a "b" \c"#), r#""a \"b\" \\c""#);
        assert_eq!(ps_quote("it's"), "'it''s'");
    }
}
