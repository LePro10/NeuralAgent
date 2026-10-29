//! Local text to speech (sherpa-onnx): Supertonic (multilingual) and Pocket TTS (English, cloned voice).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, Wave};

use crate::stt::file;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TtsKind {
    Supertonic,
    Pocket,
}

impl TtsKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "supertonic" => Some(Self::Supertonic),
            "pocket" => Some(Self::Pocket),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TtsModel {
    pub kind: TtsKind,
    pub dir: PathBuf,
    pub threads: i32,
}

/// One synthesized reply.
pub struct Speech {
    pub samples: Vec<f32>,
    pub sample_rate: i32,
    /// Time until the first audio was ready (what a listener waits for).
    pub first_audio: Duration,
}

pub struct Tts {
    pub model: TtsModel,
    tts: OfflineTts,
    /// Pocket TTS speaks in the voice of a short reference clip.
    reference: Option<(Vec<f32>, i32)>,
    /// Supertonic diffusion steps: 4 is the latency sweet spot, 8 sounds a little better.
    pub steps: i32,
}

fn any(dir: &Path, name: &str) -> Result<String> {
    let p = dir.join(name);
    anyhow::ensure!(p.exists(), "no {name} in {}", dir.display());
    Ok(p.to_string_lossy().into_owned())
}

impl Tts {
    pub fn load(model: TtsModel) -> Result<Self> {
        let dir = &model.dir;
        let mut c = OfflineTtsConfig::default();
        c.model.num_threads = model.threads;
        let mut reference = None;
        match model.kind {
            TtsKind::Supertonic => {
                let s = &mut c.model.supertonic;
                s.duration_predictor = Some(file(dir, "duration_predictor")?);
                s.text_encoder = Some(file(dir, "text_encoder")?);
                s.vector_estimator = Some(file(dir, "vector_estimator")?);
                s.vocoder = Some(file(dir, "vocoder")?);
                s.tts_json = Some(any(dir, "tts.json")?);
                s.unicode_indexer = Some(any(dir, "unicode_indexer.bin")?);
                s.voice_style = Some(any(dir, "voice.bin")?);
            }
            TtsKind::Pocket => {
                let p = &mut c.model.pocket;
                p.lm_flow = Some(file(dir, "lm_flow")?);
                p.lm_main = Some(file(dir, "lm_main")?);
                p.encoder = Some(file(dir, "encoder")?);
                p.decoder = Some(file(dir, "decoder")?);
                p.text_conditioner = Some(file(dir, "text_conditioner")?);
                p.vocab_json = Some(any(dir, "vocab.json")?);
                p.token_scores_json = Some(any(dir, "token_scores.json")?);
                let clip = dir.join("test_wavs").join("bria.wav");
                let w = Wave::read(&clip.to_string_lossy()).context("Pocket TTS reference voice")?;
                reference = Some((w.samples().to_vec(), w.sample_rate()));
            }
        }
        let tts = OfflineTts::create(&c).with_context(|| format!("loading {:?}", model.kind))?;
        Ok(Self { model, tts, reference, steps: 4 })
    }

    pub fn sample_rate(&self) -> i32 {
        self.tts.sample_rate()
    }

    /// `lang` is an ISO code ("de", "en"); `voice` picks a speaker where the model has several.
    pub fn speak(&self, text: &str, lang: &str, voice: i32, speed: f32) -> Result<Speech> {
        let mut g = GenerationConfig { speed, sid: voice, ..Default::default() };
        match self.model.kind {
            TtsKind::Supertonic => {
                g.num_steps = self.steps;
                g.extra = Some(HashMap::from([("lang".to_string(), serde_json::json!(lang))]));
            }
            TtsKind::Pocket => {
                if lang != "en" {
                    bail!("Pocket TTS speaks English only");
                }
                let (samples, rate) = self.reference.clone().unwrap_or_default();
                g.reference_audio = Some(samples);
                g.reference_sample_rate = rate;
            }
        }
        let start = Instant::now();
        let first: Arc<Mutex<Option<Duration>>> = Arc::default();
        let seen = first.clone();
        let audio = self
            .tts
            .generate_with_config(
                text,
                &g,
                Some(move |samples: &[f32], _: f32| {
                    let mut f = seen.lock().unwrap();
                    if f.is_none() && !samples.is_empty() {
                        *f = Some(start.elapsed());
                    }
                    true
                }),
            )
            .context("speech synthesis failed")?;
        let first_audio = first.lock().unwrap().unwrap_or_else(|| start.elapsed());
        Ok(Speech { samples: audio.samples().to_vec(), sample_rate: audio.sample_rate(), first_audio })
    }
}
