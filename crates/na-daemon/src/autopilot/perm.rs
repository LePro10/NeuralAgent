//! What the pilot may do on its own: tool classes and the playbook's rules.

use na_protocol::{Allow, Playbook, ToolClass};

/// Built-in tools of the pilot and their class. `start_agent` and `send_to_agent` change things
/// (they run an agent); everything else only reads or talks to the user.
pub fn builtin_class(tool: &str) -> ToolClass {
    match tool {
        "start_agent" | "send_to_agent" | "build_connector" => ToolClass::Write,
        _ => ToolClass::Read,
    }
}

/// The rule that applies: exact tool first, then the connector's "*".
fn rule(p: &Playbook, connector: Option<&str>, tool: &str) -> Option<Allow> {
    let of = |name: &str| p.rules.iter().find(|r| r.connector_id.as_deref() == connector && r.tool == name).map(|r| r.allow);
    of(tool).or_else(|| of("*"))
}

/// Auto, Ask or Never for one tool.
///
/// Defaults: read → auto; write → auto for the pilot's own agent tools, ask for connector tools;
/// external (speaks to other people) → ask. A rule overrides the default in both directions.
pub fn resolve(p: &Playbook, connector: Option<&str>, tool: &str, class: ToolClass) -> Allow {
    if let Some(a) = rule(p, connector, tool) {
        return a;
    }
    match (class, connector) {
        (ToolClass::Read, _) => Allow::Auto,
        (ToolClass::Write, None) => Allow::Auto,
        (ToolClass::Write, Some(_)) => Allow::Ask,
        (ToolClass::External, _) => Allow::Ask,
    }
}

/// Whether the user explicitly allowed this tool to run alone (needed to send a draft unasked).
pub fn explicit_auto(p: &Playbook, connector: Option<&str>, tool: &str) -> bool {
    rule(p, connector, tool) == Some(Allow::Auto)
}

#[cfg(test)]
mod tests {
    use super::*;
    use na_protocol::ToolRule;

    fn rule(c: Option<&str>, tool: &str, allow: Allow) -> ToolRule {
        ToolRule { connector_id: c.map(str::to_string), tool: tool.into(), allow }
    }

    #[test]
    fn defaults_follow_the_class() {
        let p = Playbook::default();
        assert_eq!(resolve(&p, Some("discord"), "read_messages", ToolClass::Read), Allow::Auto);
        assert_eq!(resolve(&p, Some("github"), "label", ToolClass::Write), Allow::Ask);
        assert_eq!(resolve(&p, Some("discord"), "reply", ToolClass::External), Allow::Ask);
        assert_eq!(resolve(&p, None, "start_agent", builtin_class("start_agent")), Allow::Auto);
        // Building a connector the owner asked for needs no second confirmation.
        assert_eq!(resolve(&p, None, "build_connector", builtin_class("build_connector")), Allow::Auto);
        assert_eq!(resolve(&p, None, "connector_status", builtin_class("connector_status")), Allow::Auto);
        assert_eq!(resolve(&p, None, "inbox_update", builtin_class("inbox_update")), Allow::Auto);
    }

    #[test]
    fn exact_rules_beat_wildcards_beat_defaults() {
        let p = Playbook {
            rules: vec![
                rule(Some("discord"), "*", Allow::Never),
                rule(Some("discord"), "read_messages", Allow::Auto),
                rule(None, "start_agent", Allow::Ask),
                rule(Some("github"), "comment", Allow::Auto),
            ],
            ..Default::default()
        };
        assert_eq!(resolve(&p, Some("discord"), "read_messages", ToolClass::Read), Allow::Auto);
        assert_eq!(resolve(&p, Some("discord"), "reply", ToolClass::External), Allow::Never);
        assert_eq!(resolve(&p, Some("discord"), "whoami", ToolClass::Read), Allow::Never);
        assert_eq!(resolve(&p, None, "start_agent", ToolClass::Write), Allow::Ask);
        // A rule of another connector does not leak.
        assert_eq!(resolve(&p, Some("github"), "label", ToolClass::Write), Allow::Ask);
        assert_eq!(resolve(&p, Some("github"), "comment", ToolClass::External), Allow::Auto);
        assert!(explicit_auto(&p, Some("github"), "comment"));
        assert!(!explicit_auto(&p, Some("github"), "label"));
        // A built-in rule is not a connector rule of the same name.
        assert_eq!(resolve(&p, Some("x"), "start_agent", ToolClass::Write), Allow::Ask);
    }
}
