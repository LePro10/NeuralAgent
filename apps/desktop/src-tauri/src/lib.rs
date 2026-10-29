mod daemon;

use serde::Serialize;

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
        .invoke_handler(tauri::generate_handler![daemon_connect, daemon_stop, dev_log])
        .run(tauri::generate_context!())
        .expect("error while running NeuralAgent");
}
