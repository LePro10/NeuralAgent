//! Voice calls with Neural. The client streams echo-cancelled microphone audio; everything
//! else happens here, on this computer: voice activity (Silero) finds the end of a sentence,
//! Parakeet transcribes it, Neural answers, and Supertonic speaks the answer sentence by
//! sentence while the rest is still being written. When the answer takes longer than a moment,
//! a short acknowledgment ("Okay.") is played first, so the caller hears something within a
//! second. Talking over Neural stops it (barge-in).
//!
//! The pipeline runs on plain threads: the speech engines block.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use base64::Engine as _;
use na_protocol::{AttentionKind, CallEvent, CallState, ServerMsg};
use na_voice::stt::{Stt, SttKind, SttModel};
use na_voice::tts::{Tts, TtsKind, TtsModel};
use na_voice::vad::Vad;
use parking_lot::Mutex;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::core::Core;

/// Rate of the audio sent to the client.
pub const OUT_RATE: u32 = 24_000;
/// A pause this long ends the caller's sentence.
const END_OF_TURN: f32 = 0.5;
/// When the answer has not started this long after the caller's sentence was understood, an
/// acknowledgment is played.
const FILLER_AFTER: Duration = Duration::from_millis(80);
/// Talking over Neural for this long interrupts it.
const BARGE_IN: Duration = Duration::from_millis(300);
/// Speech models stay loaded this long after the last call.
const KEEP_LOADED: Duration = Duration::from_secs(300);

const FILLERS_DE: [&str; 3] = ["Okay.", "Moment.", "Mhm, okay."];
const FILLERS_EN: [&str; 3] = ["Okay.", "Sure.", "Mhm, okay."];

/// The loaded speech engines, shared by calls.
pub struct Engines {
    stt: Stt,
    tts: Mutex<Tts>,
    vad: std::path::PathBuf,
    /// Pre-synthesized acknowledgments per language, at [`OUT_RATE`].
    fillers: Vec<(&'static str, Vec<i16>)>,
}

#[derive(Default)]
pub struct Calls {
    engines: Mutex<Option<(Arc<Engines>, Instant)>>,
    /// The running call (one per computer).
    active: Mutex<Option<(u64, CancellationToken)>>,
    /// Where the running call takes news about agents, to say between answers.
    news: Mutex<Option<(u64, Sender<Say>)>>,
    next: AtomicU64,
}

/// Held by the connection that started the call; dropping it ends the call.
pub struct CallHandle {
    audio: Sender<Vec<f32>>,
    stop: CancellationToken,
}

impl CallHandle {
    /// Base64 16-bit PCM from the client.
    pub fn audio(&self, b64: &str) {
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else { return };
        let samples = bytes.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes(*b) as f32 / 32768.0).collect();
        let _ = self.audio.send(samples);
    }
}

