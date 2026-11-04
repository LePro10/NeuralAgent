//! Autopilot (D87, docs/notes/autopilot.md): one project agent per workspace that looks after the
//! project on its own. It reads sources through connectors (Discord, GitHub, a browser, the
//! user's own APIs), keeps an inbox, starts coding agents in the project and drafts answers, all
//! by the user's playbook. Part of the snapshot as `State.autopilot`; live updates arrive as
//! `host_notice { topic: "autopilot", data: AutopilotState }`. Requests are one variant,
//! `Request::Autopilot { op }`, gated by the daemon feature "autopilot".

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::{Id, Millis};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AutopilotState {
    /// One per workspace that has an autopilot, in creation order.
    #[serde(default)]
    pub pilots: Vec<Pilot>,
    /// Inbox of every pilot, newest first (the last 200 per pilot).
    #[serde(default)]
    pub items: Vec<InboxItem>,
    /// Chat with the pilots, oldest first (the last 200 per pilot).
    #[serde(default)]
    pub messages: Vec<PilotMessage>,
    /// Actions waiting for the user's OK.
    #[serde(default)]
    pub pending: Vec<PilotPending>,
    /// Changes to a playbook the pilot proposes (only the user can apply them).
    #[serde(default)]
    pub suggestions: Vec<PilotSuggestion>,
    /// Installed connectors plus the built-in ones (built-in ones not set up yet have
    /// `status: needs_setup`).
    #[serde(default)]
    pub connectors: Vec<Connector>,
    /// The browser extension (the "Browser" connector).
    #[serde(default)]
    pub browser: BrowserLink,
}

// ───────────────────────────── pilots ─────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Pilot {
    pub id: Id,
    pub workspace_id: Id,
    pub name: String,
    /// Off: no routines, no events; the chat still answers.
    pub enabled: bool,
    pub status: PilotStatus,
    /// What it is doing right now, in a few words ("Reading Discord").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub activity: Option<String>,
    pub playbook: Playbook,
    /// False until the setup conversation ended or the user saved a playbook.
    pub setup_done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub last_run: Option<Millis>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub next_run: Option<Millis>,
    #[ts(type = "number")]
    pub created: Millis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PilotStatus {
    Idle,
    Working,
    /// Waits for the user (a confirmation, a draft to send).
    NeedsYou,
    Off,
    /// No model key, a connector down, …: see `activity`.
    Error,
}

/// The user's instructions. Structured parts are enforced by code (schedule, rules); the prose
/// parts guide the model. Only the user changes it; the pilot can only propose (`PilotSuggestion`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Playbook {
    /// What the project is and what the pilot should achieve.
    #[serde(default)]
    pub mission: String,
    /// How to work: what to do with a bug, a question, a feature wish, … (free text).
    #[serde(default)]
    pub instructions: String,
    /// How to talk to people (language, tone, signature).
    #[serde(default)]
    pub tone: String,
    #[serde(default)]
    pub routines: Vec<Routine>,
    /// Connectors this pilot uses and what of them.
    #[serde(default)]
    pub sources: Vec<SourceUse>,
    /// Exceptions to the defaults per tool class (read: auto, write/external: ask).
    #[serde(default)]
    pub rules: Vec<ToolRule>,
    #[serde(default)]
    pub notify: NotifyLevel,
}

