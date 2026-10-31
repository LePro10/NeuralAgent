//! Claude view: the structured conversation of a Claude Code session, read from its transcript
//! by the daemon. The CLI keeps running in its PTY; clients render these messages and type
//! into the PTY.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CvRole {
    User,
    Assistant,
    #[default]
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "k", rename_all = "snake_case")]
#[ts(export)]
#[allow(clippy::large_enum_variant)]
pub enum CvBlock {
    Text {
        text: String,
    },
    Thinking {
        text: String,
        /// How long Claude thought (`thinkingDurationMs` of the line), when the CLI wrote it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[ts(type = "number")]
        ms: Option<u64>,
    },
    ToolUse {
        id: String,
        name: String,
        #[ts(type = "unknown")]
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        text: String,
        is_error: bool,
        /// Images in the result (a `Read` of a picture, screenshots from MCP tools): references,
        /// the bytes come from `cv_image`.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(as = "Option<Vec<CvImage>>", optional)]
        images: Vec<CvImage>,
        /// Structured details the CLI keeps next to the result (`toolUseResult`), whitelisted and clipped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        meta: Option<CvToolMeta>,
    },
    /// The final word of a background task (agent, shell, monitor): a `<task-notification>`.
    /// Usually merged by the UI into the card of `tool_use_id`; shown alone when there is none.
    TaskNote {
        task_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        tool_use_id: Option<String>,
        /// `completed`, `failed`, `killed`, `stopped`.
        status: String,
        /// One line ("Agent \"Fix the build\" finished", "Background command \"npm test\" completed").
        summary: String,
        /// The agent's final report (markdown), clipped. Empty for shells.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(as = "Option<String>", optional)]
        result: String,
        /// `agent` when the task is a subagent, `bash` for a background command (from the id shape).
        kind: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[ts(type = "number")]
        tokens: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        tool_count: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[ts(type = "number")]
        duration_ms: Option<u64>,
        /// The task's output file (readable with `cv_task_output`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        output_file: Option<String>,
    },
    /// `!` shell mode: a command the user ran directly, and its output once it is there.
    Shell {
        command: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        stdout: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        stderr: Option<String>,
    },
    /// Text the user pasted (`<pasted_content>`): shown folded.
    Pasted {
        text: String,
        lines: u32,
    },
    /// Something a hook said: a system message, an error, a blocked stop, a cancelled tool.
    Hook {
        /// `PostToolUse`, `Stop`, … (or the hook's name).
        event: String,
        text: String,
        /// An error, or the hook stopped Claude from going on.
        error: bool,
    },
    /// An API error the CLI wrote as an assistant message (rate limit, refusal, server error).
    Error {
        text: String,
        /// `rate_limit`, `invalid_request`, `server_error`, `refusal`, `oauth_org_not_allowed`, …
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        code: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        status: Option<u32>,
    },
    /// "Worked for 2m 10s": how long a turn took (`system.turn_duration`).
    Duration {
        #[ts(type = "number")]
        ms: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        messages: Option<u32>,
    },
    /// The conversation was compacted (`compact_boundary`).
    Compact {
        /// `auto` or `manual`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        trigger: Option<String>,
        /// Context tokens before compaction.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        #[ts(type = "number")]
        pre_tokens: Option<u64>,
    },
    /// An image the user attached.
    Image {
        media_type: String,
        /// Absent when the transcript has no bytes for it (or from an older daemon).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        image: Option<CvImage>,
        /// An image given by address (`source.type = url`, https only): the client loads it itself.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        url: Option<String>,
    },
}

/// A whitelisted, clipped subset of a tool result's `toolUseResult`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvToolMeta {
    /// Agent/Task: the subagent's id (`cv_attach` with `agent`, `CvTask.id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent_id: Option<String>,
    /// Agent: `async_launched` (runs in the background; the result comes as a `task_note`) or `completed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<String>,
    /// Agent: subagent type (`Explore`, `general-purpose`, …) when the result names it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent_type: Option<String>,
    /// Bash: moved to the background (`CvTask.id`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub background_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interrupted: Option<bool>,
    /// Bash: what the exit code means ("No matches found").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub return_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stdout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub stderr: Option<String>,
    /// Bash printed an image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_image: Option<bool>,
    /// The full output was saved to this file (`persistedOutputPath`, readable with `cv_file`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub full_output: Option<String>,
    /// Edit/Write/MultiEdit: hunks with the file's real line numbers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<CvHunk>>", optional)]
    pub patch: Vec<CvHunk>,
    /// Write: `create` or `update`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub write: Option<String>,
    /// The user changed the proposed edit before accepting it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub user_modified: Option<bool>,
    /// Glob/Grep/WebSearch: number of files, matches or results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub duration_ms: Option<u64>,
    /// Agent: tool calls and tokens the subagent used, the model it ran on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// SendUserFile: files Claude sent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub files: Vec<String>,
    /// AskUserQuestion: question → chosen answer(s).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "Record<string, string>")]
    pub answers: Option<Value>,
}

