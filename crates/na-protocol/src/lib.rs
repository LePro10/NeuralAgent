//! Wire types shared by every NeuralAgent component.
//!
//! The daemon is the source of truth. Every client (desktop window, web remote, Android
//! shell, orchestrator) speaks the same messages: requests with ids, a state snapshot followed
//! by sequenced events, and terminal streams with sequence numbers. Locally they travel as
//! JSON over a WebSocket; remotely the same JSON is sealed in E2E envelopes by the relay
//! client. TypeScript types are generated from this file (`cargo test -p na-protocol`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub const PROTOCOL_VERSION: u32 = 1;

pub type Id = String;
/// Milliseconds since the Unix epoch.
pub type Millis = i64;

// ───────────────────────────── envelope ─────────────────────────────

/// Client → daemon.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientMsg {
    Hello {
        v: u32,
        client: ClientInfo,
    },
    Req {
        #[ts(type = "number")]
        id: u64,
        req: Request,
    },
    /// Subscribe to state. With `since` the daemon replays missed events if it still has
    /// them, otherwise it sends a fresh snapshot.
    Sub {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[ts(type = "number")]
        since: Option<u64>,
    },
    Ping {
        #[ts(type = "number")]
        at: Millis,
    },
}

/// Daemon → client.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export)]
pub enum ServerMsg {
    HelloOk {
        v: u32,
        daemon_version: String,
        host: HostInfo,
    },
    Res {
        #[ts(type = "number")]
        id: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        r: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        err: Option<ApiError>,
    },
    Snapshot {
        #[ts(type = "number")]
        seq: u64,
        state: State,
    },
    Ev {
        #[ts(type = "number")]
        seq: u64,
        ev: Event,
    },
    /// Raw terminal output (base64) for an attached session, in order.
    Term {
        sid: Id,
        #[ts(type = "number")]
        seq: u64,
        d: String,
    },
    /// The client fell behind or the stream restarted: reset the terminal and write this.
    TermReset {
        sid: Id,
        snapshot: String,
        #[ts(type = "number")]
        seq: u64,
        cols: u16,
        rows: u16,
    },
    Pong {
        #[ts(type = "number")]
        at: Millis,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClientInfo {
    pub kind: ClientKind,
    /// Human readable, e.g. "MacBook Pro" or "Pixel 9".
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub device_id: Option<Id>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ClientKind {
    Desktop,
    Web,
    Android,
    Orchestrator,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HostInfo {
    pub host_id: Id,
    pub name: String,
    pub os: String,
    pub home: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ErrorCode {
    BadRequest,
    NotFound,
    Conflict,
    Forbidden,
    /// The action needs the user's confirmation; an approval was created.
    NeedsApproval,
    Unavailable,
    Internal,
}

// ───────────────────────────── state ─────────────────────────────

/// Everything a client needs to render. Terminal contents are not part of it (attach).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct State {
    pub workspaces: Vec<Workspace>,
    pub layouts: BTreeMap<Id, WorkspaceLayout>,
    pub sessions: BTreeMap<Id, Session>,
    pub profiles: Vec<Profile>,
    pub catalog: Vec<CatalogEntry>,
    pub settings: Settings,
    /// MCP servers every agent gets (Claude Code, Codex, OpenCode).
    #[serde(default)]
    pub mcp: Vec<McpServer>,
    /// Subscription limits the CLIs last reported (Claude Code, Codex).
    #[serde(default)]
    pub limits: Vec<UsageLimit>,
    /// Remote access through the relay (account, connection, devices). Never holds secrets.
    #[serde(default)]
    pub remote: RemoteState,
}

/// Connection to the relay, as the desktop sees it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RemoteStatus {
    /// Not signed in (remote is invite-only).
    #[default]
    SignedOut,
    /// Signed in, waiting for the admin's approval.
    Pending,
    Denied,
    Blocked,
    /// Approved, but switched off here ("Disconnect remote") or by the admin.
    Off,
    Connecting,
    Online,
    /// Approved and switched on, but the relay cannot be reached right now.
    Offline,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteState {
    pub status: RemoteStatus,
    /// Relay base URL, e.g. `https://agent.neuralhub.dev`.
    pub relay: String,
    /// Switched off on this computer ("Disconnect remote"); the account stays signed in.
    #[serde(default)]
    pub paused: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub account: Option<RemoteAccount>,
    /// The account's devices (this computer included).
    #[serde(default)]
    pub devices: Vec<RemoteDevice>,
    /// This computer's key fingerprint (phones check it when pairing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fingerprint: Option<String>,
    /// Last problem worth showing (sign-in failed, relay unreachable, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteAccount {
    pub email: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteDevice {
    pub id: Id,
    pub name: String,
    /// `macos`, `windows`, `linux`, `android`, `ios` or `web`.
    pub platform: String,
    pub online: bool,
    /// Unix seconds.
    #[ts(type = "number")]
    pub last_seen: i64,
    /// This computer.
    pub this: bool,
}

/// Answer to `RemotePair`: what the QR code shows.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemotePairCode {
    /// Opens the web remote (or the app) and pairs; the code is in the URL fragment.
    pub url: String,
    pub expires_in: u32,
    /// The URL as a QR code (SVG, black on white so every camera reads it in any theme).
    pub svg: String,
}

/// Tokens of model calls. `input` excludes cached input; `cache_read` / `cache_write` are the
/// prompt-cache parts (Codex reports no cache writes).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TokenCounts {
    #[ts(type = "number")]
    pub input: u64,
    #[ts(type = "number")]
    pub output: u64,
    #[ts(type = "number")]
    pub cache_read: u64,
    #[ts(type = "number")]
    pub cache_write: u64,
}

/// What an agent's conversation used so far, from the CLI's transcript.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionUsage {
    pub tokens: TokenCounts,
    /// What it would cost at API prices (USD); missing when a model's price is unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cost_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
}

/// One subscription window, e.g. Claude's 5-hour limit or Codex's weekly limit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UsageLimit {
    /// "claude" or "codex".
    pub engine: String,
    /// "5h", "7d", "7d_opus", ... (`window_minutes` says how long it is when known).
    pub window: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub window_minutes: Option<u32>,
    pub used_percent: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub resets_at: Option<Millis>,
    #[ts(type = "number")]
    pub updated_at: Millis,
}

/// Usage of one model on one day (local time) in one folder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UsageRow {
    /// `YYYY-MM-DD`.
    pub day: String,
    pub engine: String,
    pub model: String,
    /// The workspace whose folder the conversation ran in, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workspace_id: Option<Id>,
    pub tokens: TokenCounts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cost_usd: Option<f64>,
    /// Model calls.
    pub calls: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UsageReport {
    pub rows: Vec<UsageRow>,
    /// Agent time per day (`YYYY-MM-DD` → ms working), from sessions run here.
    #[ts(type = "Record<string, number>")]
    pub busy_ms: BTreeMap<String, i64>,
}

/// An MCP server managed in one place. Values of environment variables and headers are kept by
/// the daemon only (they are often API keys); clients see their names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct McpServer {
    /// Also the server's name inside the agents: letters, digits, `-` and `_`.
    pub id: Id,
    pub enabled: bool,
    pub transport: McpTransport,
    /// Names of the secret values (environment variables for `stdio`, headers for `http`).
    pub secrets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum McpTransport {
    /// A local program the agent starts.
    Stdio { command: String, args: Vec<String> },
    /// A server reached over HTTP (streamable HTTP).
    Http { url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Workspace {
    pub id: Id,
    pub name: String,
    pub path: String,
    /// Orchestrator and phones may start/prompt/stop agents here without asking.
    pub approved: bool,
    pub pinned: bool,
    #[ts(type = "number")]
    pub order: i64,
    #[ts(type = "number")]
    pub created_at: Millis,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub git: Option<GitSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitSummary {
    pub branch: String,
    pub changed: u32,
    pub ahead: u32,
    pub behind: u32,
}

/// Files changed in a workspace (against HEAD) or in an agent's worktree (against where it began).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitChanges {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitFile {
    pub path: String,
    /// Old path of a renamed file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub from: Option<String>,
    pub status: GitFileStatus,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum GitFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GitDiff {
    /// Unified diff text.
    pub text: String,
    /// Cut because it was too long.
    pub truncated: bool,
}

/// Tabs of a workspace, each a split tree of panes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkspaceLayout {
    pub tabs: Vec<Tab>,
    pub active_tab: Id,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Tab {
    pub id: Id,
    pub title: String,
    pub root: LayoutNode,
    pub focused: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub zoomed: Option<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum LayoutNode {
    Split {
        id: Id,
        dir: SplitDir,
        /// Fractions, sum = 1.
        sizes: Vec<f32>,
        children: Vec<LayoutNode>,
    },
    Pane {
        id: Id,
        content: PaneContent,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SplitDir {
    /// Children side by side.
    Row,
    /// Children stacked.
    Column,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum PaneContent {
    Empty,
    Terminal { session: Id },
    Browser { url: String },
}

/// A process in a PTY: an agent CLI or a plain shell.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Session {
    pub id: Id,
    pub workspace_id: Id,
    pub profile_id: Id,
    pub title: String,
    pub cwd: String,
    pub status: AgentStatus,
    #[ts(type = "number")]
    pub status_since: Millis,
    #[ts(type = "number")]
    pub started_at: Millis,
    /// Time spent in `working`, summed (ms).
    #[ts(type = "number")]
    pub busy_ms: i64,
    pub cols: u16,
    pub rows: u16,
    pub alive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exit_code: Option<i32>,
    /// The CLI's own conversation id, used for resume.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub engine_session: Option<String>,
    /// Last meaningful line of output (plain text).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_line: Option<String>,
    /// Last assistant message (from hooks/transcripts), shortened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_message: Option<String>,
    /// The first prompt, shortened; good for titles and the dashboard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub worktree: Option<WorktreeInfo>,
    /// Last local web address it printed (a dev server), for the preview pane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub preview_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub usage: Option<SessionUsage>,
    /// Where the status comes from.
    pub status_source: StatusSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AgentStatus {
    Starting,
    Working,
    /// Needs the user: a permission prompt or a question.
    Waiting,
    /// Finished its turn; ready for the next prompt.
    Done,
    Error,
    /// Shell or agent without activity.
    Idle,
    Exited,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum StatusSource {
    Hooks,
    Output,
    Process,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub base: String,
}

/// How to launch something in a PTY. Built-ins come from the catalog; users add their own.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Profile {
    pub id: Id,
    pub name: String,
    /// Catalog engine id (`claude`, `codex`, …) or `shell` / `custom`.
    pub engine: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    /// lucide icon name or an engine logo id.
    pub icon: String,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub command: String,
    pub installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<String>,
    /// Install command for this OS, shown before it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub install: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub install_note: Option<String>,
    pub docs_url: String,
    pub hooks: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Settings {
    pub keep_awake: KeepAwake,
    pub resume_on_start: bool,
    pub theme: String,
    pub discord_presence: DiscordPresence,
    pub default_profile: Id,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            keep_awake: KeepAwake::WhileWorking,
            resume_on_start: true,
            theme: "ice".into(),
            discord_presence: DiscordPresence::General,
            default_profile: "claude".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum KeepAwake {
    Off,
    WhileWorking,
    WhileWorkingOnPower,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DiscordPresence {
    Off,
    General,
    Detailed,
}

// ───────────────────────────── events ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "e", rename_all = "snake_case")]
#[ts(export)]
// Events are built, sent and dropped right away; boxing the big ones buys nothing.
#[allow(clippy::large_enum_variant)]
pub enum Event {
    WorkspaceUpsert {
        workspace: Workspace,
    },
    WorkspaceRemoved {
        id: Id,
    },
    LayoutSet {
        workspace_id: Id,
        layout: WorkspaceLayout,
    },
    SessionUpsert {
        session: Session,
    },
    SessionRemoved {
        id: Id,
    },
    ProfilesSet {
        profiles: Vec<Profile>,
    },
    McpSet {
        servers: Vec<McpServer>,
    },
    LimitsSet {
        limits: Vec<UsageLimit>,
    },
    RemoteSet {
        remote: RemoteState,
    },
    CatalogSet {
        catalog: Vec<CatalogEntry>,
    },
    SettingsSet {
        settings: Settings,
    },
    /// Something the user should notice (agent done / needs input / error).
    Attention {
        session_id: Id,
        kind: AttentionKind,
        text: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AttentionKind {
    Done,
    Waiting,
    Error,
}

// ───────────────────────────── requests ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "m", content = "p", rename_all = "snake_case")]
#[ts(export)]
pub enum Request {
    // workspaces
    WorkspaceAdd {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
    },
    WorkspaceUpdate {
        id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        approved: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pinned: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[ts(type = "number")]
        order: Option<i64>,
    },
    WorkspaceRemove {
        id: Id,
    },
    // layout
    LayoutSet {
        workspace_id: Id,
        layout: WorkspaceLayout,
    },
    // sessions
    SessionStart(StartSession),
    SessionStop {
        id: Id,
    },
    SessionClose {
        id: Id,
    },
    SessionRestart {
        id: Id,
    },
    SessionRename {
        id: Id,
        title: String,
    },
    /// Type a prompt into an agent and press Enter.
    SessionPrompt {
        id: Id,
        text: String,
    },
    // terminals
    TermAttach {
        sid: Id,
    },
    TermDetach {
        sid: Id,
    },
    TermWrite {
        sid: Id,
        data: String,
    },
    TermResize {
        sid: Id,
        cols: u16,
        rows: u16,
    },
    // profiles / catalog
    ProfileSave {
        profile: Profile,
    },
    ProfileDelete {
        id: Id,
    },
    CatalogRefresh,
    // settings
    SettingsSet {
        settings: Settings,
    },
    // filesystem (read-only browsing, for picking folders)
    FsList {
        path: String,
    },
    // git: a workspace, or with `session_id` that agent's worktree
    GitChanges {
        workspace_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        session_id: Option<Id>,
    },
    GitDiff {
        workspace_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        session_id: Option<Id>,
        /// One file, or everything.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        path: Option<String>,
    },
    /// Commit what the agent changed in its worktree, merge its branch into the workspace's
    /// branch, remove the worktree and close the session. Returns a short message.
    WorktreeMerge {
        session_id: Id,
    },
    /// Stop the agent and throw its worktree and branch away.
    WorktreeDiscard {
        session_id: Id,
    },
    // MCP servers. `values` sets secret values by name (others are kept; names no longer in
    // `server.secrets` are dropped).
    McpSave {
        server: McpServer,
        #[serde(default)]
        values: BTreeMap<String, String>,
    },
    McpDelete {
        id: Id,
    },
    /// Copy the servers configured in Claude Code (`~/.claude.json`) and Codex
    /// (`~/.codex/config.toml`) that are not here yet. Returns how many were added.
    McpImport,
    /// Token use and cost of Claude Code and Codex conversations of the last `days` days
    /// (1 = today). Returns `UsageReport`.
    UsageReport {
        days: u32,
    },
    // remote access (desktop only)
    /// Starts a sign-in in the system browser; returns the URL to open. `message` is the
    /// optional "Why do you want access?" for a new request.
    RemoteSignIn {
        provider: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        message: Option<String>,
    },
    RemoteSignOut,
    /// Signs out every device of the account (this one too).
    RemoteSignOutEverywhere,
    /// "Disconnect remote": `false` closes the relay connection at once and keeps it closed.
    RemoteEnable {
        enabled: bool,
    },
    /// "Add phone": a one-time code (2 minutes, this account only). Returns `RemotePairCode`.
    RemotePair,
    RemoteRevoke {
        device_id: Id,
    },
    // past agent conversations (Claude Code, Codex) on this computer, newest first
    HistorySearch {
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        limit: Option<u32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StartSession {
    pub workspace_id: Id,
    pub profile_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prompt: Option<String>,
    /// Pane that should show the new session; created if missing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pane_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rows: Option<u16>,
    /// Continue a previous CLI conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub resume: Option<String>,
    /// Folder inside the workspace to run in (default: the workspace folder). CLIs keep their
    /// conversations per folder, so resuming needs the original one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub worktree: Option<bool>,
}

// ───────────────────────────── responses ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AttachResult {
    /// ANSI that reproduces scrollback + screen + modes.
    pub snapshot: String,
    #[ts(type = "number")]
    pub seq: u64,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HistoryEntry {
    /// Catalog id of the CLI ("claude", "codex"); resume with `StartSession.resume = id`.
    pub engine: Id,
    pub id: String,
    pub cwd: String,
    pub title: String,
    /// The prompt that matched the query, shortened around the match.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub snippet: Option<String>,
    pub prompts: u32,
    #[ts(type = "number")]
    pub updated_at: Millis,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub git: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_wire_format_is_stable() {
        let r = Request::TermWrite { sid: "s1".into(), data: "ls\r".into() };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v, serde_json::json!({"m":"term_write","p":{"sid":"s1","data":"ls\r"}}));
        let back: Request = serde_json::from_value(v).unwrap();
        assert!(matches!(back, Request::TermWrite { .. }));
    }

    #[test]
    fn client_msg_round_trip() {
        let m = ClientMsg::Req { id: 3, req: Request::CatalogRefresh };
        let s = serde_json::to_string(&m).unwrap();
        assert_eq!(s, r#"{"t":"req","id":3,"req":{"m":"catalog_refresh"}}"#);
    }
}
