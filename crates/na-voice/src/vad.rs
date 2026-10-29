//! Voice activity detection (Silero): cuts microphone audio into utterances.

use std::path::Path;

use anyhow::{Context, Result};
use sherpa_onnx::{VadModelConfig, VoiceActivityDetector};

use crate::SAMPLE_RATE;

/// One utterance; `start` counts samples since the stream began.
pub struct Segment {
    pub start: usize,
    pub samples: Vec<f32>,
}

pub struct Vad {
    vad: VoiceActivityDetector,
    window: usize,
    pending: Vec<f32>,
}

impl Vad {
    /// `silence` is how long a pause ends an utterance, in seconds.
    pub fn load(model: &Path, silence: f32) -> Result<Self> {
        let mut c = VadModelConfig::default();
        c.silero_vad.model = Some(model.to_string_lossy().into_owned());
        c.silero_vad.threshold = 0.5;
        c.silero_vad.min_silence_duration = silence;
        c.silero_vad.min_speech_duration = 0.25;
        c.silero_vad.max_speech_duration = 30.0;
        c.silero_vad.window_size = 512;
        c.sample_rate = SAMPLE_RATE;
        c.num_threads = 1;
        let vad = VoiceActivityDetector::create(&c, 60.0).context("loading Silero VAD")?;
        Ok(Self { vad, window: 512, pending: Vec::new() })
    }

    /// Feeds audio; returns every utterance that ended in it.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Segment> {
        self.pending.extend_from_slice(samples);
        let full = self.pending.len() / self.window * self.window;
        for w in self.pending[..full].chunks(self.window) {
            self.vad.accept_waveform(w);
        }
        self.pending.drain(..full);
        self.take()
    }

    /// True while someone is speaking.
    pub fn speaking(&self) -> bool {
        self.vad.detected()
    }

    /// Ends the stream and returns what is left.
    pub fn flush(&mut self) -> Vec<Segment> {
        self.vad.flush();
        self.take()
    }

    fn take(&mut self) -> Vec<Segment> {
        let mut out = Vec::new();
        while let Some(seg) = self.vad.front() {
            out.push(Segment { start: seg.start().max(0) as usize, samples: seg.samples().to_vec() });
            self.vad.pop();
        }
        out
    }
}
