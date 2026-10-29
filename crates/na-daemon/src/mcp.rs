//! MCP servers managed in one place and handed to every agent at launch.
//!
//! Secret values (environment variables of local servers, headers of HTTP servers) live in
//! `mcp-secrets.json` (owner-only) and never in the shared state. They reach an agent only through
//! its process environment: the generated configuration refers to them by variable name
//! (Claude Code `${VAR}`, Codex `env_vars` / `env_http_headers`, OpenCode `{env:VAR}`), so they
//! appear neither on a command line nor in a file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::Result;
use na_protocol::{McpServer, McpTransport};
use serde_json::{Value, json};

use crate::paths::write_private;

/// server id → secret name → value
pub type Secrets = BTreeMap<String, BTreeMap<String, String>>;

pub fn secrets_path(root: &Path) -> PathBuf {
    root.join("mcp-secrets.json")
}

pub fn load_secrets(root: &Path) -> Secrets {
    std::fs::read_to_string(secrets_path(root)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_secrets(root: &Path, s: &Secrets) -> Result<()> {
    write_private(&secrets_path(root), &serde_json::to_vec_pretty(s)?)
}

/// Letters, digits, `-` and `_`: safe as a key in every agent's config.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 48 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Environment variable that carries a header value for HTTP servers.
fn header_var(id: &str, header: &str) -> String {
    let clean = |s: &str| s.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' }).collect::<String>();
    format!("NEURALAGENT_MCP_{}_{}", clean(id), clean(header))
}

/// What to add to an agent's launch: extra arguments and environment.
#[derive(Default, Debug)]
pub struct Extra {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

pub fn for_engine(engine: &str, servers: &[McpServer], secrets: &Secrets) -> Extra {
    let on: Vec<&McpServer> = servers.iter().filter(|s| s.enabled && valid_id(&s.id)).collect();
    let mut x = Extra::default();
    if on.is_empty() {
        return x;
    }
    // Secret values travel in the agent's environment.
    for s in &on {
        let vals = secrets.get(&s.id);
        for name in &s.secrets {
            let Some(v) = vals.and_then(|m| m.get(name)) else { continue };
            let var = match s.transport {
                McpTransport::Stdio { .. } => name.clone(),
                McpTransport::Http { .. } => header_var(&s.id, name),
            };
            x.env.push((var, v.clone()));
        }
    }
    let has = |s: &McpServer, name: &str| secrets.get(&s.id).is_some_and(|m| m.contains_key(name));
    match engine {
        "claude" => {
            let mut map = serde_json::Map::new();
            for s in &on {
                let v = match &s.transport {
                    McpTransport::Stdio { command, args } => {
                        let env: serde_json::Map<String, Value> =
                            s.secrets.iter().filter(|n| has(s, n)).map(|n| (n.clone(), json!(format!("${{{n}}}")))).collect();
                        json!({ "type": "stdio", "command": command, "args": args, "env": env })
                    }
                    McpTransport::Http { url } => {
                        let headers: serde_json::Map<String, Value> = s
                            .secrets
                            .iter()
                            .filter(|n| has(s, n))
                            .map(|n| (n.clone(), json!(format!("${{{}}}", header_var(&s.id, n)))))
                            .collect();
                        json!({ "type": "http", "url": url, "headers": headers })
                    }
                };
                map.insert(s.id.clone(), v);
            }
            x.args.extend(["--mcp-config".into(), json!({ "mcpServers": map }).to_string()]);
        }
        "codex" => {
            // `-c key=value`, the value in TOML (JSON strings and arrays are valid TOML).
            for s in &on {
                let key = format!("mcp_servers.{}", s.id);
                let mut set = |k: &str, v: String| x.args.extend(["-c".into(), format!("{key}.{k}={v}")]);
                match &s.transport {
                    McpTransport::Stdio { command, args } => {
                        set("command", json!(command).to_string());
                        set("args", json!(args).to_string());
                        let names: Vec<&String> = s.secrets.iter().filter(|n| has(s, n)).collect();
                        if !names.is_empty() {
                            set("env_vars", json!(names).to_string());
                        }
                    }
                    McpTransport::Http { url } => {
                        set("url", json!(url).to_string());
                        let pairs: Vec<String> = s
                            .secrets
                            .iter()
                            .filter(|n| has(s, n))
                            .map(|n| format!("{} = {}", json!(n), json!(header_var(&s.id, n))))
                            .collect();
                        if !pairs.is_empty() {
                            set("env_http_headers", format!("{{ {} }}", pairs.join(", ")));
                        }
                    }
                }
            }
        }
        "opencode" => {
            let mut map = serde_json::Map::new();
            for s in &on {
                let v = match &s.transport {
                    McpTransport::Stdio { command, args } => {
                        let env: serde_json::Map<String, Value> =
                            s.secrets.iter().filter(|n| has(s, n)).map(|n| (n.clone(), json!(format!("{{env:{n}}}")))).collect();
                        let mut cmd = vec![command.clone()];
                        cmd.extend(args.iter().cloned());
                        json!({ "type": "local", "command": cmd, "environment": env, "enabled": true })
                    }
                    McpTransport::Http { url } => {
                        let headers: serde_json::Map<String, Value> = s
                            .secrets
                            .iter()
                            .filter(|n| has(s, n))
                            .map(|n| (n.clone(), json!(format!("{{env:{}}}", header_var(&s.id, n)))))
                            .collect();
                        json!({ "type": "remote", "url": url, "headers": headers, "enabled": true })
                    }
                };
                map.insert(s.id.clone(), v);
            }
            x.env.push(("OPENCODE_CONFIG_CONTENT".into(), json!({ "mcp": map }).to_string()));
        }
        _ => {}
    }
    x
}

/// Agents that get the servers.
#[cfg(test)]
const SUPPORTED: &[&str] = &["claude", "codex", "opencode"];

/// Servers configured in Claude Code (user scope) and Codex, with their secret values.
pub fn import(home: &Path, codex_home: &Path) -> Vec<(McpServer, BTreeMap<String, String>)> {
    let mut out: Vec<(McpServer, BTreeMap<String, String>)> = Vec::new();
    let mut add = |id: &str, transport: McpTransport, vals: BTreeMap<String, String>| {
        let id: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(48).collect();
        if valid_id(&id) && !out.iter().any(|(s, _)| s.id == id) {
            out.push((McpServer { id, enabled: true, secrets: vals.keys().cloned().collect(), transport }, vals));
        }
    };
    let strings = |v: Option<&Value>| -> BTreeMap<String, String> {
        v.and_then(Value::as_object)
            .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
            .unwrap_or_default()
    };
    // Claude Code: ~/.claude.json { "mcpServers": { name: { command, args, env } | { type: "http"|"sse", url, headers } } }
    if let Some(claude) = std::fs::read_to_string(home.join(".claude.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok())
        && let Some(servers) = claude.get("mcpServers").and_then(Value::as_object)
    {
        for (name, s) in servers {
            if let Some(url) = s.get("url").and_then(Value::as_str) {
                add(name, McpTransport::Http { url: url.into() }, strings(s.get("headers")));
            } else if let Some(cmd) = s.get("command").and_then(Value::as_str) {
                let args = s
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                add(name, McpTransport::Stdio { command: cmd.into(), args }, strings(s.get("env")));
            }
        }
    }
    // Codex: ~/.codex/config.toml [mcp_servers.<name>] command, args, env | url, http_headers
    if let Some(cfg) = std::fs::read_to_string(codex_home.join("config.toml")).ok().and_then(|s| s.parse::<toml::Table>().ok())
        && let Some(servers) = cfg.get("mcp_servers").and_then(toml::Value::as_table)
    {
        let tstrings = |v: Option<&toml::Value>| -> BTreeMap<String, String> {
            v.and_then(toml::Value::as_table)
                .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
                .unwrap_or_default()
        };
        for (name, s) in servers {
            if let Some(url) = s.get("url").and_then(toml::Value::as_str) {
                add(name, McpTransport::Http { url: url.into() }, tstrings(s.get("http_headers")));
            } else if let Some(cmd) = s.get("command").and_then(toml::Value::as_str) {
                let args = s
                    .get("args")
                    .and_then(toml::Value::as_array)
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                add(name, McpTransport::Stdio { command: cmd.into(), args }, tstrings(s.get("env")));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn servers() -> (Vec<McpServer>, Secrets) {
        let s = vec![
            McpServer {
                id: "files".into(),
                enabled: true,
                transport: McpTransport::Stdio { command: "npx".into(), args: vec!["-y".into(), "srv".into()] },
                secrets: vec!["API_KEY".into()],
            },
            McpServer {
                id: "docs".into(),
                enabled: true,
                transport: McpTransport::Http { url: "https://x.dev/mcp".into() },
                secrets: vec!["Authorization".into()],
            },
            McpServer { id: "off".into(), enabled: false, transport: McpTransport::Http { url: "https://off".into() }, secrets: vec![] },
        ];
        let mut sec = Secrets::new();
        sec.entry("files".into()).or_default().insert("API_KEY".into(), "k1".into());
        sec.entry("docs".into()).or_default().insert("Authorization".into(), "Bearer t".into());
        (s, sec)
    }

    #[test]
    fn secrets_only_in_env() {
        let (s, sec) = servers();
        for engine in SUPPORTED {
            let x = for_engine(engine, &s, &sec);
            let all = format!("{:?} {:?}", x.args, x.env.iter().filter(|(k, _)| k == "OPENCODE_CONFIG_CONTENT").collect::<Vec<_>>());
            assert!(!all.contains("k1") && !all.contains("Bearer t"), "{engine}: {all}");
            assert!(!all.contains("https://off"), "{engine}: disabled server passed");
            assert!(x.env.contains(&("API_KEY".into(), "k1".into())), "{engine}");
            assert!(x.env.contains(&("NEURALAGENT_MCP_DOCS_AUTHORIZATION".into(), "Bearer t".into())), "{engine}");
        }
        let c = for_engine("claude", &s, &sec);
        let cfg: Value = serde_json::from_str(&c.args[1]).unwrap();
        assert_eq!(cfg["mcpServers"]["files"]["env"]["API_KEY"], "${API_KEY}");
        assert_eq!(cfg["mcpServers"]["docs"]["headers"]["Authorization"], "${NEURALAGENT_MCP_DOCS_AUTHORIZATION}");
        let x = for_engine("codex", &s, &sec);
        assert!(x.args.contains(&r#"mcp_servers.files.env_vars=["API_KEY"]"#.to_string()), "{:?}", x.args);
        assert!(
            x.args.contains(&r#"mcp_servers.docs.env_http_headers={ "Authorization" = "NEURALAGENT_MCP_DOCS_AUTHORIZATION" }"#.to_string())
        );
        // each codex value parses as TOML
        for a in x.args.iter().filter(|a| a.contains('=')) {
            let (_, v) = a.split_once('=').unwrap();
            assert!(format!("x = {v}").parse::<toml::Table>().is_ok(), "{v}");
        }
        assert!(for_engine("gemini", &s, &sec).args.is_empty());
    }

    #[test]
    fn imports_claude_and_codex() {
        let home = std::env::temp_dir().join(format!("na-mcp-{}", rand::random::<u32>()));
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(
            home.join(".claude.json"),
            r#"{"mcpServers":{"fs":{"command":"npx","args":["-y","fs"],"env":{"TOKEN":"t"}},"web":{"type":"http","url":"https://w/mcp","headers":{"X-Key":"h"}}}}"#,
        )
        .unwrap();
        std::fs::write(
            home.join(".codex/config.toml"),
            "[mcp_servers.fs]\ncommand = \"other\"\n\n[mcp_servers.gh]\ncommand = \"gh-mcp\"\nargs = [\"serve\"]\n",
        )
        .unwrap();
        let got = import(&home, &home.join(".codex"));
        let ids: Vec<&str> = got.iter().map(|(s, _)| s.id.as_str()).collect();
        assert_eq!(ids, ["fs", "web", "gh"]);
        assert_eq!(got[0].1.get("TOKEN").map(String::as_str), Some("t"));
        assert_eq!(got[1].0.secrets, ["X-Key"]);
        std::fs::remove_dir_all(&home).unwrap();
    }
}
