//! Testing a connector: the user's "Test connection" (does it start, list tools, pass its own
//! check) and the conformance check the builder runs when an agent has built one.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use na_protocol::{ConnectorManifest, ConnectorStatus, ConnectorTestResult, TestStep};
use serde_json::json;

use super::log::Log;
use super::manifest;
use super::supervisor::{self, LaunchSpec};
use crate::core::Core;

fn step(label: &str, ok: bool, detail: Option<String>) -> TestStep {
    TestStep { label: label.into(), ok, detail }
}

fn result(steps: Vec<TestStep>) -> ConnectorTestResult {
    ConnectorTestResult { ok: steps.iter().all(|s| s.ok), steps }
}

fn clip(s: &str, n: usize) -> String {
    crate::neural::observe::clip(s, n)
}

/// "Test connection": start it once, list its tools, run its check tool.
pub async fn test(core: &Arc<Core>, id: &str) -> ConnectorTestResult {
    let Some(c) = core.connectors.get(id) else {
        return result(vec![step("Find the connector", false, Some("no such connector".into()))]);
    };
    if id == "browser" || id == "reddit" {
        let on = core.connectors.bridge.connected();
        let mut v = vec![step(
            "Browser extension connected",
            on,
            Some(if on {
                core.connectors.bridge.link().browser.unwrap_or_default()
            } else {
                "Pair the extension first (Pair browser).".into()
            }),
        )];
        if on && id == "reddit" {
            let r =
                core.connectors.call_tool(core, "reddit", "search", json!({ "query": "test", "limit": 1 }), Duration::from_secs(60)).await;
            v.push(step("Read a Reddit page", r.is_ok(), r.err()));
        }
        return result(v);
    }
    let missing = manifest::missing(&c.manifest, &c.config, &c.secrets_set);
    let mut steps =
        vec![step("Settings complete", missing.is_empty(), (!missing.is_empty()).then(|| format!("Still needed: {}", missing.join(", "))))];
    if !missing.is_empty() {
        return result(steps);
    }
    let Some((spec, log)) = core.connectors.spec(&core.paths.root, id) else { return result(steps) };
    steps.extend(probe(core, &spec, &log, true).await);
    if steps.iter().all(|s| s.ok) && matches!(c.status, ConnectorStatus::Error) {
        core.connectors.restart(core, id);
    }
    result(steps)
}

/// Starts the connector once, asks for its tools and (when `run_check`) runs the check tool.
async fn probe(core: &Core, spec: &LaunchSpec, log: &Arc<Log>, run_check: bool) -> Vec<TestStep> {
    let mut steps = vec![];
    let mut l = match supervisor::launch(core, spec, log) {
        Ok(l) => l,
        Err(e) => return vec![step("Started", false, Some(e))],
    };
    let init = tokio::time::timeout(Duration::from_secs(25), async {
        l.client.initialize().await?;
        l.client.list_tools().await
    })
    .await;
    let tools = match init {
        Ok(Ok(t)) => {
            steps.push(step("Started", true, None));
            t
        }
        Ok(Err(e)) => {
            let hint = log.last().map(|x| format!(" Last log line: {}", clip(&x, 200))).unwrap_or_default();
            let _ = l.child.start_kill();
            return vec![step("Started", false, Some(format!("{e}.{hint}")))];
        }
        Err(_) => {
            let _ = l.child.start_kill();
            return vec![step("Started", false, Some("It did not answer within 25 s.".into()))];
        }
    };
    steps.push(step("Tools listed", !tools.is_empty(), Some(format!("{} tools", tools.len()))));
    if run_check && let Some(check) = &spec.manifest.check {
        if tools.iter().any(|t| &t.name == check) {
            match l.client.call_tool(check, json!({}), Duration::from_secs(45)).await {
                Ok(o) if !o.is_error => steps.push(step("Check passed", true, Some(clip(&o.text, 300)))),
                Ok(o) => steps.push(step("Check passed", false, Some(clip(&o.text, 300)))),
                Err(e) => steps.push(step("Check passed", false, Some(e))),
            }
        } else {
            steps.push(step("Check passed", false, Some(format!("The check tool \"{check}\" is not offered by the connector."))));
        }
    }
    let _ = l.child.start_kill();
    steps
}

