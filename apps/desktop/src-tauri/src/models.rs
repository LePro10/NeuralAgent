//! Voice models: what exists, what is installed, and a checked download into `<data>/models`.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use sha2::{Digest, Sha256};

const BASE: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

pub struct Spec {
    pub id: &'static str,
    pub name: &'static str,
    pub purpose: &'static str,
    /// Release path below [`BASE`].
    url: &'static str,
    sha256: &'static str,
    /// Folder (or file) the archive unpacks to.
    pub folder: &'static str,
    pub size: u64,
}

pub const PARAKEET: &str = "parakeet";
pub const WAKE: &str = "wake";
pub const VAD: &str = "vad";
pub const SUPERTONIC: &str = "supertonic";

pub const SPECS: &[Spec] = &[
    Spec {
        id: PARAKEET,
        name: "Parakeet TDT 0.6B v3",
        purpose: "Dictation and commands, 25 languages",
        url: "asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
        sha256: "5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf",
        folder: na_voice::models::PARAKEET,
        size: 487_170_055,
    },
    Spec {
        id: WAKE,
        name: "Wake word spotter",
        purpose: "Listens for \u{201c}Hey Neural\u{201d}",
        url: "kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2",
        sha256: "f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a",
        folder: na_voice::models::WAKE,
        size: 17_626_723,
    },
    Spec {
        id: VAD,
        name: "Silero VAD",
        purpose: "Finds where speech starts and ends",
        url: "asr-models/silero_vad.onnx",
        sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
        folder: na_voice::models::VAD,
        size: 643_854,
    },
    Spec {
        id: SUPERTONIC,
        name: "Supertonic 3",
        purpose: "Spoken replies, 31 languages",
        url: "tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
        sha256: "82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427",
        folder: na_voice::models::SUPERTONIC,
        size: 128_774_318,
    },
];

#[derive(Clone, Serialize)]
pub struct ModelStatus {
    pub id: String,
    pub name: String,
    pub purpose: String,
    pub size: u64,
    pub installed: bool,
    /// 0..1 while downloading.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn spec(id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.id == id)
}

pub fn path(root: &Path, id: &str) -> Option<PathBuf> {
    let p = root.join(spec(id)?.folder);
    p.exists().then_some(p)
}

/// Downloads, checks and unpacks one model. `progress` gets 0..1.
pub fn download(root: &Path, spec: &Spec, progress: impl Fn(f32)) -> Result<PathBuf> {
    std::fs::create_dir_all(root)?;
    let dest = root.join(spec.folder);
    if dest.exists() {
        return Ok(dest);
    }
    let file_name = spec.url.rsplit('/').next().unwrap_or(spec.id);
    let partial = root.join(format!(".{file_name}.part"));
    {
        let mut res = ureq::get(&format!("{BASE}/{}", spec.url)).call().context("download failed")?;
        let total = res.body().content_length().unwrap_or(spec.size).max(1);
        let mut body = res.body_mut().as_reader();
        let mut out = std::fs::File::create(&partial)?;
        let mut hash = Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let (mut done, mut last) = (0u64, 0.0f32);
        loop {
            let n = body.read(&mut buf).context("download interrupted")?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
            hash.update(&buf[..n]);
            done += n as u64;
            let p = done as f32 / total as f32;
            if p - last >= 0.01 {
                last = p;
                progress(p.min(1.0));
            }
        }
        out.flush()?;
        let got = format!("{:x}", hash.finalize());
        if got != spec.sha256 {
            let _ = std::fs::remove_file(&partial);
            bail!("checksum mismatch for {} (the file was changed or damaged)", spec.name);
        }
    }

    if file_name.ends_with(".tar.bz2") {
        // Unpack next to the target, then move into place, so a crash never leaves half a model.
        let staging = root.join(format!(".{}.unpack", spec.id));
        let _ = std::fs::remove_dir_all(&staging);
        let file = std::fs::File::open(&partial)?;
        tar::Archive::new(bzip2::read::BzDecoder::new(std::io::BufReader::new(file))).unpack(&staging).context("unpacking")?;
        std::fs::rename(staging.join(spec.folder), &dest).context("archive has an unexpected layout")?;
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_file(&partial);
    } else {
        std::fs::rename(&partial, &dest)?;
    }
    progress(1.0);
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Downloads the two small models (needs the network): `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn downloads_and_checks() {
        let root = std::env::temp_dir().join(format!("na-models-{}", std::process::id()));
        for id in [VAD, WAKE] {
            let p = download(&root, spec(id).unwrap(), |_| {}).unwrap();
            assert!(p.exists(), "{id}");
            assert_eq!(path(&root, id), Some(p));
        }
        assert!(path(&root, WAKE).unwrap().join("tokens.txt").exists());
        let bad = Spec { sha256: "0", ..*spec(VAD).unwrap() };
        let other = root.join("bad");
        assert!(download(&other, &bad, |_| {}).unwrap_err().to_string().contains("checksum"));
        assert!(!other.join(bad.folder).exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
