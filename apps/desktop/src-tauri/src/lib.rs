mod autostart;
mod daemon;
mod duck;
mod hud;
mod mic;
mod models;
mod permissions;
mod service;
mod system;
mod tray;
mod update;
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

/// After an app update the service still runs the old version (agents keep running). Once
/// nothing runs any more the UI calls this: the old service stops and this version's starts.
#[tauri::command]
async fn daemon_upgrade() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let info = daemon::ensure().map_err(|e| format!("{e:#}"))?;
        if info.version == env!("CARGO_PKG_VERSION") {
            return Ok(info.version);
        }
        tracing::info!(from = %info.version, to = env!("CARGO_PKG_VERSION"), "upgrading the service");
        daemon::restart_newest().map_err(|e| format!("{e:#}"))?;
        daemon::wait_gone(&info);
        daemon::ensure().map(|i| i.version).map_err(|e| format!("{e:#}"))
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
fn tray_update(app: tauri::AppHandle, running: u32, working: u32, waiting: u32, remote: Option<bool>) -> Result<(), String> {
    tray::update(&app, running, working, waiting, remote).map_err(|e| e.to_string())
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

/// One clipboard for the app's lifetime: on Linux (X11) the text we copied is served by our own
/// process and would vanish with a short-lived handle.
fn with_clipboard<T>(f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>) -> Result<T, String> {
    static CLIP: std::sync::Mutex<Option<arboard::Clipboard>> = std::sync::Mutex::new(None);
    let mut slot = CLIP.lock().map_err(|e| e.to_string())?;
    if slot.is_none() {
        *slot = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
    }
    f(slot.as_mut().expect("set above")).map_err(|e| e.to_string())
}

/// Puts text on the system clipboard. The page's own Clipboard API needs a click first, which
/// text copied by a program in a terminal (OSC 52) never has.
#[tauri::command]
fn clipboard_write_text(text: String) -> Result<(), String> {
    with_clipboard(|c| c.set_text(text))
}

/// The text on the system clipboard (the page's readText would make WebKit ask with a bubble).
#[tauri::command]
fn clipboard_text() -> Option<String> {
    with_clipboard(|c| c.get_text()).ok()
}

/// The image on the system clipboard (a screenshot), PNG as base64, or None. WebViews do not always
/// hand screenshots to the page on paste.
#[tauri::command]
fn clipboard_image() -> Option<String> {
    let img = arboard::Clipboard::new().ok()?.get_image().ok()?;
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.width as u32, img.height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().ok()?.write_image_data(&img.bytes).ok()?;
    }
    use base64::Engine;
    Some(base64::engine::general_purpose::STANDARD.encode(out))
}

/// Dev builds: the webview's console errors end up in the terminal running `tauri dev`.
#[tauri::command]
fn dev_log(level: String, message: String) {
    if cfg!(debug_assertions) {
        eprintln!("[webview {level}] {message}");
    }
}

/// The app's own log (updates, voice, tray) goes to `<data>/logs/app.log`, next to the service's.
fn init_logging() {
    let filter = tracing_subscriber::EnvFilter::try_from_env("NEURALAGENT_LOG").unwrap_or_else(|_| "info".into());
    let Ok(dir) = daemon::data_dir().map(|d| d.join("logs")) else { return };
    let _ = std::fs::create_dir_all(&dir);
    let log = dir.join("app.log");
    if std::fs::metadata(&log).map(|m| m.len() > 5 << 20).unwrap_or(false) {
        let _ = std::fs::rename(&log, log.with_extension("old.log"));
    }
    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
        let _ = tracing_subscriber::fmt().with_env_filter(filter).with_ansi(false).with_writer(std::sync::Mutex::new(file)).try_init();
    }
}

/// `neuralagent --service …` runs the host without a window (service.rs); returns its exit code.
pub fn run_service(args: &[String]) -> i32 {
    service::main(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    tauri::Builder::default()
        // One app window per user: a second start (Start menu, desktop file, Dock while an
        // update relaunches) shows the running window instead of opening another app.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| voice::on_shortcut(app, event.state)).build())
        .setup(|app| {
            // Launch: before the page paints, the window shows its own colour. The config's is the
            // dark launch screen's; in light mode use the light one (packages/app lib/launchFrame.ts).
            if let Some(w) = app.get_webview_window("main")
                && matches!(w.theme(), Ok(tauri::Theme::Light))
            {
                let _ = w.set_background_color(Some(tauri::window::Color(0xf2, 0xf3, 0xf5, 0xff)));
            }
            // Update tests: install a waiting update right away, without the UI.
            if std::env::var("NEURALAGENT_UPDATE_NOW").as_deref() == Ok("1") {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = update::update_install(handle).await {
                        tracing::warn!("update now: {e}");
                    }
                });
            }
            let data = daemon::data_dir()?;
            // Before voice: it puts back volumes a crashed run left lowered, then takes reports.
            app.manage(duck::Ducking::start(&data));
            let voice = Voice::new(app.handle().clone(), data);
            app.manage(voice.clone());
            if let Err(e) = hud::create(app.handle()) {
                tracing::warn!("listening pill: {e}");
            }
            voice.apply();
            if let Err(e) = tray::create(app.handle()) {
                tracing::warn!("menu bar icon: {e}");
            }
            system::self_check(app.handle());
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
            daemon_upgrade,
            update::update_check,
            update::update_install,
            update::update_server,
            dev_log,
            clipboard_image,
            clipboard_write_text,
            clipboard_text,
            tray_update,
            voice_status,
            voice_set,
            voice_download,
            voice_learn,
            duck::duck_call,
            duck::duck_apps,
            duck::duck_allow_apps,
            system::system_status,
            system::system_request,
            system::system_open,
            system::system_repair,
            system::system_autostart
        ])
        .build(tauri::generate_context!())
        .expect("error while starting NeuralAgent")
        .run(|app, event| {
            // Quitting never leaves other apps' audio lowered.
            if let tauri::RunEvent::Exit = event
                && let Some(d) = app.try_state::<duck::Ducking>()
            {
                d.shutdown();
            }
            // macOS: clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main(app);
            }
        });
}
