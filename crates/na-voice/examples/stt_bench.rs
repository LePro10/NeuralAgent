//! STT benchmark: word error rate, real-time factor and latency per model on a corpus.
//!
//! cargo run --release -p na-voice --example stt_bench -- <corpus dir> <kind>:<model dir>[:<lang>] ...
//! The corpus has `sentences.tsv` (id, lang, text) and `<id>.wav` (16 kHz mono).

use std::path::PathBuf;
use std::time::Instant;

use na_voice::stt::{Stt, SttKind, SttModel};
use na_voice::text::wer;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let corpus = PathBuf::from(&args[0]);
    let rows: Vec<(String, String, String)> = std::fs::read_to_string(corpus.join("sentences.tsv"))?
        .lines()
        .filter_map(|l| {
            let mut p = l.splitn(3, '\t');
            Some((p.next()?.to_string(), p.next()?.to_string(), p.next()?.to_string()))
        })
        .collect();
    let threads: i32 = std::env::var("THREADS").ok().and_then(|t| t.parse().ok()).unwrap_or(4);

    println!("| model | lang | WER | RTF | avg latency | load |");
    println!("|---|---|---|---|---|---|");
    for spec in &args[1..] {
        let mut parts = spec.splitn(3, ':');
        let kind = match parts.next().unwrap() {
            "parakeet" => SttKind::Parakeet,
            "nemotron" => SttKind::NemotronStreaming,
            "whisper" => SttKind::Whisper,
            k => anyhow::bail!("unknown kind {k}"),
        };
        let dir = PathBuf::from(parts.next().unwrap());
        let fixed_lang = parts.next().map(String::from);
        let name = dir.file_name().unwrap().to_string_lossy().into_owned();
        for lang in ["de", "en"] {
            let t0 = Instant::now();
            let stt = Stt::load(SttModel { kind, dir: dir.clone(), language: fixed_lang.clone().or(Some(lang.into())), threads })?;
            let load = t0.elapsed().as_secs_f32();
            let (mut errs, mut audio, mut compute, mut n) = (0.0, 0.0, 0.0, 0);
            for (id, l, text) in rows.iter().filter(|r| r.1 == lang) {
                let wave = sherpa_onnx::Wave::read(corpus.join(format!("{id}.wav")).to_str().unwrap()).expect("wav");
                // A microphone recording starts with a little silence; the clips do not.
                let mut samples = vec![0.0f32; 4800];
                samples.extend_from_slice(wave.samples());
                let t = Instant::now();
                let hyp = stt.transcribe(&samples)?;
                let dt = t.elapsed().as_secs_f32();
                let w = wer(text, &hyp);
                if std::env::var("VERBOSE").is_ok() {
                    eprintln!("{name} {id} [{l}] wer={w:.2} {dt:.2}s | {hyp}");
                }
                errs += w;
                audio += wave.num_samples() as f32 / wave.sample_rate() as f32;
                compute += dt;
                n += 1;
            }
            println!(
                "| {name} | {lang} | {:.1} % | {:.3} | {:.0} ms | {load:.1} s |",
                100.0 * errs / n as f32,
                compute / audio,
                1000.0 * compute / n as f32
            );
        }
    }
    Ok(())
}
