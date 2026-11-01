//! Linux: each playing stream's own volume through `pactl` (PulseAudio, or PipeWire with
//! pipewire-pulse). This app's own streams (and its web view's) are left alone, so Neural's voice
//! in a call stays loud. Needs `pactl` 16+ for JSON output; without it nothing is lowered.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::HashSet;
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::{Backend, Target};

/// PulseAudio's 100 %.
const NORM: f32 = 65536.0;

#[derive(Deserialize)]
struct SinkInput {
    index: u32,
    #[serde(default)]
    corked: bool,
    #[serde(default)]
    mute: bool,
    #[serde(default)]
    properties: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    volume: serde_json::Map<String, serde_json::Value>,
}

/// A stream from `pactl -f json list sink-inputs`.
#[derive(Clone, Debug, PartialEq)]
struct Stream {
    index: u32,
    pid: Option<u32>,
    volume: f32,
    playing: bool,
}

fn parse(json: &str) -> Vec<Stream> {
    let items: Vec<SinkInput> = serde_json::from_str(json).unwrap_or_default();
    items
        .into_iter()
        .filter_map(|s| {
            let raw: Vec<f32> = s.volume.values().filter_map(|c| c.get("value")?.as_f64()).map(|v| v as f32).collect();
            if raw.is_empty() {
                return None;
            }
            let pid = s.properties.get("application.process.id").and_then(|p| p.as_str()?.parse().ok());
            Some(Stream { index: s.index, pid, volume: raw.iter().sum::<f32>() / raw.len() as f32 / NORM, playing: !s.corked && !s.mute })
        })
        .collect()
}

/// `ppid` from `/proc/<pid>/stat` (the field after the command name in parentheses).
fn parent(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.rsplit_once(')')?.1.split_whitespace().nth(1)?.parse().ok()
}

/// `pid` is this process or started by it (the web view's processes).
fn ours(pid: u32, me: u32, parent: impl Fn(u32) -> Option<u32>) -> bool {
    let mut p = pid;
    for _ in 0..32 {
        if p == me {
            return true;
        }
        match parent(p) {
            Some(pp) if pp > 1 && pp != p => p = pp,
            _ => return false,
        }
    }
    false
}

fn pactl(args: &[&str]) -> Option<String> {
    let out = Command::new("pactl").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Default)]
pub struct Streams {
    /// One `pactl` listing per fade step, not one per stream.
    cache: Option<(Instant, Vec<Stream>)>,
    mine: HashSet<u32>,
}

impl Streams {
    fn list(&mut self) -> Vec<Stream> {
        if let Some((at, s)) = &self.cache
            && at.elapsed() < Duration::from_millis(20)
        {
            return s.clone();
        }
        let me = std::process::id();
        let all = pactl(&["-f", "json", "list", "sink-inputs"]).map(|j| parse(&j)).unwrap_or_default();
        let streams: Vec<Stream> = all
            .into_iter()
            .filter(|s| {
                let mine = s.pid.is_some_and(|p| self.mine.contains(&p) || ours(p, me, parent));
                if mine && let Some(p) = s.pid {
                    self.mine.insert(p);
                }
                !mine
            })
            .collect();
        self.cache = Some((Instant::now(), streams.clone()));
        streams
    }
}

impl Backend for Streams {
    fn scan(&mut self) -> Vec<Target> {
        self.list().into_iter().map(|s| Target { id: s.index.to_string(), volume: s.volume, playing: s.playing }).collect()
    }

    fn set(&mut self, id: &str, v: f32) -> Option<f32> {
        let raw = (v.max(0.0) * NORM).round() as u32;
        pactl(&["set-sink-input-volume", id, &raw.to_string()])?;
        self.cache = None;
        Some(raw as f32 / NORM)
    }

    fn every(&self) -> Duration {
        Duration::from_millis(40)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pactl_json() {
        let json = r#"[
          {"index":42,"corked":false,"mute":false,
           "properties":{"application.name":"Spotify","application.process.id":"4242"},
           "volume":{"front-left":{"value":32768,"value_percent":"50%","db":"-18.06 dB"},
                     "front-right":{"value":32768,"value_percent":"50%","db":"-18.06 dB"}}},
          {"index":43,"corked":true,"mute":false,"properties":{},
           "volume":{"mono":{"value":65536,"value_percent":"100%","db":"0.00 dB"}}}
        ]"#;
        let s = parse(json);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0], Stream { index: 42, pid: Some(4242), volume: 0.5, playing: true });
        assert_eq!(s[1], Stream { index: 43, pid: None, volume: 1.0, playing: false });
        assert!(parse("not json").is_empty());
    }

    #[test]
    fn knows_its_own_process_tree() {
        // 30 (web view audio) ← 20 (web view) ← 10 (this app) ← 1; 40 is another app.
        let tree = |p: u32| match p {
            30 => Some(20),
            20 => Some(10),
            10 => Some(1),
            40 => Some(1),
            _ => None,
        };
        assert!(ours(30, 10, tree));
        assert!(ours(10, 10, tree));
        assert!(!ours(40, 10, tree));
        assert!(!ours(99, 10, tree));
    }
}
