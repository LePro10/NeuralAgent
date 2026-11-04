//! Workspaces on other computers over SSH (D87). The system `ssh` does everything, so
//! `~/.ssh/config`, keys, the agent, jump hosts and `known_hosts` all apply. The daemon is the
//! one that connects: phones and browsers reach a remote folder through it, like any other.
//!
//! Connection sharing (`ControlMaster`) keeps one connection per host open for ten minutes, so
//! browsing and starting agents is instant, and a password typed once in a terminal pane
//! also serves the folder browser afterwards. No ports are forwarded and nothing is installed on
//! the other computer: it needs `sh` and, for agents, the CLIs themselves.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use na_protocol::{ApiError, ErrorCode, FsEntry, Profile, SshHost, SshKnown};
use serde_json::{Value, json};

use crate::catalog::{self, PromptMode};
use crate::core::err;
use crate::profiles::Launch;

/// Folders shown first when browsing a computer (like `fsbrowse::roots`).
const PROJECT_DIRS: &str = "Projects Developer Code dev src repos GitHub Documents Desktop";

/// `'it'\''s'`: one word for any POSIX-like shell (sh, bash, zsh, fish).
pub fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Host and user become command-line words: nothing that ssh could read as an option.
pub fn validate(h: &SshHost) -> Result<(), ApiError> {
    let word = |s: &str, extra: &str| {
        !s.is_empty() && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c) || extra.contains(c))
    };
    if !word(&h.host, ":%[]") {
        return Err(err(ErrorCode::BadRequest, "That is not a valid host name"));
    }
    if h.user.as_deref().is_some_and(|u| !word(u, "")) {
        return Err(err(ErrorCode::BadRequest, "That is not a valid user name"));
    }
    if h.port == Some(0) {
        return Err(err(ErrorCode::BadRequest, "That is not a valid port"));
    }
    Ok(())
}

/// Where the shared connections live. Short on purpose: a socket path is limited to ~100 bytes.
fn control_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        return None; // Windows' OpenSSH has no connection sharing
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // SAFETY: getuid has no preconditions.
        let uid = unsafe { libc::getuid() };
        let dir = PathBuf::from(format!("/tmp/na-ssh-{uid}"));
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).ok()?;
        Some(dir)
    }
    #[cfg(not(unix))]
    None
}

/// Options shared by every connection. `batch`: never ask anything (browsing, checks).
fn options(h: &SshHost, batch: bool, tty: bool) -> Vec<String> {
    let mut a: Vec<String> = vec![];
    let mut o = |s: &str| {
        a.push("-o".into());
        a.push(s.into());
    };
    o("StrictHostKeyChecking=accept-new");
    o("ServerAliveInterval=15");
    o("ServerAliveCountMax=3");
    o(&format!("ConnectTimeout={}", if batch { 8 } else { 15 }));
    if batch {
        o("BatchMode=yes");
    }
    if let Some(dir) = control_dir() {
        o("ControlMaster=auto");
        o(&format!("ControlPath={}/%C", dir.display()));
        o("ControlPersist=10m");
    }
    if tty {
        a.push("-t".into());
    } else {
        a.push("-T".into());
    }
    if let Some(p) = h.port {
        a.extend(["-p".into(), p.to_string()]);
    }
    if let Some(u) = &h.user {
        a.extend(["-l".into(), u.clone()]);
    }
    a.push(h.host.clone());
    a
}

/// Turns what ssh said into something a person can act on.
fn explain(stderr: &str) -> String {
    let last = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("ssh failed").trim();
    let low = last.to_lowercase();
    if low.contains("permission denied") || low.contains("no more authentication") {
        "Permission denied. Set up a key login (ssh-copy-id), or add the host anyway and sign in once in its terminal.".into()
    } else if low.contains("could not resolve") || low.contains("name or service not known") {
        format!("Host not found. {last}")
    } else if low.contains("timed out") || low.contains("connection refused") || low.contains("no route") {
        format!("Cannot reach the host. {last}")
    } else if low.contains("host key verification failed") || low.contains("remote host identification has changed") {
        "The host key changed. Check ~/.ssh/known_hosts on the computer running NeuralAgent.".into()
    } else if low.contains("no such file") && low.contains("ssh") {
        "ssh is not installed on the computer running NeuralAgent".into()
    } else {
        last.to_string()
    }
}

