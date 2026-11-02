//! Checks the wake word and the VAD against a corpus (see `stt_bench`).
//!
//! `wake_vad <corpus dir> <kws model dir> <silero_vad.onnx>`
//! Env: THRESHOLD, SCORE (defaults: `WakeConfig::default()`), TAIL / NOISE (silence after each
//! clip, seconds / level), LOOSE=0 (spotter only), KEYWORDS (a keywords file to try instead),
//! LEARN (comma-separated clip ids to learn the pronunciation from first).

use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use na_voice::vad::Vad;
use na_voice::wake::{Wake, WakeConfig};
use sherpa_onnx::Wave;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [corpus, kws, vad] = args.as_slice() else { anyhow::bail!("usage: wake_vad <corpus> <kws dir> <silero_vad.onnx>") };
    let corpus = PathBuf::from(corpus);
    let tsv = std::fs::read_to_string(corpus.join("sentences.tsv")).context("sentences.tsv")?;
    let env = |k: &str, d: f32| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
    let base = WakeConfig::default();
    let mut config = WakeConfig { threshold: env("THRESHOLD", base.threshold), score: env("SCORE", base.score), loose: env("LOOSE", 1.0) > 0.0, ..base };
    if let Ok(file) = std::env::var("KEYWORDS") {
        config.keywords = std::fs::read_to_string(file)?.trim().to_string();
    }

    if let Ok(ids) = std::env::var("LEARN") {
        for id in ids.split(',') {
            let wave = Wave::read(&corpus.join(format!("{id}.wav")).to_string_lossy()).context(id.to_string())?;
            match na_voice::wake::learn(&PathBuf::from(kws), wave.samples(), 2) {
                Ok(line) => {
                    println!("  learned from {id}: {line}");
                    config.keywords = format!("{}\n{line}", config.keywords);
                }
                Err(e) => println!("  not learned from {id}: {e}"),
            }
        }
    }

    // TAIL: seconds of silence after each clip; NOISE: its level (a room is never digital zero).
    let tail = env("TAIL", 1.0);
    let noise = env("NOISE", 0.0);
    let mut seed = 1u32;
    let mut silence = |s: f32| -> Vec<f32> {
        (0..(s * 16_000.0) as usize)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (seed as f32 / u32::MAX as f32 - 0.5) * 2.0 * noise
            })
            .collect()
    };
    let (mut hits, mut misses, mut false_wakes) = (0, 0, 0);
    let mut stream = Vec::new();
    let mut wake_ms = 0.0;
    for line in tsv.lines().filter(|l| !l.trim().is_empty()) {
        let cols: Vec<&str> = line.split('\t').collect();
        let (id, text) = (cols[0], cols[cols.len() - 1]);
        let wave = Wave::read(&corpus.join(format!("{id}.wav")).to_string_lossy()).context(id.to_string())?;
        let mut audio = silence(0.5);
        audio.extend_from_slice(wave.samples());
        audio.extend(silence(tail));
        stream.extend_from_slice(&audio);

        // A fresh spotter per clip, fed in 100 ms pieces like a microphone.
        let mut wake = Wake::load(&PathBuf::from(kws), &config)?;
        let t = Instant::now();
        let words: Vec<String> = audio.chunks(1600).filter_map(|c| wake.push(c)).collect();
        let heard = !words.is_empty();
        if std::env::var("VERBOSE").is_ok() && heard {
            println!("  {id}: {}", words.join(", "));
        }
        wake_ms += t.elapsed().as_secs_f64() * 1000.0;
        let expected = text.to_lowercase().contains("hey neural");
        match (expected, heard) {
            (true, true) => hits += 1,
            (true, false) => misses += 1,
            (false, true) => false_wakes += 1,
            _ => {}
        }
        if expected != heard {
            println!("  {id}: expected {expected}, heard {heard} — {text}");
        }
    }
    let clips = tsv.lines().filter(|l| !l.trim().is_empty()).count();
    let secs = stream.len() as f64 / 16_000.0;
    println!(
        "wake word: {hits} hits, {misses} misses, {false_wakes} false wakes over {clips} clips; CPU {:.1} % of real time",
        wake_ms / 10.0 / secs
    );

    let mut vad = Vad::load(&PathBuf::from(vad), 0.5)?;
    let mut segments = 0;
    for c in stream.chunks(1600) {
        segments += vad.push(c).len();
    }
    segments += vad.flush().len();
    println!("vad: {segments} utterances found, {clips} spoken");
    Ok(())
}
