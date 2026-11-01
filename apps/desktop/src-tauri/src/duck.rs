//! Lowers other audio while the user talks to the computer (D73, `docs/notes/ducking.md`): while
//! the dictation hotkey is held, after "Hey Neural", and during a call in this app. Music keeps
//! playing in the background, quietly, and comes back with a fade when the user is done.
//!
//! What gets lowered depends on the OS ([`routes`]): on macOS the system output volume for
//! dictation (this app plays nothing then) and, only if the user allowed it, Music and Spotify
//! in calls (Neural's voice must stay loud). On Windows and Linux every other app's own volume.
//!
//! The original volumes are saved to `<data>/duck.json` before anything changes and put back on
//! the next start if the app died while audio was lowered. A volume the user changes while it is
//! lowered is theirs: it is left alone and not "restored" over their choice.
//!
//! A device or player that goes away while lowered (AirPods taken off, Spotify quit) keeps the low
//! volume it had. It is remembered (also in `duck.json`, for up to [`GONE_FOR`]) and its volume is
//! put back when it returns, or lowered from its real volume again if a duck is still running.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::voice::Activity;

#[cfg(any(target_os = "linux", test))]
mod linux;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "windows")]
mod win;

/// How far other audio goes down, in percent of where it was, unless the user picked another level.
pub const DEFAULT_LEVEL: u8 = 20;
const FADE_DOWN: Duration = Duration::from_millis(300);
const FADE_UP: Duration = Duration::from_millis(600);
/// Audio stays low this long after the last reason ended: quick re-presses and "Hey Neural" →
/// command → done do not pump the music up and down.
const HOLD: Duration = Duration::from_millis(800);
/// While lowered, look again this often for audio that started since (a new song, a new tab).
const RESCAN: Duration = Duration::from_secs(1);
/// A volume that moved this far from what we set was changed by the user (or another app).
const TOUCHED: f32 = 0.02;
/// Below this there is nothing worth lowering.
const SILENT: f32 = 0.01;
/// While a lowered device or app is gone, look this often whether it is back.
const REVIVE_EVERY: Duration = Duration::from_secs(2);
/// A device gone longer than this is forgotten (its volume is not put back any more).
const GONE_FOR: Duration = Duration::from_secs(30 * 24 * 3600);

/// Why other audio is lowered. Several can be on at once (dictating during a call).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Dictation,
    Wake,
    Call,
}

impl Reason {
    const fn bit(self) -> u8 {
        match self {
            Reason::Dictation => 1,
            Reason::Wake => 2,
            Reason::Call => 4,
        }
    }
}

/// What a backend lowers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    /// The whole output (macOS dictation and wake word: this app is silent then).
    System,
    /// Other apps one by one (Windows sessions, Linux streams, Music/Spotify on macOS).
    Apps,
}

/// Whether `route` goes down for the active `reasons` on this OS.
fn wanted(route: Route, reasons: u8) -> bool {
    let talking = Reason::Dictation.bit() | Reason::Wake.bit();
    if cfg!(target_os = "macos") {
        // The system volume would make Neural's voice quieter too, so calls only touch apps.
        match route {
            Route::System => reasons & talking != 0,
            Route::Apps => reasons & Reason::Call.bit() != 0,
        }
    } else {
        reasons != 0
    }
}

/// One volume that can be lowered: the system output or one app's.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub id: String,
    /// 0..1 (Linux can go above 1).
    pub volume: f32,
    /// Something is playing there now (when unknown: true).
    pub playing: bool,
}

/// The OS side: reads and sets volumes. Used from one worker thread only.
pub trait Backend: Send {
    /// What can be lowered right now.
    fn scan(&mut self) -> Vec<Target>;
    /// The current volume of `id`, or `None` when it is gone.
    fn get(&mut self, id: &str) -> Option<f32> {
        self.scan().into_iter().find(|t| t.id == id).map(|t| t.volume)
    }
    /// Sets the volume of `id`; returns the volume now in effect (devices round), `None` when gone.
    fn set(&mut self, id: &str, volume: f32) -> Option<f32>;
    /// How often a fade step may run (spawning a helper per step is slower than an API call).
    fn every(&self) -> Duration {
        Duration::from_millis(25)
    }
}

