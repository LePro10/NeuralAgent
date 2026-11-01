//! Neural's tasks and teams: linking agents, status changes on agent events, and the team
//! patterns (race, build + review) as small state machines. Pure; the runtime in `mod.rs` does
//! what a [`Step`] asks.

use na_protocol::{AttemptState, Id, Millis, NeuralAttempt, NeuralState, NeuralTask, NeuralTaskStatus, NeuralTeam, ObsKind, TeamPattern};

/// Tasks kept: finished ones are dropped oldest first beyond this.
const KEEP: usize = 30;
/// Build + review: rounds before Neural asks the user.
pub const MAX_ROUNDS: u32 = 3;

pub fn next_id(n: &NeuralState) -> Id {
    let max = n.tasks.iter().filter_map(|t| t.id.strip_prefix('t')?.parse::<u32>().ok()).max().unwrap_or(0);
    format!("t{}", max + 1)
}

pub fn create(n: &mut NeuralState, title: &str, done_when: &str, workspace_id: Option<Id>, check: Option<String>, now: Millis) -> Id {
    let id = next_id(n);
    n.tasks.push(NeuralTask {
        id: id.clone(),
        title: super::observe::clip(title, 120),
        done_when: super::observe::clip(done_when, 300),
        status: NeuralTaskStatus::Open,
        workspace_id,
        agents: vec![],
        check: check.filter(|c| !c.trim().is_empty()),
        note: String::new(),
        team: None,
        created_at: now,
        updated_at: now,
    });
    while n.tasks.len() > KEEP {
        match n.tasks.iter().position(|t| t.status.finished()) {
            Some(i) => {
                n.tasks.remove(i);
            }
            None => break,
        }
    }
    id
}

/// The unfinished task an agent works on.
pub fn of_agent<'a>(n: &'a NeuralState, sid: &str) -> Option<&'a NeuralTask> {
    n.tasks.iter().rev().find(|t| !t.status.finished() && t.agents.iter().any(|a| a == sid))
}

pub fn get_mut<'a>(n: &'a mut NeuralState, id: &str) -> Option<&'a mut NeuralTask> {
    n.tasks.iter_mut().find(|t| t.id == id)
}

pub fn link(n: &mut NeuralState, task: &str, sid: &str, now: Millis) {
    if let Some(t) = get_mut(n, task) {
        if !t.agents.iter().any(|a| a == sid) {
            t.agents.push(sid.to_string());
        }
        if matches!(t.status, NeuralTaskStatus::Open | NeuralTaskStatus::Review | NeuralTaskStatus::Blocked) {
            t.status = NeuralTaskStatus::Working;
        }
        t.updated_at = now;
    }
}

/// What the runtime should do after an agent event.
#[derive(Debug, PartialEq)]
pub enum Step {
    Nothing,
    /// Race attempt finished its turn: measure the change and run the check in its worktree.
    Measure {
        task: Id,
        sid: Id,
    },
    /// Builder finished: run the check, then start or prompt the reviewer.
    Review {
        task: Id,
        builder: Id,
    },
    /// Reviewer finished: read its verdict.
    Verdict {
        task: Id,
        reviewer: Id,
    },
    /// Every race attempt is in.
    RaceDone {
        task: Id,
    },
}

pub fn attempt_mut<'a>(t: &'a mut NeuralTask, sid: &str) -> Option<&'a mut NeuralAttempt> {
    t.team.as_mut()?.attempts.iter_mut().find(|a| a.session_id == sid)
}

/// Updates task and team state for an agent event and says what comes next.
pub fn on_agent(n: &mut NeuralState, sid: &str, kind: ObsKind, now: Millis) -> Step {
    let Some(id) = of_agent(n, sid).map(|t| t.id.clone()) else { return Step::Nothing };
    let t = get_mut(n, &id).expect("task exists");
    t.updated_at = now;
    let Some(team) = t.team.as_mut() else {
        match kind {
            ObsKind::Started if t.status == NeuralTaskStatus::Open => t.status = NeuralTaskStatus::Working,
            ObsKind::Done if t.status == NeuralTaskStatus::Working => t.status = NeuralTaskStatus::Review,
            _ => {}
        }
        return Step::Nothing;
    };
    let pattern = team.pattern;
    let Some(a) = team.attempts.iter_mut().find(|a| a.session_id == sid) else { return Step::Nothing };
    let role = a.role.clone();
    match kind {
        ObsKind::Started | ObsKind::Waiting => {
            if matches!(a.state, AttemptState::Done | AttemptState::Ready) && kind == ObsKind::Started {
                a.state = AttemptState::Working;
            }
            Step::Nothing
        }
        ObsKind::Done if a.state == AttemptState::Working => {
            a.state = AttemptState::Done;
            match (pattern, role.as_str()) {
                (TeamPattern::Race, _) => Step::Measure { task: id, sid: sid.into() },
                (TeamPattern::Review, "reviewer") => Step::Verdict { task: id, reviewer: sid.into() },
                (TeamPattern::Review, _) => Step::Review { task: id, builder: sid.into() },
            }
        }
        ObsKind::Error | ObsKind::Exited if matches!(a.state, AttemptState::Working | AttemptState::Done | AttemptState::Checking) => {
            a.state = AttemptState::Failed;
            if pattern == TeamPattern::Race {
                if race_complete(t) {
                    t.status = NeuralTaskStatus::Review;
                    Step::RaceDone { task: id }
                } else {
                    Step::Nothing
                }
            } else {
                t.status = NeuralTaskStatus::Blocked;
                t.note = format!("The {role} stopped.");
                Step::Nothing
            }
        }
        _ => Step::Nothing,
    }
}

