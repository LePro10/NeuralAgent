//! Known agent CLIs: how to find, install, start and resume them, and how we get their status.
//!
//! Install commands come from each vendor's own docs (checked 2026-10-29). They are shown to the
//! user before they run and run visibly in a pane.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use na_protocol::CatalogEntry;

use crate::env::LoginEnv;

/// How an initial prompt reaches the CLI while keeping its interactive UI open.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PromptMode {
    /// `cli "prompt"`
    Positional,
    /// `cli <flag> "prompt"`
    Flag(&'static str),
    /// No such option: typed into the UI once it is up.
    TypeIn,
}

/// Where status comes from besides terminal output.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Hooks {
    /// `claude --settings <json>` with our hook commands (merged with the user's own hooks).
    ClaudeSettings,
    /// `codex -c notify=[…]`: a call at the end of every turn.
    CodexNotify,
    None,
}

pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    pub vendor: &'static str,
    pub command: &'static str,
    pub docs: &'static str,
    pub install_unix: &'static str,
    pub install_windows: &'static str,
    pub install_note: Option<&'static str>,
    pub prompt: PromptMode,
    /// Arguments that resume a previous session; `{}` is the engine's session id.
    pub resume: &'static [&'static str],
    pub hooks: Hooks,
}

const NODE: Option<&str> = Some("Needs Node.js 20 or newer.");