impl Backend for Box<dyn Backend> {
    fn scan(&mut self) -> Vec<Target> {
        (**self).scan()
    }
    fn get(&mut self, id: &str) -> Option<f32> {
        (**self).get(id)
    }
    fn set(&mut self, id: &str, volume: f32) -> Option<f32> {
        (**self).set(id, volume)
    }
    fn every(&self) -> Duration {
        (**self).every()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Lowered {
    id: String,
    original: f32,
    /// What we set last (as read back); anything else means the user changed it.
    #[serde(skip)]
    set: f32,
}

/// A lowered volume whose device or app went away (unplugged, quit) before it was put back.
#[derive(Clone, Debug, PartialEq)]
struct Gone {
    id: String,
    original: f32,
    /// The volume it had when it went (what it will have when it comes back).
    last: f32,
    /// Unix seconds.
    since: u64,
}

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// One route's fade: depth 0 is untouched, 1 is fully lowered.
pub struct Duck<B> {
    pub route: Route,
    backend: B,
    lowered: Vec<Lowered>,
    /// Changed by the user during this duck: not lowered again until audio is back up.
    left: Vec<String>,
    depth: f32,
    /// Lowered until then (the hold after the last reason ended).
    until: Option<Instant>,
    last_step: Option<Instant>,
    last_scan: Option<Instant>,
    /// The (depth, level) last applied: while fully lowered nothing is set again, and the volumes
    /// are only read back on a rescan (a long call must not spawn `osascript` 7 times a second).
    applied: Option<(f32, f32)>,
    /// Lowered volumes whose device or app went away; put back when they return.
    gone: Vec<Gone>,
    last_revive: Option<Instant>,
}

impl<B: Backend> Duck<B> {
    pub fn new(route: Route, backend: B) -> Self {
        Self {
            route,
            backend,
            lowered: Vec::new(),
            left: Vec::new(),
            depth: 0.0,
            until: None,
            last_step: None,
            last_scan: None,
            applied: None,
            gone: Vec::new(),
            last_revive: None,
        }
    }

    /// Needs more steps (fading, holding or lowered).
    fn busy(&self) -> bool {
        self.depth > 0.0 || self.until.is_some() || !self.lowered.is_empty()
    }

    /// Advances the fade to `now`. `want`: a reason for this route is active; `level`: 0..1.
    pub fn step(&mut self, want: bool, level: f32, now: Instant) {
        if want {
            self.until = Some(now + HOLD);
        }
        let down = self.until.is_some_and(|u| now < u);
        if !down {
            self.until = None;
        }
        if self.last_step.is_some_and(|t| now.duration_since(t) < self.backend.every()) {
            return;
        }
        let dt = self.last_step.map_or(self.backend.every(), |t| now.duration_since(t));
        self.last_step = Some(now);
        let rescan = down && self.last_scan.is_none_or(|t| now.duration_since(t) >= RESCAN);
        if !self.gone.is_empty() && (rescan || self.last_revive.is_none_or(|t| now.duration_since(t) >= REVIVE_EVERY)) {
            self.last_revive = Some(now);
            // Before `add_playing`: a returning device must not be taken with its low volume as
            // its "original".
            self.revive(down);
        }
        if rescan {
            self.last_scan = Some(now);
            self.add_playing();
        }
        if !self.lowered.is_empty() {
            self.depth =
                if down { (self.depth + secs(dt) / secs(FADE_DOWN)).min(1.0) } else { (self.depth - secs(dt) / secs(FADE_UP)).max(0.0) };
            if rescan || self.applied != Some((self.depth, level)) {
                self.apply(level);
                self.applied = Some((self.depth, level));
            }
        }
        if self.lowered.is_empty() {
            self.depth = 0.0;
        }
        if self.depth == 0.0 && !down {
            self.end();
        }
    }

    /// Back to untouched: the next duck starts fresh.
    fn end(&mut self) {
        self.lowered.clear();
        self.left.clear();
        self.depth = 0.0;
        self.until = None;
        self.last_step = None;
        self.last_scan = None;
        self.applied = None;
    }

    /// Starts managing whatever plays now and is not lowered yet.
    fn add_playing(&mut self) {
        for t in self.backend.scan() {
            if t.playing && t.volume > SILENT && !self.lowered.iter().any(|l| l.id == t.id) && !self.left.contains(&t.id) {
                self.lowered.push(Lowered { id: t.id, original: t.volume, set: t.volume });
            }
        }
    }

    /// Devices and apps that went away while lowered and are back: put their volume back, or,
    /// while still lowering (`down`), manage them again from their real volume.
    fn revive(&mut self, down: bool) {
        let now_s = unix_now();
        let (backend, lowered) = (&mut self.backend, &mut self.lowered);
        self.gone.retain(|g| {
            if now_s.saturating_sub(g.since) > GONE_FOR.as_secs() {
                return false;
            }
            let Some(v) = backend.get(&g.id) else { return true };
            if v < g.last.min(g.original) - TOUCHED || v > g.original + TOUCHED {
                tracing::info!(id = %g.id, "came back at a volume set by the user; leaving it");
                return false;
            }
            if down {
                lowered.retain(|l| l.id != g.id);
                lowered.push(Lowered { id: g.id.clone(), original: g.original, set: v });
            } else if backend.set(&g.id, g.original).is_some() {
                tracing::info!(id = %g.id, "came back; put its volume back");
            }
            false
        });
    }

    fn apply(&mut self, level: f32) {
        let depth = smooth(self.depth);
        let (backend, left, gone) = (&mut self.backend, &mut self.left, &mut self.gone);
        let went = |l: &Lowered, gone: &mut Vec<Gone>| {
            tracing::info!(id = %l.id, "went away while lowered; its volume is put back when it returns");
            gone.retain(|g| g.id != l.id);
            gone.push(Gone { id: l.id.clone(), original: l.original, last: l.set, since: unix_now() });
        };
        self.lowered.retain_mut(|l| {
            let Some(now) = backend.get(&l.id) else {
                went(l, gone);
                return false;
            };
            if (now - l.set).abs() > TOUCHED {
                tracing::info!(id = %l.id, "volume changed by the user while lowered; leaving it");
                left.push(l.id.clone());
                return false;
            }
            let v = if depth == 0.0 { l.original } else { l.original * (1.0 - (1.0 - level) * depth) };
            match backend.set(&l.id, v) {
                Some(actual) => {
                    l.set = actual;
                    true
                }
                None => {
                    went(l, gone);
                    false
                }
            }
        });
    }

    /// Puts everything back at once (app exit).
    pub fn restore_now(&mut self) {
        self.depth = 0.0;
        self.apply(0.0);
        self.end();
    }

    fn saved(&self, level: f32) -> Vec<Saved> {
        let lowered = self.lowered.iter().map(|l| Saved {
            route: self.route,
            id: l.id.clone(),
            original: l.original,
            low: l.original * level,
            gone: None,
        });
        let gone =
            self.gone.iter().map(|g| Saved { route: self.route, id: g.id.clone(), original: g.original, low: g.last, gone: Some(g.since) });
        lowered.chain(gone).collect()
    }

    /// After a crash or quit: puts a saved volume back if it still is where we left it. One whose
    /// device is not there now is remembered and put back when it returns.
    fn recover(&mut self, s: &Saved) -> bool {
        let Some(now) = self.backend.get(&s.id) else {
            if !self.gone.iter().any(|g| g.id == s.id) {
                self.gone.push(Gone { id: s.id.clone(), original: s.original, last: s.low, since: s.gone.unwrap_or_else(unix_now) });
            }
            return false;
        };
        let (lo, hi) = (s.low.min(s.original) - TOUCHED, s.original + TOUCHED);
        if now < lo || now > hi {
            return false;
        }
        self.backend.set(&s.id, s.original).is_some()
    }
}

fn secs(d: Duration) -> f32 {
    d.as_secs_f32()
}

/// Smoothstep: soft at both ends of the fade.
fn smooth(x: f32) -> f32 {
    x * x * (3.0 - 2.0 * x)
}

/// What `<data>/duck.json` holds while audio is lowered.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Saved {
    route: Route,
    id: String,
    original: f32,
    /// The fully lowered volume (a value between it and `original` is still ours). For a gone
    /// one: the volume it had when it went.
    low: f32,
    /// Unix seconds since its device or app went away (unplugged, quit); put back when it returns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gone: Option<u64>,
}

fn save(path: &Path, saved: &[Saved]) {
    if saved.is_empty() {
        let _ = std::fs::remove_file(path);
        return;
    }
    let tmp = path.with_extension("json.tmp");
    if let Ok(bytes) = serde_json::to_vec(saved)
        && std::fs::write(&tmp, bytes).is_ok()
    {
        let _ = std::fs::rename(&tmp, path);
    }
}

// --- The worker ---

#[derive(Clone, Copy, Debug, PartialEq)]
struct Settings {
    on: bool,
    level: f32,
}

enum Msg {
    Reason(Reason, bool),
    Voice(Activity),
    Settings(Settings),
    Stop(Sender<()>),
}

/// The routes this OS has.
fn routes() -> Vec<Duck<Box<dyn Backend>>> {
    #[allow(unused_mut)]
    let mut routes: Vec<Duck<Box<dyn Backend>>> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        routes.push(Duck::new(Route::System, Box::new(mac::System) as Box<dyn Backend>));
        routes.push(Duck::new(Route::Apps, Box::new(mac::Players) as Box<dyn Backend>));
    }
    #[cfg(target_os = "windows")]
    routes.push(Duck::new(Route::Apps, Box::new(win::Sessions::default()) as Box<dyn Backend>));
    #[cfg(target_os = "linux")]
    routes.push(Duck::new(Route::Apps, Box::new(linux::Streams::default()) as Box<dyn Backend>));
    routes
}

