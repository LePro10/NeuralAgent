//! Claude view: the slash commands of Claude Code (table for CLI 2.1.316) plus the user's,
//! the project's and the plugins' commands and skills.

use std::path::Path;

use na_protocol::CvCommand;
use serde_json::Value;

/// One built-in command: name, group, kind, argument hint, argument values, aliases, native
/// screen in the app (`""`: none), useful on a phone, description.
type Row = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
    &'static str,
    bool,
    &'static str,
);

/// Claude Code 2.1.316. Kinds: `native` (the app has its own screen), `args` (runs with what is
/// typed after it), `dialog` (opens a menu or panel in the CLI), `prompt` (sends a prompt to the
/// model, e.g. bundled skills), `output` (prints text).
const BUILTIN: &[Row] = &[
    // conversation
    ("clear", "conversation", "args", "[name]", &[], &["reset", "new"], "", true, "Start a new conversation (optionally named)"),
    ("compact", "conversation", "args", "[instructions]", &[], &[], "", true, "Summarize the conversation to free context"),
    (
        "rewind",
        "conversation",
        "native",
        "",
        &[],
        &["checkpoint"],
        "rewind",
        true,
        "Go back to an earlier point (conversation and/or code)",
    ),
    ("branch", "conversation", "args", "[name]", &[], &[], "", true, "Branch the conversation from here"),
    ("fork", "conversation", "args", "[prompt]", &[], &[], "", true, "Fork the conversation into a new session"),
    ("resume", "conversation", "native", "[session]", &[], &["continue"], "resume", true, "Resume an earlier conversation"),
    ("rename", "conversation", "args", "<name>", &[], &[], "", true, "Rename the conversation"),
    ("export", "conversation", "args", "[file]", &[], &[], "", true, "Export the conversation to a file or the clipboard"),
    ("copy", "conversation", "args", "[N]", &[], &[], "", true, "Copy the last (or Nth last) answer"),
    ("recap", "conversation", "prompt", "", &[], &[], "", true, "Recap what happened so far"),
    ("btw", "conversation", "args", "<question>", &[], &[], "", true, "Ask a side question without adding it to the conversation"),
    ("exit", "conversation", "args", "", &[], &["quit"], "", false, "Exit Claude Code"),
    // model and modes
    ("model", "model", "native", "[model]", &["default", "opus", "sonnet", "haiku", "opusplan"], &[], "model", true, "Choose the model"),
    (
        "effort",
        "model",
        "native",
        "[level]",
        &["auto", "low", "medium", "high", "xhigh", "max"],
        &[],
        "effort",
        true,
        "Set how hard Claude thinks",
    ),
    ("fast", "model", "native", "[on|off]", &["on", "off"], &[], "fast", true, "Toggle fast mode"),
    ("plan", "model", "native", "[description]", &[], &[], "mode", true, "Enter plan mode (optionally with a task)"),
    ("advisor", "model", "args", "[model|off]", &["opus", "sonnet", "off"], &[], "", true, "Let a second model review the work"),
    ("output-style", "model", "args", "[style]", &["default", "explanatory", "learning"], &[], "", true, "Choose the output style"),
    ("focus", "model", "args", "", &[], &[], "", true, "Toggle focus mode"),
    ("brief", "model", "args", "", &[], &[], "", true, "Toggle brief answers"),
    ("goal", "model", "args", "[condition|clear]", &["clear"], &[], "", true, "Set a goal Claude works towards until it is met"),
    ("autocompact", "model", "args", "[auto|tokens]", &["auto"], &[], "", true, "When to compact automatically"),
    // context and cost
    ("context", "context", "native", "[all]", &["all"], &[], "context", true, "Show context usage"),
    ("usage", "context", "native", "", &[], &["cost", "stats"], "usage", true, "Show plan usage, cost and statistics"),
    ("status", "context", "dialog", "", &[], &[], "", true, "Show version, account and connection status"),
    ("insights", "context", "prompt", "", &[], &[], "", true, "Insights about how you use Claude Code"),
    // agents and tasks
    ("tasks", "agents", "native", "", &[], &["bashes"], "tasks", true, "Show background tasks and agents"),
    ("subtask", "agents", "args", "<task>", &[], &[], "", true, "Hand a task to a subagent"),
    ("background", "agents", "args", "[prompt]", &[], &["bg"], "", true, "Run a prompt in the background"),
    ("stop", "agents", "args", "", &[], &[], "", true, "Stop running background agents"),
    ("list-agents", "agents", "output", "", &[], &[], "", true, "List running agents"),
    ("workflows", "agents", "dialog", "", &[], &[], "", true, "Show workflows"),
    ("loop", "agents", "prompt", "[interval] <prompt>", &[], &[], "", true, "Run a prompt on an interval"),
    ("loops", "agents", "dialog", "", &[], &[], "", true, "Manage running loops"),
    ("schedule", "agents", "args", "<when> <prompt>", &[], &[], "", true, "Schedule a prompt"),
    ("batch", "agents", "prompt", "<task>", &[], &[], "", true, "Run a task over many items in parallel"),
    // code and review
    ("diff", "code", "native", "", &[], &[], "changes", true, "View uncommitted changes"),
    (
        "code-review",
        "code",
        "prompt",
        "[low|medium|high|xhigh|max] [target]",
        &["low", "medium", "high", "xhigh", "max"],
        &["review"],
        "",
        true,
        "Review the current changes or a pull request",
    ),
    ("security-review", "code", "prompt", "", &[], &[], "", true, "Review pending changes for security issues"),
    ("simplify", "code", "prompt", "", &[], &[], "", true, "Simplify the changed code"),
    ("verify", "code", "prompt", "", &[], &[], "", true, "Verify that the change works"),
    ("run", "code", "prompt", "", &[], &[], "", true, "Run the app to see a change working"),
    ("ultrareview", "code", "prompt", "[target]", &[], &[], "", true, "Deep multi-agent review"),
    ("autofix-pr", "code", "args", "[pr]", &[], &[], "", true, "Fix review comments and CI on a pull request"),
    ("debug", "code", "prompt", "[problem]", &[], &[], "", true, "Debug a problem step by step"),
    // project setup
    ("init", "project", "prompt", "", &[], &[], "", true, "Create a CLAUDE.md for this project"),
    ("memory", "project", "dialog", "", &[], &[], "", true, "Edit memory files"),
    ("add-dir", "project", "native", "<path>", &[], &[], "folder", true, "Add a working directory"),
    ("cd", "project", "native", "<path>", &[], &[], "folder", true, "Change the working directory"),
    ("permissions", "project", "dialog", "", &[], &["allowed-tools"], "", true, "Manage tool permissions"),
    ("hooks", "project", "dialog", "", &[], &[], "", true, "Manage hooks"),
    ("sandbox", "project", "dialog", "", &[], &[], "", true, "Sandbox settings"),
    ("doctor", "project", "prompt", "", &[], &[], "", true, "Check the installation"),
    ("fewer-permission-prompts", "project", "prompt", "", &[], &[], "", true, "Allow common read-only commands"),
    ("update-config", "project", "prompt", "<change>", &[], &[], "", true, "Change Claude Code settings"),
    ("run-skill-generator", "project", "prompt", "", &[], &[], "", true, "Generate a skill from this session"),
    ("keybindings", "project", "dialog", "", &[], &[], "", false, "Customize key bindings"),
    ("statusline", "project", "prompt", "[description]", &[], &[], "", false, "Set up the status line"),
    ("terminal-setup", "project", "dialog", "", &[], &[], "", false, "Set up terminal key bindings"),
    // extensions
    ("skills", "extensions", "dialog", "", &[], &[], "", true, "List skills"),
    ("reload-skills", "extensions", "args", "", &[], &[], "", true, "Reload skills from disk"),
    ("plugin", "extensions", "dialog", "[subcommand]", &["install", "list", "marketplace"], &["plugins"], "", true, "Manage plugins"),
    ("reload-plugins", "extensions", "args", "", &[], &[], "", true, "Reload plugins"),
    (
        "mcp",
        "extensions",
        "native",
        "[reconnect|enable|disable] [server]",
        &["reconnect", "enable", "disable"],
        &[],
        "mcp",
        true,
        "Manage MCP servers",
    ),
    ("ide", "extensions", "dialog", "", &[], &[], "", false, "Connect to an IDE"),
    ("chrome", "extensions", "dialog", "", &[], &[], "", false, "Connect to Chrome"),
    ("claude-api", "extensions", "prompt", "", &[], &[], "", true, "Help with the Claude API"),
    ("artifacts", "extensions", "dialog", "", &[], &[], "", true, "Your published artifacts"),
    // account and app
    ("login", "account", "dialog", "", &[], &[], "", true, "Sign in"),
    ("logout", "account", "args", "", &[], &[], "", true, "Sign out"),
    ("config", "account", "dialog", "", &[], &["settings"], "", true, "Open settings"),
    ("theme", "account", "dialog", "", &[], &[], "", false, "Change the theme"),
    ("color", "account", "args", "[color]", &[], &[], "", false, "Set the prompt bar color"),
    ("tui", "account", "args", "", &[], &[], "", false, "Switch the terminal UI"),
    ("voice", "account", "args", "", &[], &[], "", false, "Voice input"),
    ("release-notes", "account", "output", "", &[], &[], "", true, "Show release notes"),
    ("version", "account", "output", "", &[], &[], "", true, "Show the version"),
    ("restart", "account", "args", "", &[], &[], "", true, "Restart Claude Code"),
    ("upgrade", "account", "dialog", "", &[], &[], "", true, "Upgrade the plan"),
    ("usage-credits", "account", "dialog", "", &[], &[], "", true, "Usage credits"),
    ("rate-limit-options", "account", "dialog", "", &[], &[], "", true, "What to do when a limit is hit"),
    ("privacy-settings", "account", "dialog", "", &[], &[], "", true, "Privacy settings"),
    ("feedback", "account", "args", "[report]", &[], &["bug"], "", true, "Send feedback"),
    ("mobile", "account", "dialog", "", &[], &["ios", "android"], "", false, "Get the mobile app"),
    ("desktop", "account", "args", "", &[], &[], "", false, "Continue in the desktop app"),
    ("remote-control", "account", "args", "", &[], &["rc"], "", true, "Continue this session from another device"),
    ("teleport", "account", "args", "[session]", &[], &[], "", true, "Pull a web session into this terminal"),
    ("remote-env", "account", "dialog", "", &[], &[], "", true, "Remote environment settings"),
    ("web-setup", "account", "dialog", "", &[], &[], "", false, "Set up Claude Code on the web"),
    ("install-github-app", "account", "dialog", "", &[], &[], "", false, "Set up the Claude GitHub app"),
    ("install-slack-app", "account", "dialog", "", &[], &[], "", false, "Set up the Claude Slack app"),
    ("setup-bedrock", "account", "dialog", "", &[], &[], "", false, "Set up Amazon Bedrock"),
    ("setup-vertex", "account", "dialog", "", &[], &[], "", false, "Set up Google Vertex AI"),
    ("powerup", "account", "dialog", "", &[], &[], "", false, "Learn features step by step"),
    ("stickers", "account", "args", "", &[], &[], "", false, "Order stickers"),
    ("radio", "account", "args", "", &[], &[], "", false, "Play music while Claude works"),
    ("passes", "account", "dialog", "", &[], &[], "", false, "Share guest passes"),
    ("heapdump", "account", "args", "", &[], &[], "", false, "Write a heap dump"),
];