/// A literal that looks like a credential: known token prefixes, or a long mixed token next to a
/// word like token/secret/key/password.
pub fn looks_secret(line: &str) -> bool {
    const PREFIXES: &[&str] = &["ghp_", "gho_", "github_pat_", "sk-ant-", "sk-live", "xoxb-", "xoxp-", "AKIA", "AIza", "glpat-"];
    let lower = line.to_lowercase();
    let near = ["token", "secret", "key", "password", "passwd", "authorization", "bearer"].iter().any(|w| lower.contains(w));
    for q in ['"', '\'', '`'] {
        for (i, lit) in line.split(q).enumerate() {
            if i % 2 == 0 || lit.len() < 20 || lit.contains(' ') || lit.contains("${") || lit.contains("process.env") {
                continue;
            }
            if PREFIXES.iter().any(|p| lit.starts_with(p)) && lit.len() >= 24 {
                return true;
            }
            let tokenish = lit.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=+/".contains(c));
            let mixed = lit.chars().any(|c| c.is_ascii_digit()) && lit.chars().any(|c| c.is_ascii_alphabetic());
            // Not a URL path, a module name or a file name.
            let plain =
                lit.contains("://") || lit.starts_with("./") || lit.starts_with("node:") || lit.ends_with(".mjs") || lit.ends_with(".json");
            if near && tokenish && mixed && lit.len() >= 28 && !plain && !lit.contains('/') {
                return true;
            }
        }
    }
    // A Discord bot token has three dot-separated parts.
    line.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')).any(|w| {
        let p: Vec<&str> = w.split('.').collect();
        p.len() == 3 && p[0].len() >= 24 && p[1].len() == 6 && p[2].len() >= 27 && w.chars().any(|c| c.is_ascii_digit())
    })
}

fn code_files(dir: &Path, out: &mut Vec<std::path::PathBuf>, depth: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() {
            if depth < 4 && name != "node_modules" && !name.starts_with('.') {
                code_files(&p, out, depth + 1);
            }
        } else if matches!(p.extension().and_then(|x| x.to_str()), Some("mjs" | "js" | "json" | "ts" | "cjs"))
            && !name.ends_with(".test.mjs")
            && !name.ends_with(".test.js")
            && name != "package-lock.json"
        {
            out.push(p);
        }
    }
}

/// Files (relative) with something that looks like a secret.
pub fn scan_secrets(dir: &Path) -> Vec<String> {
    let mut files = vec![];
    code_files(dir, &mut files, 0);
    let mut hits = vec![];
    for f in files {
        let Ok(text) = std::fs::read_to_string(&f) else { continue };
        if let Some((n, _)) = text.lines().enumerate().find(|(_, l)| looks_secret(l)) {
            hits.push(format!("{}:{}", f.strip_prefix(dir).unwrap_or(&f).display(), n + 1));
        }
    }
    hits
}

/// Classes missing in the manifest for tools the server offers, and manifest tools it does not offer.
pub fn tool_gaps(m: &ConnectorManifest, offered: &[String]) -> (Vec<String>, Vec<String>) {
    let unclassified = offered.iter().filter(|t| !m.tools.contains_key(*t)).cloned().collect();
    let missing = m.tools.keys().filter(|t| !offered.contains(t)).cloned().collect();
    (unclassified, missing)
}

async fn node_tests(dir: &Path, env: Vec<(String, String)>) -> TestStep {
    if !std::fs::read_dir(dir).is_ok_and(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().ends_with(".test.mjs"))) {
        return step("Tests pass", false, Some("There is no connector.test.mjs.".into()));
    }
    let mut c = tokio::process::Command::new("node");
    c.arg("--test").current_dir(dir).env_clear().envs(env).stdin(std::process::Stdio::null()).kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(120), c.output()).await {
        Ok(Ok(o)) if o.status.success() => step("Tests pass", true, None),
        Ok(Ok(o)) => {
            let out = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            step("Tests pass", false, Some(crate::neural::tools::tail(&out, 1500)))
        }
        Ok(Err(e)) => step("Tests pass", false, Some(format!("cannot run node: {e}"))),
        Err(_) => step("Tests pass", false, Some("The tests took longer than 2 minutes.".into())),
    }
}

