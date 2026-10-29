mod daemon;
mod hud;
mod mic;
mod models;
mod tray;
mod voice;

use std::sync::Arc;

use serde::Serialize;
use tauri::{Manager, State};
use voice::{Voice, VoiceConfig, VoiceStatus};

#[derive(Serialize)]
struct Connection {
    url: String,
    version: String,
}

/// Where the UI connects. Starts the service if it is not running.
#[tauri::command]
async fn daemon_connect() -> Result<Connection, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let info = daemon::ensure().map_err(|e| format!("{e:#}"))?;
        Ok(Connection { url: format!("ws://127.0.0.1:{}/ws?token={}", info.port, info.token), version: info.version })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn daemon_stop() -> Result<(), String> {
    daemon::stop().map_err(|e| format!("{e:#}"))
}

/// The UI reports agent counts so the menu bar icon can show them.
#[tauri::command]
fn tray_update(app: tauri::AppHandle, running: u32, working: u32, waiting: u32) -> Result<(), String> {
    tray::update(&app, running, working, waiting).map_err(|e| e.to_string())
}

#[tauri::command]
fn voice_status(voice: State<'_, Arc<Voice>>) -> VoiceStatus {
    voice.status()
}

#[tauri::command]
fn voice_set(voice: State<'_, Arc<Voice>>, config: VoiceConfig) -> Result<(), String> {
    voice.set_config(config).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn voice_download(voice: State<'_, Arc<Voice>>, id: String) -> Result<(), String> {
    voice.download(&id).map_err(|e| format!("{e:#}"))
}

/// Records "Hey Neural" once (up to 4 s) and teaches the wake word this pronunciation.
#[tauri::command]
async fn voice_learn(voice: State<'_, Arc<Voice>>) -> Result<String, String> {
    let voice = voice.inner().clone();
    tauri::async_runtime::spawn_blocking(move || voice.learn().map_err(|e| format!("{e:#}"))).await.map_err(|e| e.to_string())?
}

/// Dev builds: the webview's console errors end up in the terminal running `tauri dev`.
#[tauri::command]
fn dev_log(level: String, message: String) {
    if cfg!(debug_assertions) {
        eprintln!("[webview {level}] {message}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| voice::on_shortcut(app, event.state)).build())
        .setup(|app| {
            let data = daemon::data_dir()?;
            let voice = Voice::new(app.handle().clone(), data);
            app.manage(voice.clone());
            if let Err(e) = hud::create(app.handle()) {
                tracing::warn!("listening pill: {e}");
            }
            voice.apply();
            if let Err(e) = tray::create(app.handle()) {
                tracing::warn!("menu bar icon: {e}");
            }
            Ok(())
        })
        // Closing the window keeps NeuralAgent in the menu bar (dictation and wake word stay on).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            daemon_connect,
            daemon_stop,
            dev_log,
            tray_update,
            voice_status,
            voice_set,
            voice_download,
            voice_learn
        ])
        .build(tauri::generate_context!())
        .expect("error while starting NeuralAgent")
        .run(|app, event| {
            // macOS: clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
