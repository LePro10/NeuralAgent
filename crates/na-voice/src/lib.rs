//! Local speech for NeuralAgent, on top of sherpa-onnx (CPU, int8 models).
//!
//! Models live in a folder per model (see [`stt::SttModel`]); nothing here downloads.

pub mod stt;
pub mod text;
pub mod tts;
pub mod vad;
pub mod wake;

/// All engines work on 16 kHz mono f32 samples.
pub const SAMPLE_RATE: i32 = 16_000;