struct Worker<B> {
    routes: Vec<Duck<B>>,
    store: PathBuf,
    reasons: u8,
    settings: Settings,
    saved: Vec<Saved>,
}

impl<B: Backend> Worker<B> {
    fn new(routes: Vec<Duck<B>>, store: PathBuf) -> Self {
        let mut w =
            Self { routes, store, reasons: 0, settings: Settings { on: true, level: DEFAULT_LEVEL as f32 / 100.0 }, saved: Vec::new() };
        w.recover();
        w
    }

    /// Puts back what a previous run left lowered.
    fn recover(&mut self) {
        let Ok(bytes) = std::fs::read(&self.store) else { return };
        let saved: Vec<Saved> = serde_json::from_slice(&bytes).unwrap_or_default();
        for s in &saved {
            if let Some(d) = self.routes.iter_mut().find(|d| d.route == s.route)
                && d.recover(s)
            {
                tracing::info!(id = %s.id, "put back a volume left lowered by the last run");
            }
        }
        let _ = std::fs::remove_file(&self.store);
        // Volumes whose device is away now stay saved until it returns.
        self.persist();
    }

    fn handle(&mut self, msg: &Msg) {
        match *msg {
            Msg::Reason(r, on) => self.reasons = if on { self.reasons | r.bit() } else { self.reasons & !r.bit() },
            Msg::Voice(a) => {
                let mut r = self.reasons & !(Reason::Dictation.bit() | Reason::Wake.bit());
                match a {
                    Activity::Listening => r |= Reason::Dictation.bit(),
                    Activity::Awake => r |= Reason::Wake.bit(),
                    _ => {}
                }
                self.reasons = r;
            }
            Msg::Settings(s) => self.settings = s,
            Msg::Stop(_) => {}
        }
    }

