//! Tauri commands for Settings → System (permissions, autostart) and the check after start that
//! warns when an update lost a permission. The page is `packages/app/src/components/settings/
//! SystemPanel.tsx`; phones ask the same through the daemon (`host_ui` "system.status").

use serde::Serialize;
use tauri::AppHandle;

use crate::autostart::{self, Autostart, Ctx};
use crate::permissions::{self, Permission};

#[derive(Serialize)]
pub struct SystemStatus {
    /// `macos` | `windows` | `linux`.
    os: &'static str,
    permissions: Vec<Permission>,
    autostart: Autostart,
    /// Autostart cannot point at this copy of the app (why, in words), e.g. run from Downloads.
    #[serde(skip_serializing_if = "Option::is_none")]
    blocked: Option<String>,
    /// The boot service points at another copy of the app: set it up again.
    stale: bool,
}

fn status() -> Result<SystemStatus, String> {
    let ctx = Ctx::detect().map_err(|e| format!("{e:#}"))?;
    let stale = autostart::refresh(&ctx).unwrap_or(false);
    Ok(SystemStatus {
        os: std::env::consts::OS,
        permissions: permissions::list(),
        autostart: autostart::status(&ctx),
        blocked: autostart::installable(&ctx).err().map(|e| e.to_string()),
        stale,
    })
}

#[tauri::command]
pub async fn system_status() -> Result<SystemStatus, String> {
    tauri::async_runtime::spawn_blocking(status).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn system_request(id: String) -> Result<(), String> {
    permissions::request(&id)
}

#[tauri::command]
pub fn system_open(id: String) -> Result<(), String> {
    permissions::open(&id)
}

#[tauri::command]
pub fn system_repair(id: String) -> Result<(), String> {
    permissions::repair(&id)
}

/// Sets autostart; "boot" asks for the administrator password once (macOS, Windows UAC).
#[tauri::command]
pub async fn system_autostart(autostart: Autostart) -> Result<SystemStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = Ctx::detect().map_err(|e| format!("{e:#}"))?;
        autostart::set(&ctx, autostart).map_err(|e| format!("{e:#}"))?;
        status()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A few seconds after start: a permission that was granted last time and is gone now (an
/// update with a new signature, a reset) gets a notification instead of a surprise later.
pub fn self_check(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        let Ok(data) = crate::daemon::data_dir() else { return };
        let lost = permissions::lost_since_last_run(&data, &permissions::list());
        if lost.is_empty() {
            return;
        }
        tracing::warn!(?lost, "permissions lost since the last start");
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("NeuralAgent needs a permission again")
            .body(format!("{} is off now. Open Settings → System to switch it on.", lost.join(", ")))
            .show();
    });
}