/// One hunk of a structured patch (as `diff -u`: `lines` start with ` `, `-` or `+`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<String>,
}

/// Background work of a session: subagents, background shells, monitors. Built by the daemon from
/// the Agent/Bash tool calls and results, `<task-notification>`s, `task_status` attachments, the
/// subagents' `.meta.json` files and the live `subagentStatusLine` feed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvTask {
    /// The agent id (for `cv_attach` with `agent`) or the background task id.
    pub id: String,
    /// `agent`, `bash`, `monitor`, `workflow`.
    pub kind: String,
    /// The tool call that started it (links the card in the transcript).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool_use_id: Option<String>,
    /// The agent that spawned it (nested subagents); `None` for the main conversation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent_type: Option<String>,
    pub description: String,
    /// Live progress text while it runs (subagentStatusLine), or the latest step ("Bash · cargo test").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
    /// `running`, `completed`, `failed`, `killed`, `stopped`.
    pub status: String,
    pub background: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// Started / ended (ms since epoch).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub started: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub ended: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool_count: Option<u32>,
    /// One line when it ended (task notification summary).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub summary: Option<String>,
    /// The final report (agents), clipped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub result: Option<String>,
    /// The subagent's own transcript exists (`cv_attach` with `agent: id`).
    pub has_transcript: bool,
    /// Shells/monitors: the command.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub command: Option<String>,
    /// Shell/monitor output (read-only tail with `cv_task_output`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub output_file: Option<String>,
}

/// A todo item (TodoWrite / TaskCreate / TaskUpdate).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvTodo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    pub content: String,
    /// What the CLI shows while it is in progress ("Running the tests").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub active: Option<String>,
    /// `pending`, `in_progress`, `completed`.
    pub status: String,
}

/// The pull request of the current branch (statusline `pr`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvPr {
    pub number: u32,
    pub url: String,
    /// `approved`, `changes_requested`, `pending`, … when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub state: Option<String>,
}

/// The session runs in a git worktree the CLI created (`--worktree`, statusline `worktree`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvWorktree {
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub original_cwd: Option<String>,
}

/// A message typed while Claude works, waiting for its turn (`queue-operation`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvQueued {
    pub text: String,
    #[ts(type = "number")]
    pub ts: i64,
}

/// An image in the transcript, by reference: history and live updates stay small (a phone may
/// be on the relay), and a client fetches the bytes with `cv_image` when it shows the image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvImage {
    /// Stable within the session's transcript file (`<line offset>-<n>-<length>`).
    pub id: String,
    pub media_type: String,
    /// Decoded size of the original.
    #[ts(type = "number")]
    pub bytes: u64,
    /// Pixel size, when the header could be read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub w: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub h: Option<u32>,
}

