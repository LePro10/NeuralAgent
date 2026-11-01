//! macOS: the system output volume (Core Audio, no permission needed) and the own volume of
//! Music and Spotify (Apple Events, only after the user allowed it once in Settings).
//!
//! macOS has no public API to lower other apps; per-app volume needs either the apps' scripting
//! or a Core Audio process tap that re-plays all audio (a "record system audio" prompt and a
//! real-time audio path for a volume knob). See `docs/notes/ducking.md`.

use std::ffi::{c_char, c_void};
use std::process::Command;
use std::time::Duration;

use super::{Backend, DuckApp, Target};

type ObjectId = u32;
type OsStatus = i32;

#[repr(C)]
struct Address {
    selector: u32,
    scope: u32,
    element: u32,
}

const fn code(b: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*b)
}

const SYSTEM_OBJECT: ObjectId = 1;
const SCOPE_GLOBAL: u32 = code(b"glob");
const SCOPE_OUTPUT: u32 = code(b"outp");
const ELEMENT_MAIN: u32 = 0;
const DEFAULT_OUTPUT: u32 = code(b"dOut");
const DEVICES: u32 = code(b"dev#");
const DEVICE_UID: u32 = code(b"uid ");
/// kAudioHardwareServiceDeviceProperty_VirtualMainVolume: the volume slider, 0..1.
const MAIN_VOLUME: u32 = code(b"vmvc");
const MUTE: u32 = code(b"mute");
/// kAudioDevicePropertyDeviceIsRunningSomewhere: some process plays (or records) on it.
const RUNNING_SOMEWHERE: u32 = code(b"gone");
const UTF8: u32 = 0x0800_0100;

#[link(name = "CoreAudio", kind = "framework")]
unsafe extern "C" {
    fn AudioObjectGetPropertyData(
        id: ObjectId,
        addr: *const Address,
        qsize: u32,
        qdata: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> OsStatus;
    fn AudioObjectGetPropertyDataSize(id: ObjectId, addr: *const Address, qsize: u32, qdata: *const c_void, size: *mut u32) -> OsStatus;
    fn AudioObjectSetPropertyData(
        id: ObjectId,
        addr: *const Address,
        qsize: u32,
        qdata: *const c_void,
        size: u32,
        data: *const c_void,
    ) -> OsStatus;
    fn AudioObjectIsPropertySettable(id: ObjectId, addr: *const Address, settable: *mut u8) -> OsStatus;
}

// The virtual main volume is implemented in AudioToolbox (AudioHardwareService).
#[link(name = "AudioToolbox", kind = "framework")]
unsafe extern "C" {}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringGetCString(s: *const c_void, buf: *mut c_char, len: isize, encoding: u32) -> u8;
    fn CFRelease(cf: *const c_void);
}

fn addr(selector: u32, scope: u32) -> Address {
    Address { selector, scope, element: ELEMENT_MAIN }
}

/// Reads a plain value property (`u32`, `f32`, an object id).
fn get<T: Copy + Default>(id: ObjectId, selector: u32, scope: u32) -> Option<T> {
    let mut v = T::default();
    let mut size = size_of::<T>() as u32;
    let a = addr(selector, scope);
    // SAFETY: `v` is a valid out buffer of `size` bytes for a property of that type.
    let st = unsafe { AudioObjectGetPropertyData(id, &a, 0, std::ptr::null(), &mut size, (&mut v as *mut T).cast()) };
    (st == 0 && size as usize == size_of::<T>()).then_some(v)
}

fn default_output() -> Option<ObjectId> {
    get::<u32>(SYSTEM_OBJECT, DEFAULT_OUTPUT, SCOPE_GLOBAL).filter(|&d| d != 0)
}

fn uid(dev: ObjectId) -> Option<String> {
    let a = addr(DEVICE_UID, SCOPE_GLOBAL);
    let mut s: *const c_void = std::ptr::null();
    let mut size = size_of::<*const c_void>() as u32;
    // SAFETY: the property is a CFStringRef we own afterwards (released below).
    let st = unsafe { AudioObjectGetPropertyData(dev, &a, 0, std::ptr::null(), &mut size, (&mut s as *mut *const c_void).cast()) };
    if st != 0 || s.is_null() {
        return None;
    }
    let mut buf = [0 as c_char; 512];
    // SAFETY: `s` is a valid CFString, `buf` has the length we pass.
    let ok = unsafe { CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, UTF8) } != 0;
    // SAFETY: we own the reference returned by the property getter.
    unsafe { CFRelease(s) };
    // SAFETY: CFStringGetCString wrote a NUL-terminated string on success.
    ok.then(|| unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned())
}