/// A race attempt was measured. Returns whether the race is complete now.
#[allow(clippy::too_many_arguments)]
pub fn measured(
    n: &mut NeuralState,
    task: &str,
    sid: &str,
    files: u32,
    add: u32,
    del: u32,
    check: Option<(bool, String)>,
    now: Millis,
) -> bool {
    let Some(t) = get_mut(n, task) else { return false };
    t.updated_at = now;
    if let Some(a) = attempt_mut(t, sid) {
        a.files = files;
        a.additions = add;
        a.deletions = del;
        if let Some((ok, out)) = check {
            a.check_ok = Some(ok);
            a.check_out = Some(out);
        }
        if matches!(a.state, AttemptState::Done | AttemptState::Checking) {
            a.state = AttemptState::Ready;
        }
    }
    let done = race_complete(t);
    if done {
        t.status = NeuralTaskStatus::Review;
        t.note = "Every attempt is in: pick one.".into();
    }
    done
}

fn race_complete(t: &NeuralTask) -> bool {
    t.team.as_ref().is_some_and(|tm| {
        tm.pattern == TeamPattern::Race
            && tm.attempts.iter().all(|a| matches!(a.state, AttemptState::Ready | AttemptState::Failed | AttemptState::Dropped))
    })
}

/// After a daemon restart: tasks still working whose agents do not run any more were cut off.
/// Attempts that were running fail; a race that still has finished attempts goes to the pick, any
/// other cut-off task waits for the user (Blocked, with a note). `alive`: the agent runs now (it
/// may have been resumed). Returns the titles of the tasks it changed.
pub fn interrupted(n: &mut NeuralState, alive: impl Fn(&str) -> bool, now: Millis) -> Vec<String> {
    const NOTE: &str = "Cut off by a restart of NeuralAgent: its agents stopped.";
    let mut changed = vec![];
    for t in n.tasks.iter_mut().filter(|t| t.status == NeuralTaskStatus::Working && !t.agents.is_empty()) {
        if t.agents.iter().any(|a| alive(a)) {
            continue;
        }
        if let Some(team) = t.team.as_mut() {
            for a in team.attempts.iter_mut().filter(|a| !alive(&a.session_id)) {
                match a.state {
                    AttemptState::Working => a.state = AttemptState::Failed,
                    // Finished its turn; only the measuring or the check was cut off.
                    AttemptState::Done | AttemptState::Checking => {
                        a.state = AttemptState::Ready;
                        if a.check_ok.is_none() && t.check.is_some() {
                            a.check_out = Some("The check was cut off by a restart.".into());
                        }
                    }
                    _ => {}
                }
            }
        }
        let race = t.team.as_ref().is_some_and(|tm| tm.pattern == TeamPattern::Race);
        let any_ready = t.team.as_ref().is_some_and(|tm| tm.attempts.iter().any(|a| a.state == AttemptState::Ready));
        if race && race_complete(t) && any_ready {
            t.status = NeuralTaskStatus::Review;
            t.note = format!("{NOTE} Pick one of the finished attempts.");
        } else {
            t.status = NeuralTaskStatus::Blocked;
            t.note = format!("{NOTE} Ask Neural to start again, or drop it.");
        }
        t.updated_at = now;
        changed.push(t.title.clone());
    }
    changed
}

/// The attempts whose worktrees "Clean up" may throw away: a race that ended without a pick
/// (dropped, failed, cut off and waiting for the user). Never the kept attempt.
pub fn cleanable(t: &NeuralTask) -> Result<Vec<Id>, &'static str> {
    let Some(team) = t.team.as_ref().filter(|tm| tm.pattern == TeamPattern::Race) else { return Err("not a race") };
    if !(t.status.finished() || t.status == NeuralTaskStatus::Blocked) {
        return Err("this race still runs or waits for your pick: drop it first");
    }
    Ok(team.attempts.iter().filter(|a| a.state != AttemptState::Merged).map(|a| a.session_id.clone()).collect())
}

