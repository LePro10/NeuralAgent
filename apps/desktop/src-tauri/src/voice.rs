//! Voice on the desktop: hold a hotkey to dictate into any app, and the "Hey Neural" wake word.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use na_voice::stt::{Stt, SttKind, SttModel};
use na_voice::text::normalize;
use na_voice::vad::Vad;
use na_voice::wake::{HEY_NEURAL, Wake, WakeConfig};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::mic::Mic;
use crate::models::{self, ModelStatus, PARAKEET, SPECS, VAD, WAKE};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct VoiceConfig {
    /// Hold the hotkey, speak, release: the text is typed where the cursor is.
    pub dictation: bool,
    pub hotkey: String,
    pub wake_word: bool,
    /// Pronunciations learned from the user's own recordings (keyword lines).
    pub learned: Vec<String>,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self { dictation: true, hotkey: "Alt+Space".into(), wake_word: false, learned: Vec::new() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Activity {
    Idle,
    Listening,
    Transcribing,
    /// Woken by "Hey Neural", waiting for the command.
    Awake,
    Learning,
}

#[derive(Clone, Serialize)]
pub struct VoiceStatus {
    pub config: VoiceConfig,
    pub models: Vec<ModelStatus>,
    pub activity: Activity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Audio kept before the point where the spotter reported "Hey Neural" (it fires a moment
/// after the word, so cutting there would lose the start of the command).
const WAKE_LAG: usize = na_voice::SAMPLE_RATE as usize * 2 / 5;

/// Shortest press that counts as dictation (shorter is an accidental tap).
const MIN_SPEECH: usize = na_voice::SAMPLE_RATE as usize / 4;

pub struct Voice {
    app: AppHandle,
    root: PathBuf,
    config: Mutex<VoiceConfig>,
    stt: Mutex<Option<Arc<Stt>>>,
    recording: Mutex<Option<Mic>>,
    activity: Mutex<Activity>,
    last_text: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    downloads: Mutex<HashMap<String, (f32, Option<String>)>>,
    wake: Mutex<Option<WakeLoop>>,
}

impl Voice {
    pub fn new(app: AppHandle, data: PathBuf) -> Arc<Self> {
        let config = std::fs::read(data.join("voice.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Arc::new(Self {
            app,
            root: data.join("models"),
            config: Mutex::new(config),
            stt: Mutex::new(None),
            recording: Mutex::new(None),
            activity: Mutex::new(Activity::Idle),
            last_text: Mutex::new(None),
            error: Mutex::new(None),
            downloads: Mutex::new(HashMap::new()),
            wake: Mutex::new(None),
        })
    }

    fn config_path(&self) -> PathBuf {
        self.root.parent().unwrap_or(&self.root).join("voice.json")
    }

    pub fn status(&self) -> VoiceStatus {
        let downloads = self.downloads.lock();
        let models = SPECS
            .iter()
            .map(|s| {
                let d = downloads.get(s.id);
                ModelStatus {
                    id: s.id.into(),
                    name: s.name.into(),
                    purpose: s.purpose.into(),
                    size: s.size,
                    installed: models::path(&self.root, s.id).is_some(),
                    progress: d.filter(|d| d.1.is_none()).map(|d| d.0),
                    error: d.and_then(|d| d.1.clone()),
                }
            })
            .collect();
        VoiceStatus {
            config: self.config.lock().clone(),
            models,
            activity: *self.activity.lock(),
            last_text: self.last_text.lock().clone(),
            error: self.error.lock().clone(),
        }
    }

    fn emit(&self) {
        let _ = self.app.emit("voice", self.status());
    }

    fn set_activity(&self, a: Activity) {
        dev_log(format_args!("activity {a:?}"));
        *self.activity.lock() = a;
        crate::hud::update(&self.app, a);
        self.emit();
    }

    fn fail(&self, e: impl std::fmt::Display) {
        dev_log(format_args!("error {e}"));
        *self.error.lock() = Some(e.to_string());
        *self.activity.lock() = Activity::Idle;
        crate::hud::update(&self.app, Activity::Idle);
        self.emit();
    }

    /// Applies settings at startup or after a change: hotkey and wake word.
    pub fn apply(self: &Arc<Self>) {
        let config = self.config.lock().clone();
        let shortcuts = self.app.global_shortcut();
        let _ = shortcuts.unregister_all();
        if config.dictation
            && let Err(e) = shortcuts.register(config.hotkey.as_str())
        {
            self.fail(format!("The shortcut {} is not available: {e}", config.hotkey));
        }
        let running = self.wake.lock().take();
        drop(running);
        if config.wake_word {
            match WakeLoop::start(self.clone()) {
                Ok(w) => *self.wake.lock() = Some(w),
                Err(e) => self.fail(format!("{e:#}")),
            }
        }
        self.emit();
    }

    pub fn set_config(self: &Arc<Self>, config: VoiceConfig) -> Result<()> {
        std::fs::create_dir_all(&self.root)?;
        std::fs::write(self.config_path(), serde_json::to_vec_pretty(&config)?)?;
        *self.config.lock() = config;
        *self.error.lock() = None;
        self.apply();
        Ok(())
    }

    pub fn download(self: &Arc<Self>, id: &str) -> Result<()> {
        let spec = models::spec(id).context("unknown model")?;
        if self.downloads.lock().get(id).is_some_and(|d| d.1.is_none()) {
            return Ok(());
        }
        self.downloads.lock().insert(id.into(), (0.0, None));
        self.emit();
        let me = self.clone();
        std::thread::spawn(move || {
            let result = models::download(&me.root, spec, |p| {
                me.downloads.lock().insert(spec.id.into(), (p, None));
                me.emit();
            });
            match result {
                Ok(_) => {
                    me.downloads.lock().remove(spec.id);
                    // A model that was missing may be what the wake word waited for.
                    me.apply();
                }
                Err(e) => {
                    me.downloads.lock().insert(spec.id.into(), (0.0, Some(format!("{e:#}"))));
                    me.emit();
                }
            }
        });
        Ok(())
    }

    /// The dictation model, loaded on first use and then kept.
    fn stt(&self) -> Result<Arc<Stt>> {
        let mut slot = self.stt.lock();
        if let Some(s) = slot.as_ref() {
            return Ok(s.clone());
        }
        let dir = models::path(&self.root, PARAKEET).context("Download the dictation model in Settings → Voice first.")?;
        let s = Arc::new(Stt::load(SttModel { kind: SttKind::Parakeet, dir, language: None, threads: 4 })?);
        *slot = Some(s.clone());
        Ok(s)
    }

    // --- Push to talk ---

    pub fn press(self: &Arc<Self>) {
        if !self.config.lock().dictation || self.recording.lock().is_some() {
            return;
        }
        if models::path(&self.root, PARAKEET).is_none() {
            return self.fail("Download the dictation model in Settings → Voice first.");
        }
        match Mic::open() {
            Ok(mic) => {
                *self.recording.lock() = Some(mic);
                *self.error.lock() = None;
                self.set_activity(Activity::Listening);
                // Warm the model while the user speaks.
                let me = self.clone();
                std::thread::spawn(move || {
                    let _ = me.stt();
                });
            }
            Err(e) => self.fail(format!("{e:#}")),
        }
    }

    pub fn release(self: &Arc<Self>) {
        let Some(mic) = self.recording.lock().take() else { return };
        let samples = mic.drain();
        drop(mic);
        dev_log(format_args!("recorded {:.1} s", samples.len() as f32 / na_voice::SAMPLE_RATE as f32));
        if samples.len() < MIN_SPEECH {
            return self.set_activity(Activity::Idle);
        }
        self.set_activity(Activity::Transcribing);
        let me = self.clone();
        std::thread::spawn(move || {
            let text = me.stt().and_then(|stt| transcribe(&stt, &samples));
            match text {
                Ok(text) if text.is_empty() => me.set_activity(Activity::Idle),
                Ok(text) => {
                    dev_log(format_args!("dictated {text:?}"));
                    let typed = type_text(&me.app, &text);
                    *me.last_text.lock() = Some(text);
                    match typed {
                        Ok(()) => me.set_activity(Activity::Idle),
                        Err(e) => me.fail(format!("{e:#}")),
                    }
                }
                Err(e) => me.fail(format!("{e:#}")),
            }
        });
    }

    // --- Wake word ---

    fn wake_config(&self) -> WakeConfig {
        let learned = self.config.lock().learned.join("\n");
        let keywords = if learned.is_empty() { HEY_NEURAL.to_string() } else { format!("{HEY_NEURAL}\n{learned}") };
        WakeConfig { keywords, ..Default::default() }
    }

    /// Records the user saying "Hey Neural" once and adds how the spotter heard it.
    pub fn learn(self: &Arc<Self>) -> Result<String> {
        let dir = models::path(&self.root, WAKE).context("Download the wake word model first.")?;
        let vad_model = models::path(&self.root, VAD).context("Download the voice activity model first.")?;
        self.set_activity(Activity::Learning);
        let result = (|| {
            let mic = Mic::open()?;
            let mut vad = Vad::load(&vad_model, 0.4)?;
            let start = Instant::now();
            let mut heard = None;
            while start.elapsed() < Duration::from_secs(4) && heard.is_none() {
                if let Ok(chunk) = mic.rx.recv_timeout(Duration::from_millis(200)) {
                    heard = vad.push(&chunk).into_iter().next();
                }
            }
            let speech = heard
                .or_else(|| vad.flush().into_iter().next())
                .map(|s| s.samples)
                .context("Nothing heard. Press Record, then say \u{201c}Hey Neural\u{201d}.")?;
            na_voice::wake::learn(&dir, &speech, 2)
        })();
        *self.activity.lock() = Activity::Idle;
        let line = result?;
        let mut config = self.config.lock().clone();
        if !config.learned.contains(&line) {
            config.learned.push(line.clone());
            // Keep the newest few: old ones may be from another microphone or room.
            let extra = config.learned.len().saturating_sub(6);
            config.learned.drain(..extra);
        }
        self.set_config(config)?;
        Ok(line)
    }

    fn command(&self, text: String) {
        dev_log(format_args!("command {text:?}"));
        *self.last_text.lock() = Some(text.clone());
        let _ = self.app.emit("voice-command", text);
        self.set_activity(Activity::Idle);
    }
}

/// Dev builds: voice events in the `tauri dev` terminal (never the audio or settings).
fn dev_log(msg: std::fmt::Arguments) {
    if cfg!(debug_assertions) {
        eprintln!("[voice] {msg}");
    }
}

/// Transcribes with a little silence around: recordings start and stop mid-breath.
fn transcribe(stt: &Stt, samples: &[f32]) -> Result<String> {
    let mut audio = vec![0.0f32; na_voice::SAMPLE_RATE as usize * 3 / 10];
    audio.extend_from_slice(samples);
    audio.extend(std::iter::repeat_n(0.0, na_voice::SAMPLE_RATE as usize * 3 / 10));
    stt.transcribe(&audio)
}

/// Types into whatever app has focus (macOS asks once for Accessibility access).
///
/// On macOS the text is pasted (clipboard + ⌘V, the previous clipboard text is put back after):
/// typing it as synthetic key events drops all but the first character in terminals.
fn type_text(app: &AppHandle, text: &str) -> Result<()> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let (tx, rx) = std::sync::mpsc::channel();
    let text = text.to_string();
    let paste = cfg!(target_os = "macos");
    let mut clip = if paste { arboard::Clipboard::new().ok() } else { None };
    let previous = clip.as_mut().and_then(|c| c.get_text().ok());
    if let Some(c) = clip.as_mut() {
        c.set_text(text.clone()).map_err(|e| anyhow!("clipboard: {e}"))?;
    }
    let pasting = clip.is_some();
    // Input events go through the main thread: macOS keyboard APIs require it.
    app.run_on_main_thread(move || {
        let r = Enigo::new(&Settings::default())
            .map_err(|e| anyhow!("Allow NeuralAgent under Privacy & Security → Accessibility to type for you ({e})."))
            .and_then(|mut e| {
                if pasting {
                    e.key(Key::Meta, Direction::Press)
                        .and_then(|_| e.key(Key::Unicode('v'), Direction::Click))
                        .and_then(|_| e.key(Key::Meta, Direction::Release))
                } else {
                    e.text(&text)
                }
                .map_err(|e| anyhow!("typing failed: {e}"))
            });
        let _ = tx.send(r);
    })?;
    let r = rx.recv_timeout(Duration::from_secs(10)).map_err(|_| anyhow!("typing timed out"))?;
    if let (Some(mut c), Some(prev)) = (clip, previous) {
        // Give the target app time to read the clipboard before restoring it.
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            let _ = c.set_text(prev);
        });
    }
    r
}

/// "Hey Neural, start Claude" → "start Claude"; `None` when the text does not start with it.
fn strip_wake(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let first = normalize(words.first()?);
    ["hey", "hi", "hei", "hai", "high"]
        .contains(&first.trim())
        .then(|| words[2.min(words.len())..].join(" ").trim_start_matches([',', '.', '!', '?', ' ']).to_string())
}

/// The command in an utterance that contains the wake word; `woke` is where the spotter fired.
fn command_text(stt: &Stt, speech: &[f32], woke: usize) -> Result<String> {
    let full = transcribe(stt, speech)?;
    if let Some(rest) = strip_wake(&full) {
        return Ok(rest);
    }
    // The recognizer misheard the wake word: drop the audio up to it instead.
    let cut = woke.saturating_sub(WAKE_LAG).min(speech.len());
    transcribe(stt, &speech[cut..])
}

/// Listens for the wake word while enabled, then turns the next utterance into a command.
struct WakeLoop {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WakeLoop {
    fn start(voice: Arc<Voice>) -> Result<Self> {
        let dir = models::path(&voice.root, WAKE).context("Download the wake word model to use \u{201c}Hey Neural\u{201d}.")?;
        let vad_model = models::path(&voice.root, VAD).context("Download the voice activity model to use the wake word.")?;
        if models::path(&voice.root, PARAKEET).is_none() {
            anyhow::bail!("The wake word needs the dictation model too.");
        }
        let mut wake = Wake::load(&dir, &voice.wake_config())?;
        let mut vad = Vad::load(&vad_model, 0.7)?;
        let mic = Mic::open()?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::Builder::new().name("wake".into()).spawn(move || {
            let mut awake: Option<Instant> = None;
            // Samples heard so far, and where the wake word ended.
            let (mut heard_total, mut woke_at) = (0usize, 0usize);
            while !flag.load(Ordering::Relaxed) {
                let Ok(chunk) = mic.rx.recv_timeout(Duration::from_millis(200)) else { continue };
                // Dictation owns the microphone's words while the hotkey is held.
                if voice.recording.lock().is_some() {
                    continue;
                }
                let heard = wake.push(&chunk).is_some();
                let segments = vad.push(&chunk);
                heard_total += chunk.len();
                if heard && awake.is_none() {
                    awake = Some(Instant::now());
                    woke_at = heard_total;
                    let _ = voice.app.emit("voice-wake", ());
                    voice.set_activity(Activity::Awake);
                }
                let Some(since) = awake else { continue };
                for seg in segments.into_iter().filter(|s| s.start + s.samples.len() > woke_at) {
                    let text = voice.stt().and_then(|stt| command_text(&stt, &seg.samples, woke_at.saturating_sub(seg.start)));
                    match text {
                        Ok(t) if t.is_empty() => {} // Only the wake word so far; wait for the command.
                        Ok(t) => {
                            awake = None;
                            voice.command(t);
                            break;
                        }
                        Err(e) => {
                            awake = None;
                            voice.fail(format!("{e:#}"));
                            break;
                        }
                    }
                }
                if awake.is_some_and(|_| since.elapsed() > Duration::from_secs(8)) {
                    awake = None;
                    voice.set_activity(Activity::Idle);
                }
            }
        })?;
        Ok(Self { stop, thread: Some(thread) })
    }
}

impl Drop for WakeLoop {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Handles the dictation hotkey (registered in [`Voice::apply`]).
pub fn on_shortcut(app: &AppHandle, state: ShortcutState) {
    let Some(voice) = app.try_state::<Arc<Voice>>() else { return };
    match state {
        ShortcutState::Pressed => voice.press(),
        ShortcutState::Released => voice.release(),
    }
}

#[cfg(test)]
mod tests {
    use super::strip_wake;

    #[test]
    fn strips_the_wake_word() {
        assert_eq!(strip_wake("Hey Neural, start Claude.").as_deref(), Some("start Claude."));
        assert_eq!(strip_wake("Hi Noral. Was machen meine Agents?").as_deref(), Some("Was machen meine Agents?"));
        assert_eq!(strip_wake("Hey Neural").as_deref(), Some(""));
        assert_eq!(strip_wake("Angeral, read me"), None);
    }
}
