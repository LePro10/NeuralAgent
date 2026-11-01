//! Process-wide speech memory rules (D74, D75).
//!
//! - One Parakeet per daemon: calls and Claude-view dictation each keep the model only as long as
//!   their own keep-alive says, but while either holds it the other reuses the same instance
//!   instead of loading a second copy (about 0.6-1 GB each).
//! - `MallocSpaceEfficient` is the host's instruction to this process's allocator (read once at
//!   process start) so freed model memory goes back to macOS at once; it is removed from the
//!   environment right away so agents and tools we start run exactly as before.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};

use anyhow::Result;
use na_voice::stt::{Stt, SttKind, SttModel};
use parking_lot::Mutex;

/// The environment variable the host sets for the daemon (macOS libmalloc).
pub const MALLOC_ENV: &str = "MallocSpaceEfficient";

/// Call first thing in `main`, before any thread exists.
pub fn forget_malloc_env() {
    if std::env::var_os(MALLOC_ENV).is_some() {
        // SAFETY: called at the very start of `main`, while the process has a single thread.
        unsafe { std::env::remove_var(MALLOC_ENV) };
    }
}

/// The loaded Parakeet, if anybody still holds it. Not a keep-alive itself.
static PARAKEET: Mutex<Option<(PathBuf, Weak<Stt>)>> = Mutex::new(None);
/// Held while a Parakeet loads, so two users starting at once share one load.
static LOADING: Mutex<()> = Mutex::new(());

fn loaded(dir: &Path) -> Option<Arc<Stt>> {
    PARAKEET.lock().as_ref().filter(|(d, _)| d == dir).and_then(|(_, w)| w.upgrade())
}

/// Parakeet from `dir`: the instance another user holds, or a fresh load. The caller decides how
/// long to keep it (dropping the last `Arc` frees it).
pub fn parakeet(dir: PathBuf, threads: i32) -> Result<Arc<Stt>> {
    if let Some(s) = loaded(&dir) {
        return Ok(s);
    }
    let _one = LOADING.lock();
    if let Some(s) = loaded(&dir) {
        return Ok(s);
    }
    let s = Arc::new(Stt::load(SttModel { kind: SttKind::Parakeet, dir: dir.clone(), language: None, threads })?);
    *PARAKEET.lock() = Some((dir, Arc::downgrade(&s)));
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_loaded_means_no_reuse() {
        assert!(loaded(Path::new("/nonexistent/parakeet")).is_none());
        // A missing model folder is an error, not a panic, and leaves nothing behind.
        assert!(parakeet(PathBuf::from("/nonexistent/parakeet"), 1).is_err());
        assert!(loaded(Path::new("/nonexistent/parakeet")).is_none());
    }
}