/// Runs `script` with `sh` on the other computer; `args` become `$1`, `$2`, … Without a tty.
async fn run(h: &SshHost, script: &str, args: &[&str]) -> Result<String, ApiError> {
    validate(h)?;
    let mut cmd = tokio::process::Command::new("ssh");
    let words: Vec<String> = ["sh", "-c", script, "sh"].iter().copied().chain(args.iter().copied()).map(quote).collect();
    cmd.args(options(h, true, false)).arg(words.join(" "));
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(25), cmd.output())
        .await
        .map_err(|_| err(ErrorCode::Unavailable, "The host did not answer in time"))?
        .map_err(|e| {
            err(
                ErrorCode::Unavailable,
                if e.kind() == std::io::ErrorKind::NotFound { "ssh is not installed on this computer".into() } else { e.to_string() },
            )
        })?;
    if !out.status.success() {
        let code = out.status.code();
        let stderr = String::from_utf8_lossy(&out.stderr);
        // 255 is ssh itself; anything else is our script (e.g. a folder that does not exist).
        let msg = if code == Some(255) || stderr.trim().is_empty() {
            explain(&stderr)
        } else {
            stderr.trim().lines().last().unwrap_or("failed").to_string()
        };
        return Err(err(if code == Some(3) { ErrorCode::NotFound } else { ErrorCode::Unavailable }, msg));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `$1` with `~` expanded; leaves the folder in `$d`.
const RESOLVE: &str = r#"case "$1" in ""|"~") d="$HOME";; "~/"*) d="$HOME/${1#"~/"}";; *) d="$1";; esac
cd -- "$d" 2>/dev/null || { echo "$d is not a folder on this computer" >&2; exit 3; }
"#;

pub async fn list(h: &SshHost, path: &str) -> Result<Value, ApiError> {
    let script = format!(
        r#"{RESOLVE}pwd -P
if [ -d .git ]; then echo G; else echo D; fi
for f in */; do [ -d "$f" ] || continue; n="${{f%/}}"; if [ -d "$f.git" ]; then echo "G $n"; else echo "D $n"; fi; done
exit 0"#
    );
    Ok(parse_listing(&run(h, &script, &[path]).await?))
}

/// `list` output → what `fs_list` answers.
pub fn parse_listing(out: &str) -> Value {
    let mut lines = out.lines();
    let dir = lines.next().unwrap_or("/").to_string();
    let git = lines.next() == Some("G");
    let mut entries: Vec<FsEntry> = lines
        .filter_map(|l| {
            let (k, name) = l.split_once(' ')?;
            let path = if dir == "/" { format!("/{name}") } else { format!("{dir}/{name}") };
            Some(FsEntry { name: name.to_string(), path, dir: true, git: k == "G", needs_fda: None })
        })
        .collect();
    entries.sort_by_key(|e| e.name.to_lowercase());
    let parent = (dir != "/").then(|| Path::new(&dir).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "/".into()));
    json!({ "path": dir, "git": git, "parent": parent, "entries": entries })
}

pub async fn roots(h: &SshHost) -> Result<Value, ApiError> {
    let script = format!(
        r#"printf '%s\n' "$HOME"
for d in {PROJECT_DIRS}; do if [ -d "$HOME/$d" ]; then if [ -d "$HOME/$d/.git" ]; then echo "G $d"; else echo "D $d"; fi; fi; done
exit 0"#
    );
    let out = run(h, &script, &[]).await?;
    let mut lines = out.lines();
    let home = lines.next().unwrap_or("/").trim_end_matches('/').to_string();
    let projects: Vec<FsEntry> = lines
        .filter_map(|l| {
            let (k, name) = l.split_once(' ')?;
            Some(FsEntry { name: name.to_string(), path: format!("{home}/{name}"), dir: true, git: k == "G", needs_fda: None })
        })
        .collect();
    Ok(json!({ "home": home, "projects": projects }))
}