fn devices() -> Vec<ObjectId> {
    let a = addr(DEVICES, SCOPE_GLOBAL);
    let mut size = 0u32;
    // SAFETY: size query only.
    if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &a, 0, std::ptr::null(), &mut size) } != 0 {
        return Vec::new();
    }
    let mut ids = vec![0u32; size as usize / size_of::<u32>()];
    // SAFETY: `ids` holds `size` bytes.
    let st = unsafe { AudioObjectGetPropertyData(SYSTEM_OBJECT, &a, 0, std::ptr::null(), &mut size, ids.as_mut_ptr().cast()) };
    if st != 0 {
        return Vec::new();
    }
    ids.truncate(size as usize / size_of::<u32>());
    ids
}

/// The device with this UID (also when it is no longer the default output).
fn device(uid_: &str) -> Option<ObjectId> {
    if let Some(d) = default_output()
        && uid(d).as_deref() == Some(uid_)
    {
        return Some(d);
    }
    devices().into_iter().find(|&d| uid(d).as_deref() == Some(uid_))
}

fn volume(dev: ObjectId) -> Option<f32> {
    get::<f32>(dev, MAIN_VOLUME, SCOPE_OUTPUT).filter(|v| v.is_finite())
}

fn settable(dev: ObjectId) -> bool {
    let a = addr(MAIN_VOLUME, SCOPE_OUTPUT);
    let mut s = 0u8;
    // SAFETY: plain out parameter.
    unsafe { AudioObjectIsPropertySettable(dev, &a, &mut s) == 0 && s != 0 }
}

fn set_volume(dev: ObjectId, v: f32) -> bool {
    let a = addr(MAIN_VOLUME, SCOPE_OUTPUT);
    let v = v.clamp(0.0, 1.0);
    // SAFETY: an f32 property, passed by pointer with its size.
    unsafe { AudioObjectSetPropertyData(dev, &a, 0, std::ptr::null(), size_of::<f32>() as u32, (&v as *const f32).cast()) == 0 }
}

/// The current system output volume (0..1) and its device UID, for the manual check.
#[cfg(test)]
fn system_volume() -> Option<(String, f32)> {
    let d = default_output()?;
    Some((uid(d)?, volume(d)?))
}

/// The default output's volume slider. Digital outputs (HDMI, some USB DACs) have none: then
/// nothing is lowered.
pub struct System;

impl Backend for System {
    fn scan(&mut self) -> Vec<Target> {
        let Some(dev) = default_output() else { return Vec::new() };
        if get::<u32>(dev, MUTE, SCOPE_OUTPUT).unwrap_or(0) != 0 || !settable(dev) {
            return Vec::new();
        }
        let (Some(id), Some(v)) = (uid(dev), volume(dev)) else { return Vec::new() };
        let playing = get::<u32>(dev, RUNNING_SOMEWHERE, SCOPE_GLOBAL).is_none_or(|r| r != 0);
        vec![Target { id, volume: v, playing }]
    }

    fn get(&mut self, id: &str) -> Option<f32> {
        volume(device(id)?)
    }

    fn set(&mut self, id: &str, v: f32) -> Option<f32> {
        let dev = device(id)?;
        set_volume(dev, v).then(|| volume(dev)).flatten()
    }
}

// --- Music and Spotify ---

/// Players whose own volume can be lowered (bundle id, name). Browsers have no volume to script.
const PLAYERS: [(&str, &str); 2] = [("com.apple.Music", "Music"), ("com.spotify.client", "Spotify")];

#[repr(C)]
struct AeDesc {
    descriptor_type: u32,
    data_handle: *mut c_void,
}

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn AECreateDesc(type_code: u32, data: *const c_void, size: isize, result: *mut AeDesc) -> i16;
    fn AEDisposeDesc(desc: *mut AeDesc) -> i16;
    fn AEDeterminePermissionToAutomateTarget(target: *const AeDesc, event_class: u32, event_id: u32, ask: u8) -> OsStatus;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Access {
    Allowed,
    Denied,
    Ask,
    Closed,
}

/// May we send Apple Events to `bundle`? With `ask`, macOS shows its prompt (once per app).
fn access(bundle: &str, ask: bool) -> Access {
    let mut desc = AeDesc { descriptor_type: 0, data_handle: std::ptr::null_mut() };
    // SAFETY: AECreateDesc copies the bytes; the descriptor is disposed below.
    if unsafe { AECreateDesc(code(b"bund"), bundle.as_ptr().cast(), bundle.len() as isize, &mut desc) } != 0 {
        return Access::Denied;
    }
    let any = code(b"****");
    // SAFETY: a valid descriptor; may block while the system prompt is open (never on the main thread).
    let st = unsafe { AEDeterminePermissionToAutomateTarget(&desc, any, any, ask as u8) };
    // SAFETY: created above.
    unsafe { AEDisposeDesc(&mut desc) };
    match st {
        0 => Access::Allowed,
        -1744 => Access::Ask,
        -600 => Access::Closed,
        _ => Access::Denied,
    }
}