    fn step(&mut self, now: Instant) {
        let Settings { on, level } = self.settings;
        for d in &mut self.routes {
            let want = on && wanted(d.route, self.reasons);
            d.step(want, level, now);
        }
        self.persist();
    }

    fn persist(&mut self) {
        let saved: Vec<Saved> = self.routes.iter().flat_map(|d| d.saved(self.settings.level)).collect();
        // Only the set of lowered volumes matters (not every fade step).
        let key = |v: &[Saved]| v.iter().map(|s| (s.route, s.id.clone(), s.original.to_bits(), s.gone.is_some())).collect::<Vec<_>>();
        if key(&saved) != key(&self.saved) {
            save(&self.store, &saved);
            self.saved = saved;
        }
    }

    fn busy(&self) -> bool {
        (self.settings.on && self.reasons != 0) || self.routes.iter().any(Duck::busy)
    }

    fn restore_now(&mut self) {
        for d in &mut self.routes {
            d.restore_now();
        }
        self.persist();
    }

    fn run(mut self, rx: Receiver<Msg>) {
        loop {
            let wait = if self.busy() {
                Some(Duration::from_millis(25))
            } else if self.routes.iter().any(|d| !d.gone.is_empty()) {
                Some(REVIVE_EVERY)
            } else {
                None
            };
            let msg = if let Some(wait) = wait {
                match rx.recv_timeout(wait) {
                    Ok(m) => Some(m),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            } else {
                match rx.recv() {
                    Ok(m) => Some(m),
                    Err(_) => break,
                }
            };
            if let Some(Msg::Stop(done)) = &msg {
                self.restore_now();
                let _ = done.send(());
                return;
            }
            if let Some(m) = &msg {
                self.handle(m);
            }
            self.step(Instant::now());
        }
        self.restore_now();
    }
}

/// Managed Tauri state: the channel to the worker thread.
pub struct Ducking {
    tx: Mutex<Sender<Msg>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Ducking {
    /// Starts the worker; it first puts back volumes a crashed run left lowered.
    pub fn start(data: &Path) -> Self {
        let (tx, rx) = mpsc::channel();
        let store = data.join("duck.json");
        let thread = std::thread::Builder::new()
            .name("duck".into())
            .spawn(move || Worker::new(routes(), store).run(rx))
            .map_err(|e| tracing::warn!("audio ducking: {e}"))
            .ok();
        Self { tx: Mutex::new(tx), thread: Mutex::new(thread) }
    }

    fn send(&self, msg: Msg) {
        let _ = self.tx.lock().send(msg);
    }

    /// Restores everything and stops (app exit). Waits at most half a second.
    pub fn shutdown(&self) {
        let (done, wait) = mpsc::channel();
        self.send(Msg::Stop(done));
        if wait.recv_timeout(Duration::from_millis(500)).is_ok()
            && let Some(t) = self.thread.lock().take()
        {
            let _ = t.join();
        }
    }
}

/// Dictation or the wake word changed state (called from `voice.rs`).
pub fn voice(app: &AppHandle, activity: Activity) {
    if let Some(d) = app.try_state::<Ducking>() {
        d.send(Msg::Voice(activity));
    }
}

/// The user's settings (Settings → Voice → Other audio).
pub fn configure(app: &AppHandle, on: bool, level: u8) {
    if let Some(d) = app.try_state::<Ducking>() {
        d.send(Msg::Settings(Settings { on, level: f32::from(level.clamp(0, 100)) / 100.0 }));
    }
}

/// A call runs in this app's window (the UI reports it).
#[tauri::command]
pub fn duck_call(app: AppHandle, on: bool) {
    if let Some(d) = app.try_state::<Ducking>() {
        d.send(Msg::Reason(Reason::Call, on));
    }
}

/// An app whose volume may be lowered in calls, and whether the user allowed it (macOS).
#[derive(Clone, Debug, Serialize)]
pub struct DuckApp {
    pub name: String,
    /// "allowed", "denied", "ask" (not decided yet) or "closed" (not running: cannot ask now).
    pub access: String,
}

/// macOS: which players may be lowered in calls. Never asks the user.
#[tauri::command]
pub async fn duck_apps() -> Vec<DuckApp> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(|| mac::apps(false)).await.unwrap_or_default();
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

/// macOS: asks once for each running player (the user pressed Allow in Settings).
#[tauri::command]
pub async fn duck_allow_apps() -> Vec<DuckApp> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(|| mac::apps(true)).await.unwrap_or_default();
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;