pub async fn mkdir(h: &SshHost, parent: &str, name: &str) -> Result<Value, ApiError> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0', '\n']) {
        return Err(err(ErrorCode::BadRequest, "A folder name cannot be empty or contain slashes"));
    }
    let script = format!("{RESOLVE}mkdir -- \"$2\" && cd -- \"$2\" && pwd -P");
    let out = run(h, &script, &[parent, name]).await?;
    let path = out.lines().next().unwrap_or_default().to_string();
    Ok(json!(FsEntry { name: name.to_string(), path, dir: true, git: false, needs_fda: None }))
}

/// The folder as it really is on the other computer (absolute), or why it cannot be used.
pub async fn resolve(h: &SshHost, path: &str) -> Result<String, ApiError> {
    let out = run(h, &format!("{RESOLVE}pwd -P"), &[path]).await?;
    Ok(out.lines().next().unwrap_or_default().to_string())
}

/// Branch and changes of a folder there (blocking; the git refresh runs on its own thread).
pub fn git_summary(h: &SshHost, path: &str) -> Option<na_protocol::GitSummary> {
    validate(h).ok()?;
    let script = format!("{RESOLVE}git status --porcelain=v2 --branch -z 2>/dev/null");
    let words: Vec<String> = ["sh", "-c", &script, "sh", path].iter().map(|s| quote(s)).collect();
    let mut opts = options(h, true, false);
    // Quick: this runs in the background every minute.
    opts.splice(0..0, ["-o".to_string(), "ConnectTimeout=5".to_string()]);
    let out = std::process::Command::new("ssh").args(opts).arg(words.join(" ")).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    crate::git::parse_summary(&String::from_utf8_lossy(&out.stdout), || None)
}