impl Drop for CallHandle {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

impl Engines {
    fn load(models: &Path, voice: i32, speed: f32) -> Result<Self> {
        let need = |name: &str| {
            let p = models.join(name);
            p.exists().then_some(p).context("Calls need the voice models: download them in Settings → Voice on the computer.")
        };
        let stt_dir = need(na_voice::models::PARAKEET)?;
        let tts_dir = need(na_voice::models::SUPERTONIC)?;
        let vad = need(na_voice::models::VAD)?;
        let threads = std::thread::available_parallelism().map(|n| n.get().clamp(2, 4) as i32).unwrap_or(2);
        let started = Instant::now();
        let stt = Stt::load(SttModel { kind: SttKind::Parakeet, dir: stt_dir, language: None, threads })?;
        let tts = Tts::load(TtsModel { kind: TtsKind::Supertonic, dir: tts_dir, threads })?;
        let mut fillers = vec![];
        for (lang, list) in [("de", FILLERS_DE), ("en", FILLERS_EN)] {
            for text in list {
                fillers.push((lang, synth(&tts, text, lang, voice, speed)?));
            }
        }
        tracing::info!(ms = started.elapsed().as_millis() as u64, "call: speech models loaded");
        Ok(Self { stt, tts: Mutex::new(tts), vad, fillers })
    }
}

fn synth(tts: &Tts, text: &str, lang: &str, voice: i32, speed: f32) -> Result<Vec<i16>> {
    let s = tts.speak(text, lang, voice, speed)?;
    Ok(resample(&s.samples, s.sample_rate as u32, OUT_RATE))
}

/// Linear resampling to 16-bit PCM; good enough for speech.
fn resample(samples: &[f32], from: u32, to: u32) -> Vec<i16> {
    if samples.is_empty() {
        return vec![];
    }
    let n = (samples.len() as u64 * to as u64 / from as u64) as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * from as f64 / to as f64;
            let j = pos as usize;
            let f = (pos - j as f64) as f32;
            let a = samples[j.min(samples.len() - 1)];
            let b = samples[(j + 1).min(samples.len() - 1)];
            ((a + (b - a) * f).clamp(-1.0, 1.0) * 32767.0) as i16
        })
        .collect()
}

/// German or English, from the words (Neural answers in the caller's language).
pub fn lang_of(text: &str, fallback: &'static str) -> &'static str {
    const DE: &[&str] = &[
        "ich", "und", "der", "die", "das", "ist", "nicht", "du", "wir", "bitte", "ein", "eine", "mit", "auf", "für", "was", "wie",
        "kannst", "mal", "schon", "noch", "ja", "nein", "er", "sie", "es", "den", "dem", "zu", "im", "läuft", "gerade", "starte", "sag",
        "agenten", "fertig", "okay,", "moment",
    ];
    const EN: &[&str] =
        &["the", "and", "is", "you", "what", "please", "can", "it", "to", "of", "are", "my", "start", "tell", "agent", "done", "yes", "no"];
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric() && c != 'ä' && c != 'ö' && c != 'ü' && c != 'ß').collect();
    let de = words.iter().filter(|w| DE.contains(w)).count() + lower.chars().filter(|c| "äöüß".contains(*c)).count();
    let en = words.iter().filter(|w| EN.contains(w)).count();
    match de.cmp(&en) {
        std::cmp::Ordering::Greater => "de",
        std::cmp::Ordering::Less => "en",
        std::cmp::Ordering::Equal => fallback,
    }
}

