//! `connector.json`: parsing, validation and what is still missing to run a connector.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use na_protocol::{ConnectorManifest, FieldKind, ToolClass};
use serde_json::Value;

pub fn parse(text: &str) -> Result<ConnectorManifest> {
    let m: ConnectorManifest = serde_json::from_str(text).context("connector.json is not valid")?;
    let problems = validate(&m);
    if let Some(p) = problems.first() {
        anyhow::bail!("{p}");
    }
    Ok(m)
}

/// Everything wrong with a manifest, in words (empty: fine).
pub fn validate(m: &ConnectorManifest) -> Vec<String> {
    let mut p = vec![];
    if m.name.trim().is_empty() {
        p.push("the manifest has no name".to_string());
    }
    let mut keys = std::collections::BTreeSet::new();
    for f in &m.setup {
        if f.key.is_empty() || !f.key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            p.push(format!("setup field \"{}\": the key may only use letters, digits and _", f.key));
        }
        if !keys.insert(f.key.clone()) {
            p.push(format!("setup field \"{}\" appears twice", f.key));
        }
        if f.label.trim().is_empty() {
            p.push(format!("setup field \"{}\" has no label", f.key));
        }
        if let Some(from) = &f.from
            && !m.tools.contains_key(from)
        {
            p.push(format!("setup field \"{}\" loads its choices from \"{from}\", which is not in tools", f.key));
        }
    }
    if let Some(c) = &m.check {
        match m.tools.get(c) {
            None => p.push(format!("the check tool \"{c}\" is not in tools")),
            Some(ToolClass::Read) => {}
            Some(_) => p.push(format!("the check tool \"{c}\" must be a read tool")),
        }
    }
    if let Some(poll) = &m.poll {
        if !m.tools.contains_key(&poll.tool) {
            p.push(format!("the poll tool \"{}\" is not in tools", poll.tool));
        }
        if poll.minutes == 0 {
            p.push("poll.minutes must be at least 1".to_string());
        }
    }
    p
}

/// Class of a tool; a tool the manifest does not list counts as `external`.
pub fn class_of(m: &ConnectorManifest, tool: &str) -> ToolClass {
    m.tools.get(tool).copied().unwrap_or(ToolClass::External)
}

fn has_value(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => !a.is_empty(),
        _ => true,
    }
}

/// Labels of required setup fields that have no value yet.
pub fn missing(m: &ConnectorManifest, config: &BTreeMap<String, Value>, secrets_set: &[String]) -> Vec<String> {
    m.setup
        .iter()
        .filter(|f| f.required)
        .filter(|f| match f.kind {
            FieldKind::Secret => !secrets_set.contains(&f.key),
            _ => !config.get(&f.key).or(f.default.as_ref()).is_some_and(has_value),
        })
        .map(|f| f.label.clone())
        .collect()
}

/// `NA_SECRET_<KEY>`.
pub fn secret_var(key: &str) -> String {
    format!("NA_SECRET_{}", key.to_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK: &str = r#"{
        "name": "Demo", "kind": "api",
        "setup": [
          {"key": "token", "label": "Token", "type": "secret", "required": true},
          {"key": "repos", "label": "Repos", "type": "pick", "from": "list_repos", "required": true},
          {"key": "note", "label": "Note", "type": "text"}
        ],
        "tools": {"whoami": "read", "list_repos": "read", "comment": "external"},
        "check": "whoami",
        "poll": {"tool": "whoami", "minutes": 5}
    }"#;

    #[test]
    fn parses_a_manifest() {
        let m = parse(OK).unwrap();
        assert_eq!(m.name, "Demo");
        assert_eq!(class_of(&m, "comment"), ToolClass::External);
        // not listed = external
        assert_eq!(class_of(&m, "mystery"), ToolClass::External);
    }

    #[test]
    fn finds_problems() {
        let bad = OK.replace("\"check\": \"whoami\"", "\"check\": \"comment\"");
        assert!(parse(&bad).unwrap_err().to_string().contains("must be a read tool"));
        let bad = OK.replace("\"from\": \"list_repos\"", "\"from\": \"nope\"");
        assert!(parse(&bad).is_err());
        assert!(parse("{").is_err());
        assert!(parse(r#"{"name": " "}"#).is_err());
    }

    #[test]
    fn says_what_is_missing() {
        let m = parse(OK).unwrap();
        let mut cfg = BTreeMap::new();
        assert_eq!(missing(&m, &cfg, &[]), vec!["Token".to_string(), "Repos".to_string()]);
        cfg.insert("repos".into(), serde_json::json!(["a/b"]));
        assert_eq!(missing(&m, &cfg, &["token".into()]), Vec::<String>::new());
        cfg.insert("repos".into(), serde_json::json!([]));
        assert_eq!(missing(&m, &cfg, &["token".into()]), vec!["Repos".to_string()]);
        assert_eq!(secret_var("api_key"), "NA_SECRET_API_KEY");
    }
}
