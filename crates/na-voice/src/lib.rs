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

/// Where each model unpacks inside the models folder (`<data>/models`). The desktop app
/// downloads them; the daemon's call pipeline and the app's dictation read them from there.
pub mod models {
    pub const PARAKEET: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
    pub const WAKE: &str = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01";
    pub const VAD: &str = "silero_vad.onnx";
    pub const SUPERTONIC: &str = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11";
}