/// A job on a schedule ("every 6 hours: read new Reddit posts about the app").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Routine {
    pub id: Id,
    pub task: String,
    pub schedule: Schedule,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum Schedule {
    /// Every `minutes` (at least 5).
    Every { minutes: u32 },
    /// Every day at `at` ("09:00", local time).
    Daily { at: String },
    /// Every week on `day` (0 = Monday) at `at`.
    Weekly { day: u8, at: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SourceUse {
    pub connector_id: Id,
    /// New events of this connector (a Discord message, a new report) land in the inbox.
    pub listen: bool,
    /// Connector-specific narrowing (channels, repositories, subreddits).
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub scope: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolRule {
    /// None: a built-in tool of the pilot (`start_agent`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connector_id: Option<Id>,
    /// A tool name, or "*" for all tools of the connector.
    pub tool: String,
    pub allow: Allow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Allow {
    /// The pilot does it on its own (logged).
    Auto,
    /// The pilot asks first (`PilotPending`).
    Ask,
    /// Never offered to the model.
    Never,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum NotifyLevel {
    /// A push for everything that lands in the inbox.
    All,
    /// A push only when it needs the user (confirmation, draft, error).
    #[default]
    NeedsYou,
    Never,
}

// ───────────────────────────── inbox ─────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InboxItem {
    pub id: Id,
    pub pilot_id: Id,
    /// Connector id, or "routine" / "chat".
    pub source: String,
    pub kind: ItemKind,
    pub title: String,
    /// The triage summary (written without tools, from the original).
    pub summary: String,
    /// The text from outside, clipped. Untrusted: shown as data, never as instructions.
    #[serde(default)]
    pub original: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub url: Option<String>,
    pub status: ItemStatus,
    /// 0 low … 3 urgent.
    pub urgency: u8,
    /// What the pilot did about it, oldest first.
    #[serde(default)]
    pub steps: Vec<ItemStep>,
    /// The coding agent working on it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session_id: Option<Id>,
    /// An answer waiting to be sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub draft: Option<Draft>,
    #[ts(type = "number")]
    pub created: Millis,
    #[ts(type = "number")]
    pub updated: Millis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ItemKind {
    Bug,
    Question,
    Feedback,
    Idea,
    Task,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ItemStatus {
    New,
    Working,
    NeedsYou,
    Done,
    Dismissed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ItemStep {
    #[ts(type = "number")]
    pub at: Millis,
    pub text: String,
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Draft {
    pub text: String,
    /// The connector tool that sends it (`reply`), with its arguments besides the text.
    pub connector_id: Id,
    pub tool: String,
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub args: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PilotMessage {
    pub id: Id,
    pub pilot_id: Id,
    pub role: PilotRole,
    pub text: String,
    #[ts(type = "number")]
    pub at: Millis,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item_id: Option<Id>,
    /// Written on its own (a routine, an event), not as an answer.
    #[serde(default)]
    pub proactive: bool,
    /// Tool steps of this answer, in words ("Read 12 Discord messages").
    #[serde(default)]
    pub steps: Vec<String>,
    /// A connector this message is about (the pilot started building or set it up). The app shows
    /// a live card for it: build progress, the setup form, test result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connector_id: Option<Id>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PilotRole {
    User,
    Pilot,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PilotPending {
    pub id: Id,
    pub pilot_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item_id: Option<Id>,
    /// None for a built-in tool.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connector_id: Option<Id>,
    pub tool: String,
    /// In plain words what will happen ("Reply in #support: …").
    pub summary: String,
    #[ts(type = "unknown")]
    pub args: Value,
    #[ts(type = "number")]
    pub created: Millis,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PilotSuggestion {
    pub id: Id,
    pub pilot_id: Id,
    /// Why ("I answered the same question 5 times").
    pub reason: String,
    /// The whole playbook as it would be after the change.
    pub playbook: Playbook,
    #[ts(type = "number")]
    pub created: Millis,
}

// ───────────────────────────── connectors ─────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Connector {
    /// Folder name under `<home>/connectors/`.
    pub id: Id,
    pub manifest: ConnectorManifest,
    /// Shipped with NeuralAgent (cannot be edited, only set up).
    pub builtin: bool,
    pub enabled: bool,
    pub status: ConnectorStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    /// Values of the non-secret setup fields.
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub config: BTreeMap<String, Value>,
    /// Secret fields that have a value (never the values).
    #[serde(default)]
    pub secrets_set: Vec<String>,
    /// Tools the running server reports, with the class from the manifest.
    #[serde(default)]
    pub tools: Vec<ConnectorTool>,
    /// The coding agent building or changing it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub build_session: Option<Id>,
    /// The last build or change ended without a working result (`error` says why).
    #[serde(default)]
    pub build_stopped: bool,
    /// A last working version is kept and can be restored.
    #[serde(default)]
    pub can_restore: bool,
    /// What the user last asked an agent to build or change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_request: Option<String>,
    /// Things worth knowing while it runs, e.g. a tool that was skipped because its schema is unusable.
    #[serde(default)]
    pub warnings: Vec<String>,
    /// Folder on disk (for "Open folder").
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ConnectorStatus {
    /// Required setup fields are missing.
    NeedsSetup,
    Off,
    Starting,
    Running,
    Error,
    /// A coding agent is building it.
    Building,
}

/// `connector.json` in the connector's folder.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectorManifest {
    pub name: String,
    /// A lucide icon name ("message-circle") or a brand ("discord", "github", "reddit").
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub kind: ConnectorKind,
    #[serde(default)]
    pub version: String,
    /// The form the app draws for it.
    #[serde(default)]
    pub setup: Vec<SetupField>,
    /// Numbered steps shown above the form (Markdown, links allowed).
    #[serde(default)]
    pub guide: Vec<String>,
    /// Tool name → class. A tool missing here counts as `external`.
    #[serde(default)]
    #[ts(type = "Record<string, import('./ToolClass').ToolClass>")]
    pub tools: BTreeMap<String, ToolClass>,
    /// Event types it reports (`notifications/neuralagent/event`).
    #[serde(default)]
    pub events: Vec<String>,
    /// A read tool that proves the setup works ("whoami").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub check: Option<String>,
    /// For sources without push: call `tool` every `minutes`; it returns new events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub poll: Option<Poll>,
    /// How to start it; default `node index.mjs` in its folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub run: Option<RunSpec>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ConnectorKind {
    /// Stays connected and reports events (Discord, Telegram).
    #[default]
    Service,
    /// Wraps an HTTP API (the user's own app).
    Api,
    /// Pages through the browser extension.
    Browser,
    /// Polls a feed.
    Feed,
    /// Any existing MCP server, without a manifest of its own.
    Mcp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SetupField {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: FieldKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub help: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub link: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub required: bool,
    /// For `pick`: a read tool returning `[{ value, label }]` (needs the earlier fields).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub from: Option<String>,
    /// For `pick` without `from`, and `select`.
    #[serde(default)]
    pub options: Vec<FieldOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "unknown")]
    pub default: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FieldKind {
    Text,
    /// Stored owner-only, reaches the connector as an environment variable only.
    Secret,
    Url,
    Number,
    Bool,
    /// One value from a list.
    Select,
    /// Several values from a list (channels, repositories).
    Pick,
    /// Free list of strings (subreddits, keywords).
    List,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FieldOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ToolClass {
    /// Only reads (default: the pilot may on its own).
    Read,
    /// Changes something of the user's (a label, a dashboard entry; default: ask).
    Write,
    /// Speaks to other people or the public (a reply, a post; default: ask).
    External,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Poll {
    pub tool: String,
    pub minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectorTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub class: ToolClass,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectorTestResult {
    pub ok: bool,
    pub steps: Vec<TestStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TestStep {
    pub label: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BrowserLink {
    pub connected: bool,
    /// "Chrome 141 on macOS".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub browser: Option<String>,
}

// ───────────────────────────── requests ─────────────────────────────

/// `Request::Autopilot { op }`. Answers in brackets.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "op", rename_all = "snake_case")]
#[ts(export)]
pub enum AutopilotOp {
    /// A pilot for this workspace; it starts the setup conversation. [Pilot]
    PilotCreate {
        workspace_id: Id,
    },
    /// Rename, switch on/off, or save the playbook (also marks the setup done). [Pilot]
    PilotUpdate {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        enabled: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        playbook: Option<Playbook>,
    },
    PilotRemove {
        id: Id,
    },
    /// A chat message ("look at all new Discord messages"). [null]
    PilotSend {
        id: Id,
        text: String,
    },
    /// Run a routine now (or, without one, "check everything now"). [null]
    PilotRun {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        routine_id: Option<Id>,
    },
    /// Stop the current turn. [null]
    PilotStop {
        id: Id,
    },
    /// Set an item's status, or edit its draft. [InboxItem]
    ItemUpdate {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        status: Option<ItemStatus>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        draft: Option<String>,
    },
    /// Send the item's draft (the user's OK). [null]
    ItemSend {
        id: Id,
    },
    /// Allow or deny a `PilotPending`. [null]
    Confirm {
        id: Id,
        allow: bool,
    },
    /// Apply or drop a `PilotSuggestion`. [null]
    SuggestionDecide {
        id: Id,
        accept: bool,
    },
    /// A new connector built by a coding agent from a description. [Connector]
    ConnectorCreate {
        name: String,
        description: String,
        /// The agent profile that builds it (absent: the default one).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        profile: Option<Id>,
    },
    /// Let a coding agent change a connector the user made. [Connector]
    ConnectorChange {
        id: Id,
        request: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        profile: Option<Id>,
    },
    /// Back to the template; setup values and secrets stay. Needs feature `connector_recover`. [Connector]
    ConnectorReset {
        id: Id,
    },
    /// Back to the last working version, if one is kept. Needs feature `connector_recover`. [Connector]
    ConnectorRestore {
        id: Id,
    },
    /// Run the build again with the last request. Needs feature `connector_recover`. [Connector]
    ConnectorRetry {
        id: Id,
    },
    /// Add an existing MCP server or connector folder. [Connector]
    ConnectorImport {
        path: String,
    },
    /// Save setup values; `secrets` with an empty string removes one. [Connector]
    ConnectorConfigure {
        id: Id,
        #[serde(default)]
        #[ts(type = "Record<string, unknown>")]
        config: BTreeMap<String, Value>,
        #[serde(default)]
        secrets: BTreeMap<String, String>,
    },
    ConnectorEnable {
        id: Id,
        enabled: bool,
    },
    /// Start it, list its tools, run its check. [ConnectorTestResult]
    ConnectorTest {
        id: Id,
    },
    /// Choices for a `pick` field, from the connector. [FieldOption[]]
    ConnectorOptions {
        id: Id,
        field: String,
    },
    /// Its last log lines. [string[]]
    ConnectorLogs {
        id: Id,
    },
    ConnectorRemove {
        id: Id,
    },
    /// A one-time code the browser extension asks for (valid 10 minutes). [string]
    BrowserPair,
    BrowserUnpair,
}
