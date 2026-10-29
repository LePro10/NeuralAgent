//! Menu bar / tray icon: shows how many agents need you, opens the window, and quits either just
//! the app (agents keep running) or everything; with remote access set up it also holds the
//! emergency "Disconnect remote". Closing the window keeps the app here, so the
//! dictation shortcut and the wake word keep working.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::daemon;

const ID: &str = "main";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, "No agents running", None)?;
    TrayIconBuilder::with_id(ID)
        .icon(mark(if cfg!(target_os = "macos") { 36 } else { 32 }))
        .icon_as_template(true)
        .tooltip("NeuralAgent")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            // The window's script (alive while hidden) knows the current state and asks the daemon.
            "remote" => {
                let _ = app.emit("tray-remote", ());
            }
            "quit" => app.exit(0),
            "quit-all" => {
                if let Err(e) = daemon::stop() {
                    tracing::warn!("stopping the service: {e:#}");
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Windows/Linux: a left click opens the window, the menu is on the right button.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event
                && !cfg!(target_os = "macos")
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn build_menu(app: &AppHandle, status: &str, remote: Option<bool>) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "status", status, false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", "Open NeuralAgent", true, None::<&str>)?,
        ],
    )?;
    if let Some(on) = remote {
        menu.append(&MenuItem::with_id(app, "remote", if on { "Disconnect remote" } else { "Reconnect remote" }, true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit (agents keep running)", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit-all", "Quit and stop all agents", true, None::<&str>)?)?;
    Ok(menu)
}

/// Called by the UI whenever agent states change.
pub fn update(app: &AppHandle, running: u32, working: u32, waiting: u32, remote: Option<bool>) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(ID) else { return Ok(()) };
    let status = match (running, working, waiting) {
        (0, ..) => "No agents running".to_string(),
        (n, 0, 0) => format!("{} running", agents(n)),
        (n, w, 0) => format!("{} · {w} working", agents(n)),
        (n, _, q) => format!("{} · {q} need{} you", agents(n), if q == 1 { "s" } else { "" }),
    };
    tray.set_menu(Some(build_menu(app, &status, remote)?))?;
    tray.set_tooltip(Some(format!("NeuralAgent — {status}")))?;
    set_badge(&tray, waiting)?;
    Ok(())
}

fn agents(n: u32) -> String {
    if n == 1 { "1 agent".into() } else { format!("{n} agents") }
}

/// macOS shows the count of agents waiting for input next to the icon.
fn set_badge(tray: &TrayIcon, waiting: u32) -> tauri::Result<()> {
    if cfg!(target_os = "macos") {
        tray.set_title(if waiting > 0 { Some(waiting.to_string()) } else { None::<String> })?;
    }
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The NeuralAgent mark (two posts and three steps, as in `docs/brand/neuralagent-mark.svg`)
/// drawn in black on transparent, `size` pixels square, with soft edges.
fn mark(size: u32) -> Image<'static> {
    // x, y, width, height, radius on the 64-unit grid of the SVG.
    const RECTS: [(f32, f32, f32, f32, f32); 5] =
        [(8., 8., 10., 48., 3.), (46., 8., 10., 48., 3.), (20., 9., 12., 14., 3.), (26., 25., 12., 14., 3.), (32., 41., 12., 14., 3.)];
    let scale = size as f32 / 64.0;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    for py in 0..size {
        for px in 0..size {
            // 4×4 supersampling for the edges.
            let mut hits = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let (x, y) = ((px as f32 + (sx as f32 + 0.5) / 4.0) / scale, (py as f32 + (sy as f32 + 0.5) / 4.0) / scale);
                    if RECTS.iter().any(|&(rx, ry, w, h, r)| inside(x, y, rx, ry, w, h, r)) {
                        hits += 1;
                    }
                }
            }
            let i = ((py * size + px) * 4) as usize;
            rgba[i + 3] = (hits * 255 / 16) as u8;
        }
    }
    Image::new_owned(rgba, size, size)
}

fn inside(x: f32, y: f32, rx: f32, ry: f32, w: f32, h: f32, r: f32) -> bool {
    if x < rx || y < ry || x > rx + w || y > ry + h {
        return false;
    }
    // Distance into the rounded corner, if the point is in a corner square.
    let cx = x.clamp(rx + r, rx + w - r);
    let cy = y.clamp(ry + r, ry + h - r);
    (x - cx).powi(2) + (y - cy).powi(2) <= r * r
}