/// The players and whether they may be lowered. `ask`: show the system prompt for running ones
/// that were never asked (the Allow button; never called from a remote device).
pub fn apps(ask: bool) -> Vec<DuckApp> {
    PLAYERS
        .iter()
        .map(|(bundle, name)| {
            let a = access(bundle, ask);
            let access = match a {
                Access::Allowed => "allowed",
                Access::Denied => "denied",
                Access::Ask => "ask",
                Access::Closed => "closed",
            };
            DuckApp { name: (*name).into(), access: access.into() }
        })
        .collect()
}

/// AppleScript that never launches a player: every `tell` sits behind `is running`.
fn script(bundle: &str, body: &str) -> String {
    format!("if application id \"{bundle}\" is running then\ntell application id \"{bundle}\"\n{body}\nend tell\nend if")
}

fn osascript(src: &str) -> Option<String> {
    let out = Command::new("/usr/bin/osascript").arg("-e").arg(src).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Music and Spotify, only those running and allowed (checked without asking every time).
#[derive(Default)]
pub struct Players;

impl Backend for Players {
    fn scan(&mut self) -> Vec<Target> {
        let mut out = Vec::new();
        for (bundle, _) in PLAYERS {
            if access(bundle, false) != Access::Allowed {
                continue;
            }
            let body = "return (sound volume as text) & \" \" & ((player state is playing) as text)";
            let Some(line) = osascript(&script(bundle, body)) else { continue };
            let mut parts = line.split_whitespace();
            let (Some(v), Some(p)) = (parts.next().and_then(|v| v.parse::<f32>().ok()), parts.next()) else { continue };
            out.push(Target { id: bundle.into(), volume: v / 100.0, playing: p == "true" });
        }
        out
    }

    fn get(&mut self, id: &str) -> Option<f32> {
        if access(id, false) != Access::Allowed {
            return None;
        }
        osascript(&script(id, "return sound volume"))?.parse::<f32>().ok().map(|v| v / 100.0)
    }

    fn set(&mut self, id: &str, v: f32) -> Option<f32> {
        if !PLAYERS.iter().any(|(b, _)| *b == id) || access(id, false) != Access::Allowed {
            return None;
        }
        let n = (v * 100.0).round().clamp(0.0, 100.0) as u32;
        // Spotify sometimes lands one below what was set; one more nudge fixes that.
        let body = format!("set sound volume to {n}\nif sound volume < {n} then set sound volume to {}\nreturn sound volume", n + 1);
        osascript(&script(id, &body))?.parse::<f32>().ok().map(|v| v / 100.0)
    }

    fn every(&self) -> Duration {
        Duration::from_millis(150)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads the system volume, lowers it a little for a moment and puts the exact value back.
    /// Touches the real output, so only by hand: `cargo test -p neuralagent-desktop -- --ignored system_volume`.
    #[test]
    #[ignore]
    fn system_volume_round_trip() {
        let mut s = System;
        let Some(t) = s.scan().into_iter().next() else { return eprintln!("no controllable output") };
        eprintln!("output {} at {:.4}, playing: {}", t.id, t.volume, t.playing);
        let low = s.set(&t.id, t.volume * 0.8).expect("set");
        std::thread::sleep(Duration::from_millis(200));
        let back = s.set(&t.id, t.volume).expect("restore");
        eprintln!("lowered to {low:.4}, back to {back:.4}");
        assert_eq!(back, t.volume);
        assert_eq!(system_volume().map(|v| v.1), Some(t.volume));
    }

    /// The real worker on the real output: a dictation of half a second, lowered to 50 %, then
    /// back. By hand only: `cargo test -p neuralagent-desktop -- --ignored real_fade`.
    #[test]
    #[ignore]
    fn real_fade_restores_exactly() {
        use super::super::{Activity, Duck, Msg, Route, Settings, Worker};
        let Some((_, before)) = system_volume() else { return };
        let dir = std::env::temp_dir().join(format!("na-duck-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let w = Worker::new(vec![Duck::new(Route::System, System)], dir.join("duck.json"));
        let (tx, rx) = std::sync::mpsc::channel();
        let h = std::thread::spawn(move || w.run(rx));
        tx.send(Msg::Settings(Settings { on: true, level: 0.5 })).unwrap();
        tx.send(Msg::Voice(Activity::Listening)).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let low = system_volume().unwrap().1;
        tx.send(Msg::Voice(Activity::Idle)).unwrap();
        std::thread::sleep(Duration::from_millis(1800));
        let after = system_volume().unwrap().1;
        drop(tx);
        h.join().unwrap();
        eprintln!("before {before:.4}, lowered {low:.4}, after {after:.4}");
        assert_eq!(after, before);
        assert!(low < before || before < 0.02);
    }

    #[test]
    fn scripts_never_launch_a_player() {
        let s = script("com.spotify.client", "return sound volume");
        assert!(s.starts_with("if application id \"com.spotify.client\" is running then"));
    }
}
