//! Voice on the desktop: hold a hotkey to dictate into any app, and the "Hey Neural" wake word.
//!
//! "Hey Neural" starts a call with Neural, the same as "Call Neural" (`lib/call.ts`): the window
//! hears `voice-wake`, opens the call, and fetches what was said since just before the wake word
//! (`take_preroll`), so "Hey Neural, start Claude" in one breath loses nothing. While a call runs
//! in this window (`call_active`, reported with `duck_call`) the spotter rests; afterwards it
//! starts again on fresh audio.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use base64::Engine as _;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow};
use na_voice::stt::{Stt, SttKind, SttModel};
use na_voice::vad::Vad;
use na_voice::wake::{HEY_NEURAL, Wake, WakeConfig};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::dictations::Dictations;
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
    /// Lower other audio (music) while dictating, after "Hey Neural" and in calls (`duck.rs`).
    pub duck: bool,
    /// Down to this many percent of where it was.
    pub duck_level: u8,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            dictation: true,
            hotkey: "Alt+Space".into(),
            wake_word: false,
            learned: Vec::new(),
            duck: true,
            duck_level: crate::duck::DEFAULT_LEVEL,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Activity {
    Idle,
    Listening,
    Transcribing,
    /// Woken by "Hey Neural": the call it started is opening or running.
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

/// Audio kept from before the spotter reported "Hey Neural" and handed to the call: the spotter
/// fires a moment after the word, so the command may have started already. The call strips the
/// wake word from what it hears (`na_voice::text::strip_wake`).
const PRE: usize = na_voice::SAMPLE_RATE as usize * 3 / 2;
/// At most this much audio waits for the call (it normally takes it within a second).
const PREROLL_MAX: usize = na_voice::SAMPLE_RATE as usize * 15;
/// The window starts the call within this time after the wake word, or the wake is dropped.
const CALL_WAIT: Duration = Duration::from_secs(8);

/// Shortest press that counts as dictation (shorter is an accidental tap).
const MIN_SPEECH: usize = na_voice::SAMPLE_RATE as usize / 4;

/// The dictation model (about 0.6-1 GB) is freed this long after its last use, like the
/// service's speech models (D74). The hotkey and the wake word load it again while the user
/// speaks, so only a very short first word after a pause may wait a moment longer.
const STT_KEEP: Duration = Duration::from_secs(300);

pub struct Voice {
    app: AppHandle,
    root: PathBuf,
    config: Mutex<VoiceConfig>,
    /// The dictation model and when it was last used ([`STT_KEEP`]).
    stt: Mutex<Option<(Arc<Stt>, Instant)>>,
    recording: Mutex<Option<Mic>>,
    activity: Mutex<Activity>,
    last_text: Mutex<Option<String>>,
    /// The last dictations, kept on disk (D85).
    pub dictations: Dictations,
    error: Mutex<Option<String>>,
    downloads: Mutex<HashMap<String, (f32, Option<String>)>>,
    wake: Mutex<Option<WakeLoop>>,
    /// A call runs in this app's window (the spotter rests meanwhile).
    call_on: AtomicBool,
    /// Audio since just before the wake word, until the call it started takes it.
    preroll: Mutex<Option<Vec<f32>>>,
}

impl Voice {
    pub fn new(app: AppHandle, data: PathBuf) -> Arc<Self> {
        let config = std::fs::read(data.join("voice.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let voice = Arc::new(Self {
            app,
            root: data.join("models"),
            config: Mutex::new(config),
            stt: Mutex::new(None),
            recording: Mutex::new(None),
            activity: Mutex::new(Activity::Idle),
            last_text: Mutex::new(None),
            dictations: Dictations::load(&data),
            error: Mutex::new(None),
            downloads: Mutex::new(HashMap::new()),
            wake: Mutex::new(None),
            call_on: AtomicBool::new(false),
            preroll: Mutex::new(None),
        });
        let weak = Arc::downgrade(&voice);
        let _ = std::thread::Builder::new().name("voice-unload".into()).spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(15));
                let Some(voice) = weak.upgrade() else { return };
                voice.unload_idle();
            }
        });
        voice
    }

    /// Frees the dictation model once it has not been used for [`STT_KEEP`]; never while
    /// dictating (a call started by the wake word uses the service's models, not this one).
    fn unload_idle(&self) {
        let busy = matches!(*self.activity.lock(), Activity::Listening | Activity::Transcribing) || self.recording.lock().is_some();
        // A load in progress holds the slot: skip this round.
        let Some(mut slot) = self.stt.try_lock() else { return };
        let Some((_, used)) = slot.as_mut() else { return };
        if busy {
            *used = Instant::now();
        } else if used.elapsed() > STT_KEEP {
            let model = slot.take();
            drop(slot);
            drop(model); // freeing takes a moment: outside the lock
            dev_log(format_args!("dictation model unloaded"));
        }
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
        crate::duck::voice(&self.app, a);
        self.emit();
    }

    fn fail(&self, e: impl std::fmt::Display) {
        dev_log(format_args!("error {e}"));
        *self.error.lock() = Some(e.to_string());
        *self.activity.lock() = Activity::Idle;
        crate::hud::update(&self.app, Activity::Idle);
        crate::duck::voice(&self.app, Activity::Idle);
        self.emit();
    }

    /// Applies settings at startup or after a change: hotkey and wake word.
    pub fn apply(self: &Arc<Self>) {
        let config = self.config.lock().clone();
        crate::duck::configure(&self.app, config.duck, config.duck_level);
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

    /// The dictation model, loaded on first use and kept until [`STT_KEEP`] without use.
    fn stt(&self) -> Result<Arc<Stt>> {
        let mut slot = self.stt.lock();
        if let Some((s, used)) = slot.as_mut() {
            *used = Instant::now();
            return Ok(s.clone());
        }
        let dir = models::path(&self.root, PARAKEET).context("Download the dictation model in Settings → Voice first.")?;
        let s = Arc::new(Stt::load(SttModel { kind: SttKind::Parakeet, dir, language: None, threads: 4 })?);
        *slot = Some((s.clone(), Instant::now()));
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
                    // Kept before typing: the text survives a failed paste or an app that drops it.
                    if let Err(e) = me.dictations.add(&text) {
                        dev_log(format_args!("dictation history: {e:#}"));
                    }
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
            let extra = config.learned.len().saturating_sub(10);
            config.learned.drain(..extra);
        }
        self.set_config(config)?;
        Ok(line)
    }

    /// A call in this app's window started or ended (`duck_call` from the UI).
    pub fn call_active(&self, on: bool) {
        self.call_on.store(on, Ordering::SeqCst);
    }

    /// What was said from just before "Hey Neural" until now, as 16 kHz PCM16 (base64), once:
    /// the call it started sends it first, then its own microphone takes over.
    pub fn take_preroll(&self) -> Option<String> {
        let samples = self.preroll.lock().take()?;
        let pcm: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
        dev_log(format_args!("preroll {:.1} s", samples.len() as f32 / na_voice::SAMPLE_RATE as f32));
        Some(base64::engine::general_purpose::STANDARD.encode(pcm))
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
            .map_err(|e| anyhow!("Allow NeuralAgent under Privacy & Security → Accessibility to type for you (NeuralAgent → Settings → System; if it is on already, use Repair there) ({e})."))
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

/// Listens for the wake word while enabled; a hit starts a call in the window.
struct WakeLoop {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WakeLoop {
    fn start(voice: Arc<Voice>) -> Result<Self> {
        let dir = models::path(&voice.root, WAKE).context("Download the wake word model to use \u{201c}Hey Neural\u{201d}.")?;
        let mut wake = Wake::load(&dir, &voice.wake_config())?;
        let mic = Mic::open()?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::Builder::new().name("wake".into()).spawn(move || {
            // The last moment of audio (for the preroll), when the wake word was heard (waiting
            // for the window to start the call), whether the running call is the wake word's.
            let mut recent: VecDeque<f32> = VecDeque::with_capacity(PRE + 4096);
            let mut woke: Option<Instant> = None;
            let (mut in_call, mut wake_call) = (false, false);
            while !flag.load(Ordering::Relaxed) {
                let Ok(chunk) = mic.rx.recv_timeout(Duration::from_millis(200)) else { continue };
                // Until the call takes it, the preroll grows with what is said.
                if let Some(p) = voice.preroll.lock().as_mut()
                    && p.len() < PREROLL_MAX
                {
                    p.extend_from_slice(&chunk);
                }
                if voice.call_on.load(Ordering::SeqCst) {
                    // The call listens now (its own microphone, with echo cancellation).
                    in_call = true;
                    woke = None;
                    continue;
                }
                if in_call {
                    // Hung up: listen again from scratch, without the call's audio in the spotter.
                    in_call = false;
                    wake.reset();
                    recent.clear();
                    *voice.preroll.lock() = None;
                    if std::mem::take(&mut wake_call) {
                        voice.set_activity(Activity::Idle);
                    }
                    continue;
                }
                if let Some(at) = woke {
                    if at.elapsed() > CALL_WAIT {
                        // The window did not start a call (closed, or no daemon): back to waiting.
                        dev_log(format_args!("wake: no call started"));
                        woke = None;
                        wake_call = false;
                        *voice.preroll.lock() = None;
                        wake.reset();
                        voice.set_activity(Activity::Idle);
                    }
                    continue;
                }
                // Dictation owns the microphone's words while the hotkey is held; "Learn my voice"
                // records the wake word on purpose (it must not start a call).
                if voice.recording.lock().is_some() || *voice.activity.lock() == Activity::Learning {
                    continue;
                }
                recent.extend(chunk.iter().copied());
                let extra = recent.len().saturating_sub(PRE);
                recent.drain(..extra);
                if wake.push(&chunk).is_some() {
                    dev_log(format_args!("wake word"));
                    woke = Some(Instant::now());
                    wake_call = true;
                    *voice.preroll.lock() = Some(recent.drain(..).collect());
                    voice.set_activity(Activity::Awake);
                    let _ = voice.app.emit("voice-wake", ());
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
