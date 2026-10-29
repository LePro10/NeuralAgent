//! Built-in launch profiles and how a profile becomes a command line.

use std::collections::BTreeMap;
use std::path::Path;

use na_protocol::{ApiError, ErrorCode, Profile};
use serde_json::{Value, json};

use crate::catalog::{self, Hooks, PromptMode};
use crate::env::LoginEnv;

/// Pseudo profiles `install:<agent>` run an agent's install command in a pane.
pub const INSTALL_PREFIX: &str = "install:";

fn p(id: &str, name: &str, engine: &str, command: &str) -> Profile {
    Profile {
        id: id.into(),
        name: name.into(),
        engine: engine.into(),
        command: command.into(),
        args: vec![],
        env: BTreeMap::new(),
        icon: engine.into(),
        builtin: true,
    }
}

/// A terminal plus one profile per known agent CLI (the UI only offers installed ones).
pub fn builtin() -> Vec<Profile> {
    std::iter::once(p("shell", "Terminal", "shell", "")).chain(catalog::AGENTS.iter().map(|a| p(a.id, a.name, a.id, a.command))).collect()
}

pub fn install_profile(agent_id: &str) -> Option<Profile> {
    let a = catalog::agent(agent_id)?;
    Some(p(&format!("{INSTALL_PREFIX}{}", a.id), &format!("Install {}", a.name), "install", a.install()))
}

pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// The initial prompt is part of `args`; otherwise it is typed in after start.
    pub prompt_in_args: bool,
}

fn login_shell(env: &LoginEnv, command: Option<&str>) -> Launch {
    let (program, args) = match (cfg!(windows), command) {
        (true, Some(c)) => (
            "powershell.exe".to_string(),
            vec!["-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-Command".into(), c.into()],
        ),
        (true, None) => (env.shell.clone(), vec![]),
        (false, Some(c)) => (env.shell.clone(), vec!["-lc".into(), c.into()]),
        (false, None) => (env.shell.clone(), vec!["-l".into()]),
    };
    Launch { program, args, env: vec![], prompt_in_args: false }
}

/// `extra` (MCP servers) goes before the hook options: Claude's `--mcp-config` takes any number
/// of values, so the next option has to end it.
pub fn launch(
    env: &LoginEnv,
    profile: &Profile,
    prompt: Option<&str>,
    resume: Option<&str>,
    hook_exe: &Path,
    extra: &[String],
) -> Result<Launch, ApiError> {
    match profile.engine.as_str() {
        "shell" if profile.command.is_empty() => return Ok(login_shell(env, None)),
        "install" => return Ok(login_shell(env, Some(&profile.command))),
        _ => {}
    }
    let program = env
        .which(&profile.command)
        .ok_or_else(|| ApiError {
            code: ErrorCode::NotFound,
            message: format!("{} is not installed (command `{}` not found)", profile.name, profile.command),
        })?
        .to_string_lossy()
        .into_owned();
    let Some(agent) = catalog::agent(&profile.engine) else {
        // Custom command: arguments as configured, prompt typed in.
        return Ok(Launch { program, args: profile.args.clone(), env: vec![], prompt_in_args: false });
    };

    let mut args: Vec<String> = Vec::new();
    if let Some(r) = resume.filter(|_| !agent.resume.is_empty()) {
        args.extend(agent.resume.iter().map(|a| a.replace("{}", r)));
    }
    args.extend(extra.iter().cloned());
    match agent.hooks {
        Hooks::ClaudeSettings => args.extend(["--settings".into(), claude_settings(hook_exe).to_string()]),
        Hooks::CodexNotify => args.extend(["-c".into(), format!("notify={}", json!([hook_exe.to_string_lossy(), "hook", "codex-notify"]))]),
        Hooks::None => {}
    }
    args.extend(profile.args.iter().cloned());
    let mut prompt_in_args = false;
    if let Some(p) = prompt {
        match agent.prompt {
            PromptMode::Positional => args.push(p.into()),
            PromptMode::Flag(f) => args.extend([f.into(), p.into()]),
            PromptMode::TypeIn => {}
        }
        prompt_in_args = agent.prompt != PromptMode::TypeIn;
    }
    Ok(Launch { program, args, env: vec![], prompt_in_args })
}

/// The Claude Code events we listen to. Hooks from `--settings` merge with the user's own.
pub const CLAUDE_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Notification",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

pub fn claude_settings(hook_exe: &Path) -> Value {
    let exe = shell_quote(&hook_exe.to_string_lossy());
    let hooks: serde_json::Map<String, Value> = CLAUDE_EVENTS
        .iter()
        .map(|ev| (ev.to_string(), json!([{ "hooks": [{ "type": "command", "command": format!("{exe} hook {ev}"), "timeout": 10 }] }])))
        .collect();
    // The statusline command reports the subscription limits, then runs the user's own one.
    json!({ "hooks": hooks, "statusLine": { "type": "command", "command": format!("{exe} statusline"), "padding": 0 } })
}

/// Quotes a path for the shell that runs hook commands (sh on unix, cmd/PowerShell on Windows).
fn shell_quote(s: &str) -> String {
    if cfg!(windows) { format!("\"{s}\"") } else { format!("'{}'", s.replace('\'', r"'\''")) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_hook_command_is_quoted() {
        let v = claude_settings(Path::new("/Applications/Neural Agent.app/neuralagentd"));
        let cmd = v["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
        if !cfg!(windows) {
            assert_eq!(cmd, "'/Applications/Neural Agent.app/neuralagentd' hook Stop");
        }
        assert_eq!(v["hooks"].as_object().unwrap().len(), CLAUDE_EVENTS.len());
    }

    #[test]
    fn builtins_cover_catalog() {
        let b = builtin();
        assert_eq!(b.len(), catalog::AGENTS.len() + 1);
        assert!(install_profile("codex").unwrap().command.contains("codex"));
        assert!(install_profile("nope").is_none());
    }
}