/// The command line for a terminal or agent in `cwd` on the other computer. Agents run through
/// the user's own login shell there, so their PATH (nvm, ~/.local/bin, …) is the one they know.
/// Hooks and MCP servers belong to this computer and are not passed on; status comes from output.
pub fn launch(h: &SshHost, profile: &Profile, prompt: Option<&str>, resume: Option<&str>, cwd: &str) -> Result<Launch, ApiError> {
    validate(h)?;
    let mut prompt_in_args = false;
    let words: Option<Vec<String>> = match profile.engine.as_str() {
        "shell" if profile.command.is_empty() => None,
        "install" => Some(vec![profile.command.clone()]).map(|v| vec![v.join(" ")]),
        _ => {
            let mut w = vec![profile.command.clone()];
            let agent = catalog::agent(&profile.engine);
            if let (Some(a), Some(r)) = (agent, resume) {
                w.extend(a.resume.iter().map(|x| x.replace("{}", r)));
            }
            w.extend(profile.args.iter().cloned());
            if let (Some(a), Some(p)) = (agent, prompt) {
                match a.prompt {
                    PromptMode::Positional => w.push(p.into()),
                    PromptMode::Flag(f) => w.extend([f.into(), p.into()]),
                    PromptMode::TypeIn => {}
                }
                prompt_in_args = a.prompt != PromptMode::TypeIn;
            }
            Some(w.iter().map(|x| quote(x)).collect())
        }
    };
    let cd = match cwd {
        "" | "~" => "cd".to_string(),
        c if c.starts_with("~/") => format!("cd \"$HOME\"/{}", quote(&c[2..])),
        c => format!("cd {}", quote(c)),
    };
    // "install" carries a ready command line (pipes and all); an agent is a list of words.
    let tail = match (&words, profile.engine.as_str()) {
        (None, _) => r#"exec "$SHELL" -l"#.to_string(),
        (Some(w), "install") => format!(r#"exec "$SHELL" -l -i -c {}"#, quote(&w.join(" "))),
        (Some(w), _) => format!(r#"exec "$SHELL" -l -i -c {}"#, quote(&w.join(" "))),
    };
    let mut args = options(h, false, true);
    args.push(format!("{cd} && {tail}"));
    Ok(Launch { program: "ssh".into(), args, env: vec![], prompt_in_args })
}

/// The hosts in `~/.ssh/config` that can be connected to by name (no wildcards).
pub fn known_hosts(home: &Path) -> Vec<SshKnown> {
    let text = std::fs::read_to_string(home.join(".ssh/config")).unwrap_or_default();
    parse_config(&text)
}

pub fn parse_config(text: &str) -> Vec<SshKnown> {
    let mut out: Vec<SshKnown> = vec![];
    // The aliases of the Host block being read.
    let mut current: Vec<usize> = vec![];
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let (key, val) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, v)) => (k.to_lowercase(), v.trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim()),
            None => continue,
        };
        match key.as_str() {
            "host" => {
                current.clear();
                for alias in val.split_whitespace() {
                    if alias.contains(['*', '?', '!']) {
                        continue;
                    }
                    current.push(out.len());
                    out.push(SshKnown { alias: alias.to_string(), hostname: None, user: None, port: None });
                }
            }
            "match" => current.clear(),
            "hostname" => current.iter().for_each(|&i| out[i].hostname = Some(val.to_string())),
            "user" => current.iter().for_each(|&i| out[i].user = Some(val.to_string())),
            "port" => current.iter().for_each(|&i| out[i].port = val.parse().ok()),
            _ => {}
        }
    }
    out.retain(|k| validate(&SshHost { host: k.alias.clone(), user: None, port: None }).is_ok());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host() -> SshHost {
        SshHost { host: "box".into(), user: Some("me".into()), port: Some(2222) }
    }

    #[test]
    fn quoting_survives_apostrophes() {
        assert_eq!(quote("a'b"), r"'a'\''b'");
    }

    #[test]
    fn hosts_cannot_look_like_options() {
        assert!(validate(&host()).is_ok());
        assert!(validate(&SshHost { host: "-oProxyCommand=x".into(), user: None, port: None }).is_err());
        assert!(validate(&SshHost { host: "a b".into(), user: None, port: None }).is_err());
        assert!(validate(&SshHost { host: "h".into(), user: Some("-x".into()), port: None }).is_err());
    }

    #[test]
    fn config_lists_named_hosts_only() {
        let k = parse_config(
            "Host *\n  User x\nHost web staging\n  HostName 10.0.0.2\n  User deploy\n  Port 2200\nHost *.corp\nHost gpu\n  HostName gpu.example.com\n",
        );
        let names: Vec<&str> = k.iter().map(|k| k.alias.as_str()).collect();
        assert_eq!(names, ["web", "staging", "gpu"]);
        assert_eq!(k[1].user.as_deref(), Some("deploy"));
        assert_eq!(k[1].port, Some(2200));
        assert_eq!(k[2].hostname.as_deref(), Some("gpu.example.com"));
    }

    #[test]
    fn listing_is_parsed() {
        let v = parse_listing("/home/me/code\nG\nD zeta\nG app\n");
        assert_eq!(v["path"], "/home/me/code");
        assert_eq!(v["git"], true);
        assert_eq!(v["parent"], "/home/me");
        assert_eq!(v["entries"][0]["name"], "app");
        assert_eq!(v["entries"][0]["path"], "/home/me/code/app");
        assert_eq!(v["entries"][0]["git"], true);
    }

    #[test]
    fn terminal_command_goes_through_the_login_shell() {
        let p = Profile {
            id: "shell".into(),
            name: "Terminal".into(),
            engine: "shell".into(),
            command: String::new(),
            args: vec![],
            env: Default::default(),
            icon: "shell".into(),
            builtin: true,
        };
        let l = launch(&host(), &p, None, None, "/srv/it's").unwrap();
        assert_eq!(l.program, "ssh");
        let last = l.args.last().unwrap();
        assert_eq!(last, r#"cd '/srv/it'\''s' && exec "$SHELL" -l"#);
        assert!(l.args.windows(2).any(|w| w == ["-p", "2222"]));
        assert!(l.args.windows(2).any(|w| w == ["-l", "me"]));
        assert!(l.args.contains(&"-t".to_string()));
    }
}
