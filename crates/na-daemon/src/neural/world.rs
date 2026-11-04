//! The world state: a compact picture of everything Neural should know, rendered fresh for every
//! model step instead of piling events into the conversation (docs/notes/neural-v2.md). Pure.

use std::collections::HashMap;
use std::fmt::Write;

use na_protocol::{AgentStatus, CvPrompt, Id, Millis, NeuralMode, NeuralState, OrchRole, State};

use super::observe::{clip, workspace_name};

/// Live agents listed in full; exited ones are summed up beyond this.
const AGENTS: usize = 14;
/// Open tasks listed; older ones are counted.
const OPEN_TASKS: usize = 12;
const EXITED: usize = 4;
/// Observations already seen that are still shown, for continuity.
const EARLIER: usize = 6;

pub struct Ctx<'a> {
    pub now: Millis,
    /// Local time, e.g. "Saturday 2026-10-31 14:05".
    pub clock: String,
    pub host: String,
    /// Open prompts of waiting agents (Claude view).
    pub prompts: &'a HashMap<Id, CvPrompt>,
}

/// First 6 characters of an id: what the model uses to name agents.
pub fn short(id: &str) -> String {
    id.chars().take(6).collect()
}

/// A duration: "1 min", "3 h" (under a minute counts as one).
fn span(ms: Millis) -> String {
    let m = (ms.max(0) / 60_000).max(1);
    match m {
        1..=89 => format!("{m} min"),
        _ if m < 48 * 60 => format!("{} h", m / 60),
        _ => format!("{} days", m / (24 * 60)),
    }
}

/// A point in the past: "just now", "5 min ago".
fn ago(ms: Millis) -> String {
    if ms < 60_000 { "just now".into() } else { format!("{} ago", span(ms)) }
}

