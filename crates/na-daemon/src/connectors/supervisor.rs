//! Starting connector processes and keeping them alive: restart with backoff (1 s up to 5 min),
//! an Error state after 5 failures within 10 minutes.

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use na_protocol::{ConnectorManifest, ConnectorStatus, ConnectorTool, FieldKind};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::log::Log;
use super::manifest;
use super::mcp_client::McpClient;
use crate::core::Core;

pub const FAILURES: usize = 5;
pub const FAILURE_WINDOW: Duration = Duration::from_secs(600);
pub const MAX_BACKOFF: Duration = Duration::from_secs(300);

/// Everything needed to start one connector process.
#[derive(Clone)]
pub struct LaunchSpec {
    #[allow(dead_code)]
    pub id: String,
    pub dir: PathBuf,
    pub state_dir: PathBuf,
    pub manifest: ConnectorManifest,
    pub config: BTreeMap<String, Value>,
    pub secrets: BTreeMap<String, String>,
}

pub struct Launched {
    pub client: Arc<McpClient>,
    pub child: Child,
    pub events: mpsc::UnboundedReceiver<Value>,
}

/// What a connector process may see of the user's environment: no tokens, only what Node and
/// networking need.
const PASS: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SHELL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
];

pub fn base_env(base: &BTreeMap<String, String>) -> Vec<(String, String)> {
    base.iter().filter(|(k, _)| PASS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// The environment of a connector process (public for tests).
pub fn environment(base: &BTreeMap<String, String>, spec: &LaunchSpec) -> Vec<(String, String)> {
    let mut env = base_env(base);
    // Non-secret values; fields with a default count even if the user never touched them.
    let mut cfg = spec.config.clone();
    for f in &spec.manifest.setup {
        if f.kind != FieldKind::Secret
            && !cfg.contains_key(&f.key)
            && let Some(d) = &f.default
        {
            cfg.insert(f.key.clone(), d.clone());
        }
    }
    env.push(("NA_CONFIG".into(), json!(cfg).to_string()));
    env.push(("NA_STATE_DIR".into(), spec.state_dir.to_string_lossy().into_owned()));
    for (k, v) in &spec.secrets {
        env.push((manifest::secret_var(k), v.clone()));
    }
    // A plain MCP server wants its variables under their own names.
    if spec.manifest.kind == na_protocol::ConnectorKind::Mcp {
        for f in &spec.manifest.setup {
            let v = match f.kind {
                FieldKind::Secret => spec.secrets.get(&f.key).cloned(),
                _ => cfg.get(&f.key).map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())),
            };
            if let Some(v) = v.filter(|v| !v.is_empty()) {
                env.push((f.key.clone(), v));
            }
        }
    }
    env
}

pub fn command_of(m: &ConnectorManifest) -> (String, Vec<String>) {
    match &m.run {
        Some(r) => (r.command.clone(), r.args.clone()),
        None => ("node".into(), vec!["index.mjs".into()]),
    }
}

/// Starts the process and the client on its pipes. The log gets stderr.
pub fn launch(core: &Core, spec: &LaunchSpec, log: &Arc<Log>) -> Result<Launched, String> {
    let (cmd, args) = command_of(&spec.manifest);
    let _ = std::fs::create_dir_all(&spec.state_dir);
    log.set_secrets(spec.secrets.values().cloned().collect());
    let mut c = Command::new(&cmd);
    c.args(&args).current_dir(&spec.dir).env_clear();
    for (k, v) in environment(&core.env.vars, spec) {
        c.env(k, v);
    }
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = c.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("cannot start \"{cmd}\": not found (connectors need Node.js 22 or newer)"),
        _ => format!("cannot start \"{cmd}\": {e}"),
    })?;
    let (stdin, stdout, stderr) =
        (child.stdin.take().ok_or("no stdin")?, child.stdout.take().ok_or("no stdout")?, child.stderr.take().ok_or("no stderr")?);
    let l = log.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            l.push(&line);
        }
    });
    let (etx, events) = mpsc::unbounded_channel();
    let client = McpClient::start(stdout, stdin, etx);
    Ok(Launched { client, child, events })
}

/// Tools the server reported, with the class from the manifest.
pub fn tools_with_classes(m: &ConnectorManifest, found: &[super::mcp_client::ToolInfo]) -> Vec<ConnectorTool> {
    found
        .iter()
        .map(|t| ConnectorTool { name: t.name.clone(), description: t.description.clone(), class: manifest::class_of(m, &t.name) })
        .collect()
}

enum End {
    Cancelled,
    /// Ended after running this long.
    Ended(Duration, String),
    StartFailed(String),
}

