//! Settings → System → Permissions (D58): what macOS lets NeuralAgent do, checked live without
//! causing a dialog, and one button each that asks for it or opens the right System Settings
//! pane. Everything is granted to "NeuralAgent" (this app's signing identity, stable across
//! updates since 0.3.4); the host (service.rs) makes the service and the agents count as
//! NeuralAgent too, so these grants cover them.
//!
//! Windows and Linux have no such per-app prompts for what NeuralAgent does (the service only
//! listens on 127.0.0.1, so no firewall prompt either); Windows lists the microphone switch.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Granted,
    Missing,
    /// Denied once: only System Settings can change it now.
    Denied,
    /// Cannot be checked without asking (Automation, Windows microphone).
    Unknown,
}

#[derive(Serialize, Clone, Debug)]
pub struct Permission {
    pub id: &'static str,
    pub title: &'static str,
    /// What it is for, in plain words.
    pub detail: &'static str,
    pub state: State,
    /// Needed for working from the phone without dialogs (Full Disk Access).
    pub remote: bool,
    /// Optional: only some agents' tasks need it.
    pub optional: bool,
}

pub fn list() -> Vec<Permission> {
    #[cfg(target_os = "macos")]
    {
        let fda = macos::full_disk_access();
        vec![
            Permission {
                id: "full_disk_access",
                title: "Full Disk Access",
                detail: "Agents can work in Documents, Desktop, Downloads, iCloud Drive and other disks without a macOS dialog on this screen. Needed when you work from your phone.",
                state: if fda { State::Granted } else { State::Missing },
                remote: true,
                optional: false,
            },
            Permission {
                id: "accessibility",
                title: "Accessibility",
                detail: "Dictation types the text into the app in front.",
                state: if macos::accessibility() { State::Granted } else { State::Missing },
                remote: false,
                optional: false,
            },
            Permission {
                id: "microphone",
                title: "Microphone",
                detail: "Dictation and “Hey Neural”. Audio never leaves this computer.",
                state: macos::microphone(),
                remote: false,
                optional: false,
            },
            Permission {
                id: "screen_recording",
                title: "Screen Recording",
                detail: "Only if agents take screenshots of this screen.",
                state: if macos::screen_recording() { State::Granted } else { State::Missing },
                remote: false,
                optional: true,
            },
            Permission {
                id: "automation",
                title: "Automation",
                detail: "macOS asks once per app an agent controls (Finder, Safari, …). Answer it at the computer, or switch them on here.",
                state: State::Unknown,
                remote: false,
                optional: true,
            },
        ]
    }
    #[cfg(windows)]
    {
        vec![Permission {
            id: "microphone",
            title: "Microphone",
            detail: "Dictation and “Hey Neural”: “Let desktop apps access your microphone” must be on.",
            state: State::Unknown,
            remote: false,
            optional: false,
        }]
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        vec![]
    }
}

/// The System Settings page for `id`.
pub fn pane(id: &str) -> Option<&'static str> {
    if cfg!(windows) {
        return (id == "microphone").then_some("ms-settings:privacy-microphone");
    }
    Some(match id {
        "full_disk_access" => "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        "screen_recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "automation" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
        "login_items" => "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
        _ => return None,
    })
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("/usr/bin/open").arg(url).status();
    #[cfg(windows)]
    let r = std::process::Command::new("explorer").arg(url).status();
    #[cfg(not(any(target_os = "macos", windows)))]
    let r = std::process::Command::new("xdg-open").arg(url).status();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// Asks for `id` the way macOS allows: the system dialog where there is one (Accessibility,
/// Microphone, Screen Recording put NeuralAgent into their list that way), then the pane.
/// Full Disk Access has no dialog: the pane opens and Finder shows the app to drag into it.
pub fn request(id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match id {
            "accessibility" => {
                if macos::accessibility_prompt() {
                    return Ok(());
                }
            }
            "microphone" => {
                if macos::microphone() == State::Missing {
                    // Opening the microphone is what asks; nothing is recorded.
                    crate::mic::probe();
                    return Ok(());
                }
            }
            "screen_recording" => {
                if macos::screen_recording_prompt() {
                    return Ok(());
                }
            }
            "full_disk_access" => {
                if let Some(app) = bundle() {
                    let _ = std::process::Command::new("/usr/bin/open").arg("-R").arg(app).status();
                }
            }
            _ => {}
        }
    }
    open_url(pane(id).ok_or("nothing to open")?)
}

/// Opens the pane only.
pub fn open(id: &str) -> Result<(), String> {
    open_url(pane(id).ok_or("nothing to open")?)
}

/// macOS: removes NeuralAgent's entry for `id` and asks again. Fixes an entry that is switched on
/// but belongs to an older signature (an update before 0.3.4): System Settings shows it on, macOS
/// says no.
pub fn repair(id: &str) -> Result<(), String> {
    let service = match id {
        "accessibility" => "Accessibility",
        "microphone" => "Microphone",
        "screen_recording" => "ScreenCapture",
        "full_disk_access" => "SystemPolicyAllFiles",
        _ => return Err("nothing to repair".into()),
    };
    let ok =
        std::process::Command::new("/usr/bin/tccutil").args(["reset", service, crate::daemon::APP_ID]).status().is_ok_and(|s| s.success());
    if !ok {
        tracing::warn!(service, "tccutil reset failed");
    }
    request(id)
}

