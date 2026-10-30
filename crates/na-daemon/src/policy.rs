//! What a client may do without asking.
//!
//! The desktop window is the user at the keyboard: everything is allowed. Phones and the
//! orchestrator may start, prompt and stop agents only in approved workspaces; typing into a
//! raw shell, changing approvals and settings needs the desktop (the approval queue that turns
//! these into "confirm on desktop/phone" prompts arrives with the remote in M5).

use na_protocol::{ApiError, ClientInfo, ClientKind, ErrorCode, Request};

use crate::core::{Core, err};

pub fn check(core: &Core, client: &ClientInfo, req: &Request) -> Result<(), ApiError> {
    if client.kind == ClientKind::Desktop {
        return Ok(());
    }
    let ws_of_session = |sid: &String| core.read(|s| s.sessions.get(sid).map(|x| (x.workspace_id.clone(), x.profile_id.clone())));
    let approved = |ws: &String| core.read(|s| s.workspaces.iter().any(|w| &w.id == ws && w.approved));
    let needs = |what: &str| Err(err(ErrorCode::NeedsApproval, format!("{what} needs confirmation on the desktop")));
    match req {
        // The emergency switch works from anywhere; everything else about the account is desktop-only.
        Request::RemoteEnable { enabled: false } => Ok(()),
        Request::RemoteSignIn { .. }
        | Request::RemoteSignOut
        | Request::RemoteSignOutEverywhere
        | Request::RemoteEnable { .. }
        | Request::RemotePair
        | Request::RemoteRevoke { .. } => needs("changing remote access"),
        Request::SessionStart(st) if st.profile_id.starts_with(crate::profiles::INSTALL_PREFIX) => needs("installing a CLI"),
        Request::SessionStart(st) if !approved(&st.workspace_id) => needs("starting an agent outside an approved workspace"),
        Request::SessionStart(st) if st.profile_id == "shell" && client.kind == ClientKind::Orchestrator => needs("opening a raw shell"),
        Request::SessionPrompt { id, .. } | Request::SessionStop { id } | Request::SessionRestart { id } => match ws_of_session(id) {
            Some((ws, _)) if approved(&ws) => Ok(()),
            Some(_) => needs("controlling an agent outside an approved workspace"),
            None => Err(err(ErrorCode::NotFound, "no such session")),
        },
        Request::TermWrite { sid, .. } => match ws_of_session(sid) {
            Some((_, profile)) if profile == "shell" && client.kind == ClientKind::Orchestrator => needs("typing into a raw shell"),
            Some((ws, _)) if approved(&ws) => Ok(()),
            Some(_) => needs("typing into an agent outside an approved workspace"),
            None => Err(err(ErrorCode::NotFound, "no such session")),
        },
        Request::GitChanges { workspace_id, .. } | Request::GitDiff { workspace_id, .. } if !approved(workspace_id) => {
            needs("looking at changes outside an approved workspace")
        }
        Request::WorktreeMerge { session_id } | Request::WorktreeDiscard { session_id } => match ws_of_session(session_id) {
            Some((ws, _)) if approved(&ws) => Ok(()),
            Some(_) => needs("merging or discarding outside an approved workspace"),
            None => Err(err(ErrorCode::NotFound, "no such session")),
        },
        Request::WorkspaceUpdate { approved: Some(_), .. }
        | Request::SettingsSet { .. }
        | Request::ProfileSave { .. }
        | Request::ProfileDelete { .. } => needs("this change"),
        Request::WorkspaceRemove { .. } => needs("removing a workspace"),
        Request::McpSave { .. } | Request::McpDelete { .. } | Request::McpImport => needs("changing MCP servers"),
        Request::LlmKeySet { .. } => needs("changing model keys"),
        // Neural does not talk to itself.
        Request::OrchSend { .. } | Request::OrchClear | Request::LlmTest if client.kind == ClientKind::Orchestrator => {
            Err(err(ErrorCode::BadRequest, "not available to the orchestrator"))
        }
        Request::CatalogRefresh => Ok(()),
        _ => Ok(()),
    }
}
