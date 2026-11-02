//! Wake word ("Hey Neural") with a small streaming keyword spotter (zipformer, ~3 MB).
//!
//! Two paths on the same model (D86): the keyword spotter, which wants the exact BPE pieces of one
//! of its keyword lines, and a loose path that runs the model as a streaming recognizer and
//! compares the words it writes with every keyword line (built-in and learned) by edit distance.
//! The loose path catches pronunciations the spotter just misses ("Hey Noiral", "He nail").

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
    /// Bonus for keyword paths while decoding. Not "higher means more hits": on synthetic clips
    /// (examples/wake_vad.rs, 2026-11-02) 1.5 hit 17 of 18 English "Hey Neural", 2.0 only 13 and
    /// 3.0 fewer still (a strong bonus pulls the decode off the real pieces); 0 false wakes each.
    pub score: f32,
    pub threads: i32,
    /// Also listen with the loose path (see the module docs).
    pub loose: bool,
}

impl Default for WakeConfig {
    fn default() -> Self {
        Self { keywords: HEY_NEURAL.into(), threshold: 0.25, score: 1.5, threads: 1, loose: true }
    }
}

pub struct Wake {
    kws: KeywordSpotter,
    stream: OnlineStream,
    loose: Option<Loose>,
}

/// The loose path: the spotter's model as a recognizer, and what "Hey Neural" may look like in
/// its words (one entry per keyword line, without spaces).
struct Loose {
    r: OnlineRecognizer,
    s: OnlineStream,
    targets: Vec<String>,
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
        let loose = if config.loose {
            let mut rc = recognizer_config(dir, config.threads)?;
            // A pause ends the stream's text, so it stays short and old words never match.
            rc.enable_endpoint = true;
            rc.rule1_min_trailing_silence = 1.2;
            rc.rule2_min_trailing_silence = 0.8;
            rc.rule3_min_utterance_length = 12.0;
            let r = OnlineRecognizer::create(&rc).context("loading the wake model as a recognizer")?;
            let s = r.create_stream();
            Some(Loose { r, s, targets: targets(&config.keywords) })
        } else {
            None
        };
        Ok(Self { kws, stream, loose })
    }

    /// Forgets everything heard so far (after a call: the spotter starts on fresh audio).
    pub fn reset(&mut self) {
        self.stream = self.kws.create_stream();
        if let Some(l) = self.loose.as_mut() {
            l.s = l.r.create_stream();
        }
    }

    /// Feeds microphone audio; returns the keyword name when one was heard.
    pub fn push(&mut self, samples: &[f32]) -> Option<String> {
        let mut heard = None;
        self.stream.accept_waveform(SAMPLE_RATE, samples);
        while self.kws.is_ready(&self.stream) {
            self.kws.decode(&self.stream);
            if let Some(r) = self.kws.get_result(&self.stream)
                && !r.keyword.is_empty()
            {
                self.kws.reset(&self.stream);
                heard = Some(r.keyword);
                break;
            }
        }
        let Some(l) = self.loose.as_mut() else { return heard };
        l.s.accept_waveform(SAMPLE_RATE, samples);
        while l.r.is_ready(&l.s) {
            l.r.decode(&l.s);
        }
        let text = l.r.get_result(&l.s).map(|r| r.text).unwrap_or_default();
        let words: Vec<String> = text.split_whitespace().map(|w| w.to_lowercase()).collect();
        if heard.is_none() && loose_match(&words, &l.targets) {
            heard = Some("hey_neural".into());
        }
        // One utterance at a time; after a hit the next one starts fresh (both paths).
        if heard.is_some() || l.r.is_endpoint(&l.s) {
            l.s = l.r.create_stream();
        }
        if heard.is_some() {
            self.stream = self.kws.create_stream();
        }
        heard
    }
}

