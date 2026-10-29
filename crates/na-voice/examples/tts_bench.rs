//! Text-to-speech benchmark: speed, time to first audio, and intelligibility (the speech is
//! transcribed again with Parakeet and scored as WER).
//!
//! `tts_bench <corpus dir> <parakeet dir> <kind>:<model dir>...`  (kinds: supertonic, pocket)
//! Env: THREADS (default 4), STEPS (Supertonic, default 4), VOICE (speaker id, default 0), OUT (folder to save one clip per run).

use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use na_voice::stt::{Stt, SttKind, SttModel};
use na_voice::text::wer;
use na_voice::tts::{Tts, TtsKind, TtsModel};
use sherpa_onnx::LinearResampler;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    anyhow::ensure!(args.len() >= 3, "usage: tts_bench <corpus> <parakeet dir> <kind>:<dir>...");
    let threads: i32 = std::env::var("THREADS").ok().and_then(|v| v.parse().ok()).unwrap_or(4);
    let voice: i32 = std::env::var("VOICE").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let out = std::env::var("OUT").ok().map(PathBuf::from);
    let tsv = std::fs::read_to_string(PathBuf::from(&args[0]).join("sentences.tsv")).context("sentences.tsv")?;
    let sentences: Vec<(String, String, String)> = tsv
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let c: Vec<&str> = l.split('\t').collect();
            (c[0].to_string(), c[1].to_string(), c[c.len() - 1].to_string())
        })
        .collect();
    let stt = Stt::load(SttModel { kind: SttKind::Parakeet, dir: PathBuf::from(&args[1]), language: None, threads })?;

    println!("| model | lang | round-trip WER | RTF | first audio | load |\n|---|---|---|---|---|---|");
    for spec in &args[2..] {
        let (kind, dir) = spec.split_once(':').context("kind:dir")?;
        let kind = TtsKind::parse(kind).context("unknown kind")?;
        let t = Instant::now();
        let mut tts = Tts::load(TtsModel { kind, dir: PathBuf::from(dir), threads })?;
        if let Some(steps) = std::env::var("STEPS").ok().and_then(|v| v.parse().ok()) {
            tts.steps = steps;
        }
        let load = t.elapsed().as_secs_f64();
        let name = PathBuf::from(dir).file_name().unwrap().to_string_lossy().into_owned();
        let resampler = LinearResampler::create(tts.sample_rate(), 16_000).context("resampler")?;
        for lang in ["de", "en"] {
            let (mut errs, mut synth, mut audio, mut first, mut n) = (0.0, 0.0, 0.0, 0.0, 0);
            for (id, l, text) in sentences.iter().filter(|s| s.1 == lang) {
                let t = Instant::now();
                let speech = match tts.speak(text, l, voice, 1.0) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("{name} {lang}: {e:#}");
                        break;
                    }
                };
                synth += t.elapsed().as_secs_f64();
                audio += speech.samples.len() as f64 / speech.sample_rate as f64;
                first += speech.first_audio.as_secs_f64();
                resampler.reset();
                let heard = stt.transcribe(&resampler.resample(&speech.samples, true))?;
                let w = wer(text, &heard);
                if std::env::var("VERBOSE").is_ok() {
                    eprintln!("{name} {id} wer={w:.2} | {heard}");
                }
                errs += w as f64;
                if n == 0
                    && let Some(out) = &out
                {
                    std::fs::create_dir_all(out)?;
                    let path = out.join(format!("{name}-{lang}.wav"));
                    sherpa_onnx::write(&path.to_string_lossy(), &speech.samples, speech.sample_rate);
                }
                n += 1;
            }
            if n > 0 {
                let n = n as f64;
                println!(
                    "| {name} | {lang} | {:.1} % | {:.3} | {:.0} ms | {load:.1} s |",
                    errs / n * 100.0,
                    synth / audio,
                    first / n * 1000.0
                );
            }
        }
    }
    Ok(())
}
