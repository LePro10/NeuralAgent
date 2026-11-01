//! Observations: what Neural noticed about agents, kept apart from the conversation. Coalescing,
//! labels, prompt descriptions and "stuck" detection. Pure.

use std::collections::HashMap;

use na_protocol::{AgentStatus, CvPrompt, Id, Millis, NeuralObs, NeuralState, ObsKind, Session, State};

/// Observations kept.
pub const KEEP: usize = 40;
/// Same agent and kind within this window: one observation.
const COALESCE_MS: Millis = 60_000;
/// Working without visible progress this long counts as stuck.
pub const STUCK_MS: Millis = 15 * 60_000;

/// Adds `obs`, or folds it into the newest one of the same agent and kind. Returns the id kept.
pub fn push(n: &mut NeuralState, mut obs: NeuralObs) -> Id {
    if let Some(prev) = n
        .observations
        .iter_mut()
        .rev()
        .take(6)
        .find(|o| o.kind == obs.kind && o.session_id.is_some() && o.session_id == obs.session_id && obs.at - o.at < COALESCE_MS)
    {
        prev.text = obs.text;
        prev.at = obs.at;
        prev.seen = false;
        prev.count = prev.count.max(1) + 1;
        return prev.id.clone();
    }
    obs.count = obs.count.max(1);
    let id = obs.id.clone();
    n.observations.push(obs);
    if n.observations.len() > KEEP {
        let cut = n.observations.len() - KEEP;
        n.observations.drain(..cut);
    }
    id
}

/// "Japan Map — Fix the login" for an agent.
pub fn label(st: &State, sid: &str) -> String {
    match st.sessions.get(sid) {
        Some(x) => format!("{} — {}", workspace_name(st, &x.workspace_id), x.title),
        None => "An agent".into(),
    }
}

pub fn workspace_name<'a>(st: &'a State, id: &str) -> &'a str {
    st.workspaces.iter().find(|w| w.id == id).map(|w| w.name.as_str()).unwrap_or("?")
}

/// What an open prompt asks, in one line: "wants to run `cargo test`", "asks: Which database?".
pub fn describe_prompt(p: &CvPrompt) -> String {
    match p.kind.as_deref() {
        Some("permission") => match &p.tool {
            Some(t) => {
                let what = t.input["command"]
                    .as_str()
                    .or_else(|| t.input["file_path"].as_str())
                    .or_else(|| t.input["url"].as_str())
                    .or_else(|| t.input["pattern"].as_str())
                    .map(|c| format!(": `{}`", clip(c, 160)))
                    .unwrap_or_default();
                format!("wants to use {}{what}", t.name)
            }
            None => format!("asks: {}", clip(&p.title, 160)),
        },
        Some("question") => {
            let q = p.question.as_ref().and_then(|q| q.questions.first());
            match q {
                Some(q) => {
                    let opts: Vec<String> = q.options.iter().map(|o| o.label.clone()).take(5).collect();
                    format!("asks: {} (options: {})", clip(&q.question, 200), opts.join(" / "))
                }
                None => format!("asks: {}", clip(&p.title, 160)),
            }
        }
        Some("plan") => format!("wants its plan approved: {}", clip(p.plan.as_deref().unwrap_or(&p.title), 240)),
        _ => {
            let opts: Vec<String> = p.options.iter().map(|o| format!("{}. {}", o.n, o.label)).take(4).collect();
            format!("asks: {} ({})", clip(&p.title, 160), opts.join(", "))
        }
    }
}

/// The text of an agent observation, in the shape of the old chat notices.
pub fn agent_text(label: &str, kind: ObsKind, detail: &str) -> String {
    let what = match kind {
        ObsKind::Done => "finished",
        ObsKind::Waiting => "needs input",
        ObsKind::Error => "stopped with an error",
        ObsKind::Exited => "exited",
        ObsKind::Started => "started",
        ObsKind::Stuck => "seems stuck",
        ObsKind::CheckPassed => "passed the check",
        ObsKind::CheckFailed => "failed the check",
        ObsKind::Allowed => "was allowed",
        ObsKind::Team => "moved on",
    };
    let d = detail.trim();
    if d.is_empty() { format!("{label} {what}") } else { format!("{label} {what}: {}", clip(d, 300)) }
}

