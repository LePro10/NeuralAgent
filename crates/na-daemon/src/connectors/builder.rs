//! Building connectors: "New connector" (template + a coding agent), "Change with an agent", and
//! "Add existing" (a folder with a connector.json, or an MCP server command).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use na_protocol::{
    ApiError, AttentionKind, ClientInfo, ClientKind, Connector, ConnectorKind, ConnectorManifest, ErrorCode, Event, FieldKind, Id, Request,
    RunSpec, SetupField, StartSession,
};
use serde_json::{Value, json};

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
async fn start_agent(core: &Arc<Core>, dir: &Path, name: &str, prompt: String) -> Result<Id, ApiError> {
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
    let profile = core.read(|s| s.settings.default_profile.clone());
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
pub async fn create(core: &Arc<Core>, name: String, description: String) -> Result<Connector, ApiError> {
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
    build(core, &id, &dir, &name, &description, false).await
}

/// Let an agent change a connector the user made.
pub async fn change(core: &Arc<Core>, id: &str, request: String) -> Result<Connector, ApiError> {
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
    build(core, id, &dir, &c.manifest.name, &request, true).await
}

async fn build(core: &Arc<Core>, id: &str, dir: &Path, name: &str, text: &str, change: bool) -> Result<Connector, ApiError> {
    core.connectors.set_build_failed(core, id, None);
    let sid = start_agent(core, dir, name, build_prompt(name, text, change)).await?;
    core.audit.note("connector_build", Some(format!("{name} ({id})")), true, None);
    core.connectors.set_build_session(core, id, Some(sid.clone()));
    let c = core.clone();
    let id2 = id.to_string();
    let dir2 = dir.to_path_buf();
    tokio::spawn(async move { watch_build(c, id2, dir2, sid).await });
    core.connectors.get(id).ok_or_else(|| err(ErrorCode::Internal, "the connector disappeared"))
}

/// When the agent finishes a turn: run the check; on failure send it back once.
async fn watch_build(core: Arc<Core>, id: String, dir: PathBuf, sid: Id) {
    let mut rx = core.subscribe(None).rx;
    let mut retried = false;
    loop {
        let ev = match rx.recv().await {
            Ok((_, e)) => e,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => return,
        };
        let done = match ev {
            Event::Attention { session_id, kind: AttentionKind::Done, .. } if session_id == sid => true,
            Event::SessionUpsert { session } if session.id == sid && !session.alive => {
                finish(&core, &id, Some("The agent stopped before the connector was ready.".into())).await;
                return;
            }
            Event::SessionRemoved { id: gone } if gone == sid => {
                finish(&core, &id, None).await;
                return;
            }
            _ => false,
        };
        if !done {
            continue;
        }
        core.connectors.rescan(&core);
        let r = check::conformance(&core, &id, &dir).await;
        if r.ok {
            finish(&core, &id, None).await;
            return;
        }
        if retried {
            finish(&core, &id, Some(check::failure_message(&r))).await;
            return;
        }
        retried = true;
        let msg = check::failure_message(&r);
        tracing::info!(connector = id, "connector check failed, sending it back to the agent");
        if core.send_prompt(&sid, &msg).is_err() {
            finish(&core, &id, Some(msg)).await;
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

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let name = e.file_name();
        let n = name.to_string_lossy();
        if n == "node_modules" || n == ".git" {
            continue;
        }
        let t = e.file_type()?;
        if t.is_dir() {
            copy_dir(&e.path(), &to.join(&name))?;
        } else if t.is_file() {
            std::fs::copy(e.path(), to.join(&name))?;
        }
    }
    Ok(())
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
    fn prompts_name_the_rules() {
        let p = build_prompt("Demo", "Reads X", false);
        assert!(p.contains("CLAUDE.md") && p.contains("class") && p.contains("node --test") && p.contains("Reads X"));
    }
}