pub fn builtin() -> Vec<CvCommand> {
    BUILTIN
        .iter()
        .map(|(name, group, kind, args, values, aliases, native, phone, description)| CvCommand {
            name: (*name).into(),
            description: (*description).into(),
            source: "builtin".into(),
            group: Some((*group).into()),
            kind: Some((*kind).into()),
            args: Some((*args).into()).filter(|a: &String| !a.is_empty()),
            values: values.iter().map(|v| (*v).into()).collect(),
            aliases: aliases.iter().map(|v| (*v).into()).collect(),
            native: Some((*native).into()).filter(|a: &String| !a.is_empty()),
            phone: (!phone).then_some(false),
        })
        .collect()
}

/// `description:` and `argument-hint:` from the front matter (else the first text line).
pub fn front_matter(text: &str) -> (String, Option<String>) {
    let unq = |s: &str| s.trim().trim_matches(['"', '\'']).to_string();
    let mut desc = None;
    let mut hint = None;
    let mut lines = text.lines();
    if lines.next().map(str::trim) == Some("---") {
        for l in lines.by_ref() {
            if l.trim() == "---" {
                break;
            }
            if let Some(d) = l.strip_prefix("description:") {
                desc = Some(unq(d));
            } else if let Some(h) = l.strip_prefix("argument-hint:") {
                hint = Some(unq(h)).filter(|h| !h.is_empty());
            }
        }
    }
    let desc = desc.unwrap_or_else(|| {
        text.lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && *l != "---" && !l.starts_with('#') && !l.contains(": "))
            .unwrap_or("")
            .chars()
            .take(120)
            .collect()
    });
    (desc, hint)
}

