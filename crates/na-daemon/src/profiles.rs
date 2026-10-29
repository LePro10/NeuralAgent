//! Built-in launch profiles and how a profile becomes a command line.

use std::collections::BTreeMap;

use na_protocol::{ApiError, ErrorCode, Profile};

use crate::env::LoginEnv;

fn p(id: &str, name: &str, engine: &str, command: &str, icon: &str) -> Profile {
    Profile {
        id: id.into(),
        name: name.into(),
        engine: engine.into(),
        command: command.into(),
        args: vec![],
        env: BTreeMap::new(),
        icon: icon.into(),
        builtin: true,
    }
}

pub fn builtin() -> Vec<Profile> {
    vec![
        p("shell", "Terminal", "shell", "", "terminal"),
        p("claude", "Claude Code", "claude", "claude", "claude"),
        p("codex", "Codex", "codex", "codex", "codex"),
        p("gemini", "Gemini CLI", "gemini", "gemini", "gemini"),
    ]
}

pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// The initial prompt is part of `args`; otherwise it is typed in after start.
    pub prompt_in_args: bool,
}

pub fn launch(env: &LoginEnv, profile: &Profile, prompt: Option<&str>, resume: Option<&str>) -> Result<Launch, ApiError> {
    if profile.engine == "shell" && profile.command.is_empty() {
        let args = if cfg!(windows) { vec![] } else { vec!["-l".to_string()] };
        return Ok(Launch { program: env.shell.clone(), args, env: vec![], prompt_in_args: false });
    }
    let program = env
        .which(&profile.command)
        .ok_or_else(|| ApiError { code: ErrorCode::NotFound, message: format!("{} is not installed (command `{}` not found)", profile.name, profile.command) })?
        .to_string_lossy()
        .into_owned();
    let mut args = profile.args.clone();
    let mut prompt_in_args = false;
    match profile.engine.as_str() {
        "claude" => {
            if let Some(r) = resume {
                args.extend(["--resume".into(), r.into()]);
            }
            if let Some(p) = prompt {
                args.push(p.into());
                prompt_in_args = true;
            }
        }
        "codex" => {
            if let Some(r) = resume {
                args.splice(0..0, ["resume".to_string(), r.to_string()]);
            }
            if let Some(p) = prompt {
                args.push(p.into());
                prompt_in_args = true;
            }
        }
        "gemini" => {
            if let Some(p) = prompt {
                args.extend(["-i".into(), p.into()]);
                prompt_in_args = true;
            }
        }
        _ => {}
    }
    Ok(Launch { program, args, env: vec![], prompt_in_args })
}
