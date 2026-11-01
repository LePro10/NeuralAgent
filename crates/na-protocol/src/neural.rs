//! Neural's own working state (D61–D64, docs/notes/neural-v2.md): the tasks it follows up,
//! what it noticed about agents, what it remembers about the user, and actions waiting for the
//! user's OK. Part of the snapshot as `State.neural`; live updates arrive as
//! `host_notice { topic: "neural", data: NeuralState }` so older clients ignore them.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Id, Millis};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeuralState {
    #[serde(default)]
    pub mode: NeuralMode,
    /// Goals Neural follows up until they are done, oldest first.
    #[serde(default)]
    pub tasks: Vec<NeuralTask>,
    /// What Neural remembers about the user (preferences, projects), oldest first.
    #[serde(default)]
    pub notes: Vec<NeuralNote>,
    /// What Neural noticed about agents (the last 40), oldest first.
    #[serde(default)]
    pub observations: Vec<NeuralObs>,
    /// Actions Neural wants to take that need the user's OK.
    #[serde(default)]
    pub pending: Vec<NeuralPending>,
    /// Older conversation, compacted into a few sentences (what the model sees instead).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[ts(as = "Option<String>", optional)]
    pub summary: String,
    /// Conversation messages up to this time are in `summary`.
    #[serde(default)]
    #[ts(type = "number")]
    pub summary_upto: Millis,
}

/// How much Neural speaks on its own.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum NeuralMode {
    /// Reports when something matters, follows up its tasks, allows safe prompts of its agents.
    #[default]
    Active,
    /// Only what needs the user: questions, errors, finished tasks.
    Quiet,
    /// Answers only when asked.
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeuralTask {
    /// Short: `t1`, `t2`, …
    pub id: Id,
    pub title: String,
    /// What "done" means, in the user's words.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[ts(as = "Option<String>", optional)]
    pub done_when: String,
    pub status: NeuralTaskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workspace_id: Option<Id>,
    /// Agents working on it (session ids), in start order.
    #[serde(default)]
    pub agents: Vec<Id>,
    /// A command that checks the work (`cargo test`, `pnpm test`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub check: Option<String>,
    /// Neural's latest word on it ("Tests pass; waiting for your OK to merge").
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[ts(as = "Option<String>", optional)]
    pub note: String,
    /// Set when the task is a team (race or build + review).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub team: Option<NeuralTeam>,
    #[ts(type = "number")]
    pub created_at: Millis,
    #[ts(type = "number")]
    pub updated_at: Millis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum NeuralTaskStatus {
    /// Planned, nothing started yet.
    Open,
    Working,
    /// Agents are done; Neural (or the user) checks the result.
    Review,
    /// Needs the user (a question, a failed check, a decision).
    Blocked,
    Done,
    Failed,
}

impl NeuralTaskStatus {
    pub fn finished(self) -> bool {
        matches!(self, Self::Done | Self::Failed)
    }
}

/// A team Neural coordinates (replaces the free-form swarm, D62).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeuralTeam {
    pub pattern: TeamPattern,
    /// The agent types asked for (race: one per contestant; review: builder, reviewer).
    #[serde(default)]
    pub profiles: Vec<Id>,
    /// One per agent: race contestants, or builder then reviewer.
    pub attempts: Vec<NeuralAttempt>,
    /// Build + review: review rounds so far.
    #[serde(default)]
    pub round: u32,
    /// Race: the attempt the user picked (its session id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub winner: Option<Id>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TeamPattern {
    /// The same brief to several agents, each in its own worktree; the user picks the best.
    Race,
    /// A builder, and a reviewer of another engine that checks every round.
    Review,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeuralAttempt {
    pub session_id: Id,
    pub profile_id: Id,
    /// `builder`, `reviewer` or `racer`.
    pub role: String,
    pub state: AttemptState,
    /// The check's result in this attempt's folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub check_ok: Option<bool>,
    /// Last lines of the check's output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub check_out: Option<String>,
    #[serde(default)]
    pub files: u32,
    #[serde(default)]
    pub additions: u32,
    #[serde(default)]
    pub deletions: u32,
    /// Reviewer: the verdict of the last round (`approved`, `changes`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub verdict: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AttemptState {
    Working,
    /// Finished its turn; the check may still run.
    Done,
    Checking,
    /// Done and measured (check run if there is one).
    Ready,
    Failed,
    /// Thrown away (race loser, stopped).
    Dropped,
    /// Race winner, merged.
    Merged,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeuralNote {
    pub id: Id,
    pub text: String,
    #[ts(type = "number")]
    pub at: Millis,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeuralObs {
    pub id: Id,
    #[ts(type = "number")]
    pub at: Millis,
    pub kind: ObsKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub task_id: Option<Id>,
    /// "Japan Map — Claude needs input: wants to run `pnpm test`" (agent events keep the shape
    /// of the old chat notices: `<label> finished|needs input|stopped with an error[: text]`).
    pub text: String,
    /// The model has been shown it.
    #[serde(default)]
    pub seen: bool,
    /// Coalesced repeats (same agent and kind within a minute).
    #[serde(default, skip_serializing_if = "is_one")]
    #[ts(as = "Option<u32>", optional)]
    pub count: u32,
}

fn is_one(n: &u32) -> bool {
    *n <= 1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ObsKind {
    Started,
    Done,
    Waiting,
    Error,
    Exited,
    /// Working without new output for a long time.
    Stuck,
    CheckPassed,
    CheckFailed,
    /// Neural allowed a safe permission prompt of one of its agents.
    Allowed,
    /// A team moved on (reviewer started, feedback sent, race complete).
    Team,
}

/// An action Neural wants to take that needs the user's OK (destructive or unusual).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeuralPending {
    pub id: Id,
    #[ts(type = "number")]
    pub at: Millis,
    /// Plain words: "Send Japan Map — Claude: “delete the build folder…”".
    pub title: String,
    /// The exact command or text.
    pub detail: String,
    /// The tool call to run on Allow (`{ "name": …, "args": … }`).
    #[ts(type = "unknown")]
    pub action: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session_id: Option<Id>,
}