/// Renders the world block. Everything in it is true now; nothing is history except the digest.
pub fn render(st: &State, cx: &Ctx) -> String {
    let n: &NeuralState = &st.neural;
    let mut o = String::new();
    let _ = writeln!(o, "<world>\nNow: {} on \"{}\". Mode: {}.", cx.clock, cx.host, mode(n.mode));
    let last_user = st.orchestrator.messages.iter().rev().find(|m| m.role == OrchRole::User).map(|m| m.at);
    if let Some(at) = last_user {
        let _ = writeln!(o, "The user last wrote to you {}.", ago(cx.now - at));
    }

    // Tasks
    // The most recently active open tasks; a long tail is only counted (bounded context).
    let mut open: Vec<_> = n.tasks.iter().filter(|t| !t.status.finished()).collect();
    open.sort_by_key(|t| std::cmp::Reverse(t.updated_at));
    let more_open = open.len().saturating_sub(OPEN_TASKS);
    open.truncate(OPEN_TASKS);
    let done: Vec<_> = n.tasks.iter().filter(|t| t.status.finished() && cx.now - t.updated_at < 24 * 3_600_000).collect();
    o.push_str("\nYour tasks:\n");
    if open.is_empty() && done.is_empty() {
        o.push_str("- none\n");
    }
    for t in &open {
        let agents: Vec<String> = t.agents.iter().map(|a| format!("[{}]", short(a))).collect();
        let _ = write!(o, "- {} ({}) {}", t.id, status_word(t.status), clip(&t.title, 120));
        if let Some(w) = &t.workspace_id {
            let _ = write!(o, " · in {}", workspace_name(st, w));
        }
        if !t.done_when.is_empty() {
            let _ = write!(o, " · done when: {}", clip(&t.done_when, 160));
        }
        if let Some(c) = &t.check {
            let _ = write!(o, " · check: `{c}`");
        }
        if !agents.is_empty() {
            let _ = write!(o, " · agents {}", agents.join(" "));
        }
        if !t.note.is_empty() {
            let _ = write!(o, " · note: {}", clip(&t.note, 160));
        }
        o.push('\n');
    }
    if more_open > 0 {
        let _ = writeln!(o, "- … and {more_open} older open tasks (close what is finished with update_task)");
    }
    for t in done.iter().rev().take(4) {
        let _ = writeln!(o, "- {} ({}, {}) {}", t.id, status_word(t.status), ago(cx.now - t.updated_at), clip(&t.title, 80));
    }

    // Agents
    o.push_str("\nAgents:\n");
    let mut sessions: Vec<_> = st.sessions.values().filter(|x| !x.profile_id.starts_with("install:") && x.profile_id != "shell").collect();
    sessions.sort_by_key(|x| std::cmp::Reverse(x.started_at));
    // With many agents, the ones that wait or work on a task of Neural's come first, so the cut
    // below never hides them.
    let key = |x: &&na_protocol::Session| (x.status != AgentStatus::Waiting && super::tasks::of_agent(n, &x.id).is_none()) as u8;
    let mut live: Vec<_> = sessions.iter().filter(|x| x.alive).collect();
    live.sort_by_key(|x| key(x));
    let exited: Vec<_> = sessions.iter().filter(|x| !x.alive && cx.now - x.status_since < 12 * 3_600_000).collect();
    if live.is_empty() {
        o.push_str("- none running\n");
    }
    for x in live.iter().take(AGENTS).chain(exited.iter().take(EXITED)) {
        let engine = st.profiles.iter().find(|p| p.id == x.profile_id).map(|p| p.name.as_str()).unwrap_or(x.profile_id.as_str());
        let status = format!("{:?}", x.status).to_lowercase();
        let _ = write!(
            o,
            "- [{}] {} — {} ({engine}), {status} for {}",
            short(&x.id),
            workspace_name(st, &x.workspace_id),
            clip(&x.title, 60),
            span(cx.now - x.status_since)
        );
        if let Some(t) = super::tasks::of_agent(n, &x.id) {
            let _ = write!(o, ", task {}", t.id);
        }
        if x.worktree.is_some() {
            o.push_str(", own worktree");
        }
        if x.status == AgentStatus::Waiting {
            match cx.prompts.get(&x.id) {
                Some(p) => {
                    let _ = write!(o, "\n  open prompt: {}", super::observe::describe_prompt(p));
                }
                None => o.push_str("\n  waits for input (prompt not readable: read_agent)"),
            }
        }
        if let Some(l) = x.last_message.as_deref().or(x.last_line.as_deref()) {
            let _ = write!(o, "\n  last: {}", clip(&l.replace('\n', " "), 200));
        }
        o.push('\n');
    }
    if live.len() > AGENTS {
        let _ = writeln!(o, "- … and {} more running", live.len() - AGENTS);
    }

    // Digest
    let fresh: Vec<_> = n.observations.iter().filter(|x| !x.seen).collect();
    let earlier: Vec<_> = n.observations.iter().filter(|x| x.seen).rev().take(EARLIER).collect();
    if !earlier.is_empty() {
        o.push_str("\nEarlier (already known):\n");
        for x in earlier.iter().rev() {
            let _ = writeln!(o, "- {}: {}", ago(cx.now - x.at), clip(&x.text, 160));
        }
    }
    o.push_str("\nNew since your last turn:\n");
    if fresh.is_empty() {
        o.push_str("- nothing\n");
    }
    for x in &fresh {
        let rep = if x.count > 1 { format!(" (×{})", x.count) } else { String::new() };
        let who = x.session_id.as_deref().map(|s| format!(" [{}]", short(s))).unwrap_or_default();
        let _ = writeln!(o, "- {}{who}: {}{rep}", ago(cx.now - x.at), clip(&x.text, 300));
    }

    if !n.pending.is_empty() {
        o.push_str("\nWaiting for the user's OK (shown to them with Allow / Deny):\n");
        for p in &n.pending {
            let _ = writeln!(o, "- {}: {}", p.title, clip(&p.detail, 160));
        }
    }

    if !n.notes.is_empty() {
        o.push_str("\nWhat you remember about the user:\n");
        for m in &n.notes {
            let _ = writeln!(o, "- ({}) {}", m.id, m.text);
        }
    }
    if !n.summary.is_empty() {
        let _ = writeln!(o, "\nEarlier in this conversation (summary): {}", n.summary);
    }

    o.push_str("\nWorkspaces:\n");
    for w in &st.workspaces {
        let _ = writeln!(
            o,
            "- {} ({}){}",
            w.name,
            w.path,
            if w.approved { "" } else { " — not approved: the user must approve it on the computer" }
        );
    }
    if st.workspaces.is_empty() {
        o.push_str("- none yet\n");
    }
    let types: Vec<String> = st
        .profiles
        .iter()
        .filter(|p| !p.id.starts_with("install:") && p.id != "shell")
        .filter(|p| !p.builtin || st.catalog.is_empty() || st.catalog.iter().any(|c| c.id == p.engine && c.installed))
        .map(|p| format!("{} (id {})", p.name, p.id))
        .collect();
    let _ = writeln!(o, "Agent types: {}. Default: {}.\n</world>", types.join(", "), st.settings.default_profile);
    o
}

fn mode(m: NeuralMode) -> &'static str {
    match m {
        NeuralMode::Active => "active (report what matters on your own)",
        NeuralMode::Quiet => "quiet (speak on your own only when the user is needed)",
        NeuralMode::Off => "off (answer only when asked)",
    }
}

