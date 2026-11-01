//! When Neural speaks on its own: which observations wake it, batching and throttling.
//! Pure (time is passed in), see docs/notes/neural-v2.md → Proactivity.

use std::collections::VecDeque;

use na_protocol::{Id, Millis, NeuralMode, ObsKind};

/// Wait this long after the first reason, so one wake covers what piles up.
pub const BATCH_MS: Millis = 8_000;
/// At least this long between two wakes.
pub const GAP_MS: Millis = 45_000;
/// At most this many wakes per hour.
pub const PER_HOUR: usize = 12;

/// Whether an observation is worth waking Neural for (else it only shows up in the next turn's
/// digest). `tracked`: the agent works on one of Neural's tasks.
pub fn wakes(kind: ObsKind, tracked: bool, mode: NeuralMode) -> bool {
    if mode == NeuralMode::Off || !tracked {
        return false;
    }
    match kind {
        ObsKind::Done | ObsKind::Waiting | ObsKind::Error | ObsKind::CheckFailed | ObsKind::Team => true,
        ObsKind::Stuck => mode == NeuralMode::Active,
        ObsKind::Started | ObsKind::Exited | ObsKind::CheckPassed | ObsKind::Allowed => false,
    }
}

#[derive(Default, Debug)]
pub struct Pulse {
    queue: Vec<Id>,
    first_at: Option<Millis>,
    last_wake: Option<Millis>,
    recent: VecDeque<Millis>,
}

impl Pulse {
    /// An observation that should wake Neural.
    pub fn add(&mut self, obs: Id, now: Millis) {
        if !self.queue.contains(&obs) {
            self.queue.push(obs);
        }
        self.first_at.get_or_insert(now);
    }

    /// Forget reasons the model has seen in the meantime (a user turn showed them).
    pub fn retain(&mut self, mut unseen: impl FnMut(&Id) -> bool) {
        self.queue.retain(|id| unseen(id));
        if self.queue.is_empty() {
            self.first_at = None;
        }
    }

    #[cfg(test)]
    pub fn pending(&self) -> usize {
        self.queue.len()
    }

    /// The batch to wake up for now, if any. `busy`: a turn runs (the user talks to Neural).
    pub fn due(&mut self, now: Millis, busy: bool) -> Option<Vec<Id>> {
        let first = self.first_at?;
        if busy || now - first < BATCH_MS || self.last_wake.is_some_and(|t| now - t < GAP_MS) {
            return None;
        }
        while self.recent.front().is_some_and(|t| now - t > 3_600_000) {
            self.recent.pop_front();
        }
        if self.recent.len() >= PER_HOUR {
            return None;
        }
        self.recent.push_back(now);
        self.last_wake = Some(now);
        self.first_at = None;
        Some(std::mem::take(&mut self.queue))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_tracked_work_wakes() {
        assert!(wakes(ObsKind::Done, true, NeuralMode::Active));
        assert!(!wakes(ObsKind::Done, false, NeuralMode::Active), "other agents only go to the digest");
        assert!(!wakes(ObsKind::Waiting, true, NeuralMode::Off));
        assert!(!wakes(ObsKind::Stuck, true, NeuralMode::Quiet), "quiet: only what needs the user");
        assert!(wakes(ObsKind::Waiting, true, NeuralMode::Quiet));
        assert!(!wakes(ObsKind::Allowed, true, NeuralMode::Active));
    }

    #[test]
    fn batches_and_throttles() {
        let mut p = Pulse::default();
        p.add("a".into(), 0);
        assert_eq!(p.due(1_000, false), None, "waits for the batch");
        p.add("b".into(), 2_000);
        p.add("b".into(), 2_500);
        assert_eq!(p.due(BATCH_MS, true), None, "not while the user talks to Neural");
        assert_eq!(p.due(BATCH_MS, false), Some(vec!["a".to_string(), "b".to_string()]));
        p.add("c".into(), BATCH_MS + 1_000);
        assert_eq!(p.due(BATCH_MS + 20_000, false), None, "too soon after the last wake");
        assert_eq!(p.due(BATCH_MS + GAP_MS, false), Some(vec!["c".to_string()]));
    }

    #[test]
    fn hourly_cap() {
        let mut p = Pulse::default();
        let mut t = 0;
        let mut woke = 0;
        for i in 0..30 {
            p.add(format!("o{i}"), t);
            t += GAP_MS + BATCH_MS;
            if p.due(t, false).is_some() {
                woke += 1;
            }
        }
        assert_eq!(woke, PER_HOUR, "30 reasons in 27 minutes: capped");
        assert!(p.pending() > 0, "the rest waits for the next free slot");
    }

    #[test]
    fn seen_reasons_are_dropped() {
        let mut p = Pulse::default();
        p.add("a".into(), 0);
        p.retain(|_| false);
        assert_eq!(p.due(BATCH_MS * 2, false), None);
    }
}
