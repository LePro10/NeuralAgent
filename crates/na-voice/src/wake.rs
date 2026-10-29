//! Wake word ("Hey Neural") with a small streaming keyword spotter (zipformer, ~3 MB).

use std::path::Path;

use anyhow::{Context, Result};
use sherpa_onnx::{KeywordSpotter, KeywordSpotterConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream};

use crate::SAMPLE_RATE;
use crate::stt::{file, tokens};

/// "Hey Neural" in the model's BPE pieces (from its `bpe.model`), with the near misses the
/// English-only model hears for accented or fast speech.
pub const HEY_NEURAL: &str = "▁HE Y ▁NE UR AL @hey_neural\n▁HE Y ▁ N UR AL @hey_neural\n▁HE Y ▁NO R AL @hey_neural\n▁HE Y ▁NO Y R AL @hey_neural\n▁HE Y ▁MU R AL @hey_neural\n▁HI ▁NE UR AL @hey_neural";

pub struct WakeConfig {
    /// One keyword per line: BPE pieces, optional `:boost #threshold`, then `@name`.
    pub keywords: String,
    /// Higher means fewer false wakes, more misses (0..1).
    pub threshold: f32,
    /// Bonus for keyword paths while decoding; higher means more hits.
    pub score: f32,
    pub threads: i32,
}

impl Default for WakeConfig {
    fn default() -> Self {
        Self { keywords: HEY_NEURAL.into(), threshold: 0.25, score: 2.0, threads: 1 }
    }
}

pub struct Wake {
    kws: KeywordSpotter,
    stream: OnlineStream,
}

impl Wake {
    pub fn load(dir: &Path, config: &WakeConfig) -> Result<Self> {
        let mut c = KeywordSpotterConfig::default();
        c.model_config.transducer.encoder = Some(file(dir, "encoder")?);
        c.model_config.transducer.decoder = Some(file(dir, "decoder")?);
        c.model_config.transducer.joiner = Some(file(dir, "joiner")?);
        c.model_config.tokens = Some(tokens(dir)?);
        c.model_config.num_threads = config.threads;
        c.keywords_buf = Some(config.keywords.clone());
        c.keywords_threshold = config.threshold;
        c.keywords_score = config.score;
        let kws = KeywordSpotter::create(&c).context("loading keyword spotter")?;
        let stream = kws.create_stream();
        Ok(Self { kws, stream })
    }

    /// Feeds microphone audio; returns the keyword name when one was heard.
    pub fn push(&mut self, samples: &[f32]) -> Option<String> {
        self.stream.accept_waveform(SAMPLE_RATE, samples);
        while self.kws.is_ready(&self.stream) {
            self.kws.decode(&self.stream);
            if let Some(r) = self.kws.get_result(&self.stream)
                && !r.keyword.is_empty()
            {
                self.kws.reset(&self.stream);
                return Some(r.keyword);
            }
        }
        None
    }
}

/// What the spotter's own model hears in a recording of the wake word, as a keyword line.
/// Adding these lines teaches the spotter a speaker's pronunciation.
pub fn learn(dir: &Path, samples: &[f32], threads: i32) -> Result<String> {
    let mut c = OnlineRecognizerConfig::default();
    c.model_config.transducer.encoder = Some(file(dir, "encoder")?);
    c.model_config.transducer.decoder = Some(file(dir, "decoder")?);
    c.model_config.transducer.joiner = Some(file(dir, "joiner")?);
    c.model_config.tokens = Some(tokens(dir)?);
    c.model_config.num_threads = threads;
    c.enable_endpoint = false;
    let r = OnlineRecognizer::create(&c).context("loading the wake model as a recognizer")?;
    let s = r.create_stream();
    let mut audio = vec![0.0f32; SAMPLE_RATE as usize / 4];
    audio.extend_from_slice(samples);
    audio.extend(vec![0.0f32; SAMPLE_RATE as usize * 6 / 10]);
    s.accept_waveform(SAMPLE_RATE, &audio);
    s.input_finished();
    while r.is_ready(&s) {
        r.decode(&s);
    }
    let pieces = r.get_result(&s).map(|r| r.tokens).unwrap_or_default();
    // Results spell the word-start marker as a space; keywords need the piece itself.
    let line = pieces
        .iter()
        .filter(|t| !t.trim().is_empty())
        .map(|t| if t.starts_with(' ') { format!("▁{}", t.trim()) } else { t.trim().to_string() })
        .collect::<Vec<_>>()
        .join(" ");
    // Two pieces ("▁HI ▁MY") would wake on everyday speech.
    anyhow::ensure!(pieces.len() >= 3, "too short to tell apart from other speech, say it again");
    Ok(format!("{line} @hey_neural"))
}