    /// Volumes in a map; `step` rounds like a device with that resolution.
    #[derive(Clone, Default)]
    struct Fake {
        vols: Arc<Mutex<HashMap<String, (f32, bool)>>>,
        step: f32,
        sets: Arc<Mutex<u32>>,
    }

    impl Fake {
        fn with(items: &[(&str, f32, bool)]) -> Self {
            let f = Fake::default();
            for (id, v, playing) in items {
                f.vols.lock().insert((*id).into(), (*v, *playing));
            }
            f
        }
        fn vol(&self, id: &str) -> f32 {
            self.vols.lock()[id].0
        }
        fn user_sets(&self, id: &str, v: f32) {
            self.vols.lock().get_mut(id).unwrap().0 = v;
        }
    }

    impl Backend for Fake {
        fn scan(&mut self) -> Vec<Target> {
            let mut v: Vec<_> = self.vols.lock().iter().map(|(id, (v, p))| Target { id: id.clone(), volume: *v, playing: *p }).collect();
            v.sort_by(|a, b| a.id.cmp(&b.id));
            v
        }
        fn set(&mut self, id: &str, volume: f32) -> Option<f32> {
            *self.sets.lock() += 1;
            let mut vols = self.vols.lock();
            let e = vols.get_mut(id)?;
            e.0 = if self.step > 0.0 { (volume / self.step).round() * self.step } else { volume };
            Some(e.0)
        }
    }