/// The supervision loop of one connector, until `cancel`.
pub async fn supervise(core: Arc<Core>, id: String, cancel: CancellationToken) {
    let mut fails: VecDeque<Instant> = VecDeque::new();
    let mut backoff = Duration::from_secs(1);
    loop {
        if cancel.is_cancelled() {
            return;
        }
        core.connectors.set_rt(&core, &id, |rt| {
            rt.status = ConnectorStatus::Starting;
            rt.error = None;
        });
        let end = run_once(&core, &id, &cancel).await;
        let reason = match end {
            End::Cancelled => return,
            End::Ended(ran, why) => {
                if ran > Duration::from_secs(60) {
                    fails.clear();
                    backoff = Duration::from_secs(1);
                }
                why
            }
            End::StartFailed(why) => why,
        };
        let now = Instant::now();
        fails.push_back(now);
        while fails.front().is_some_and(|t| now.duration_since(*t) > FAILURE_WINDOW) {
            fails.pop_front();
        }
        let last = core.connectors.log(&id).and_then(|l| l.last());
        if fails.len() >= FAILURES {
            let why = last.unwrap_or(reason);
            tracing::warn!(connector = id, "connector keeps failing: {why}");
            core.connectors.set_rt(&core, &id, |rt| {
                rt.status = ConnectorStatus::Error;
                rt.error = Some(why);
                rt.client = None;
                rt.tools.clear();
            });
            return;
        }
        let why = last.unwrap_or(reason);
        core.connectors.set_rt(&core, &id, |rt| {
            rt.status = ConnectorStatus::Starting;
            rt.error = Some(format!("{why} (restarting)"));
            rt.client = None;
        });
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = tokio::time::sleep(backoff) => {}
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

async fn run_once(core: &Arc<Core>, id: &str, cancel: &CancellationToken) -> End {
    let Some((spec, log)) = core.connectors.spec(&core.paths.root, id) else { return End::Cancelled };
    let mut l = match launch(core, &spec, &log) {
        Ok(l) => l,
        Err(e) => return End::StartFailed(e),
    };
    let started = Instant::now();
    let setup = async {
        l.client.initialize().await?;
        l.client.list_tools().await
    };
    let tools = tokio::select! {
        _ = cancel.cancelled() => { let _ = l.child.start_kill(); return End::Cancelled }
        r = setup => match r {
            Ok(t) => t,
            Err(e) => {
                let _ = l.child.start_kill();
                return End::StartFailed(format!("did not start: {e}"));
            }
        }
    };
    let classes = tools_with_classes(&spec.manifest, &tools);
    let schemas: BTreeMap<String, Value> = tools.iter().map(|t| (t.name.clone(), t.schema.clone())).collect();
    {
        let client = l.client.clone();
        core.connectors.set_rt(core, id, |rt| {
            rt.status = ConnectorStatus::Running;
            rt.error = None;
            rt.tools = classes;
            rt.schemas = schemas;
            rt.client = Some(client);
        });
    }
    let hub_id = id.to_string();
    let core2 = core.clone();
    let mut events = l.events;
    let fwd = tokio::spawn(async move {
        while let Some(ev) = events.recv().await {
            core2.connectors.forward(&hub_id, ev);
        }
    });
    let end = tokio::select! {
        _ = cancel.cancelled() => { let _ = l.child.start_kill(); End::Cancelled }
        _ = l.client.wait_closed() => {
            let code = tokio::time::timeout(Duration::from_secs(2), l.child.wait()).await.ok().and_then(|r| r.ok());
            End::Ended(started.elapsed(), match code { Some(c) => format!("stopped ({c})"), None => "stopped".into() })
        }
    };
    fwd.abort();
    let _ = l.child.start_kill();
    end
}

#[cfg(test)]
mod tests {
    use super::*;
    use na_protocol::{FieldKind, SetupField};

    #[test]
    fn environment_has_secrets_config_and_no_leaks() {
        let mut base = BTreeMap::new();
        base.insert("PATH".to_string(), "/bin".to_string());
        base.insert("AWS_SECRET_ACCESS_KEY".to_string(), "leak".to_string());
        let field = |key: &str, kind| SetupField {
            key: key.into(),
            label: key.into(),
            kind,
            help: None,
            link: None,
            placeholder: None,
            required: false,
            from: None,
            options: vec![],
            default: None,
        };
        let m = ConnectorManifest {
            name: "x".into(),
            setup: vec![field("bot_token", FieldKind::Secret), field("channel", FieldKind::Text)],
            ..Default::default()
        };
        let mut config = BTreeMap::new();
        config.insert("channel".into(), json!("general"));
        let mut secrets = BTreeMap::new();
        secrets.insert("bot_token".into(), "tok-123".into());
        let spec = LaunchSpec { id: "x".into(), dir: "/tmp".into(), state_dir: "/tmp/s".into(), manifest: m, config, secrets };
        let env: BTreeMap<_, _> = environment(&base, &spec).into_iter().collect();
        assert_eq!(env["NA_SECRET_BOT_TOKEN"], "tok-123");
        assert_eq!(env["NA_STATE_DIR"], "/tmp/s");
        assert_eq!(serde_json::from_str::<Value>(&env["NA_CONFIG"]).unwrap(), json!({ "channel": "general" }));
        assert_eq!(env["PATH"], "/bin");
        assert!(!env.contains_key("AWS_SECRET_ACCESS_KEY"));
        // Not an MCP server: no plain variable names.
        assert!(!env.contains_key("bot_token"));
        assert_eq!(command_of(&spec.manifest), ("node".to_string(), vec!["index.mjs".to_string()]));
    }
}