/// What the spotter's own model hears in a recording of the wake word, as a keyword line.
/// Adding these lines teaches the spotter a speaker's pronunciation.
pub fn learn(dir: &Path, samples: &[f32], threads: i32) -> Result<String> {
    let c = recognizer_config(dir, threads)?;
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

fn recognizer_config(dir: &Path, threads: i32) -> Result<OnlineRecognizerConfig> {
    let mut c = OnlineRecognizerConfig::default();
    c.model_config.transducer.encoder = Some(file(dir, "encoder")?);
    c.model_config.transducer.decoder = Some(file(dir, "decoder")?);
    c.model_config.transducer.joiner = Some(file(dir, "joiner")?);
    c.model_config.tokens = Some(tokens(dir)?);
    c.model_config.num_threads = threads;
    c.enable_endpoint = false;
    Ok(c)
}

/// What each keyword line looks like as words ("▁HE Y ▁NE UR AL :1.5 @x" → "hey neural").
fn targets(keywords: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in keywords.lines() {
        let pieces: String = line.split_whitespace().take_while(|p| !p.starts_with([':', '#', '@'])).collect();
        let words = pieces.replace('\u{2581}', " ").to_lowercase();
        let words = words.split_whitespace().collect::<Vec<_>>();
        let mut add = |w: &[&str]| {
            let t = w.join(" ");
            if t.len() >= 5 && !out.contains(&t) {
                out.push(t);
            }
        };
        add(&words);
        // A learned recording often ends on a stray piece the silence after it was heard as.
        if words.len() >= 2 {
            add(&words[..words.len() - 1]);
        }
    }
    out
}

/// True when some run of the recognizer's latest words reads like one of the targets: same first
/// letter, a short first word (a greeting: "hey", "hi", "he"), and at most one edit per four
/// letters (spaces ignored), ending on the same letter. "Hey Noiral", "hey new ral", "he nail" (learned) match; "the neural
/// network", "hey Nora" and "hi there" do not.
pub fn loose_match(words: &[String], targets: &[String]) -> bool {
    let tail = &words[words.len().saturating_sub(6)..];
    targets.iter().any(|t| {
        let want: Vec<char> = t.chars().filter(|c| !c.is_whitespace()).collect();
        let first = t.split_whitespace().next().unwrap_or("");
        let allowed = want.len() / 4;
        (0..tail.len()).any(|i| {
            let w0 = &tail[i];
            if w0.chars().next() != want.first().copied() || w0.chars().count() > 4.max(first.chars().count()) {
                return false;
            }
            (1..=3).filter(|n| i + n <= tail.len()).any(|n| {
                let got: Vec<char> = tail[i..i + n].concat().chars().collect();
                // Same last letter too: "Hey Nora" is one edit from "hey noral".
                got.len() + 2 >= want.len() && got.len() <= want.len() + 2 && got.last() == want.last() && edits(&got, &want) <= allowed
            })
        })
    })
}

fn edits(a: &[char], b: &[char]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(ca != cb)).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_lowercase).collect()
    }

    #[test]
    fn targets_from_keyword_lines() {
        let t = targets("\u{2581}HE Y \u{2581}NE UR AL @hey_neural\n\u{2581}HE N A IL \u{2581}THAT :2.0 #0.1 @hey_neural");
        assert_eq!(t, vec!["hey neural", "henail that", "henail"]);
    }

    #[test]
    fn loose_wake_word() {
        let t = targets(HEY_NEURAL);
        for yes in ["HEY NEURAL", "HEY NOIRAL START CLAUDE", "OKAY HEY NEURAL", "HEY NEW RAL", "HI NEURAL WHAT"] {
            assert!(loose_match(&w(yes), &t), "{yes}");
        }
        for no in ["THE NEURAL NETWORK", "HEY NORA HOW ARE YOU", "HI THERE NICE TO MEET YOU", "NATURAL LANGUAGE", "HE NEEDS ALL"] {
            assert!(!loose_match(&w(no), &t), "{no}");
        }
        let learned = targets(&format!("{HEY_NEURAL}\n\u{2581}HE N A IL \u{2581}THAT @hey_neural"));
        assert!(loose_match(&w("HENAIL A BEST"), &learned));
        assert!(!loose_match(&w("HENAIL A BEST"), &t));
    }
}