fn b64(pcm: &[i16]) -> String {
    let bytes: Vec<u8> = pcm.iter().flat_map(|s| s.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

impl Core {
    /// The speech engines, loading them on first use.
    fn call_engines(&self) -> Result<Arc<Engines>> {
        let mut g = self.calls.engines.lock();
        if let Some((e, used)) = g.as_mut() {
            *used = Instant::now();
            return Ok(e.clone());
        }
        let (voice, speed) = self.read(|s| (s.settings.call.voice as i32, s.settings.call.speed));
        let e = Arc::new(Engines::load(&self.paths.root.join("models"), voice, speed)?);
        *g = Some((e.clone(), Instant::now()));
        Ok(e)
    }

    /// Frees the speech models some minutes after the last call (they take about 1 GB).
    pub fn call_tick(&self) {
        let busy = self.calls.active.lock().is_some();
        let mut g = self.calls.engines.lock();
        if let Some((_, used)) = g.as_mut() {
            if busy {
                *used = Instant::now();
            } else if used.elapsed() > KEEP_LOADED {
                *g = None;
                tracing::info!("call: speech models unloaded");
            }
        }
    }

    /// Forgets the loaded engines (after the voice changed).
    pub fn call_reload(&self) {
        if self.calls.active.lock().is_none() {
            *self.calls.engines.lock() = None;
        }
    }

    /// Speaks a short sample in a voice, for choosing one. 16-bit PCM at [`OUT_RATE`].
    pub fn call_preview(&self, voice: u32, speed: f32, lang: &str) -> Result<String> {
        let e = self.call_engines()?;
        let text =
            if lang == "de" { "Hallo, ich bin Neural. Soll ich einen Agenten starten?" } else { "Hi, I'm Neural. Shall I start an agent?" };
        let pcm = synth(&e.tts.lock(), text, if lang == "de" { "de" } else { "en" }, voice as i32, speed)?;
        Ok(b64(&pcm))
    }

    /// An agent finished, needs the user or failed: the running call says so when Neural is
    /// not talking (the chat gets a notice either way).
    pub fn call_news(&self, kind: AttentionKind, workspace: String, agent: String) {
        if let Some((_, tx)) = self.calls.news.lock().as_ref() {
            let _ = tx.send(Say::News { kind, workspace, agent });
        }
    }

    /// Starts a call for the client behind `out`. A running call elsewhere ends.
    pub fn call_start(self: &Arc<Self>, out: mpsc::Sender<ServerMsg>) -> CallHandle {
        let (audio, rx) = channel::<Vec<f32>>();
        let stop = CancellationToken::new();
        let id = self.calls.next.fetch_add(1, Ordering::Relaxed);
        if let Some((_, old)) = self.calls.active.lock().replace((id, stop.clone())) {
            old.cancel();
        }
        let core = self.clone();
        let rt = tokio::runtime::Handle::current();
        let token = stop.clone();
        std::thread::Builder::new()
            .name("call".into())
            .spawn(move || {
                let send = |ev: CallEvent| {
                    let _ = out.blocking_send(ServerMsg::Call { ev });
                };
                let r = run(&core, &rt, rx, &token, &out, id);
                let error = r.err().map(|e| format!("{e:#}"));
                if let Some(e) = &error {
                    tracing::warn!("call: {e}");
                }
                token.cancel();
                send(CallEvent::State { state: CallState::Ended, error });
                let mut a = core.calls.active.lock();
                if a.as_ref().is_some_and(|(x, _)| *x == id) {
                    *a = None;
                }
                let mut n = core.calls.news.lock();
                if n.as_ref().is_some_and(|(x, _)| *x == id) {
                    *n = None;
                }
            })
            .expect("call thread");
        CallHandle { audio, stop }
    }
}

/// The last seconds of microphone audio, addressed by sample number since the call began.
#[derive(Default)]
struct Recent {
    buf: std::collections::VecDeque<f32>,
    /// Sample number of `buf[0]`.
    first: usize,
}

impl Recent {
    const KEEP: usize = na_voice::SAMPLE_RATE as usize * 40;
    const LEAD_IN: usize = na_voice::SAMPLE_RATE as usize * 3 / 10;

    fn push(&mut self, s: &[f32]) {
        self.buf.extend(s);
        if self.buf.len() > Self::KEEP {
            let drop = self.buf.len() - Self::KEEP;
            self.buf.drain(..drop);
            self.first += drop;
        }
    }

    /// `len` samples from `start`, with a short lead-in before it.
    fn cut(&self, start: usize, len: usize) -> Option<Vec<f32>> {
        let from = start.saturating_sub(Self::LEAD_IN).max(self.first);
        let to = start + len;
        (to <= self.first + self.buf.len() && from < to).then(|| self.buf.range(from - self.first..to - self.first).copied().collect())
    }
}

/// What the speaker thread is told.
enum Say {
    /// The caller finished a sentence at `ended`; a new answer begins.
    Turn {
        turn: u64,
        ended: Instant,
        lang: &'static str,
    },
    Sentence {
        turn: u64,
        text: String,
    },
    /// Neural finished writing the answer.
    Done {
        turn: u64,
    },
    /// Something happened to an agent.
    News {
        kind: AttentionKind,
        workspace: String,
        agent: String,
    },
}

/// One spoken sentence about an agent, in the call's language.
fn news_text(kind: AttentionKind, workspace: &str, agent: &str, lang: &str) -> String {
    let who = if workspace.is_empty() { agent.to_string() } else { format!("{agent} in {workspace}") };
    match (lang, kind) {
        ("de", AttentionKind::Done) => format!("Übrigens: {who} ist fertig."),
        ("de", AttentionKind::Waiting) => format!("Übrigens: {who} braucht dich."),
        ("de", AttentionKind::Error) => format!("Übrigens: {who} ist mit einem Fehler gestoppt."),
        (_, AttentionKind::Done) => format!("By the way, {who} is done."),
        (_, AttentionKind::Waiting) => format!("By the way, {who} needs you."),
        (_, AttentionKind::Error) => format!("By the way, {who} stopped with an error."),
    }
}

/// Shared between the listener and the speaker.
struct Line {
    out: mpsc::Sender<ServerMsg>,
    /// Bumped by every new caller sentence and by barge-in: older speech is dropped.
    turn: AtomicU64,
    /// When the audio sent so far finishes playing on the client.
    playing_until: Mutex<Instant>,
}

impl Line {
    fn send(&self, ev: CallEvent) {
        let _ = self.out.blocking_send(ServerMsg::Call { ev });
    }
    fn playing(&self) -> bool {
        Instant::now() < *self.playing_until.lock()
    }
    /// Sends speech in 200 ms pieces and books its playing time.
    fn play(&self, pcm: &[i16]) {
        for chunk in pcm.chunks(OUT_RATE as usize / 5) {
            self.send(CallEvent::Audio { d: b64(chunk), rate: OUT_RATE });
        }
        let mut until = self.playing_until.lock();
        let start = (*until).max(Instant::now());
        *until = start + Duration::from_secs_f64(pcm.len() as f64 / OUT_RATE as f64);
    }
}

fn run(
    core: &Arc<Core>,
    rt: &tokio::runtime::Handle,
    rx: Receiver<Vec<f32>>,
    stop: &CancellationToken,
    out: &mpsc::Sender<ServerMsg>,
    id: u64,
) -> Result<()> {
    let line = Arc::new(Line { out: out.clone(), turn: AtomicU64::new(0), playing_until: Mutex::new(Instant::now()) });
    line.send(CallEvent::State { state: CallState::Connecting, error: None });
    anyhow::ensure!(core.read(|s| s.orchestrator.ready), "Neural has no model yet: add a key in Settings → Neural on the computer");
    let engines = core.call_engines()?;
    let mut vad = Vad::load(&engines.vad, END_OF_TURN)?;
    // Recent microphone audio: the detector notices speech a little late, so each sentence is
    // cut from here with some lead-in.
    let mut heard = Recent::default();
    let (voice, speed) = core.read(|s| (s.settings.call.voice as i32, s.settings.call.speed));

    let (say, said) = channel::<Say>();
    let speaker = {
        let (line, engines, stop) = (line.clone(), engines.clone(), stop.clone());
        std::thread::Builder::new().name("call-speaker".into()).spawn(move || speak(&line, &engines, said, &stop, voice, speed))?
    };

    *core.calls.news.lock() = Some((id, say.clone()));
    line.send(CallEvent::State { state: CallState::Listening, error: None });
    let mut lang: &'static str = "de";
    let mut talking_since: Option<Instant> = None;
    while !stop.is_cancelled() {
        let samples = match rx.recv_timeout(Duration::from_millis(30)) {
            Ok(s) => s,
            Err(RecvTimeoutError::Timeout) => vec![],
            Err(RecvTimeoutError::Disconnected) => break,
        };
        heard.push(&samples);
        let segments = if samples.is_empty() { vec![] } else { vad.push(&samples) };

        // Barge-in: the caller talks while Neural speaks.
        let playing = line.playing();
        if vad.speaking() {
            let since = *talking_since.get_or_insert_with(Instant::now);
            if playing && since.elapsed() >= BARGE_IN {
                line.turn.fetch_add(1, Ordering::SeqCst);
                *line.playing_until.lock() = Instant::now();
                line.send(CallEvent::Flush);
                core.orch_stop();
                line.send(CallEvent::State { state: CallState::Listening, error: None });
                tracing::info!("call: barge-in");
            }
        } else {
            talking_since = None;
        }

        for seg in segments {
            // The sentence ended a pause ago.
            let ended = Instant::now() - Duration::from_secs_f32(END_OF_TURN);
            let started = Instant::now();
            let text = engines.stt.transcribe(&heard.cut(seg.start, seg.samples.len()).unwrap_or(seg.samples))?;
            let words = text.split_whitespace().count();
            tracing::info!(stt_ms = started.elapsed().as_millis() as u64, words, "call: heard");
            if words == 0 {
                continue;
            }
            line.send(CallEvent::Heard { text: text.clone() });
            line.send(CallEvent::State { state: CallState::Thinking, error: None });
            lang = lang_of(&text, lang);
            let turn = line.turn.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = say.send(Say::Turn { turn, ended, lang });
            let (tx, mut sentences) = mpsc::unbounded_channel::<String>();
            {
                let _g = rt.enter();
                if let Err(e) = core.orch_send(text, Some(tx), true) {
                    anyhow::bail!(e.message);
                }
            }
            let say = say.clone();
            rt.spawn(async move {
                while let Some(text) = sentences.recv().await {
                    if say.send(Say::Sentence { turn, text }).is_err() {
                        return;
                    }
                }
                let _ = say.send(Say::Done { turn });
            });
        }
    }
    drop(say);
    let _ = speaker.join();
    core.orch_stop();
    Ok(())
}

/// Turns sentences into audio, plays an acknowledgment when the answer is slow, and measures
/// how long the caller waited.
fn speak(line: &Line, engines: &Engines, said: Receiver<Say>, stop: &CancellationToken, voice: i32, speed: f32) {
    struct Current {
        turn: u64,
        ended: Instant,
        understood: Instant,
        lang: &'static str,
        first: Option<(u64, bool)>,
        answered: bool,
        /// Neural finished writing; once the audio has played, the caller's turn begins.
        done: bool,
    }
    let mut cur: Option<Current> = None;
    let mut filler_n = 0usize;
    // News about agents waits until Neural is quiet; said in the language of the last answer.
    let mut news = std::collections::VecDeque::new();
    let mut lang: &'static str = "de";
    while !stop.is_cancelled() {
        let msg = match said.recv_timeout(Duration::from_millis(20)) {
            Ok(m) => Some(m),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let live = line.turn.load(Ordering::SeqCst);
        match msg {
            Some(Say::Turn { turn, ended, lang: l }) => {
                lang = l;
                cur = Some(Current { turn, ended, understood: Instant::now(), lang: l, first: None, answered: false, done: false });
            }
            Some(Say::Sentence { turn, text }) if turn == live => {
                let Some(c) = cur.as_mut().filter(|c| c.turn == turn) else { continue };
                let text = text.trim().trim_start_matches(['-', '*', '#']).trim().to_string();
                if text.is_empty() {
                    continue;
                }
                let lang = lang_of(&text, c.lang);
                let pcm = match synth(&engines.tts.lock(), &text, lang, voice, speed) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!("call: speech synthesis: {e:#}");
                        continue;
                    }
                };
                if line.turn.load(Ordering::SeqCst) != turn {
                    continue;
                }
                line.send(CallEvent::State { state: CallState::Speaking, error: None });
                line.send(CallEvent::Say { text });
                line.play(&pcm);
                if !c.answered {
                    c.answered = true;
                    let answer_ms = c.ended.elapsed().as_millis() as u64;
                    let (first_ms, filler) = c.first.unwrap_or((answer_ms, false));
                    c.first = Some((first_ms, filler));
                    tracing::info!(first_ms, answer_ms, filler, "call: latency");
                    line.send(CallEvent::Latency { first_ms, answer_ms: Some(answer_ms), filler });
                }
            }
            Some(Say::Done { turn }) => {
                if let Some(c) = cur.as_mut().filter(|c| c.turn == turn) {
                    c.done = true;
                }
            }
            Some(Say::News { kind, workspace, agent }) => news.push_back(news_text(kind, &workspace, &agent, lang)),
            Some(Say::Sentence { .. }) => {}
            None => {}
        }
        if cur.is_none()
            && !line.playing()
            && let Some(text) = news.pop_front()
        {
            match synth(&engines.tts.lock(), &text, lang, voice, speed) {
                Ok(pcm) => {
                    let turn = line.turn.load(Ordering::SeqCst);
                    line.send(CallEvent::State { state: CallState::Speaking, error: None });
                    line.send(CallEvent::Say { text });
                    line.play(&pcm);
                    // Ends like an answer: listening again once it has played.
                    let now = Instant::now();
                    cur = Some(Current { turn, ended: now, understood: now, lang, first: Some((0, false)), answered: true, done: true });
                }
                Err(e) => tracing::warn!("call: speech synthesis: {e:#}"),
            }
        }
        // The answer is complete and has played: listening again.
        if let Some(c) = cur.as_ref()
            && c.done
            && !line.playing()
        {
            if c.turn == line.turn.load(Ordering::SeqCst) {
                line.send(CallEvent::State { state: CallState::Listening, error: None });
            }
            cur = None;
            continue;
        }
        // Nothing to say yet: acknowledge.
        if let Some(c) = cur.as_mut()
            && c.turn == line.turn.load(Ordering::SeqCst)
            && c.first.is_none()
            && c.understood.elapsed() >= FILLER_AFTER
        {
            let options: Vec<&Vec<i16>> = engines.fillers.iter().filter(|(l, _)| *l == c.lang).map(|(_, p)| p).collect();
            if let Some(pcm) = options.get(filler_n % options.len().max(1)) {
                filler_n += 1;
                line.send(CallEvent::State { state: CallState::Speaking, error: None });
                line.play(pcm);
                let first_ms = c.ended.elapsed().as_millis() as u64;
                c.first = Some((first_ms, true));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn news_is_one_sentence_in_the_callers_language() {
        assert_eq!(news_text(AttentionKind::Done, "Japan-Map", "Testbot", "de"), "Übrigens: Testbot in Japan-Map ist fertig.");
        assert_eq!(news_text(AttentionKind::Waiting, "", "Claude", "en"), "By the way, Claude needs you.");
    }

    #[test]
    fn language_from_words() {
        assert_eq!(lang_of("Was macht der Agent gerade?", "en"), "de");
        assert_eq!(lang_of("What is my agent doing?", "de"), "en");
        assert_eq!(lang_of("Japan Map", "de"), "de");
        assert_eq!(lang_of("Starte Claude in Japan Map", "en"), "de");
    }

    #[test]
    fn sentences_are_cut_with_a_lead_in() {
        let mut r = Recent::default();
        r.push(&(0..16_000).map(|i| i as f32).collect::<Vec<_>>());
        let cut = r.cut(8_000, 1_000).unwrap();
        assert_eq!(cut.len(), 1_000 + Recent::LEAD_IN);
        assert_eq!(cut[0], (8_000 - Recent::LEAD_IN) as f32);
        assert!(r.cut(15_500, 1_000).is_none(), "not heard yet");
    }

    #[test]
    fn resampling_keeps_duration() {
        let s = vec![0.5f32; 44_100];
        assert_eq!(resample(&s, 44_100, 24_000).len(), 24_000);
        assert!(resample(&s, 44_100, 24_000).iter().all(|x| (*x - 16_383).abs() < 2));
    }
}
