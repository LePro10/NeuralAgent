//! The environment agents run in.
//!
//! Apps started from the Dock/Explorer get a minimal PATH, so CLIs installed by Homebrew, npm,
//! bun, cargo or the vendors' own installers would not be found. We capture the user's login
//! shell environment once and use it for every PTY, and additionally probe the usual install
//! locations, because some installers (e.g. `~/.local/bin`) are not on PATH even there.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::time::Duration;

/// Variables that must not leak from the daemon's own parent into agents (e.g. the daemon was
/// started from inside an agent session during development).
pub const STRIP: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PID",
    "CODEX_SANDBOX",
    "CODEX_THREAD_ID",
    "TERM_SESSION_ID",
    "ITERM_SESSION_ID",
    "TMUX",
    "TMUX_PANE",
    "VSCODE_INJECTION",
    "NEURALAGENT_SESSION",
    "NEURALAGENT_HOOK_TOKEN",
];

#[derive(Clone, Debug)]
pub struct LoginEnv {
    pub vars: BTreeMap<String, String>,
    pub shell: String,
    pub home: PathBuf,
}

impl LoginEnv {
    pub fn capture() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        let shell = default_shell();
        let mut vars: BTreeMap<String, String> = std::env::vars().collect();
        #[cfg(unix)]
        if let Some(captured) = capture_unix(&shell) {
            vars = captured;
        }
        for k in STRIP {
            vars.remove(*k);
        }
        // Make sure the usual install dirs are searchable even if the shell rc does not add them.
        let path_key = if cfg!(windows) { "Path" } else { "PATH" };
        let current = vars.get(path_key).or_else(|| vars.get("PATH")).cloned().unwrap_or_default();
        let mut parts: Vec<PathBuf> = std::env::split_paths(&current).collect();
        for extra in extra_dirs(&home) {
            if extra.is_dir() && !parts.contains(&extra) {
                parts.push(extra);
            }
        }
        if let Ok(joined) = std::env::join_paths(parts) {
            vars.insert(path_key.to_string(), joined.to_string_lossy().into_owned());
        }
        Self { vars, shell, home }
    }

    pub fn path_dirs(&self) -> Vec<PathBuf> {
        let p = self.vars.get("PATH").or_else(|| self.vars.get("Path")).cloned().unwrap_or_default();
        std::env::split_paths(&p).collect()
    }

    /// Full path of an executable, searching PATH and the known install locations.
    pub fn which(&self, cmd: &str) -> Option<PathBuf> {
        let p = Path::new(cmd);
        if p.is_absolute() {
            return is_executable(p).then(|| p.to_path_buf());
        }
        let exts: Vec<String> = if cfg!(windows) {
            self.vars
                .get("PATHEXT")
                .cloned()
                .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".into())
                .split(';')
                .map(|e| e.to_ascii_lowercase())
                .chain(std::iter::once(String::new()))
                .collect()
        } else {
            vec![String::new()]
        };
        for dir in self.path_dirs().into_iter().chain(extra_dirs(&self.home)) {
            for ext in &exts {
                let cand = dir.join(format!("{cmd}{ext}"));
                if is_executable(&cand) {
                    return Some(cand);
                }
            }
        }
        None
    }
}

fn is_executable(p: &Path) -> bool {
    match std::fs::metadata(p) {
        Ok(m) if m.is_file() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                m.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                true
            }
        }
        _ => false,
    }
}

pub fn default_shell() -> String {
    #[cfg(windows)]
    {
        for c in ["pwsh.exe", "powershell.exe"] {
            if let Ok(out) = std::process::Command::new("where").arg(c).output() {
                if out.status.success() {
                    return c.into();
                }
            }
        }
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        if let Ok(s) = std::env::var("SHELL")
            && !s.is_empty()
        {
            return s;
        }
        #[cfg(target_os = "macos")]
        return "/bin/zsh".into();
        #[cfg(not(target_os = "macos"))]
        return "/bin/bash".into();
    }
}

fn extra_dirs(home: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = [
        ".local/bin",
        ".npm-global/bin",
        ".bun/bin",
        ".cargo/bin",
        ".deno/bin",
        ".volta/bin",
        ".opencode/bin",
        ".amp/bin",
        ".grok/bin",
        "bin",
        "go/bin",
        "Library/pnpm",
        ".local/share/pnpm",
    ]
    .iter()
    .map(|d| home.join(d))
    .collect();
    if cfg!(target_os = "macos") {
        v.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    if cfg!(target_os = "linux") {
        v.extend(["/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin", "/snap/bin"].map(PathBuf::from));
    }
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            v.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            v.push(local.join("Programs"));
            v.push(local.join("Microsoft").join("WinGet").join("Links"));
        }
    }
    v
}

#[cfg(unix)]
fn capture_unix(shell: &str) -> Option<BTreeMap<String, String>> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    const MARK: &str = "__NEURALAGENT_ENV__";
    let mut cmd = Command::new(shell);
    cmd.args(["-ilc", &format!("printf '\\0{MARK}\\0'; env -0")]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    for k in STRIP {
        cmd.env_remove(k);
    }
    let mut child = cmd.spawn().ok()?;
    let mut out = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let buf = match rx.recv_timeout(Duration::from_secs(8)) {
        Ok(b) => b,
        Err(_) => {
            let _ = child.kill();
            tracing::warn!("login shell env capture timed out");
            return None;
        }
    };
    let _ = child.wait();
    let text = String::from_utf8_lossy(&buf);
    let marker = format!("\0{MARK}\0");
    let body = &text[text.find(&marker)? + marker.len()..];
    let vars: BTreeMap<String, String> = body
        .split('\0')
        .filter_map(|kv| kv.split_once('='))
        .filter(|(k, _)| !k.is_empty() && !k.contains('\n'))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    (vars.contains_key("PATH")).then_some(vars)
}
