//! Microphone capture: the default input device as 16 kHz mono f32 chunks.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, StreamConfig};
use na_voice::SAMPLE_RATE;
use sherpa_onnx::LinearResampler;

/// An open microphone. Audio arrives on `rx`; dropping it closes the device.
pub struct Mic {
    pub rx: Receiver<Vec<f32>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Mic {
    pub fn open() -> Result<Self> {
        if cfg!(debug_assertions)
            && let Some(file) = std::env::var_os("NEURALAGENT_TEST_MIC")
        {
            return Self::from_file(&file.to_string_lossy());
        }
        let (tx, rx) = channel();
        let (ready_tx, ready_rx) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        // cpal streams cannot move between threads on every platform, so one thread owns it.
        let thread = std::thread::Builder::new().name("mic".into()).spawn(move || {
            let stream = match start(tx) {
                Ok(s) => {
                    let _ = ready_tx.send(Ok(()));
                    s
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            while !flag.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(20));
            }
            drop(stream);
        })?;
        ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| anyhow!("the microphone did not start"))??;
        Ok(Self { rx, stop, thread: Some(thread) })
    }

    /// Dev builds: plays 16 kHz wavs (`a.wav:b.wav`, 2 s apart) in real time as if spoken, then
    /// silence (for end-to-end tests).
    fn from_file(paths: &str) -> Result<Self> {
        let mut samples = Vec::new();
        for path in paths.split(':') {
            let wave = sherpa_onnx::Wave::read(path).with_context(|| format!("test microphone {path}"))?;
            anyhow::ensure!(wave.sample_rate() == SAMPLE_RATE, "test microphone file must be 16 kHz");
            samples.extend_from_slice(wave.samples());
            samples.extend(std::iter::repeat_n(0.0, SAMPLE_RATE as usize * 2));
        }
        let (tx, rx) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::spawn(move || {
            let chunk = SAMPLE_RATE as usize / 10;
            let mut pieces = samples.chunks(chunk).map(<[f32]>::to_vec);
            while !flag.load(Ordering::Relaxed) {
                if tx.send(pieces.next().unwrap_or_else(|| vec![0.0; chunk])).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        });
        Ok(Self { rx, stop, thread: Some(thread) })
    }

    /// Everything recorded so far.
    pub fn drain(&self) -> Vec<f32> {
        self.rx.try_iter().flatten().collect()
    }
}

impl Drop for Mic {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn start(tx: Sender<Vec<f32>>) -> Result<cpal::Stream> {
    let device = cpal::default_host().default_input_device().context("no microphone found")?;
    let supported = device.default_input_config().context("microphone settings")?;
    let config: StreamConfig = supported.config();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, tx)?,
        SampleFormat::I16 => build::<i16>(&device, config, tx)?,
        SampleFormat::I32 => build::<i32>(&device, config, tx)?,
        SampleFormat::U16 => build::<u16>(&device, config, tx)?,
        other => return Err(anyhow!("unsupported microphone format {other}")),
    };
    stream.play().context("starting the microphone")?;
    Ok(stream)
}

fn build<T>(device: &cpal::Device, config: StreamConfig, tx: Sender<Vec<f32>>) -> Result<cpal::Stream>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    let resampler = LinearResampler::create(config.sample_rate as i32, SAMPLE_RATE).context("resampler")?;
    let stream = device.build_input_stream(
        config,
        move |data: &[T], _: &_| {
            let mono: Vec<f32> =
                data.chunks(channels).map(|frame| frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / channels as f32).collect();
            let _ = tx.send(resampler.resample(&mono, false));
        },
        |e| tracing::warn!("microphone: {e}"),
        None,
    )?;
    Ok(stream)
}
