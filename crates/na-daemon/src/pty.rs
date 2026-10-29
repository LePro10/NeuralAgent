//! One process in a pseudo terminal, mirrored by a headless VT emulator.
//!
//! The reader thread feeds every chunk into the emulator and broadcasts it, both under the same
//! lock, so `attach` can take a snapshot and subscribe without gaps or duplicates. `seq` is the
//! number of output bytes so far; clients drop frames they already have.

use std::io::{Read, Write};
use std::num::NonZeroU16;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::broadcast;

const SCROLLBACK: usize = 5000;

#[derive(Clone, Debug)]
pub struct Chunk {
    /// Sequence number after this chunk.
    pub seq: u64,
    pub data: Arc<[u8]>,
}

pub struct Spawn {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub env_remove: Vec<String>,
    pub cols: u16,
    pub rows: u16,
}

/// What the reader thread reports to the owner.
pub enum PtyNote {
    Output { bytes: usize },
    Title(String),
    Bell,
    Exited(Option<i32>),
}

#[derive(Default)]
struct Hooks {
    title: Option<String>,
    bell: bool,
}

impl vt100::Callbacks for Hooks {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.title = Some(String::from_utf8_lossy(title).into_owned());
    }
    fn audible_bell(&mut self, _: &mut vt100::Screen) {
        self.bell = true;
    }
}

struct Term {
    parser: vt100::Parser<Hooks>,
    seq: u64,
}

pub struct Pty {
    term: Arc<Mutex<Term>>,
    tx: broadcast::Sender<Chunk>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    pub pid: Option<u32>,
    pub last_input: Mutex<Option<Instant>>,
}

fn nz(v: u16, fallback: u16) -> NonZeroU16 {
    NonZeroU16::new(v).or(NonZeroU16::new(fallback)).expect("fallback is non-zero")
}

impl Pty {
    pub fn spawn(spec: Spawn, notify: impl Fn(PtyNote) + Send + 'static) -> Result<Arc<Pty>> {
        let size = PtySize { rows: spec.rows.max(2), cols: spec.cols.max(10), pixel_width: 0, pixel_height: 0 };
        let pair = native_pty_system().openpty(size).context("openpty")?;

        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        cmd.cwd(&spec.cwd);
        for k in &spec.env_remove {
            cmd.env_remove(k);
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        let child = pair.slave.spawn_command(cmd).with_context(|| format!("spawn {}", spec.program))?;
        drop(pair.slave);
        let pid = child.process_id();

        let mut reader = pair.master.try_clone_reader().context("pty reader")?;
        let writer = pair.master.take_writer().context("pty writer")?;
        let (tx, _) = broadcast::channel(1024);
        let term = Arc::new(Mutex::new(Term {
            parser: vt100::Parser::new_with_callbacks(nz(size.rows, 24), nz(size.cols, 80), SCROLLBACK, Hooks::default()),
            seq: 0,
        }));

        let pty = Arc::new(Pty {
            term: term.clone(),
            tx: tx.clone(),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            pid,
            last_input: Mutex::new(None),
        });

        let weak = Arc::downgrade(&pty);
        std::thread::Builder::new()
            .name("pty-read".into())
            .spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    let n = match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    let (title, bell) = {
                        let mut t = term.lock();
                        t.parser.process(&buf[..n]);
                        t.seq += n as u64;
                        let _ = tx.send(Chunk { seq: t.seq, data: Arc::from(&buf[..n]) });
                        let cb = t.parser.callbacks_mut();
                        (cb.title.take(), std::mem::take(&mut cb.bell))
                    };
                    notify(PtyNote::Output { bytes: n });
                    if let Some(title) = title {
                        notify(PtyNote::Title(title));
                    }
                    if bell {
                        notify(PtyNote::Bell);
                    }
                }
                let code = weak.upgrade().and_then(|p| p.child.lock().wait().ok()).map(|s| s.exit_code() as i32);
                notify(PtyNote::Exited(code));
            })
            .context("spawn reader thread")?;

        Ok(pty)
    }

    /// ANSI that rebuilds scrollback, screen, cursor and input modes on a fresh terminal of the
    /// same size, plus the matching sequence number and a live receiver.
    pub fn attach(&self) -> (String, u64, (u16, u16), broadcast::Receiver<Chunk>) {
        let t = self.term.lock();
        let rx = self.tx.subscribe();
        let screen = t.parser.screen();
        let (rows, cols) = screen.size();
        (snapshot(screen), t.seq, (cols.get(), rows.get()), rx)
    }

    pub fn write(&self, data: &[u8]) -> Result<()> {
        *self.last_input.lock() = Some(Instant::now());
        let mut w = self.writer.lock();
        w.write_all(data)?;
        w.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let (cols, rows) = (cols.clamp(10, 1000), rows.clamp(2, 500));
        {
            let mut t = self.term.lock();
            let (r, c) = t.parser.screen().size();
            if (r.get(), c.get()) == (rows, cols) {
                return Ok(());
            }
            t.parser.screen_mut().set_size(nz(rows, 24), nz(cols, 80));
        }
        self.master.lock().resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
        Ok(())
    }

    pub fn size(&self) -> (u16, u16) {
        let (r, c) = self.term.lock().parser.screen().size();
        (c.get(), r.get())
    }

    pub fn kill(&self) {
        let _ = self.child.lock().kill();
    }

    /// Plain text of the last non-empty line at or above the cursor.
    pub fn last_line(&self) -> Option<String> {
        let t = self.term.lock();
        let screen = t.parser.screen();
        let (_, cols) = screen.size();
        let rows: Vec<String> = screen.rows(0, cols.get()).collect();
        let (cur, _) = screen.cursor_position();
        rows.iter()
            .take(cur as usize + 1)
            .rev()
            .chain(rows.iter().skip(cur as usize + 1).rev())
            .map(|r| r.trim())
            .find(|r| r.chars().any(|c| c.is_alphanumeric()))
            .map(|r| r.chars().take(200).collect())
    }

    /// The visible screen as plain text (for the orchestrator and tests).
    pub fn screen_text(&self) -> String {
        self.term.lock().parser.screen().contents()
    }
}