fn custom(name: String, text: &str, source: &str, group: &str) -> CvCommand {
    let (description, args) = front_matter(text);
    CvCommand {
        name,
        description,
        source: source.into(),
        group: Some(group.into()),
        kind: Some("prompt".into()),
        args,
        ..Default::default()
    }
}

/// The start of a small text file: regular files only (not a FIFO or `/dev/zero` behind a link),
/// at most `max` bytes.
pub fn read_small(path: &Path, max: u64) -> Option<String> {
    use std::io::Read;
    if !std::fs::metadata(path).ok()?.is_file() {
        return None;
    }
    let mut buf = vec![];
    std::fs::File::open(path).ok()?.take(max).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Front matter and description are at the top: more is never needed.
const MD_MAX: u64 = 64 << 10;

/// `commands/**.md` (subfolders become `a:b`).
pub fn collect_commands(dir: &Path, prefix: &str, source: &str, out: &mut Vec<CvCommand>, depth: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten().take(500) {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() && depth < 3 {
            collect_commands(&p, &format!("{prefix}{name}:"), source, out, depth + 1);
        } else if let Some(stem) = name.strip_suffix(".md") {
            let Some(text) = read_small(&p, MD_MAX) else { continue };
            let group = if source == "plugin" { "plugins" } else { "custom" };
            out.push(custom(format!("{prefix}{stem}"), &text, source, group));
        }
    }
}

/// `skills/<name>/SKILL.md`.
pub fn collect_skills(dir: &Path, prefix: &str, source: &str, out: &mut Vec<CvCommand>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten().take(500) {
        let md = e.path().join("SKILL.md");
        if let Some(text) = read_small(&md, MD_MAX) {
            let name = e.file_name().to_string_lossy().into_owned();
            let group = if source == "plugin" { "plugins" } else { "skills" };
            out.push(custom(format!("{prefix}{name}"), &text, source, group));
        }
    }
}

/// Commands and skills of installed, enabled plugins (`plugins/installed_plugins.json`), as `plugin:name`.
pub fn collect_plugins(claude: &Path, out: &mut Vec<CvCommand>) {
    let Some(text) = read_small(&claude.join("plugins/installed_plugins.json"), 4 << 20) else { return };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return };
    let enabled: Value = read_small(&claude.join("settings.json"), 4 << 20)
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|s| s["enabledPlugins"].clone())
        .unwrap_or(Value::Null);
    let Some(plugins) = v["plugins"].as_object().or(v.as_object()) else { return };
    for (key, installs) in plugins.iter().take(100) {
        if enabled.get(key).and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let name = key.split('@').next().unwrap_or(key);
        let list: Vec<&Value> = match installs {
            Value::Array(a) => a.iter().collect(),
            o => vec![o],
        };
        let Some(root) = list.iter().find_map(|i| i["installPath"].as_str()) else { continue };
        let root = Path::new(root);
        collect_commands(&root.join("commands"), &format!("{name}:"), "plugin", out, 1);
        collect_skills(&root.join("skills"), &format!("{name}:"), "plugin", out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_reads_skip_fifos_and_stop_at_the_limit() {
        let dir = std::env::temp_dir().join(format!("na-cv-small-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "x".repeat(100)).unwrap();
        assert_eq!(read_small(&dir.join("a.md"), 10).as_deref(), Some("xxxxxxxxxx"));
        let fifo = dir.join("pipe.md");
        let _ = std::fs::remove_file(&fifo);
        if std::process::Command::new("mkfifo").arg(&fifo).status().is_ok_and(|s| s.success()) {
            assert_eq!(read_small(&fifo, 10), None, "a FIFO would block");
        }
        assert_eq!(read_small(&dir, 10), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn table_is_sane() {
        let b = builtin();
        let names: std::collections::HashSet<&str> = b.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names.len(), b.len(), "duplicate names");
        for gone in ["todos", "vim", "pr-comments"] {
            assert!(!names.contains(gone), "{gone} was removed from the CLI");
        }
        let usage = b.iter().find(|c| c.name == "usage").unwrap();
        assert_eq!(usage.aliases, vec!["cost", "stats"]);
        assert_eq!(usage.native.as_deref(), Some("usage"));
        assert_eq!(b.iter().find(|c| c.name == "theme").unwrap().phone, Some(false));
        assert_eq!(b.iter().find(|c| c.name == "clear").unwrap().phone, None);
        let aliases: Vec<&str> = b.iter().flat_map(|c| c.aliases.iter().map(String::as_str)).collect();
        assert!(aliases.iter().all(|a| !names.contains(a)), "an alias is also a command name");
    }

    #[test]
    fn front_matter_and_plugins() {
        let (d, h) = front_matter("---\ndescription: \"Fix an issue\"\nargument-hint: [issue] [priority]\n---\nBody");
        assert_eq!((d.as_str(), h.as_deref()), ("Fix an issue", Some("[issue] [priority]")));
        let (d, h) = front_matter("# Title\nDo the thing\n");
        assert_eq!((d.as_str(), h), ("Do the thing", None));
        let dir = std::env::temp_dir().join(format!("na-cvcmd-{}", std::process::id()));
        let root = dir.join("cache/acme/1.0");
        std::fs::create_dir_all(root.join("commands")).unwrap();
        std::fs::create_dir_all(root.join("skills/lint")).unwrap();
        std::fs::create_dir_all(dir.join("plugins")).unwrap();
        std::fs::write(root.join("commands/ship.md"), "---\ndescription: Ship it\n---\n").unwrap();
        std::fs::write(root.join("skills/lint/SKILL.md"), "---\ndescription: Lint\n---\n").unwrap();
        let manifest = serde_json::json!({ "version": 2, "plugins": { "acme@market": [{ "scope": "user", "installPath": root }] } });
        std::fs::write(dir.join("plugins/installed_plugins.json"), manifest.to_string()).unwrap();
        let mut out = vec![];
        collect_plugins(&dir, &mut out);
        let mut names: Vec<&str> = out.iter().map(|c| c.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["acme:lint", "acme:ship"]);
        assert!(out.iter().all(|c| c.source == "plugin" && c.group.as_deref() == Some("plugins")));
        std::fs::write(dir.join("settings.json"), r#"{"enabledPlugins":{"acme@market":false}}"#).unwrap();
        let mut out = vec![];
        collect_plugins(&dir, &mut out);
        assert!(out.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