/// What the builder checks when the agent says it is done.
pub async fn conformance(core: &Arc<Core>, id: &str, dir: &Path) -> ConnectorTestResult {
    let mut steps = vec![];
    let text = std::fs::read_to_string(dir.join("connector.json"));
    let m = match text.map_err(|e| e.to_string()).and_then(|t| manifest::parse(&t).map_err(|e| format!("{e:#}"))) {
        Ok(m) => {
            steps.push(step("Manifest is valid", true, None));
            m
        }
        Err(e) => return result(vec![step("Manifest is valid", false, Some(e))]),
    };
    let spec = LaunchSpec {
        id: id.into(),
        dir: dir.into(),
        state_dir: std::env::temp_dir().join(format!("na-check-{}-{id}", std::process::id())),
        manifest: m.clone(),
        config: BTreeMap::new(),
        secrets: BTreeMap::new(),
    };
    let log = Arc::new(Log::default());
    let mut l = match supervisor::launch(core, &spec, &log) {
        Ok(l) => l,
        Err(e) => {
            steps.push(step("Server starts", false, Some(e)));
            return result(steps);
        }
    };
    let probe: Result<Vec<_>, String> = match tokio::time::timeout(Duration::from_secs(25), async {
        l.client.initialize().await?;
        l.client.list_tools().await
    })
    .await
    {
        Ok(r) => r,
        Err(_) => Err("no answer within 25 s".into()),
    };
    let _ = l.child.start_kill();
    let _ = std::fs::remove_dir_all(&spec.state_dir);
    let tools = match probe {
        Ok(t) => {
            steps.push(step("Server starts and lists its tools", !t.is_empty(), Some(format!("{} tools", t.len()))));
            t
        }
        Err(e) => {
            let hint = log.last().map(|x| format!(" Last log line: {}", clip(&x, 200))).unwrap_or_default();
            steps.push(step("Server starts and lists its tools", false, Some(format!("{e}.{hint}"))));
            return result(steps);
        }
    };
    let offered: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
    let (unclassified, missing) = tool_gaps(&m, &offered);
    steps.push(step(
        "Every tool has a class",
        unclassified.is_empty(),
        (!unclassified.is_empty())
            .then(|| format!("Add these to \"tools\" in connector.json as read, write or external: {}", unclassified.join(", "))),
    ));
    steps.push(step(
        "Manifest lists only real tools",
        missing.is_empty(),
        (!missing.is_empty()).then(|| format!("connector.json lists tools the server does not offer: {}", missing.join(", "))),
    ));
    let hits = scan_secrets(dir);
    steps.push(step(
        "No secrets in the code",
        hits.is_empty(),
        (!hits.is_empty())
            .then(|| format!("Something looks like a key or token in: {}. Read secrets from NA_SECRET_<KEY> only.", hits.join(", "))),
    ));
    steps.push(node_tests(dir, supervisor::base_env(&core.env.vars)).await);
    result(steps)
}

/// The failed steps as a message to the building agent.
pub fn failure_message(r: &ConnectorTestResult) -> String {
    let mut s =
        String::from("The connector check found problems. Fix them, then run `node --test` yourself and tell me when it is done:\n");
    for st in r.steps.iter().filter(|s| !s.ok) {
        s.push_str(&format!("- {}{}\n", st.label, st.detail.as_ref().map(|d| format!(": {d}")).unwrap_or_default()));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spots_secret_looking_literals() {
        assert!(looks_secret(r#"const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";"#));
        assert!(looks_secret(r#"headers: { Authorization: "Bearer-9f8a7c6d5e4b3a2f1e0d9c8b7a6f5e4d" }"#));
        // Built at run time so secret scanners do not flag the made-up Discord token.
        let fake_discord = format!("const t = '{}{}'", "MTA0NjkzMDExMjI4NDk2NDMyMA.", "GxYz12.abcdefghijklmnopqrstuvwxyz1");
        assert!(looks_secret(&fake_discord));
        assert!(!looks_secret(r#"const token = process.env.NA_SECRET_TOKEN;"#));
        assert!(!looks_secret(r#"import { x } from "../_lib/connector.mjs";"#));
        assert!(!looks_secret(r#"const url = "https://discord.com/api/v10/channels";"#));
        assert!(!looks_secret(r#"description: "Reads messages in the channels you choose and posts replies""#));
    }

    #[test]
    fn finds_tool_gaps() {
        let m = manifest::parse(r#"{"name":"x","tools":{"a":"read","b":"write"}}"#).unwrap();
        let (unclassified, missing) = tool_gaps(&m, &["a".into(), "c".into()]);
        assert_eq!(unclassified, vec!["c"]);
        assert_eq!(missing, vec!["b"]);
    }

    #[test]
    fn scans_a_folder_but_not_tests() {
        let d = std::env::temp_dir().join(format!("na-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("lib")).unwrap();
        std::fs::write(d.join("index.mjs"), "const a = 1;\nconst key = \"sk-ant-api03-abcdefghijklmnopqrstuvwxyz\";\n").unwrap();
        std::fs::write(d.join("connector.test.mjs"), "const key = \"sk-ant-api03-abcdefghijklmnopqrstuvwxyz\";\n").unwrap();
        std::fs::write(d.join("lib/ok.mjs"), "export const x = 1;\n").unwrap();
        assert_eq!(scan_secrets(&d), vec!["index.mjs:2"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