    const MS: Duration = Duration::from_millis(1);

    /// Runs the worker for `ms` milliseconds of fake time in 25 ms steps.
    fn run(w: &mut Worker<Fake>, t: &mut Instant, ms: u64) {
        for _ in 0..ms / 25 {
            *t += 25 * MS;
            w.step(*t);
        }
    }

    fn worker(fake: &Fake, dir: &Path) -> Worker<Fake> {
        let route = if cfg!(target_os = "macos") { Route::System } else { Route::Apps };
        Worker::new(vec![Duck::new(route, fake.clone())], dir.join("duck.json"))
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("na-duck-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn lowers_while_dictating_and_restores_exactly() {
        let dir = tmp("basic");
        let fake = Fake::with(&[("out", 0.4375, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 100);
        let mid = fake.vol("out");
        assert!(mid < 0.4375 && mid > 0.0875, "fading: {mid}");
        assert!(dir.join("duck.json").exists(), "original saved before lowering");
        run(&mut w, &mut t, 400);
        assert!((fake.vol("out") - 0.0875).abs() < 1e-4, "20 % of 0.4375: {}", fake.vol("out"));
        w.handle(&Msg::Voice(Activity::Transcribing));
        run(&mut w, &mut t, 500);
        assert!((fake.vol("out") - 0.0875).abs() < 1e-4, "held a moment after release");
        run(&mut w, &mut t, 1200);
        assert_eq!(fake.vol("out"), 0.4375, "exact original back");
        assert!(!dir.join("duck.json").exists());
        assert!(!w.busy());
    }

    #[test]
    fn dictation_inside_a_call_keeps_the_call_lowered() {
        let dir = tmp("nest");
        // macOS has both routes; elsewhere everything goes through `Apps`.
        let out = Fake::with(&[("out", 0.5, true)]);
        let music = Fake::with(&[("music", 0.8, true)]);
        let mut w = Worker::new(vec![Duck::new(Route::System, out.clone()), Duck::new(Route::Apps, music.clone())], dir.join("duck.json"));
        let mut t = Instant::now();
        w.handle(&Msg::Reason(Reason::Call, true));
        run(&mut w, &mut t, 500);
        let low = music.vol("music");
        assert!((low - 0.16).abs() < 1e-4, "call lowers the music: {low}");
        if cfg!(target_os = "macos") {
            assert_eq!(out.vol("out"), 0.5, "a call keeps the system volume (Neural's voice)");
        }
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        assert!((out.vol("out") - 0.1).abs() < 1e-4, "dictating lowers the output");
        assert_eq!(music.vol("music"), low);
        w.handle(&Msg::Voice(Activity::Idle));
        run(&mut w, &mut t, 2000);
        assert_eq!(music.vol("music"), low, "still in the call");
        let saved: Vec<Saved> = serde_json::from_slice(&std::fs::read(dir.join("duck.json")).unwrap()).unwrap();
        if cfg!(target_os = "macos") {
            assert_eq!(out.vol("out"), 0.5, "dictation over: output back");
            assert_eq!(saved.len(), 1);
        }
        w.handle(&Msg::Reason(Reason::Call, false));
        run(&mut w, &mut t, 2000);
        assert_eq!(music.vol("music"), 0.8);
        assert_eq!(out.vol("out"), 0.5);
        assert!(!dir.join("duck.json").exists());
    }

    #[test]
    fn routes_per_os() {
        let (d, wk, c) = (Reason::Dictation.bit(), Reason::Wake.bit(), Reason::Call.bit());
        if cfg!(target_os = "macos") {
            assert!(wanted(Route::System, d) && wanted(Route::System, wk) && !wanted(Route::System, c));
            assert!(wanted(Route::Apps, c) && !wanted(Route::Apps, d));
            assert!(wanted(Route::System, d | c) && wanted(Route::Apps, d | c));
        } else {
            assert!(wanted(Route::Apps, d) && wanted(Route::Apps, wk) && wanted(Route::Apps, c));
        }
        assert!(!wanted(Route::System, 0) && !wanted(Route::Apps, 0));
    }

    #[test]
    fn a_volume_the_user_changes_is_left_alone() {
        let dir = tmp("user");
        let fake = Fake::with(&[("out", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        fake.user_sets("out", 0.3);
        run(&mut w, &mut t, 100);
        w.handle(&Msg::Voice(Activity::Idle));
        run(&mut w, &mut t, 3000);
        assert_eq!(fake.vol("out"), 0.3);
        assert!(!dir.join("duck.json").exists());
    }

    #[test]
    fn nothing_playing_is_not_touched() {
        let dir = tmp("silent");
        let fake = Fake::with(&[("out", 0.5, false)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Voice(Activity::Awake));
        run(&mut w, &mut t, 500);
        assert_eq!(*fake.sets.lock(), 0);
        // Music starts while still listening: it joins.
        fake.vols.lock().get_mut("out").unwrap().1 = true;
        run(&mut w, &mut t, 1500);
        assert!((fake.vol("out") - 0.1).abs() < 1e-4);
        w.handle(&Msg::Voice(Activity::Idle));
        run(&mut w, &mut t, 2000);
        assert_eq!(fake.vol("out"), 0.5);
    }

    #[test]
    fn off_in_settings_does_nothing_and_turning_off_restores() {
        let dir = tmp("off");
        let fake = Fake::with(&[("out", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Settings(Settings { on: false, level: 0.2 }));
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        assert_eq!(*fake.sets.lock(), 0);
        w.handle(&Msg::Settings(Settings { on: true, level: 0.35 }));
        run(&mut w, &mut t, 500);
        assert!((fake.vol("out") - 0.175).abs() < 1e-4);
        w.handle(&Msg::Settings(Settings { on: false, level: 0.35 }));
        run(&mut w, &mut t, 2000);
        assert_eq!(fake.vol("out"), 0.5);
    }

    #[test]
    fn a_long_call_does_not_keep_setting_the_volume() {
        let dir = tmp("steady");
        let fake = Fake::with(&[("out", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Reason(Reason::Call, true));
        run(&mut w, &mut t, 1000);
        let after_fade = *fake.sets.lock();
        run(&mut w, &mut t, 10_000);
        // Only the once-a-second rescan touches it while fully lowered.
        assert!(*fake.sets.lock() - after_fade <= 11, "{} sets while holding", *fake.sets.lock() - after_fade);
        fake.user_sets("out", 0.4);
        run(&mut w, &mut t, 1100);
        w.handle(&Msg::Reason(Reason::Call, false));
        run(&mut w, &mut t, 3000);
        assert_eq!(fake.vol("out"), 0.4);
    }

    #[test]
    fn rounding_devices_are_not_mistaken_for_the_user() {
        let dir = tmp("round");
        let mut fake = Fake::with(&[("out", 0.5, true)]);
        fake.step = 1.0 / 16.0;
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        assert_eq!(fake.vol("out"), 0.125, "0.1 rounded to the device's step");
        w.handle(&Msg::Voice(Activity::Idle));
        run(&mut w, &mut t, 2000);
        assert_eq!(fake.vol("out"), 0.5);
    }

    #[test]
    fn a_crash_while_lowered_is_repaired_on_the_next_start() {
        let dir = tmp("crash");
        let fake = Fake::with(&[("out", 0.6, true), ("other", 0.7, true)]);
        {
            let mut w = worker(&fake, &dir);
            let mut t = Instant::now();
            w.handle(&Msg::Voice(Activity::Listening));
            run(&mut w, &mut t, 500);
            assert!(fake.vol("out") < 0.2);
            // Dropped without restoring: the app died.
        }
        // Meanwhile the user set "other" themselves; that one stays.
        fake.user_sets("other", 0.9);
        let w = worker(&fake, &dir);
        assert_eq!(fake.vol("out"), 0.6);
        assert_eq!(fake.vol("other"), 0.9);
        assert!(!dir.join("duck.json").exists());
        drop(w);
    }

    impl Fake {
        fn unplug(&self, id: &str) -> (f32, bool) {
            self.vols.lock().remove(id).unwrap()
        }
        fn plug(&self, id: &str, v: (f32, bool)) {
            self.vols.lock().insert(id.into(), v);
        }
    }

    #[test]
    fn a_device_unplugged_while_lowered_gets_its_volume_back_when_it_returns() {
        let dir = tmp("unplug");
        let fake = Fake::with(&[("airpods", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        // AirPods taken off while lowered: the headset keeps its low volume.
        let low = fake.unplug("airpods");
        assert!(low.0 < 0.2);
        run(&mut w, &mut t, 1100);
        w.handle(&Msg::Voice(Activity::Idle));
        run(&mut w, &mut t, 2000);
        assert!(dir.join("duck.json").exists(), "remembered while it is away");
        // Put back on later: back to where the user had it.
        fake.plug("airpods", low);
        run(&mut w, &mut t, 2100);
        assert_eq!(fake.vol("airpods"), 0.5);
        assert!(!dir.join("duck.json").exists());
    }

    #[test]
    fn a_device_that_returns_during_a_duck_is_lowered_from_its_real_volume() {
        let dir = tmp("replug");
        let fake = Fake::with(&[("airpods", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Reason(Reason::Call, true));
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        let low = fake.unplug("airpods");
        run(&mut w, &mut t, 1100);
        fake.plug("airpods", low);
        run(&mut w, &mut t, 1100);
        assert!(fake.vol("airpods") < 0.2, "still lowered while the duck runs");
        w.handle(&Msg::Reason(Reason::Call, false));
        w.handle(&Msg::Voice(Activity::Idle));
        run(&mut w, &mut t, 2000);
        assert_eq!(fake.vol("airpods"), 0.5, "the original, not the low volume it came back with");
    }

    #[test]
    fn a_device_away_at_quit_is_fixed_on_a_later_start() {
        let dir = tmp("away");
        let fake = Fake::with(&[("airpods", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        let low = fake.unplug("airpods");
        w.restore_now();
        drop(w);
        // Next start: still away, so it stays saved.
        drop(worker(&fake, &dir));
        assert!(dir.join("duck.json").exists());
        fake.plug("airpods", low);
        drop(worker(&fake, &dir));
        assert_eq!(fake.vol("airpods"), 0.5);
        assert!(!dir.join("duck.json").exists());
    }

    #[test]
    fn a_returning_device_the_user_turned_up_is_left_alone() {
        let dir = tmp("touched");
        let fake = Fake::with(&[("airpods", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        fake.unplug("airpods");
        run(&mut w, &mut t, 1100);
        w.handle(&Msg::Voice(Activity::Idle));
        run(&mut w, &mut t, 2000);
        fake.plug("airpods", (0.8, true));
        run(&mut w, &mut t, 2100);
        assert_eq!(fake.vol("airpods"), 0.8);
        assert!(!dir.join("duck.json").exists());
    }

    #[test]
    fn exit_restores_at_once() {
        let dir = tmp("exit");
        let fake = Fake::with(&[("out", 0.5, true)]);
        let mut w = worker(&fake, &dir);
        let mut t = Instant::now();
        w.handle(&Msg::Reason(Reason::Call, true));
        w.handle(&Msg::Voice(Activity::Listening));
        run(&mut w, &mut t, 500);
        w.restore_now();
        assert_eq!(fake.vol("out"), 0.5);
        assert!(!dir.join("duck.json").exists());
    }

    #[test]
    fn worker_thread_restores_on_stop() {
        let dir = tmp("thread");
        let fake = Fake::with(&[("out", 0.5, true)]);
        let w = worker(&fake, &dir);
        let (tx, rx) = mpsc::channel();
        let h = std::thread::spawn(move || w.run(rx));
        tx.send(Msg::Voice(Activity::Listening)).unwrap();
        std::thread::sleep(Duration::from_millis(450));
        assert!(fake.vol("out") < 0.2);
        let (done, wait) = mpsc::channel();
        tx.send(Msg::Stop(done)).unwrap();
        wait.recv_timeout(Duration::from_secs(1)).unwrap();
        h.join().unwrap();
        assert_eq!(fake.vol("out"), 0.5);
    }
}