/// "VERDICT: APPROVED" → Some(true), "VERDICT: CHANGES" → Some(false). The last one counts.
pub fn verdict(text: &str) -> Option<bool> {
    let up = text.to_uppercase();
    let i = up.rfind("VERDICT")?;
    let rest = &up[i..];
    let a = rest.find("APPROVED");
    let c = rest.find("CHANGES");
    match (a, c) {
        (Some(a), Some(c)) => Some(a < c),
        (Some(_), None) => Some(true),
        (None, Some(_)) => Some(false),
        _ => None,
    }
}

pub fn new_team(pattern: TeamPattern, profiles: &[Id]) -> NeuralTeam {
    NeuralTeam { pattern, profiles: profiles.to_vec(), attempts: vec![], round: 0, winner: None }
}

pub fn attempt(sid: &str, profile: &str, role: &str) -> NeuralAttempt {
    NeuralAttempt {
        session_id: sid.into(),
        profile_id: profile.into(),
        role: role.into(),
        state: AttemptState::Working,
        check_ok: None,
        check_out: None,
        files: 0,
        additions: 0,
        deletions: 0,
        verdict: None,
    }
}

fn check_line(check: Option<&str>) -> String {
    check.map(|c| format!(" The check is `{c}`: it must pass.")).unwrap_or_default()
}

pub fn race_brief(goal: &str, check: Option<&str>) -> String {
    format!(
        "{goal}\n\nYou are one of several agents trying this independently, each in its own git worktree; the best \
         result is kept. Work on your own, keep the change focused, and finish with a short summary of what you \
         changed and how you verified it.{}",
        check_line(check)
    )
}

pub fn builder_brief(goal: &str, check: Option<&str>) -> String {
    format!(
        "{goal}\n\nWhen you are done, a reviewer (another AI agent) will check your change, and its feedback comes back \
         to you here. Finish each round with a short summary of what you changed.{}",
        check_line(check)
    )
}

pub fn reviewer_brief(goal: &str, check: Option<&str>, check_result: Option<&str>) -> String {
    format!(
        "You review another agent's work in this folder. Do not change any files.\nGoal it worked on: {goal}\n\n\
         Look at the uncommitted changes (git status, git diff) and judge them against the goal: correctness, \
         missing cases, tests, anything that would break.{}{}\n\nEnd your answer with exactly one line: \
         `VERDICT: APPROVED` if it is good to keep, or `VERDICT: CHANGES` followed by a short numbered list of the \
         concrete problems to fix.",
        check_line(check),
        check_result.map(|r| format!("\nCheck result: {r}")).unwrap_or_default(),
    )
}

pub fn reviewer_again(round: u32, check_result: Option<&str>) -> String {
    format!(
        "The builder changed the code after your review (round {round}). Review the current uncommitted changes again.{}\n\
         End with `VERDICT: APPROVED` or `VERDICT: CHANGES` and the list.",
        check_result.map(|r| format!(" Check result: {r}")).unwrap_or_default()
    )
}