#[cfg(target_os = "macos")]
fn bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.parent()?.parent()?.parent().filter(|b| b.extension().is_some_and(|e| e == "app")).map(|b| b.to_path_buf())
}

/// What was granted the last time this app ran: a grant that is gone after an update is worth a
/// notification. Returns the titles that were granted before and are missing now.
pub fn lost_since_last_run(data: &std::path::Path, now: &[Permission]) -> Vec<&'static str> {
    let file = data.join("permissions.json");
    let before: Vec<String> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let granted: Vec<&str> = now.iter().filter(|p| p.state == State::Granted).map(|p| p.id).collect();
    let _ = std::fs::write(&file, serde_json::to_vec(&granted).unwrap_or_default());
    now.iter().filter(|p| p.state != State::Granted && before.iter().any(|b| b == p.id)).map(|p| p.title).collect()
}

#[cfg(target_os = "macos")]
mod macos {
    use super::State;
    use std::ffi::{c_char, c_void};

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
        static kAXTrustedCheckOptionPrompt: *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDictionaryCreate(
            a: *const c_void,
            k: *const *const c_void,
            v: *const *const c_void,
            n: isize,
            kc: *const c_void,
            vc: *const c_void,
        ) -> *const c_void;
        fn CFRelease(p: *const c_void);
        static kCFBooleanTrue: *const c_void;
        static kCFTypeDictionaryKeyCallBacks: u8;
        static kCFTypeDictionaryValueCallBacks: u8;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {
        static AVMediaTypeAudio: *const c_void;
    }
    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> *const c_void;
        fn sel_registerName(name: *const c_char) -> *const c_void;
        fn objc_msgSend();
    }

    pub fn accessibility() -> bool {
        // SAFETY: no arguments, no side effects.
        unsafe { AXIsProcessTrusted() }
    }

    /// Shows macOS's "open System Settings" dialog (and lists NeuralAgent) when not trusted.
    pub fn accessibility_prompt() -> bool {
        // SAFETY: a one-entry CFDictionary of CF constants, released after use.
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [kCFBooleanTrue];
            let dict = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks as *const u8 as *const c_void,
                &kCFTypeDictionaryValueCallBacks as *const u8 as *const c_void,
            );
            let ok = AXIsProcessTrustedWithOptions(dict);
            if !dict.is_null() {
                CFRelease(dict);
            }
            ok
        }
    }

    pub fn screen_recording() -> bool {
        // SAFETY: no arguments; does not prompt.
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    pub fn screen_recording_prompt() -> bool {
        // SAFETY: no arguments; prompts once.
        unsafe { CGRequestScreenCaptureAccess() }
    }

    /// `[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]` (does not prompt).
    pub fn microphone() -> State {
        // SAFETY: objc_msgSend cast to the method's real signature (class, selector, NSString*)
        // → NSInteger; the class and constant come from the linked AVFoundation.
        let status = unsafe {
            let cls = objc_getClass(c"AVCaptureDevice".as_ptr());
            if cls.is_null() {
                return State::Unknown;
            }
            let sel = sel_registerName(c"authorizationStatusForMediaType:".as_ptr());
            let send: unsafe extern "C" fn(*const c_void, *const c_void, *const c_void) -> isize =
                std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            send(cls, sel, AVMediaTypeAudio)
        };
        match status {
            3 => State::Granted,
            0 => State::Missing,
            _ => State::Denied, // 1 restricted, 2 denied
        }
    }

    /// Opening the TCC database works only with Full Disk Access, and never shows a dialog.
    pub fn full_disk_access() -> bool {
        let Some(home) = dirs::home_dir() else { return false };
        match std::fs::File::open(home.join("Library/Application Support/com.apple.TCC/TCC.db")) {
            Ok(_) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::File::open("/Library/Application Support/com.apple.TCC/TCC.db").is_ok()
            }
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panes() {
        if cfg!(target_os = "macos") {
            assert!(pane("full_disk_access").unwrap().ends_with("Privacy_AllFiles"));
            assert!(pane("nope").is_none());
        }
    }

    #[test]
    fn lists_without_asking() {
        // Only checks; must not block or show anything.
        let l = list();
        if cfg!(target_os = "macos") {
            assert_eq!(
                l.iter().map(|p| p.id).collect::<Vec<_>>(),
                ["full_disk_access", "accessibility", "microphone", "screen_recording", "automation"]
            );
        }
    }

    #[test]
    fn notices_a_lost_grant() {
        let dir = std::env::temp_dir().join(format!("na-perm-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = |id, state| Permission { id, title: id, detail: "", state, remote: false, optional: false };
        assert!(lost_since_last_run(&dir, &[p("accessibility", State::Granted), p("microphone", State::Missing)]).is_empty());
        assert_eq!(lost_since_last_run(&dir, &[p("accessibility", State::Missing), p("microphone", State::Granted)]), ["accessibility"]);
        assert!(lost_since_last_run(&dir, &[p("accessibility", State::Missing)]).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
