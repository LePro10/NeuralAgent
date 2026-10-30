//! App updates from agent.neuralhub.dev (Tauri updater, signed with the release key). Installing
//! replaces the app and restarts it; the service and its agents keep running (see daemon.rs).
//! `NEURALAGENT_UPDATE_URL` points the check at another server (tests); signatures still count.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Updater, UpdaterExt};

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: Option<u64>,
}

/// The relay the app updates from (also serves `/changelog.json` for the update dialog).
fn server() -> String {
    std::env::var("NEURALAGENT_UPDATE_URL")
        .ok()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "https://agent.neuralhub.dev".into())
        .trim_end_matches('/')
        .to_string()
}

/// Base URL of the update server; the page fetches `<server>/changelog.json` itself (CSP allows it).
#[tauri::command]
pub fn update_server() -> String {
    server()
}

fn updater(app: &AppHandle) -> Result<Updater, String> {
    let mut b = app.updater_builder();
    if let Some(url) = std::env::var("NEURALAGENT_UPDATE_URL").ok().filter(|u| !u.is_empty()) {
        let url = format!("{}/api/update/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}", url.trim_end_matches('/'));
        b = b.endpoints(vec![url.parse().map_err(|e| format!("{e}"))?]).map_err(|e| e.to_string())?;
    }
    b.build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let found = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|u| UpdateInfo { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone() }))
}

/// Downloads, verifies and installs the update, then restarts the app.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let Some(update) = updater(&app)?.check().await.map_err(|e| e.to_string())? else {
        return Err("already up to date".into());
    };
    tracing::info!(from = %update.current_version, to = %update.version, "installing update");
    let mut done = 0u64;
    let events = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let _ = events.emit("update-progress", Progress { done, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
