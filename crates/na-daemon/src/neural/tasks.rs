//! Neural's tasks: linking agents and status changes on agent events. Pure.

use na_protocol::{Id, Millis, NeuralState, NeuralTask, NeuralTaskStatus, ObsKind};

/// Tasks kept: finished ones are dropped oldest first beyond this.
const KEEP: usize = 30;

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

/// Updates the task of an agent for an agent event.
pub fn on_agent(n: &mut NeuralState, sid: &str, kind: ObsKind, now: Millis) {
    let Some(id) = of_agent(n, sid).map(|t| t.id.clone()) else { return };
    let t = get_mut(n, &id).expect("task exists");
    t.updated_at = now;
    match kind {
        ObsKind::Started if t.status == NeuralTaskStatus::Open => t.status = NeuralTaskStatus::Working,
        ObsKind::Done if t.status == NeuralTaskStatus::Working => t.status = NeuralTaskStatus::Review,
        _ => {}
    }
}

/// Tasks still "working" whose agents did not survive a restart: cut off, Blocked with a note.
/// `alive`: the agent runs now (it may have been resumed). Returns the titles of the tasks it changed.
pub fn interrupted(n: &mut NeuralState, alive: impl Fn(&str) -> bool, now: Millis) -> Vec<String> {
    const NOTE: &str = "Cut off by a restart of NeuralAgent: its agents stopped.";
    let mut changed = vec![];
    for t in n.tasks.iter_mut().filter(|t| t.status == NeuralTaskStatus::Working && !t.agents.is_empty()) {
        if t.agents.iter().any(|a| alive(a)) {
            continue;
        }
        t.status = NeuralTaskStatus::Blocked;
        t.note = format!("{NOTE} Ask Neural to start again, or drop it.");
        t.updated_at = now;
        changed.push(t.title.clone());
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

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
        on_agent(&mut n, "s1", ObsKind::Done, 2);
        assert_eq!(n.tasks[0].status, NeuralTaskStatus::Review);
        assert!(of_agent(&n, "nobody").is_none());
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
}
