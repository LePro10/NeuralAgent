//! The last dictations, kept on this computer so a text is not lost when the app it was typed
//! into drops it (D85). Plain JSON next to `voice.json`, readable only by the user; never sent
//! anywhere except to this app's own settings (and the user's paired devices, like every
//! host setting).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

/// At most this many dictations are kept; the oldest goes first.
pub const KEEP: usize = 50;

/// Makes ids unique when two dictations land in the same millisecond.
static SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Dictation {
    pub id: String,
    /// Unix time in milliseconds.
    pub at: u64,
    pub text: String,
}

pub struct Dictations {
    path: PathBuf,
    list: Mutex<Vec<Dictation>>,
}

impl Dictations {
    pub fn load(data: &Path) -> Self {
        let path = data.join("dictations.json");
        let list = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { path, list: Mutex::new(list) }
    }

    /// Newest first.
    pub fn list(&self) -> Vec<Dictation> {
        self.list.lock().clone()
    }

    pub fn add(&self, text: &str) -> Result<()> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(());
        }
        let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let mut list = self.list.lock();
        let id = format!("{at}-{}", SEQ.fetch_add(1, Ordering::Relaxed));
        list.insert(0, Dictation { id, at, text: text.to_string() });
        list.truncate(KEEP);
        self.save(&list)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let mut list = self.list.lock();
        list.retain(|d| d.id != id);
        self.save(&list)
    }

    pub fn clear(&self) -> Result<()> {
        let mut list = self.list.lock();
        list.clear();
        self.save(&list)
    }

    fn save(&self, list: &[Dictation]) -> Result<()> {
        let tmp = self.path.with_extension("json.tmp");
        let data = serde_json::to_vec(list)?;
        {
            use std::io::Write as _;
            let mut opts = std::fs::OpenOptions::new();
            opts.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt as _;
                opts.mode(0o600);
            }
            opts.open(&tmp)?.write_all(&data)?;
        }
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("na-dictations-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn keeps_newest_first_and_survives_a_restart() {
        let d = dir();
        let h = Dictations::load(&d);
        h.add("first").unwrap();
        h.add("  second  ").unwrap();
        h.add("   ").unwrap();
        let again = Dictations::load(&d);
        let texts: Vec<_> = again.list().into_iter().map(|x| x.text).collect();
        assert_eq!(texts, ["second", "first"]);
    }

    #[test]
    fn caps_deletes_and_clears() {
        let d = dir();
        let h = Dictations::load(&d);
        for i in 0..KEEP + 5 {
            h.add(&format!("t{i}")).unwrap();
        }
        let list = h.list();
        assert_eq!(list.len(), KEEP);
        assert_eq!(list[0].text, format!("t{}", KEEP + 4));
        let ids: std::collections::HashSet<_> = list.iter().map(|x| x.id.clone()).collect();
        assert_eq!(ids.len(), KEEP, "ids are unique");
        h.delete(&list[0].id).unwrap();
        assert_eq!(Dictations::load(&d).list().len(), KEEP - 1);
        h.clear().unwrap();
        assert!(Dictations::load(&d).list().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn file_is_private() {
        use std::os::unix::fs::PermissionsExt as _;
        let d = dir();
        Dictations::load(&d).add("secret").unwrap();
        let mode = std::fs::metadata(d.join("dictations.json")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