/// Answer to `cv_image`: the picture itself (maybe scaled down, see the request's `max`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvImageData {
    pub media_type: String,
    /// Base64.
    pub data: String,
    pub w: u32,
    pub h: u32,
    /// Scaled down or re-encoded from the original.
    pub scaled: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvMessage {
    /// Position in the transcript file (byte offset of its first line): stable and ordered.
    #[ts(type = "number")]
    pub i: u64,
    pub id: String,
    pub role: CvRole,
    #[ts(type = "number")]
    pub ts: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// `command` (a slash command the user ran), `output` (its output), `compact`, `notice`,
    /// `summary` (the carried-over summary after compaction), and since the mobile overhaul:
    /// `task` (a `task_note` block), `shell` (`!` mode, a `shell` block), `peer` (a message from
    /// another agent, see `from`), `hook`, `error`, `duration`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<String>,
    pub blocks: Vec<CvBlock>,
    /// `peer`: who sent it (agent id) and its name/type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub from_name: Option<String>,
    /// User prompts: a file checkpoint exists, so `/rewind` can restore code to before it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub checkpoint: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max` (what `/effort <level>` takes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub effort: Option<String>,
    /// `default`, `acceptEdits`, `plan`, `bypassPermissions`, …
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    /// Tokens in the context after the last answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub context_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub transcript: Option<String>,
    /// What the CLI shows while it works ("✻ Pondering… (3s · esc to interrupt)").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub activity: Option<String>,
    /// Claude is working on a turn (hooks: prompt submitted → stop; the spinner on the screen).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub busy: Option<bool>,
    /// The model's real context window (statusline), instead of a guessed 200k / 1M.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub context_window: Option<u64>,
    /// Context used, 0–100, as the CLI computes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub context_pct: Option<f32>,
    /// Session totals from the statusline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cost_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub api_duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub lines_added: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub lines_removed: Option<u64>,
    /// Fast mode on (`/fast`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fast: Option<bool>,
    /// Extended thinking on (only meaningful on models that have the toggle).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub thinking: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub output_style: Option<String>,
    /// `/rename` name or the session name the CLI shows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session_name: Option<String>,
    /// The CLI version (statusline).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub worktree: Option<CvWorktree>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pr: Option<CvPr>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub added_dirs: Vec<String>,
    /// Plan mode: the plan file the CLI writes (readable with `cv_file`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub plan_file: Option<String>,
    /// Messages typed while Claude works, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<CvQueued>>", optional)]
    pub queued: Vec<CvQueued>,
    /// The todo list (TodoWrite / TaskCreate / TaskUpdate), latest state.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<CvTodo>>", optional)]
    pub todos: Vec<CvTodo>,
    /// Background tasks still running (badge; the list comes as `tasks`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tasks_running: Option<u32>,
    /// The daemon plays `CvAction`s for this session (absent: an older daemon; the client types keys itself).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub actions: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvOption {
    /// What to type to choose it (the number shown by the CLI). Empty for menus without numbers:
    /// then `nav` says how to get there.
    pub n: String,
    pub label: String,
    pub selected: bool,
    /// Menus without numbers: Down presses from the highlighted row (negative: Up).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub nav: Option<i32>,
    /// Checkbox rows (`[✔]` / `[ ]`, multi-select questions).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub checked: Option<bool>,
    /// The dimmed line under the option.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    /// Choosing it asks for text (e.g. "No, and tell Claude what to do", "Type something").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub text: Option<bool>,
}

/// A menu the CLI shows in its terminal UI right now (permission, question, plan, model, …),
/// read from the screen so it can be answered with buttons.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvPrompt {
    pub title: String,
    pub options: Vec<CvOption>,
    /// Fingerprint of this prompt (its title and options as shown). Send it back as
    /// `CvAction.prompt_id` so an answer never lands on a prompt that replaced it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    /// `permission` (a tool wants to run), `question` (AskUserQuestion), `plan` (ExitPlanMode
    /// approval), `confirm` (trust folder and other yes/no dialogs), `menu` (anything else, e.g.
    /// `/model`, `/resume`, `/rewind` lists). Absent from older daemons: treat as before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<String>,
    /// `permission`: the tool that asks (from the PermissionRequest hook when it fired, else the
    /// newest pending tool call).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool: Option<CvPromptTool>,
    /// `question`: the questions with their options, and where the CLI's dialog is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub question: Option<CvQuestion>,
    /// `plan`: the plan to approve (markdown).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub plan: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvPromptTool {
    pub name: String,
    #[ts(type = "unknown")]
    pub input: Value,
    /// The pending tool call, when it could be matched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool_use_id: Option<String>,
    /// Asked by a subagent: its id and description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent: Option<String>,
}

/// AskUserQuestion: one dialog with one or more questions (tabs).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvQuestion {
    pub questions: Vec<CvQuestionItem>,
    /// The tab the CLI shows now (0-based), when read from the screen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tab: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvQuestionItem {
    pub question: String,
    /// Short tab label.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[ts(as = "Option<String>", optional)]
    pub header: String,
    pub multi_select: bool,
    pub options: Vec<CvQuestionOption>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvQuestionOption {
    pub label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[ts(as = "Option<String>", optional)]
    pub description: String,
}

/// Answer for one question of a `CvQuestion`: the chosen option labels, or free text ("Other").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvAnswer {
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub other: Option<String>,
}

