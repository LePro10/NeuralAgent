//! Claude view: the structured conversation of a Claude Code session, read from its transcript
//! by the daemon. The CLI keeps running in its PTY; clients render these messages and type
//! into the PTY.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CvRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "k", rename_all = "snake_case")]
#[ts(export)]
pub enum CvBlock {
    Text {
        text: String,
    },
    Thinking {
        text: String,
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
    },
    /// An image the user attached (bytes are not sent).
    Image {
        media_type: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
    /// `summary` (the carried-over summary after compaction).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<String>,
    pub blocks: Vec<CvBlock>,
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvOption {
    /// What to type to choose it (the number shown by the CLI).
    pub n: String,
    pub label: String,
    pub selected: bool,
}

/// A menu the CLI shows in its terminal UI right now (permission, question, plan, model, …),
/// read from the screen so it can be answered with buttons.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvPrompt {
    pub title: String,
    pub options: Vec<CvOption>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvHistoryResult {
    pub messages: Vec<CvMessage>,
    pub more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CvCommand {
    /// Without the slash.
    pub name: String,
    pub description: String,
    /// `builtin`, `user`, `project`, `skill`, `plugin`.
    pub source: String,
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
