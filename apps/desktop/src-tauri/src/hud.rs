//! A small pill at the bottom of the screen while dictating or after "Hey Neural", so the user
//! sees that the computer is listening even when NeuralAgent is in the background. It never takes
//! focus: the text has to land in the app the user is typing in.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::voice::Activity;

const LABEL: &str = "hud";
const WIDTH: f64 = 260.0;
const HEIGHT: f64 = 48.0;
/// How often the live mic level goes to the pill (it interpolates to 60 fps itself).
const LEVEL_EVERY: Duration = Duration::from_millis(40);
/// Bumped whenever the meter starts or stops; a meter thread runs only while its number is current.
static METER: AtomicU64 = AtomicU64::new(0);

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("hud.html".into()))
        .title("NeuralAgent listening")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build()?;
    let _ = window.set_ignore_cursor_events(true);
    Ok(())
}

/// Shows the pill for activities the user should see outside the app, hides it otherwise.
pub fn update(app: &AppHandle, activity: Activity) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let visible = matches!(activity, Activity::Listening | Activity::Transcribing | Activity::Awake);
    meter(app, matches!(activity, Activity::Listening | Activity::Awake));
    if !visible {
        let _ = window.hide();
        return;
    }
    // Bottom centre of the screen the main window is on (the cursor's screen is not known on
    // every platform).
    if let Ok(Some(m)) = app.get_webview_window("main").map_or(window.primary_monitor(), |w| w.current_monitor()) {
        let scale = m.scale_factor();
        let (pos, size) = (m.work_area().position.to_logical::<f64>(scale), m.work_area().size.to_logical::<f64>(scale));
        let _ = window.set_size(LogicalSize::new(WIDTH, HEIGHT));
        let _ = window.set_position(LogicalPosition::new(pos.x + (size.width - WIDTH) / 2.0, pos.y + size.height - HEIGHT - 72.0));
    }
    let _ = window.show();
}

/// Sends the microphone level (0..1, `voice-level`) to the pill every [`LEVEL_EVERY`] while the
/// user is speaking to it; stops as soon as the pill shows something else or hides.
fn meter(app: &AppHandle, on: bool) {
    let id = METER.fetch_add(1, Ordering::SeqCst) + 1;
    if !on {
        return;
    }
    crate::mic::take_level(); // drop whatever was loud before the pill appeared
    let app = app.clone();
    let _ = std::thread::Builder::new().name("hud-meter".into()).spawn(move || {
        while METER.load(Ordering::SeqCst) == id {
            let level = (crate::mic::meter(crate::mic::take_level()) * 1000.0).round() / 1000.0;
            let _ = app.emit_to(LABEL, "voice-level", level);
            std::thread::sleep(LEVEL_EVERY);
        }
    });
}
