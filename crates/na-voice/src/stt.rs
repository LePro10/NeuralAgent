//! Speech to text: offline models transcribe a finished utterance, streaming models also give
//! partial text while the user speaks.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream};

use crate::SAMPLE_RATE;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SttKind {
    /// NeMo Parakeet TDT (offline transducer).
    Parakeet,
    /// NeMo Nemotron cache-aware streaming transducer.
    NemotronStreaming,
    /// OpenAI Whisper (offline encoder/decoder).
    Whisper,
}

#[derive(Clone, Debug)]
pub struct SttModel {
    pub kind: SttKind,
    pub dir: PathBuf,
    /// "de", "en", or `None` for automatic.
    pub language: Option<String>,
    pub threads: i32,
}

/// Finds `<stem>.int8.onnx`, then `<stem>.onnx`, then any `*<stem>*.onnx` in `dir`.
pub(crate) fn file(dir: &Path, stem: &str) -> Result<String> {
    for name in [format!("{stem}.int8.onnx"), format!("{stem}.onnx")] {
        let p = dir.join(&name);
        if p.exists() {
            return Ok(p.to_string_lossy().into_owned());
        }
    }
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .with_context(|| format!("model folder {}", dir.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.contains(stem) && n.ends_with(".onnx")))
        .collect();
    // Prefer the int8 file when both exist.
    found.sort_by_key(|p| !p.to_string_lossy().contains("int8"));
    found.first().map(|p| p.to_string_lossy().into_owned()).with_context(|| format!("no {stem} model in {}", dir.display()))
}

pub(crate) fn tokens(dir: &Path) -> Result<String> {
    std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with("tokens.txt")))
        .map(|p| p.to_string_lossy().into_owned())
        .with_context(|| format!("no tokens.txt in {}", dir.display()))
}

pub enum Engine {
    Offline(OfflineRecognizer),
    Online(OnlineRecognizer),
}

pub struct Stt {
    pub model: SttModel,
    engine: Engine,
}

impl Stt {
    pub fn load(model: SttModel) -> Result<Self> {
        let dir = &model.dir;
        let engine = match model.kind {
            SttKind::Parakeet => {
                let mut c = OfflineRecognizerConfig::default();
                c.model_config.transducer.encoder = Some(file(dir, "encoder")?);
                c.model_config.transducer.decoder = Some(file(dir, "decoder")?);
                c.model_config.transducer.joiner = Some(file(dir, "joiner")?);
                c.model_config.tokens = Some(tokens(dir)?);
                c.model_config.model_type = Some("nemo_transducer".into());
                c.model_config.num_threads = model.threads;
                Engine::Offline(OfflineRecognizer::create(&c).context("loading Parakeet")?)
            }
            SttKind::Whisper => {
                let mut c = OfflineRecognizerConfig::default();
                c.model_config.whisper.encoder = Some(file(dir, "encoder")?);
                c.model_config.whisper.decoder = Some(file(dir, "decoder")?);
                c.model_config.whisper.language = model.language.clone();
                c.model_config.whisper.task = Some("transcribe".into());
                c.model_config.whisper.tail_paddings = -1;
                c.model_config.tokens = Some(tokens(dir)?);
                c.model_config.num_threads = model.threads;
                Engine::Offline(OfflineRecognizer::create(&c).context("loading Whisper")?)
            }
            SttKind::NemotronStreaming => {
                let mut c = OnlineRecognizerConfig::default();
                c.model_config.transducer.encoder = Some(file(dir, "encoder")?);
                c.model_config.transducer.decoder = Some(file(dir, "decoder")?);
                c.model_config.transducer.joiner = Some(file(dir, "joiner")?);
                c.model_config.tokens = Some(tokens(dir)?);
                c.model_config.num_threads = model.threads;
                c.enable_endpoint = false;
                Engine::Online(OnlineRecognizer::create(&c).context("loading Nemotron streaming")?)
            }
        };
        Ok(Self { model, engine })
    }

    /// Transcribes one finished utterance.
    pub fn transcribe(&self, samples: &[f32]) -> Result<String> {
        match &self.engine {
            Engine::Offline(r) => {
                let s = r.create_stream();
                s.accept_waveform(SAMPLE_RATE, samples);
                r.decode(&s);
                Ok(s.get_result().map(|r| r.text).unwrap_or_default().trim().to_string())
            }
            Engine::Online(_) => {
                let mut live = self.start()?;
                // Feed in 100 ms pieces like a microphone would.
                for chunk in samples.chunks(SAMPLE_RATE as usize / 10) {
                    live.push(chunk);
                }
                Ok(live.finish())
            }
        }
    }

    /// A live session for streaming models (partial text while audio arrives).
    pub fn start(&self) -> Result<Live<'_>> {
        let Engine::Online(r) = &self.engine else { bail!("not a streaming model") };
        let stream = r.create_stream();
        if let Some(lang) = &self.model.language
            && stream.has_option("language")
        {
            stream.set_option("language", lang);
        }
        Ok(Live { r, stream })
    }

    pub fn streaming(&self) -> bool {
        matches!(self.engine, Engine::Online(_))
    }
}

pub struct Live<'a> {
    r: &'a OnlineRecognizer,
    stream: OnlineStream,
}

impl Live<'_> {
    /// Adds audio and returns the text so far.
    pub fn push(&mut self, samples: &[f32]) -> String {
        self.stream.accept_waveform(SAMPLE_RATE, samples);
        while self.r.is_ready(&self.stream) {
            self.r.decode(&self.stream);
        }
        self.text()
    }

    pub fn text(&self) -> String {
        self.r.get_result(&self.stream).map(|r| r.text).unwrap_or_default().trim().to_string()
    }

    /// Flushes the last audio (with a little silence so the final chunk is decoded).
    pub fn finish(mut self) -> String {
        self.push(&vec![0.0; SAMPLE_RATE as usize * 6 / 10]);
        self.stream.input_finished();
        while self.r.is_ready(&self.stream) {
            self.r.decode(&self.stream);
        }
        self.text()
    }
}
