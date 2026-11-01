//! The conversation as the model sees it: only user ↔ Neural. What Neural did in a turn is one
//! "(did: …)" line in its own answer, agent events never appear (they are in the world state),
//! and older turns are compacted into `neural.summary`. Pure.

use na_protocol::{Millis, NeuralState, OrchMessage, OrchRole};

use crate::llm::Msg;

/// Compact once this many messages are newer than the summary...
pub const COMPACT_AT: usize = 30;
/// ...keeping this many verbatim.
pub const KEEP_VERBATIM: usize = 14;
/// One pasted log must not fill every later turn: messages are clipped to this many characters.
const MESSAGE: usize = 6_000;

use super::observe::clip;

/// The model's view of the conversation: the newest `keep` turns after the summary.
pub fn build(msgs: &[OrchMessage], n: &NeuralState, keep: usize) -> Vec<Msg> {
    let mut out: Vec<(bool, String)> = vec![]; // (is_user, text)
    let mut did: Vec<String> = vec![];
    let flush = |out: &mut Vec<(bool, String)>, did: &mut Vec<String>| {
        if did.is_empty() {
            return;
        }
        let line = format!("(did: {})", did.join("; "));
        did.clear();
        match out.last_mut() {
            Some((false, t)) => {
                t.push('\n');
                t.push_str(&line);
            }
            _ => out.push((false, line)),
        }
    };
    for m in msgs.iter().filter(|m| m.at > n.summary_upto) {
        match m.role {
            OrchRole::User => {
                flush(&mut out, &mut did);
                push(&mut out, true, clip(&m.text, MESSAGE));
            }
            OrchRole::Assistant if !m.text.trim().is_empty() => {
                flush(&mut out, &mut did);
                let text = clip(&m.text, MESSAGE);
                let t = if m.proactive { format!("(on your own) {text}") } else { text };
                push(&mut out, false, t);
            }
            OrchRole::Action => did.push(match &m.session_id {
                Some(sid) => format!("{} [{}]", m.text, super::world::short(sid)),
                None => m.text.clone(),
            }),
            _ => {}
        }
    }
    flush(&mut out, &mut did);
    let from = out.len().saturating_sub(keep);
    let mut out: Vec<Msg> =
        out.drain(from..).map(|(u, t)| if u { Msg::User(t) } else { Msg::Assistant { text: t, calls: vec![] } }).collect();
    // The model must not start with its own turn.
    while matches!(out.first(), Some(Msg::Assistant { .. })) {
        out.remove(0);
    }
    out
}

fn push(out: &mut Vec<(bool, String)>, user: bool, text: String) {
    match out.last_mut() {
        Some((u, t)) if *u == user => {
            t.push_str("\n\n");
            t.push_str(&text);
        }
        _ => out.push((user, text)),
    }
}

/// When the conversation since the summary is long: the messages to fold into it and the new
/// `summary_upto`.
pub fn compaction<'a>(msgs: &'a [OrchMessage], n: &NeuralState) -> Option<(Vec<&'a OrchMessage>, Millis)> {
    let talk: Vec<&OrchMessage> = msgs
        .iter()
        .filter(|m| m.at > n.summary_upto && (m.role == OrchRole::User || (m.role == OrchRole::Assistant && !m.text.trim().is_empty())))
        .collect();
    if talk.len() <= COMPACT_AT {
        return None;
    }
    let old = talk[..talk.len() - KEEP_VERBATIM].to_vec();
    let upto = old.last()?.at;
    Some((old, upto))
}

/// The request text for compaction.
pub fn compaction_prompt(summary: &str, old: &[&OrchMessage]) -> String {
    let mut s = String::from(
        "Summarise this conversation between the user and Neural (their orchestrator of AI coding agents) in at most \
         120 words: goals, decisions, preferences, open questions. Plain sentences, no list, no preamble.\n\n",
    );
    if !summary.is_empty() {
        s.push_str(&format!("Summary so far: {summary}\n\n"));
    }
    for m in old {
        let who = if m.role == OrchRole::User { "User" } else { "Neural" };
        s.push_str(&format!("{who}: {}\n", super::observe::clip(&m.text, 600)));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(role: OrchRole, text: &str, at: Millis) -> OrchMessage {
        OrchMessage { id: format!("m{at}"), role, text: text.into(), at, ok: Some(true), session_id: None, proactive: false }
    }

    #[test]
    fn actions_fold_into_the_answer_and_notices_vanish() {
        let mut act = m(OrchRole::Action, "Started Claude in Japan Map", 3);
        act.session_id = Some("abcdef99".into());
        let mut report = m(OrchRole::Assistant, "Japan Map is done, tests pass.", 6);
        report.proactive = true;
        let msgs = vec![
            m(OrchRole::Assistant, "stray", 0),
            m(OrchRole::User, "fix the login in japan map", 1),
            m(OrchRole::Assistant, "Ich starte Claude.", 2),
            act,
            m(OrchRole::Notice, "Japan Map — Claude finished", 4),
            m(OrchRole::Assistant, "", 5),
            report,
        ];
        let h = build(&msgs, &NeuralState::default(), 20);
        assert_eq!(h.len(), 2, "{h:?}");
        assert!(matches!(&h[0], Msg::User(t) if t == "fix the login in japan map"));
        let Msg::Assistant { text, .. } = &h[1] else { panic!() };
        assert_eq!(text, "Ich starte Claude.\n(did: Started Claude in Japan Map [abcdef])\n\n(on your own) Japan Map is done, tests pass.");
    }

    #[test]
    fn summary_hides_older_turns_and_compaction_keeps_the_newest() {
        let msgs: Vec<OrchMessage> =
            (0..40).map(|i| m(if i % 2 == 0 { OrchRole::User } else { OrchRole::Assistant }, &format!("t{i}"), i + 1)).collect();
        let n = NeuralState::default();
        let (old, upto) = compaction(&msgs, &n).expect("long enough");
        assert_eq!(old.len(), 40 - KEEP_VERBATIM);
        assert_eq!(upto, (40 - KEEP_VERBATIM) as Millis);
        let n = NeuralState { summary: "s".into(), summary_upto: upto, ..Default::default() };
        assert!(compaction(&msgs, &n).is_none());
        let h = build(&msgs, &n, 100);
        assert_eq!(h.len(), KEEP_VERBATIM);
    }
}