pub const AGENTS: &[Agent] = &[
    Agent {
        id: "claude",
        name: "Claude Code",
        vendor: "Anthropic",
        command: "claude",
        docs: "https://code.claude.com/docs",
        install_unix: "curl -fsSL https://claude.ai/install.sh | bash",
        install_windows: "irm https://claude.ai/install.ps1 | iex",
        install_note: None,
        prompt: PromptMode::Positional,
        resume: &["--resume", "{}"],
        hooks: Hooks::ClaudeSettings,
    },
    Agent {
        id: "codex",
        name: "Codex",
        vendor: "OpenAI",
        command: "codex",
        docs: "https://github.com/openai/codex",
        install_unix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        install_windows: "irm https://chatgpt.com/codex/install.ps1 | iex",
        install_note: None,
        prompt: PromptMode::Positional,
        resume: &["resume", "{}"],
        hooks: Hooks::CodexNotify,
    },
    Agent {
        id: "gemini",
        name: "Gemini CLI",
        vendor: "Google",
        command: "gemini",
        docs: "https://github.com/google-gemini/gemini-cli",
        install_unix: "npm install -g @google/gemini-cli",
        install_windows: "npm install -g @google/gemini-cli",
        install_note: NODE,
        prompt: PromptMode::Flag("-i"),
        resume: &["--resume", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "antigravity",
        name: "Antigravity CLI",
        vendor: "Google",
        command: "agy",
        docs: "https://antigravity.google",
        install_unix: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
        install_windows: "irm https://antigravity.google/cli/install.ps1 | iex",
        install_note: None,
        prompt: PromptMode::Flag("-i"),
        resume: &["--conversation", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "cursor",
        name: "Cursor Agent",
        vendor: "Cursor",
        command: "agent",
        docs: "https://cursor.com/docs/cli/overview",
        install_unix: "curl https://cursor.com/install -fsS | bash",
        install_windows: "irm 'https://cursor.com/install?win32=true' | iex",
        install_note: None,
        prompt: PromptMode::Positional,
        resume: &["--resume", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "copilot",
        name: "Copilot CLI",
        vendor: "GitHub",
        command: "copilot",
        docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli",
        install_unix: "curl -fsSL https://gh.io/copilot-install | bash",
        install_windows: "winget install GitHub.Copilot",
        install_note: None,
        prompt: PromptMode::Flag("-i"),
        resume: &["--resume", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "opencode",
        name: "OpenCode",
        vendor: "SST",
        command: "opencode",
        docs: "https://opencode.ai/docs/",
        install_unix: "curl -fsSL https://opencode.ai/install | bash",
        install_windows: "npm install -g opencode-ai",
        install_note: None,
        prompt: PromptMode::Flag("--prompt"),
        resume: &["-s", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "grok",
        name: "Grok Build",
        vendor: "xAI",
        command: "grok",
        docs: "https://docs.x.ai/build/cli/reference",
        install_unix: "curl -fsSL https://x.ai/cli/install.sh | bash",
        install_windows: "irm https://x.ai/cli/install.ps1 | iex",
        install_note: None,
        prompt: PromptMode::TypeIn,
        resume: &["--resume", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "amp",
        name: "Amp",
        vendor: "Amp",
        command: "amp",
        docs: "https://ampcode.com",
        install_unix: "curl -fsSL https://ampcode.com/install.sh | bash",
        install_windows: "npm install -g @ampcode/cli",
        install_note: None,
        prompt: PromptMode::TypeIn,
        resume: &[],
        hooks: Hooks::None,
    },
    Agent {
        id: "droid",
        name: "Droid",
        vendor: "Factory",
        command: "droid",
        docs: "https://docs.factory.com/cli/getting-started/quickstart",
        install_unix: "curl -fsSL https://app.factory.ai/cli | sh",
        install_windows: "irm https://app.factory.ai/cli/windows | iex",
        install_note: None,
        prompt: PromptMode::Positional,
        resume: &["--resume", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "kimi",
        name: "Kimi Code",
        vendor: "Moonshot AI",
        command: "kimi",
        docs: "https://github.com/MoonshotAI/kimi-cli",
        install_unix: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
        install_windows: "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
        install_note: None,
        prompt: PromptMode::TypeIn,
        resume: &["--session", "{}"],
        hooks: Hooks::None,
    },
    Agent {
        id: "qwen",
        name: "Qwen Code",
        vendor: "Alibaba",
        command: "qwen",
        docs: "https://github.com/QwenLM/qwen-code",
        install_unix: "npm install -g @qwen-code/qwen-code@latest",
        install_windows: "npm install -g @qwen-code/qwen-code@latest",
        install_note: Some("Needs Node.js 22 or newer."),
        prompt: PromptMode::TypeIn,
        resume: &[],
        hooks: Hooks::None,
    },
    Agent {
        id: "aider",
        name: "Aider",
        vendor: "Aider",
        command: "aider",
        docs: "https://aider.chat/docs/install.html",
        install_unix: "curl -LsSf https://aider.chat/install.sh | sh",
        install_windows: "irm https://aider.chat/install.ps1 | iex",
        install_note: Some("Bring your own model API key."),
        prompt: PromptMode::TypeIn,
        resume: &[],
        hooks: Hooks::None,
    },
];

pub fn agent(engine: &str) -> Option<&'static Agent> {
    AGENTS.iter().find(|a| a.id == engine)
}

impl Agent {
    pub fn install(&self) -> &'static str {
        if cfg!(windows) { self.install_windows } else { self.install_unix }
    }
}

/// Finds every known CLI and asks it for its version (in parallel, a few seconds at most).
pub fn detect(env: &LoginEnv) -> Vec<CatalogEntry> {
    let found: Vec<_> = AGENTS.iter().map(|a| (a, env.which(a.command))).collect();
    let versions: Vec<Option<String>> = std::thread::scope(|s| {
        let handles: Vec<_> = found
            .iter()
            .map(|(_, p)| s.spawn(move || p.as_deref().and_then(|p| version(env, p))))
            .collect();
        handles.into_iter().map(|h| h.join().ok().flatten()).collect()
    });
    found
        .into_iter()
        .zip(versions)
        .map(|((a, path), version)| CatalogEntry {
            id: a.id.into(),
            name: a.name.into(),
            vendor: a.vendor.into(),
            command: a.command.into(),
            installed: path.is_some(),
            path: path.map(|p| p.to_string_lossy().into_owned()),
            version,
            install: Some(a.install().into()),
            install_note: a.install_note.map(Into::into),
            docs_url: a.docs.into(),
            hooks: a.hooks != Hooks::None,
        })
        .collect()
}

fn version(env: &LoginEnv, exe: &Path) -> Option<String> {
    let mut child = Command::new(exe)
        .arg("--version")
        .env_clear()
        .envs(&env.vars)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < Duration::from_secs(6) => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
    parse_version(&out)
}

/// First version-looking token of the output ("2.1.3 (Claude Code)" → "2.1.3", "v2.0.25" → "2.0.25").
pub fn parse_version(out: &str) -> Option<String> {
    out.split(|c: char| c.is_whitespace() || c == ',' || c == '(' || c == ')')
        .map(|t| t.trim_start_matches('v'))
        .find(|t| t.chars().next().is_some_and(|c| c.is_ascii_digit()) && t.contains('.'))
        .map(|t| t.chars().take(32).collect())
        .or_else(|| out.lines().next().map(|l| l.trim().chars().take(32).collect()).filter(|s: &String| !s.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(parse_version("2.1.312 (Claude Code)\n").as_deref(), Some("2.1.312"));
        assert_eq!(parse_version("opencode v2.0.25").as_deref(), Some("2.0.25"));
        assert_eq!(parse_version("codex-cli 0.98.0").as_deref(), Some("0.98.0"));
        assert_eq!(parse_version("").as_deref(), None);
    }

    #[test]
    fn ids_unique() {
        let mut ids: Vec<_> = AGENTS.iter().map(|a| a.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), AGENTS.len());
    }
}