/// Something the UI wants the CLI to do. The daemon owns the key sequences (and checks the
/// screen between steps where it can), so every client behaves the same. `cv_action` → `null`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "k", rename_all = "snake_case")]
#[ts(export)]
pub enum CvAction {
    /// Esc: stop the current turn (or close a dialog).
    Interrupt,
    /// Shift+Tab until the footer shows `mode` (`default`, `acceptEdits`, `plan`, `bypassPermissions`, `auto`).
    /// Fails with a message when the mode is not in the cycle.
    SetMode { mode: String },
    /// `/model <model>`.
    Model { model: String },
    /// `/effort <level>` (`low` … `max`, or `auto`).
    Effort { level: String },
    /// `/fast on|off`.
    Fast { on: bool },
    /// Ctrl+B: move the running Bash/Agent call to the background.
    Background,
    /// Ctrl+X Ctrl+K twice: stop all background agents.
    StopAgents,
    /// Ctrl+X Ctrl+S: send the queued messages now (interrupts the turn).
    SendQueuedNow,
    /// Pick option `n` of the prompt on the screen (or walk `nav` steps for menus without
    /// numbers); `text`: feedback for an option that asks for it ("No, and tell Claude…").
    Answer {
        #[serde(default)]
        n: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        nav: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        text: Option<String>,
        /// `CvPrompt.id` of the prompt this answers: refused when the terminal shows another one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        prompt_id: Option<String>,
    },
    /// Answer the AskUserQuestion dialog: one entry per question, in order.
    AnswerQuestion {
        answers: Vec<CvAnswer>,
        /// `CvPrompt.id` of the question dialog this answers.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        prompt_id: Option<String>,
    },
    /// `!` shell mode: run `command` in the session's shell, output goes into the conversation.
    Shell { command: String },
    /// Rewind to before user message `message_id` (`CvMessage.id`). `what`: `both` (code and
    /// conversation), `conversation`, `code`, or `summarize` (summarize from here).
    Rewind { message_id: String, what: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "k", rename_all = "snake_case")]
#[ts(export)]
pub enum CvEvent {
    /// New or changed message (same `id` replaces).
    Upsert {
        message: CvMessage,
    },
    /// The transcript changed (`/clear`, `/resume`): start over with these.
    Reset {
        messages: Vec<CvMessage>,
        more: bool,
        meta: CvMeta,
    },
    Meta {
        meta: CvMeta,
    },
    Prompt {
        prompt: Option<CvPrompt>,
    },
    /// The background task list changed (whole list; small). Main conversation only.
    Tasks {
        tasks: Vec<CvTask>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvAttachResult {
    pub messages: Vec<CvMessage>,
    /// Older messages exist (`cv_history`).
    pub more: bool,
    pub meta: CvMeta,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prompt: Option<CvPrompt>,
    /// Background tasks (main conversation only; then `tasks` events).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<CvTask>>", optional)]
    pub tasks: Vec<CvTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvHistoryResult {
    pub messages: Vec<CvMessage>,
    pub more: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvCommand {
    /// Without the slash.
    pub name: String,
    pub description: String,
    /// `builtin`, `user`, `project`, `skill`, `plugin`.
    pub source: String,
    /// Palette section: `conversation`, `model`, `context`, `agents`, `code`, `project`,
    /// `extensions`, `account`, `custom` (user/project commands), `skills`, `plugins`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group: Option<String>,
    /// What running it does: `native` (the app has its own UI, see `native`), `args` (typed with
    /// optional arguments, runs at once), `dialog` (opens a CLI menu: answered via the prompt
    /// card / menu sheet, or the terminal), `prompt` (sends a prompt to Claude: skills, custom
    /// commands), `output` (prints something into the conversation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<String>,
    /// Argument hint (`[instructions]`, `<path>`, `[low|medium|high|xhigh|max|auto]`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub args: Option<String>,
    /// Known values for the argument (for chips).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub values: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub aliases: Vec<String>,
    /// `kind = native`: which app UI handles it: `model`, `effort`, `mode`, `fast`, `rewind`,
    /// `tasks`, `context`, `usage`, `changes`, `mcp`, `resume`, `folder`, `todos`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub native: Option<String>,
    /// `false`: makes little sense on a phone (theme, terminal setup…): list it under "More".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub phone: Option<bool>,
}

/// Answer to `cv_task_output` / `cv_file`: the end of a text file the transcript named.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvTextResult {
    pub text: String,
    /// The file is longer: `text` is its end (task output) or its start (`cv_file`).
    pub truncated: bool,
    #[ts(type = "number")]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UploadResult {
    /// Absolute path on the host.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TranscribeResult {
    pub text: String,
}