fn status_word(s: na_protocol::NeuralTaskStatus) -> &'static str {
    use na_protocol::NeuralTaskStatus::*;
    match s {
        Open => "open",
        Working => "working",
        Review => "to review",
        Blocked => "blocked",
        Done => "done",
        Failed => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use na_protocol::{NeuralObs, ObsKind, Session};

    fn state() -> State {
        let mut st: State = serde_json::from_value(serde_json::json!({
            "workspaces": [{ "id": "w1", "name": "Japan Map", "path": "/p/japan", "approved": true, "pinned": false, "order": 0, "created_at": 0 }],
            "layouts": {}, "sessions": {}, "profiles": [], "catalog": [],
            "settings": serde_json::to_value(na_protocol::Settings::default()).unwrap(),
        }))
        .unwrap_or_else(|e| panic!("{e}"));
        let s: Session = serde_json::from_value(serde_json::json!({
            "id": "abcdef123", "workspace_id": "w1", "profile_id": "claude", "title": "Fix the login", "cwd": "/p/japan",
            "status": "waiting", "status_since": 0, "started_at": 0, "busy_ms": 0, "cols": 80, "rows": 24, "alive": true,
            "status_source": "hooks", "last_message": "I need to run the tests."
        }))
        .unwrap();
        st.sessions.insert(s.id.clone(), s);
        st
    }

    #[test]
    fn renders_agents_prompts_tasks_and_digest() {
        let mut st = state();
        let id = super::super::tasks::create(&mut st.neural, "Fix login", "tests pass", Some("w1".into()), Some("pnpm test".into()), 0);
        super::super::tasks::link(&mut st.neural, &id, "abcdef123", 0);
        st.neural.observations.push(NeuralObs {
            id: "o1".into(),
            at: 60_000,
            kind: ObsKind::Waiting,
            session_id: Some("abcdef123".into()),
            task_id: None,
            text: "Japan Map — Fix the login needs input: wants to use Bash: `pnpm test`".into(),
            seen: false,
            count: 1,
        });
        let prompt: CvPrompt = serde_json::from_value(serde_json::json!({
            "title": "Bash", "options": [], "kind": "permission", "tool": { "name": "Bash", "input": { "command": "pnpm test" } }
        }))
        .unwrap();
        let prompts = HashMap::from([("abcdef123".to_string(), prompt)]);
        let w = render(&st, &Ctx { now: 120_000, clock: "Sat 14:05".into(), host: "Mac".into(), prompts: &prompts });
        assert!(
            w.contains("- t1 (working) Fix login · in Japan Map · done when: tests pass · check: `pnpm test` · agents [abcdef]"),
            "{w}"
        );
        assert!(w.contains("[abcdef] Japan Map — Fix the login (claude), waiting for 2 min, task t1"), "{w}");
        assert!(w.contains("open prompt: wants to use Bash: `pnpm test`"), "{w}");
        assert!(w.contains("New since your last turn:\n- 1 min ago [abcdef]: Japan Map"), "{w}");
        assert!(!w.contains("Earlier (already known)"));
        assert!(w.len() < 2_000, "compact: {} bytes", w.len());
    }

    #[test]
    fn stays_small_with_many_agents_and_tasks() {
        let mut st = state();
        let base = st.sessions.values().next().unwrap().clone();
        for i in 0..30 {
            let mut s = base.clone();
            s.id = format!("agent{i:02}xyz");
            s.started_at = 1000 + i;
            s.status = AgentStatus::Working;
            s.title = "A long title that goes on and on about what the agent does here".repeat(2);
            s.last_message = Some("Some very long last words of the agent. ".repeat(20));
            st.sessions.insert(s.id.clone(), s);
        }
        // The oldest agent waits and has a task: it must still be listed.
        let id = super::super::tasks::create(&mut st.neural, "Old task", "", None, None, 0);
        super::super::tasks::link(&mut st.neural, &id, "abcdef123", 0);
        for i in 0..40 {
            super::super::tasks::create(&mut st.neural, &format!("task {i} {}", "x".repeat(200)), &"y".repeat(400), None, None, i);
        }
        let prompts = HashMap::new();
        let w = render(&st, &Ctx { now: 100_000, clock: String::new(), host: String::new(), prompts: &prompts });
        assert!(w.contains("[abcdef]"), "the waiting task agent is listed");
        assert!(w.contains("… and 17 more running"), "{w}");
        assert!(w.contains("older open tasks"), "{w}");
        assert!(w.len() < 16_000, "bounded: {} bytes", w.len());
    }

    #[test]
    fn seen_observations_move_to_earlier() {
        let mut st = state();
        for i in 0..20 {
            st.neural.observations.push(NeuralObs {
                id: format!("o{i}"),
                at: i,
                kind: ObsKind::Done,
                session_id: None,
                task_id: None,
                text: format!("event {i}"),
                seen: true,
                count: 1,
            });
        }
        let prompts = HashMap::new();
        let w = render(&st, &Ctx { now: 0, clock: String::new(), host: String::new(), prompts: &prompts });
        assert_eq!(w.matches("event ").count(), EARLIER, "only the last few seen ones");
        assert!(w.contains("event 19") && !w.contains("event 13"));
        assert!(w.contains("New since your last turn:\n- nothing"));
    }
}