fn snapshot(screen: &vt100::Screen) -> String {
    let mut out = String::from("\x1b[0m\x1b[H\x1b[2J\x1b[3J");
    if screen.alternate_screen() {
        out.push_str("\x1b[?1049h");
    } else {
        let mut basic = String::new();
        let mut state = vt100::capture::BasicFormattedCaptureState::new();
        let _ = screen.write_contents_formatted_basic(&mut basic, vt100::capture::BasicFormattedCaptureRange::Full(&mut state));
        out.push_str(&basic.replace('\n', "\r\n"));
        out.push_str("\x1b[0m");
    }
    out.push_str(&screen.contents_formatted());
    out.push_str(&screen.input_mode_formatted());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_rebuilds_screen_and_scrollback() {
        let mut p = vt100::Parser::new(nz(5, 5), nz(20, 20), 100);
        for i in 0..12 {
            p.process(format!("line {i}\r\n").as_bytes());
        }
        p.process(b"\x1b[31mred\x1b[0m");
        let snap = snapshot(p.screen());

        let mut q = vt100::Parser::new(nz(5, 5), nz(20, 20), 100);
        q.process(snap.as_bytes());
        assert_eq!(q.screen().contents(), p.screen().contents());
        assert_eq!(q.screen().cursor_position(), p.screen().cursor_position());
        assert_eq!(q.screen().scrollback_len(), p.screen().scrollback_len());
        q.screen_mut().set_scrollback(100);
        assert!(q.screen().contents().starts_with("line 0"));
    }

    #[test]
    fn spawn_echo_and_attach() {
        let (tx, rx) = std::sync::mpsc::channel();
        let pty = Pty::spawn(
            Spawn {
                program: if cfg!(windows) { "cmd".into() } else { "/bin/sh".into() },
                args: if cfg!(windows) { vec!["/c".into(), "echo hello-pty".into()] } else { vec!["-c".into(), "echo hello-pty".into()] },
                cwd: std::env::temp_dir().to_string_lossy().into_owned(),
                env: vec![],
                env_remove: vec![],
                cols: 80,
                rows: 24,
            },
            move |n| {
                if let PtyNote::Exited(c) = n {
                    let _ = tx.send(c);
                }
            },
        )
        .unwrap();
        let code = rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
        assert_eq!(code, Some(0));
        assert!(pty.screen_text().contains("hello-pty"));
        let (snap, seq, _, _) = pty.attach();
        assert!(snap.contains("hello-pty"));
        assert!(seq > 0);
    }
}
