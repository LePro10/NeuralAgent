//! Building connectors: "New connector" (template + a coding agent), "Change with an agent", and
//! "Add existing" (a folder with a connector.json, or an MCP server command).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use na_protocol::{
    ApiError, AttentionKind, ClientInfo, ClientKind, Connector, ConnectorKind, ConnectorManifest, ConnectorTestResult, ErrorCode, Event,
    FieldKind, Id, Request, RunSpec, SetupField, StartSession, TestStep,
};
use serde_json::{Value, json};

use super::recover::{self, copy_dir};
use super::{check, embedded, manifest, store};
use crate::core::{Core, err};

fn client() -> ClientInfo {
    ClientInfo { kind: ClientKind::Desktop, name: "Autopilot".into(), device_id: None }
}

fn unique_id(core: &Core, base: &str) -> String {
    let mut id = base.to_string();
    let mut n = 2;
    while core.connectors.exists(&id) || user_path(core, &id).exists() || !store::valid_id(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

fn user_path(core: &Core, id: &str) -> PathBuf {
    core.paths.root.join("connectors").join(id)
}

/// Adds the folder as a workspace (approved: the user asked for this build) and starts the
/// user's default agent there with `prompt`. Returns the session id.
async fn start_agent(core: &Arc<Core>, dir: &Path, name: &str, prompt: String, profile: Option<Id>) -> Result<Id, ApiError> {
    let ws = core
        .handle(
            &client(),
            Request::WorkspaceAdd {
                path: dir.to_string_lossy().into_owned(),
                name: Some(format!("Connector: {name}")),
                ssh: None,
                unchecked: None,
            },
        )
        .await?;
    let ws_id = ws["id"].as_str().unwrap_or("").to_string();
    core.handle(
        &client(),
        Request::WorkspaceUpdate { id: ws_id.clone(), name: None, approved: Some(true), pinned: None, order: None, path: None },
    )
    .await?;
    let profile = profile.unwrap_or_else(|| core.read(|s| s.settings.default_profile.clone()));
    let v = core
        .handle(
            &client(),
            Request::SessionStart(StartSession {
                workspace_id: ws_id,
                profile_id: profile,
                prompt: Some(prompt),
                pane_id: None,
                cols: None,
                rows: None,
                resume: None,
                cwd: None,
                worktree: None,
            }),
        )
        .await?;
    Ok(v["id"].as_str().unwrap_or("").to_string())
}

pub fn build_prompt(name: &str, description: &str, change: bool) -> String {
    let task = if change {
        format!("Change the existing connector \"{name}\" in this folder as follows:\n\n{description}")
    } else {
        format!(
            "Build a NeuralAgent connector called \"{name}\" in this folder (it starts from the template).\n\nWhat it should do:\n{description}"
        )
    };
    format!(
        "{task}\n\nRead CLAUDE.md in this folder first and follow it: it describes the connector contract (MCP over stdio, \
         NA_CONFIG / NA_SECRET_<KEY> / NA_STATE_DIR, events, poll, check) and the rules. In short:\n\
         - connector.json: a clear name, icon, one-line description, setup fields for everything the user must enter (secrets as type \"secret\"), \
         a beginner-friendly numbered guide with links, every tool with a class (read, write or external), a \"check\" read tool that proves the setup works.\n\
         - index.mjs: no npm dependencies, Node 22+, secrets only from the environment, logs to stderr and never secret values.\n\
         - connector.test.mjs with tests that need no network or credentials; run `node --test` until it passes.\n\
         When you are done, say in two sentences what the user has to enter. NeuralAgent then checks the connector automatically."
    )
}

/// New connector from the template, built by a coding agent.
pub async fn create(core: &Arc<Core>, name: String, description: String, profile: Option<Id>) -> Result<Connector, ApiError> {
    check_profile(core, profile.as_deref())?;
    let name = name.trim().to_string();
    if name.is_empty() || description.trim().is_empty() {
        return Err(err(ErrorCode::BadRequest, "a connector needs a name and a description"));
    }
    let id = unique_id(core, &store::slug(&name));
    let dir = user_path(core, &id);
    embedded::write_template(&dir).map_err(|e| err(ErrorCode::Internal, format!("cannot copy the template: {e:#}")))?;
    // Name and description into the manifest skeleton.
    if let Ok(text) = std::fs::read_to_string(dir.join("connector.json"))
        && let Ok(mut v) = serde_json::from_str::<Value>(&text)
    {
        v["name"] = json!(name);
        v["description"] = json!(description.trim().lines().next().unwrap_or("").chars().take(140).collect::<String>());
        let _ = std::fs::write(dir.join("connector.json"), serde_json::to_vec_pretty(&v).unwrap_or_default());
    }
    core.connectors.rescan(core);
    build(core, &id, &dir, &name, &description, false, profile, false).await
}

fn check_profile(core: &Core, profile: Option<&str>) -> Result<(), ApiError> {
    match profile {
        Some(p) if !core.read(|s| s.profiles.iter().any(|x| x.id == p)) => Err(err(ErrorCode::BadRequest, "that agent is not available")),
        _ => Ok(()),
    }
}

/// Let an agent change a connector the user made.
pub async fn change(core: &Arc<Core>, id: &str, request: String, profile: Option<Id>) -> Result<Connector, ApiError> {
    check_profile(core, profile.as_deref())?;
    let c = core.connectors.get(id).ok_or_else(|| err(ErrorCode::NotFound, "no such connector"))?;
    if c.builtin {
        return Err(err(ErrorCode::BadRequest, "built-in connectors cannot be changed; make a new one instead"));
    }
    if core.connectors.build_session(id).is_some() {
        return Err(err(ErrorCode::BadRequest, "an agent is already working on it"));
    }
    if request.trim().is_empty() {
        return Err(err(ErrorCode::BadRequest, "say what should change"));
    }
    let dir = PathBuf::from(&c.path);
    build(core, id, &dir, &c.manifest.name, request.trim(), true, profile, false).await
}

/// The user's connector (not built in) and its folder.
fn own(core: &Core, id: &str) -> Result<(Connector, PathBuf), ApiError> {
    let c = core.connectors.get(id).ok_or_else(|| err(ErrorCode::NotFound, "no such connector"))?;
    if c.builtin {
        return Err(err(ErrorCode::BadRequest, "built-in connectors cannot be changed"));
    }
    if core.connectors.build_session(id).is_some() {
        return Err(err(ErrorCode::BadRequest, "an agent is working on it; stop it first"));
    }
    let dir = PathBuf::from(&c.path);
    Ok((c, dir))
}

/// "Try again": the last request once more, with the same agent.
pub async fn retry(core: &Arc<Core>, id: &str) -> Result<Connector, ApiError> {
    let (c, dir) = own(core, id)?;
    let (_, request, change, profile) = core.connectors.build_info(id).unwrap_or_default();
    let request = request.ok_or_else(|| err(ErrorCode::BadRequest, "there is no earlier request; describe what you want instead"))?;
    check_profile(core, profile.as_deref())?;
    build(core, id, &dir, &c.manifest.name, &request, change, profile, true).await
}

/// Back to the last working version.
pub fn restore(core: &Arc<Core>, id: &str) -> Result<Connector, ApiError> {
    let (_, dir) = own(core, id)?;
    let root = &core.paths.root;
    recover::restore(&dir, &recover::backup_dir(root, id), &recover::discarded_dir(root, id))
        .map_err(|e| err(ErrorCode::BadRequest, format!("cannot go back: {e}")))?;
    core.audit.note("connector_restore", Some(id.to_string()), true, None);
    refresh(core, id)
}

/// Back to the template; name, description, setup values and secrets stay.
pub fn reset(core: &Arc<Core>, id: &str) -> Result<Connector, ApiError> {
    let (c, dir) = own(core, id)?;
    let root = &core.paths.root;
    recover::reset(&dir, &recover::discarded_dir(root, id), &c.manifest.name, &c.manifest.description)
        .map_err(|e| err(ErrorCode::Internal, format!("cannot reset: {e}")))?;
    core.audit.note("connector_reset", Some(id.to_string()), true, None);
    refresh(core, id)
}

fn refresh(core: &Arc<Core>, id: &str) -> Result<Connector, ApiError> {
    core.connectors.set_build_failed(core, id, None);
    core.connectors.rescan(core);
    core.connectors.restart(core, id);
    core.connectors.get(id).ok_or_else(|| err(ErrorCode::Internal, "the connector disappeared"))
}

/// The folder passed the check: it is the last working version now.
pub fn mark_working(core: &Core, id: &str, dir: &Path) {
    if let Err(e) = recover::snapshot(dir, &recover::backup_dir(&core.paths.root, id)) {
        tracing::warn!(connector = id, "cannot keep the working version: {e}");
    }
}

#[allow(clippy::too_many_arguments)]
async fn build(
    core: &Arc<Core>,
    id: &str,
    dir: &Path,
    name: &str,
    text: &str,
    change: bool,
    profile: Option<Id>,
    resume: bool,
) -> Result<Connector, ApiError> {
    // What is in the folder now is the last working version, unless an earlier build already failed.
    if change && core.connectors.build_info(id).is_some_and(|(failed, ..)| failed.is_none()) {
        mark_working(core, id, dir);
    }
    let prompt_text = if resume {
        format!("{text}\n\n(An earlier attempt stopped before it finished. Look at what is already in the folder and finish it.)")
    } else {
        text.to_string()
    };
    let start = recover::fingerprint(dir);
    let sid = start_agent(core, dir, name, build_prompt(name, &prompt_text, change), profile.clone()).await?;
    core.connectors.set_request(core, id, text, change, profile);
    core.connectors.set_build_failed(core, id, None);
    core.audit.note("connector_build", Some(format!("{name} ({id})")), true, None);
    core.connectors.set_build_session(core, id, Some(sid.clone()));
    let c = core.clone();
    let id2 = id.to_string();
    let dir2 = dir.to_path_buf();
    tokio::spawn(async move { watch_build(c, id2, dir2, sid, start).await });
    core.connectors.get(id).ok_or_else(|| err(ErrorCode::Internal, "the connector disappeared"))
}

/// How a build ended, for the check and the message.
pub struct Verdict {
    pub changed: bool,
    pub result: ConnectorTestResult,
}

impl Verdict {
    pub fn ok(&self) -> bool {
        self.changed && self.result.ok
    }
}

async fn evaluate(core: &Arc<Core>, id: &str, dir: &Path, start: u64) -> Verdict {
    core.connectors.rescan(core);
    let changed = recover::fingerprint(dir) != start;
    let result = if changed {
        check::conformance(core, id, dir).await
    } else {
        ConnectorTestResult { ok: false, steps: vec![TestStep { label: "The agent changed something".into(), ok: false, detail: None }] }
    };
    Verdict { changed, result }
}

/// What the user reads when a build ended without a working result.
pub fn stopped_message(v: &Verdict, has_backup: bool) -> String {
    let mut s = if v.changed {
        String::from("The build stopped before it finished.")
    } else {
        String::from("The agent ended without changing anything.")
    };
    if let Some(st) = v.result.steps.iter().find(|x| !x.ok && x.detail.is_some()) {
        let d = st.detail.as_deref().unwrap_or("");
        s.push_str(&format!(" {}: {}", st.label, crate::neural::observe::clip(d.trim(), 400)));
    }
    s.push_str(if has_backup { " Your last working version is kept." } else { " What was written so far is still in the folder." });
    s
}

/// When the agent finishes a turn: run the check; on failure send it back once. When its session
/// ends, run the check one last time.
async fn watch_build(core: Arc<Core>, id: String, dir: PathBuf, sid: Id, start: u64) {
    let mut rx = core.subscribe(None).rx;
    let mut retried = false;
    loop {
        let ev = match rx.recv().await {
            Ok((_, e)) => e,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => return,
        };
        let (done, ended) = match ev {
            Event::Attention { session_id, kind: AttentionKind::Done, .. } if session_id == sid => (true, false),
            Event::SessionUpsert { session } if session.id == sid && !session.alive => (false, true),
            Event::SessionRemoved { id: gone } if gone == sid => (false, true),
            _ => (false, false),
        };
        if !done && !ended {
            continue;
        }
        let v = evaluate(&core, &id, &dir, start).await;
        if v.ok() {
            mark_working(&core, &id, &dir);
            finish(&core, &id, None).await;
            return;
        }
        if ended || retried {
            finish(&core, &id, Some(stopped_message(&v, recover::has_backup(&core.paths.root, &id)))).await;
            return;
        }
        retried = true;
        let msg = if v.changed {
            check::failure_message(&v.result)
        } else {
            "You have not changed any file in this folder yet. Do the task now, run `node --test` and tell me when it is done.".to_string()
        };
        tracing::info!(connector = id, "connector check failed, sending it back to the agent");
        if core.send_prompt(&sid, &msg).is_err() {
            finish(&core, &id, Some(stopped_message(&v, recover::has_backup(&core.paths.root, &id)))).await;
            return;
        }
    }
}

async fn finish(core: &Arc<Core>, id: &str, failed: Option<String>) {
    core.connectors.set_build_failed(core, id, failed);
    core.connectors.set_build_session(core, id, None);
    core.connectors.rescan(core);
}

// ───────────── import ─────────────

#[derive(Debug, PartialEq)]
pub struct ImportCmd {
    pub env: Vec<(String, String)>,
    pub command: String,
    pub args: Vec<String>,
}

/// Splits a command line (quotes allowed).
pub fn split_command(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for c in s.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                has = true;
            }
            (None, c) if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// `GITHUB_TOKEN= API_URL=https://x npx -y some-server` → env names (with values if given), command, args.
pub fn parse_command(s: &str) -> Result<ImportCmd, String> {
    let mut toks = split_command(s).into_iter().peekable();
    let mut env = vec![];
    while let Some(t) = toks.peek() {
        let Some((k, v)) = t.split_once('=') else { break };
        if k.is_empty() || !k.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') {
            break;
        }
        env.push((k.to_string(), v.to_string()));
        toks.next();
    }
    let command = toks.next().ok_or("there is no command to run")?;
    Ok(ImportCmd { env, command, args: toks.collect() })
}

fn secret_name(n: &str) -> bool {
    let n = n.to_uppercase();
    ["TOKEN", "KEY", "SECRET", "PASSWORD", "PASS", "AUTH", "CREDENTIAL"].iter().any(|w| n.contains(w))
}

/// A manifest for a plain MCP server: the form comes from the variables the user named; tools
/// are external until classified.
pub fn mcp_manifest(name: &str, cmd: &ImportCmd) -> ConnectorManifest {
    ConnectorManifest {
        name: name.into(),
        icon: "plug".into(),
        description: "An MCP server you added.".into(),
        kind: ConnectorKind::Mcp,
        version: "1".into(),
        setup: cmd
            .env
            .iter()
            .map(|(k, _)| SetupField {
                key: k.clone(),
                label: k.clone(),
                kind: if secret_name(k) { FieldKind::Secret } else { FieldKind::Text },
                help: Some("Passed to the server as an environment variable.".into()),
                link: None,
                placeholder: None,
                required: true,
                from: None,
                options: vec![],
                default: None,
            })
            .collect(),
        guide: vec![
            "Fill in the values the server needs, then press **Test connection**.".into(),
            "Tools you do not classify count as **Speaks for you**, so the autopilot asks before using them.".into(),
        ],
        run: Some(RunSpec { command: cmd.command.clone(), args: cmd.args.clone() }),
        ..Default::default()
    }
}

pub async fn import(core: &Arc<Core>, path: String) -> Result<Connector, ApiError> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(err(ErrorCode::BadRequest, "give a folder or a command"));
    }
    let as_path = crate::fsbrowse::expand(&core.env.home, Path::new(&path));
    let folder = if as_path.is_dir() {
        Some(as_path.clone())
    } else if as_path.file_name().is_some_and(|n| n == "connector.json") && as_path.is_file() {
        as_path.parent().map(Path::to_path_buf)
    } else {
        None
    };
    let id;
    if let Some(folder) = folder {
        let text = std::fs::read_to_string(folder.join("connector.json"))
            .map_err(|_| err(ErrorCode::BadRequest, "that folder has no connector.json; it is not a connector"))?;
        let m = manifest::parse(&text).map_err(|e| err(ErrorCode::BadRequest, format!("{e:#}")))?;
        id = unique_id(core, &store::slug(folder.file_name().and_then(|n| n.to_str()).unwrap_or(&m.name)));
        let dest = user_path(core, &id);
        tokio::task::spawn_blocking({
            let (f, d) = (folder.clone(), dest);
            move || copy_dir(&f, &d)
        })
        .await
        .map_err(|e| err(ErrorCode::Internal, e.to_string()))?
        .map_err(|e| err(ErrorCode::Internal, format!("cannot copy the folder: {e}")))?;
        core.audit.note("connector_import", Some(folder.to_string_lossy().into_owned()), true, None);
    } else {
        let cmd = parse_command(&path).map_err(|e| err(ErrorCode::BadRequest, e))?;
        let base = cmd.args.iter().rev().find(|a| !a.starts_with('-')).cloned().unwrap_or_else(|| cmd.command.clone());
        let name = base.rsplit('/').next().unwrap_or(&base).trim_start_matches("server-").to_string();
        let id0 = unique_id(core, &store::slug(&name));
        let m = mcp_manifest(&name, &cmd);
        let dir = user_path(core, &id0);
        std::fs::create_dir_all(&dir).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
        std::fs::write(dir.join("connector.json"), serde_json::to_vec_pretty(&m).unwrap_or_default())
            .map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
        core.audit.note("connector_import", Some(format!("{} {}", cmd.command, cmd.args.join(" "))), true, None);
        id = id0;
        core.connectors.rescan(core);
        // Values given inline are stored like any setup value.
        let mut config = std::collections::BTreeMap::new();
        let mut secrets = std::collections::BTreeMap::new();
        for (k, v) in cmd.env.iter().filter(|(_, v)| !v.is_empty()) {
            if secret_name(k) {
                secrets.insert(k.clone(), v.clone());
            } else {
                config.insert(k.clone(), json!(v));
            }
        }
        return core.connectors.configure(core, &id, config, secrets);
    }
    core.connectors.rescan(core);
    core.connectors.get(&id).ok_or_else(|| err(ErrorCode::Internal, "the connector disappeared"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_quoted_commands() {
        assert_eq!(split_command(r#"npx -y "my server" 'a b' c"#), vec!["npx", "-y", "my server", "a b", "c"]);
        assert_eq!(split_command("  "), Vec::<String>::new());
    }

    #[test]
    fn parses_env_and_command() {
        let c = parse_command("GITHUB_TOKEN= API_URL=https://x.dev npx -y @modelcontextprotocol/server-github").unwrap();
        assert_eq!(c.env, vec![("GITHUB_TOKEN".to_string(), String::new()), ("API_URL".to_string(), "https://x.dev".to_string())]);
        assert_eq!(c.command, "npx");
        assert_eq!(c.args, vec!["-y", "@modelcontextprotocol/server-github"]);
        assert!(parse_command("A=").is_err());
        // lower case before the command is part of the command, not an env var
        assert_eq!(parse_command("node a=b").unwrap().env.len(), 0);
    }

    #[test]
    fn draws_the_form_from_env_names() {
        let c = parse_command("GITHUB_TOKEN= REGION=eu npx server").unwrap();
        let m = mcp_manifest("server", &c);
        assert_eq!(m.kind, ConnectorKind::Mcp);
        assert_eq!(m.setup[0].kind, FieldKind::Secret);
        assert_eq!(m.setup[1].kind, FieldKind::Text);
        assert!(manifest::validate(&m).is_empty());
        // tools unclassified = external
        assert_eq!(manifest::class_of(&m, "anything"), na_protocol::ToolClass::External);
    }

    #[test]
    fn says_why_a_build_stopped() {
        let step = |ok, d: Option<&str>| TestStep { label: "Code is complete".into(), ok, detail: d.map(String::from) };
        let broken = Verdict {
            changed: true,
            result: ConnectorTestResult {
                ok: false,
                steps: vec![step(false, Some("index.mjs is incomplete or has a syntax error at line 12."))],
            },
        };
        let m = stopped_message(&broken, true);
        assert!(m.starts_with("The build stopped before it finished."));
        assert!(m.contains("at line 12") && m.ends_with("Your last working version is kept."));
        assert!(stopped_message(&broken, false).ends_with("still in the folder."));
        let idle = Verdict { changed: false, result: ConnectorTestResult { ok: true, steps: vec![] } };
        assert!(!idle.ok());
        assert!(stopped_message(&idle, true).starts_with("The agent ended without changing anything."));
    }

    #[test]
    fn prompts_name_the_rules() {
        let p = build_prompt("Demo", "Reads X", false);
        assert!(p.contains("CLAUDE.md") && p.contains("class") && p.contains("node --test") && p.contains("Reads X"));
    }
}