pub fn clip(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// Notices agents that work without visible progress (same last words, same output line
/// without its timers, same usage) for [`STUCK_MS`]. Reports each episode once.
#[derive(Default)]
pub struct Stuck {
    seen: HashMap<Id, (String, Millis, bool)>,
}

impl Stuck {
    pub fn check<'a>(&mut self, sessions: impl Iterator<Item = &'a Session>, now: Millis) -> Vec<Id> {
        let mut out = vec![];
        let mut alive = vec![];
        for s in sessions {
            if !s.alive || s.status != AgentStatus::Working {
                self.seen.remove(&s.id);
                continue;
            }
            alive.push(s.id.clone());
            let fp = fingerprint(s);
            let e = self.seen.entry(s.id.clone()).or_insert((fp.clone(), now, false));
            if e.0 != fp {
                *e = (fp, now, false);
            } else if !e.2 && now - e.1 >= STUCK_MS {
                e.2 = true;
                out.push(s.id.clone());
            }
        }
        self.seen.retain(|k, _| alive.contains(k));
        out
    }
}

fn fingerprint(s: &Session) -> String {
    let line: String = s.last_line.as_deref().unwrap_or("").chars().filter(|c| !c.is_ascii_digit()).collect();
    format!("{}|{}|{:?}", s.last_message.as_deref().unwrap_or(""), line, s.usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs(id: &str, at: Millis, kind: ObsKind, sid: &str) -> NeuralObs {
        NeuralObs { id: id.into(), at, kind, session_id: Some(sid.into()), task_id: None, text: id.into(), seen: true, count: 0 }
    }

    #[test]
    fn repeats_coalesce() {
        let mut n = NeuralState::default();
        push(&mut n, obs("a", 0, ObsKind::Waiting, "s1"));
        let kept = push(&mut n, obs("b", 30_000, ObsKind::Waiting, "s1"));
        assert_eq!(kept, "a");
        assert_eq!(n.observations.len(), 1);
        assert_eq!(n.observations[0].count, 2);
        assert!(!n.observations[0].seen, "a repeat is new again");
        push(&mut n, obs("c", 40_000, ObsKind::Done, "s1"));
        push(&mut n, obs("d", 200_000, ObsKind::Waiting, "s1"));
        assert_eq!(n.observations.len(), 3);
        for i in 0..60 {
            push(&mut n, obs(&format!("x{i}"), 300_000 + i, ObsKind::Done, &format!("s{i}")));
        }
        assert_eq!(n.observations.len(), KEEP);
    }

    #[test]
    fn notice_shape_is_kept() {
        assert_eq!(agent_text("Web — Fix", ObsKind::Waiting, "wants to use Bash"), "Web — Fix needs input: wants to use Bash");
        assert_eq!(agent_text("Web — Fix", ObsKind::Done, " "), "Web — Fix finished");
    }

    #[test]
    fn prompts_in_one_line() {
        let p: CvPrompt = serde_json::from_value(serde_json::json!({
            "title": "Bash command", "options": [], "kind": "permission",
            "tool": { "name": "Bash", "input": { "command": "cargo test" } }
        }))
        .unwrap();
        assert_eq!(describe_prompt(&p), "wants to use Bash: `cargo test`");
    }

    #[test]
    fn stuck_once_per_episode() {
        let s: Session = serde_json::from_value(serde_json::json!({
            "id": "s1", "workspace_id": "w", "profile_id": "claude", "title": "t", "cwd": "/", "status": "working",
            "status_since": 0, "started_at": 0, "busy_ms": 0, "cols": 80, "rows": 24, "alive": true, "status_source": "hooks",
            "last_line": "Thinking… (12s)"
        }))
        .unwrap();
        let mut st = Stuck::default();
        assert!(st.check([&s].into_iter(), 0).is_empty());
        let mut later = s.clone();
        later.last_line = Some("Thinking… (900s)".into());
        assert!(st.check([&later].into_iter(), STUCK_MS / 2).is_empty(), "timers do not count as progress");
        assert_eq!(st.check([&later].into_iter(), STUCK_MS), vec!["s1".to_string()]);
        assert!(st.check([&later].into_iter(), STUCK_MS * 2).is_empty(), "reported once");
        later.last_message = Some("Done with step 2".into());
        assert!(st.check([&later].into_iter(), STUCK_MS * 2).is_empty());
    }
}