pub fn feedback(review: &str) -> String {
    format!(
        "A reviewer checked your change and asks for these fixes:\n\n{}\n\nFix them, run the check again, then finish with a short summary.",
        super::observe::clip(review, 3000)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn race() -> (NeuralState, Id) {
        let mut n = NeuralState::default();
        let id = create(&mut n, "Fix login", "", None, Some("cargo test".into()), 0);
        let t = get_mut(&mut n, &id).unwrap();
        let mut team = new_team(TeamPattern::Race, &["claude".into(), "codex".into()]);
        team.attempts = vec![attempt("a", "claude", "racer"), attempt("b", "codex", "racer")];
        t.team = Some(team);
        link(&mut n, &id, "a", 1);
        link(&mut n, &id, "b", 1);
        (n, id)
    }

    #[test]
    fn ids_count_up() {
        let mut n = NeuralState::default();
        assert_eq!(create(&mut n, "a", "", None, None, 0), "t1");
        assert_eq!(create(&mut n, "b", "", None, None, 0), "t2");
    }

    #[test]
    fn single_agent_task_goes_to_review() {
        let mut n = NeuralState::default();
        let id = create(&mut n, "Fix login", "tests pass", None, None, 0);
        link(&mut n, &id, "s1", 1);
        assert_eq!(n.tasks[0].status, NeuralTaskStatus::Working);
        assert_eq!(on_agent(&mut n, "s1", ObsKind::Done, 2), Step::Nothing);
        assert_eq!(n.tasks[0].status, NeuralTaskStatus::Review);
        assert!(of_agent(&n, "nobody").is_none());
    }

    #[test]
    fn race_runs_to_completion() {
        let (mut n, id) = race();
        assert_eq!(on_agent(&mut n, "a", ObsKind::Done, 2), Step::Measure { task: id.clone(), sid: "a".into() });
        assert!(!measured(&mut n, &id, "a", 3, 40, 2, Some((true, "ok".into())), 3));
        assert_eq!(on_agent(&mut n, "b", ObsKind::Error, 4), Step::RaceDone { task: id.clone() });
        let t = &n.tasks[0];
        assert_eq!(t.status, NeuralTaskStatus::Review);
        let tm = t.team.as_ref().unwrap();
        assert_eq!(tm.attempts[0].state, AttemptState::Ready);
        assert_eq!(tm.attempts[0].check_ok, Some(true));
        assert_eq!(tm.attempts[1].state, AttemptState::Failed);
    }

    #[test]
    fn review_roles() {
        let mut n = NeuralState::default();
        let id = create(&mut n, "Add cache", "", None, None, 0);
        let t = get_mut(&mut n, &id).unwrap();
        let mut team = new_team(TeamPattern::Review, &["claude".into(), "codex".into()]);
        team.attempts = vec![attempt("b", "claude", "builder"), attempt("r", "codex", "reviewer")];
        t.team = Some(team);
        link(&mut n, &id, "b", 1);
        link(&mut n, &id, "r", 1);
        assert_eq!(on_agent(&mut n, "b", ObsKind::Done, 2), Step::Review { task: id.clone(), builder: "b".into() });
        assert_eq!(on_agent(&mut n, "r", ObsKind::Done, 3), Step::Verdict { task: id.clone(), reviewer: "r".into() });
        assert_eq!(on_agent(&mut n, "r", ObsKind::Done, 4), Step::Nothing, "a second Done without new work is ignored");
    }

    #[test]
    fn verdicts() {
        assert_eq!(verdict("Looks good.\nVERDICT: APPROVED"), Some(true));
        assert_eq!(verdict("1. missing test\nVerdict: changes"), Some(false));
        assert_eq!(verdict("I will end with VERDICT: APPROVED or VERDICT: CHANGES.\n\nVERDICT: CHANGES\n1. x"), Some(false));
        assert_eq!(verdict("no verdict here"), None);
    }

    #[test]
    fn a_restart_cuts_off_tasks_whose_agents_are_gone() {
        let mut n = NeuralState::default();
        let single = create(&mut n, "Fix login", "", None, None, 0);
        link(&mut n, &single, "s1", 1);
        let resumed = create(&mut n, "Resumed", "", None, None, 0);
        link(&mut n, &resumed, "s2", 1);
        let idle = create(&mut n, "Not started", "", None, None, 0);
        let changed = interrupted(&mut n, |sid| sid == "s2", 5);
        assert_eq!(changed, vec!["Fix login".to_string()]);
        assert_eq!(get_mut(&mut n, &single).unwrap().status, NeuralTaskStatus::Blocked);
        assert!(get_mut(&mut n, &single).unwrap().note.contains("restart"));
        assert_eq!(get_mut(&mut n, &resumed).unwrap().status, NeuralTaskStatus::Working, "a resumed agent keeps its task");
        assert_eq!(get_mut(&mut n, &idle).unwrap().status, NeuralTaskStatus::Open);
        assert!(interrupted(&mut n, |_| false, 6).len() == 1, "only the resumed one is left to cut off; never twice");
    }

    #[test]
    fn a_restart_sends_a_race_with_finished_attempts_to_the_pick() {
        let (mut n, id) = race();
        on_agent(&mut n, "a", ObsKind::Done, 2);
        measured(&mut n, &id, "a", 1, 2, 0, Some((true, "ok".into())), 3);
        interrupted(&mut n, |_| false, 4);
        let t = get_mut(&mut n, &id).unwrap();
        assert_eq!(t.status, NeuralTaskStatus::Review);
        let tm = t.team.as_ref().unwrap();
        assert_eq!((tm.attempts[0].state, tm.attempts[1].state), (AttemptState::Ready, AttemptState::Failed));
        assert!(cleanable(t).is_err(), "waits for the pick, not for a clean-up");

        let (mut n, id) = race();
        interrupted(&mut n, |_| false, 4);
        let t = get_mut(&mut n, &id).unwrap();
        assert_eq!(t.status, NeuralTaskStatus::Blocked, "nothing finished: the user decides");
        assert_eq!(cleanable(t).unwrap(), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn clean_up_never_touches_the_kept_attempt() {
        let (mut n, id) = race();
        assert!(cleanable(get_mut(&mut n, &id).unwrap()).is_err(), "still running");
        let t = get_mut(&mut n, &id).unwrap();
        t.status = NeuralTaskStatus::Done;
        t.team.as_mut().unwrap().attempts[0].state = AttemptState::Merged;
        assert_eq!(cleanable(t).unwrap(), vec!["b".to_string()]);
        t.team = None;
        assert!(cleanable(t).is_err());
    }
}
