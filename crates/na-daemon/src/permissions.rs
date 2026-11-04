//! macOS privacy (TCC) from the service's side (D58).
//!
//! macOS asks once per app before a process reads Desktop, Documents, Downloads, iCloud Drive,
//! media folders or other volumes. The dialog appears on the computer's screen and the reading
//! process waits until someone answers, which nobody can while working from the phone. With Full
//! Disk Access none of these dialogs appear. So the service checks whether it has Full Disk
//! Access (without causing a dialog) and, without it, nothing the service does for a phone, a
//! browser, Neural or in the background opens a guarded folder (`Gate`, `check`) unless macOS has
//! answered for it already (an agent works there, or the service read there). Who counts as "the app" is
//! the host process that started the service (`neuralagent --service`, see
//! apps/desktop/src-tauri/src/service.rs).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use na_protocol::{ApiError, ClientInfo, ClientKind, ErrorCode, Request};
use parking_lot::Mutex;

use crate::core::{Core, err};

/// What phones see where macOS would ask first. The UI keys on its start.
pub const NEEDS_FDA: &str = "Needs Full Disk Access on the Mac. Without it macOS first asks on the Mac's screen, and nobody can answer that from here. Turn it on once at the Mac (Settings → System), or open this folder once on the Mac.";

/// Folders below the home folder that macOS guards one by one (other apps' data and cloud
/// drives too).
#[cfg(any(target_os = "macos", test))]
const GUARDED: &[&str] = &[
    "Desktop",
    "Documents",
    "Downloads",
    "Library/Mobile Documents",
    "Library/CloudStorage",
    "Library/Containers",
    "Library/Group Containers",
    "Music",
    "Pictures",
    "Movies",
];

/// The guarded folders of one home folder, known by name and by identity on disk.
#[derive(Clone)]
pub struct Guards {
    roots: Vec<(PathBuf, Option<(u64, u64)>)>,
}

#[cfg(unix)]
fn ident(m: &std::fs::Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    Some((m.dev(), m.ino()))
}

#[cfg(not(unix))]
fn ident(_: &std::fs::Metadata) -> Option<(u64, u64)> {
    None
}

/// Case folding the way APFS compares names (enough for these ASCII names and their look-alikes).
fn fold(p: &Path) -> String {
    // `to_lowercase` maps the Kelvin sign to k; the long s is lower case already.
    p.to_string_lossy().chars().flat_map(char::to_lowercase).map(|c| if c == '\u{17f}' { 's' } else { c }).collect()
}

impl Guards {
    pub fn new(home: &Path) -> Guards {
        #[cfg(any(target_os = "macos", test))]
        let names = GUARDED;
        #[cfg(not(any(target_os = "macos", test)))]
        let names: &[&str] = &[];
        // A stat of the guarded folder itself is a lookup in its parent: no dialog.
        let roots = names
            .iter()
            .map(|g| home.join(g))
            .map(|p| (std::fs::metadata(&p).ok().as_ref().and_then(ident), p))
            .map(|(i, p)| (p, i))
            .collect();
        Guards { roots }
    }

    /// The guarded folder `path` lies in (`~/Documents`, `/Volumes/USB`, …), or None. Resolves
    /// links and other spellings (`~/documents`, a link to `~/Desktop/x`) from the top down and
    /// never looks inside a guarded folder while doing so (that alone could raise the dialog).
    pub fn root_of(&self, path: &Path) -> Option<PathBuf> {
        if self.roots.is_empty() || !path.is_absolute() {
            return None;
        }
        let mut todo: Vec<std::ffi::OsString> = vec![];
        push_parts(&mut todo, path);
        let mut cur = PathBuf::from("/");
        let mut hops = 0;
        while let Some(c) = todo.pop() {
            if c == ".." {
                cur.pop();
                continue;
            }
            let next = cur.join(&c);
            // By name in any case (also when it does not exist), then by identity.
            let name = fold(&next);
            if let Some((r, _)) = self.roots.iter().find(|(r, _)| fold(r) == name) {
                return Some(r.clone());
            }
            let meta = std::fs::symlink_metadata(&next).ok();
            if meta.as_ref().is_some_and(|m| m.file_type().is_symlink()) {
                hops += 1;
                let Ok(to) = std::fs::read_link(&next) else { return None };
                if hops > 40 {
                    return None;
                }
                if to.is_absolute() {
                    cur = PathBuf::from("/");
                }
                push_parts(&mut todo, &to);
                continue;
            }
            // Other volumes (USB disks, network shares; the boot volume's entry is a link).
            if fold(&cur) == "/volumes" {
                return Some(next);
            }
            let id = meta.as_ref().and_then(ident);
            if let Some((r, _)) = self.roots.iter().find(|(_, i)| i.is_some() && *i == id) {
                return Some(r.clone());
            }
            cur = next;
        }
        None
    }
}

/// `p`'s parts onto a stack (last part first out is the first part).
fn push_parts(todo: &mut Vec<std::ffi::OsString>, p: &Path) {
    use std::path::Component;
    let parts: Vec<_> = p
        .components()
        .filter_map(|c| match c {
            Component::Normal(n) => Some(n.to_os_string()),
            Component::ParentDir => Some("..".into()),
            _ => None,
        })
        .collect();
    todo.extend(parts.into_iter().rev());
}

/// The guarded folder `path` lies in, or None (always None off macOS).
#[cfg(test)]
pub fn guarded_root(home: &Path, path: &Path) -> Option<PathBuf> {
    Guards::new(home).root_of(path)
}

/// Guarded folders the service has already read in (macOS answered "allow" then, so it will not
/// ask again). Kept in `<data>/folder-access.json` when the host runs the service: only then is
/// it "NeuralAgent" for macOS across restarts and updates (D59).
struct Known {
    file: Option<PathBuf>,
    roots: HashSet<PathBuf>,
}

static KNOWN: Mutex<Option<Known>> = Mutex::new(None);

fn known<R>(data: &Path, f: impl FnOnce(&mut Known) -> R) -> R {
    let mut g = KNOWN.lock();
    let k = g.get_or_insert_with(|| {
        let file = crate::service::host_mode().map(|_| data.join("folder-access.json"));
        let roots = file
            .as_ref()
            .and_then(|f| std::fs::read(f).ok())
            .and_then(|b| serde_json::from_slice::<Vec<PathBuf>>(&b).ok())
            .unwrap_or_default();
        Known { file, roots: roots.into_iter().collect() }
    });
    f(k)
}

/// What a caller may touch right now without risking a macOS dialog nobody answers.
#[derive(Clone)]
pub struct Gate {
    data: PathBuf,
    fda: Option<bool>,
    /// Someone at the computer asked (the desktop window): a dialog is theirs to answer.
    here: bool,
    guards: Guards,
    allowed: Vec<PathBuf>,
}

impl Gate {
    /// No checks (tests).
    #[cfg(test)]
    pub fn open() -> Gate {
        Gate { data: PathBuf::new(), fda: None, here: true, guards: Guards { roots: vec![] }, allowed: vec![] }
    }

    /// A phone without Full Disk Access, nothing answered yet (tests).
    #[cfg(test)]
    pub fn remote_without_fda(home: &Path) -> Gate {
        Gate { data: home.to_path_buf(), fda: Some(false), here: false, guards: Guards::new(home), allowed: vec![] }
    }

    fn checks(&self) -> bool {
        !self.here && self.fda == Some(false)
    }

    /// The guarded folder `path` lies in (whoever asks), or None.
    pub fn root(&self, path: &Path) -> Option<PathBuf> {
        self.guards.root_of(path)
    }

    /// Whether the guarded folder `root` (from `root`) is shut for this caller.
    pub fn is_shut(&self, root: Option<&PathBuf>) -> bool {
        self.checks() && root.is_some_and(|r| !self.allowed.contains(r))
    }

    /// The guarded folder that keeps `path` shut, or None when it may be touched.
    pub fn shut(&self, path: &Path) -> Option<PathBuf> {
        if !self.checks() {
            return None;
        }
        self.root(path).filter(|r| self.is_shut(Some(r)))
    }

    pub fn check(&self, path: &Path) -> Result<(), ApiError> {
        match self.shut(path) {
            Some(_) => Err(err(ErrorCode::Forbidden, NEEDS_FDA)),
            None => Ok(()),
        }
    }

    /// macOS answered for `path` (it was read, or refused): remember it for its guarded folder.
    pub fn answered<T>(&self, path: &Path, r: &std::io::Result<T>) {
        if self.fda != Some(false) {
            return;
        }
        let ok = match r {
            Ok(_) => true,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => false,
            Err(_) => return,
        };
        let Some(root) = self.guards.root_of(path) else { return };
        known(&self.data, |k| {
            let changed = if ok { k.roots.insert(root) } else { k.roots.remove(&root) };
            if changed && let Some(f) = &k.file {
                let mut all: Vec<_> = k.roots.iter().collect();
                all.sort();
                let _ = std::fs::write(f, serde_json::to_vec(&all).unwrap_or_default());
            }
        });
    }
}

impl Core {
    /// What `client` may touch now (None: background work nobody asked for).
    pub(crate) fn folder_gate(&self, client: Option<&ClientInfo>) -> Gate {
        let home = &self.env.home;
        let fda = full_disk_access(home);
        let here = client.is_some_and(|c| c.kind == ClientKind::Desktop);
        let guards = Guards::new(home);
        let mut allowed: Vec<PathBuf> = vec![];
        if fda == Some(false) {
            allowed = known(&self.paths.root, |k| k.roots.iter().cloned().collect());
            // Where a running agent works, macOS already answered (it waited for the answer).
            let dirs: Vec<String> = self.read(|s| s.sessions.values().filter(|x| x.alive).map(|x| x.cwd.clone()).collect());
            allowed.extend(dirs.iter().filter_map(|d| guards.root_of(Path::new(d))));
        }
        Gate { data: self.paths.root.clone(), fda, here, guards, allowed }
    }

    /// May background work (or a request without a client) touch `path` now?
    pub(crate) fn folder_ok(&self, path: &Path) -> bool {
        self.folder_gate(None).shut(path).is_none()
    }
}

/// Requests from phones, browsers and Neural that would make the service (or an agent it starts)
/// open a folder: refused with `NEEDS_FDA` where macOS would ask first. The desktop window is the
/// user at the computer, so it may.
pub fn check(core: &Core, client: &ClientInfo, req: &Request) -> Result<(), ApiError> {
    if client.kind == ClientKind::Desktop || full_disk_access(&core.env.home) != Some(false) {
        return Ok(());
    }
    // Folders on other computers (SSH) are not this computer's to guard.
    let ws = |id: &String| core.read(|s| s.workspaces.iter().find(|w| &w.id == id && w.ssh.is_none()).map(|w| w.path.clone()));
    let cwd = |id: &String| {
        core.read(|s| {
            s.sessions.get(id).filter(|x| s.workspaces.iter().any(|w| w.id == x.workspace_id && w.ssh.is_none())).map(|x| x.cwd.clone())
        })
    };
    let ws_of = |id: &String| {
        core.read(|s| {
            s.sessions.get(id).and_then(|x| s.workspaces.iter().find(|w| w.id == x.workspace_id && w.ssh.is_none())).map(|w| w.path.clone())
        })
    };
    let paths: Vec<String> = match req {
        Request::WorkspaceAdd { ssh: Some(_), .. } => return Ok(()),
        Request::WorkspaceAdd { path, .. } => vec![crate::fsbrowse::expand_lexical(&core.env.home, path).to_string_lossy().into_owned()],
        Request::SessionStart(st) => ws(&st.workspace_id).map(|w| st.cwd.clone().unwrap_or(w)).into_iter().collect(),
        Request::SessionRestart { id } => cwd(id).into_iter().collect(),
        Request::GitChanges { workspace_id, session_id } | Request::GitDiff { workspace_id, session_id, .. } => {
            ws(workspace_id).into_iter().chain(session_id.as_ref().and_then(cwd)).collect()
        }
        Request::WorktreeMerge { session_id } | Request::WorktreeDiscard { session_id } => ws_of(session_id).into_iter().collect(),
        _ => return Ok(()),
    };
    let gate = core.folder_gate(Some(client));
    paths.iter().try_for_each(|p| gate.check(Path::new(p)))
}

/// Does this process have Full Disk Access? Only the TCC database itself tells without a
/// dialog: opening it works with Full Disk Access and fails with "operation not permitted"
/// otherwise. Checked at most every 20 s. None off macOS.
pub fn full_disk_access(home: &Path) -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        use parking_lot::Mutex;
        use std::time::{Duration, Instant};
        static LAST: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
        let mut last = LAST.lock();
        if let Some((at, v)) = *last
            && at.elapsed() < Duration::from_secs(20)
        {
            return Some(v);
        }
        let v = probe_fda(home);
        *last = Some((Instant::now(), v));
        Some(v)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = home;
        None
    }
}

#[cfg(target_os = "macos")]
fn probe_fda(home: &Path) -> bool {
    let user = home.join("Library/Application Support/com.apple.TCC/TCC.db");
    match std::fs::File::open(&user) {
        Ok(_) => true,
        // No user database (very rare): the system one tells the same.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::File::open("/Library/Application Support/com.apple.TCC/TCC.db").is_ok()
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarded_folders() {
        let home = Path::new("/Users/me");
        assert_eq!(guarded_root(home, Path::new("/Users/me/Documents/app")), Some(PathBuf::from("/Users/me/Documents")));
        assert_eq!(guarded_root(home, Path::new("/Users/me/Desktop")), Some(PathBuf::from("/Users/me/Desktop")));
        assert_eq!(
            guarded_root(home, Path::new("/Users/me/Library/Mobile Documents/com~apple~CloudDocs/x")),
            Some(PathBuf::from("/Users/me/Library/Mobile Documents"))
        );
        assert_eq!(guarded_root(home, Path::new("/Volumes/USB/proj")), Some(PathBuf::from("/Volumes/USB")));
        assert_eq!(guarded_root(home, Path::new("/Users/me/code/app")), None);
        assert_eq!(guarded_root(home, Path::new("/Users/me/DocumentsOld")), None);
        assert_eq!(guarded_root(home, Path::new("/tmp/x")), None);
    }

    fn fake_home(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("na-guard-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        for d in ["Documents/app", "Desktop", "Library/Containers/x", "code"] {
            std::fs::create_dir_all(h.join(d)).unwrap();
        }
        h
    }

    #[test]
    fn other_spellings_and_links_are_caught() {
        let h = fake_home("spell");
        let g = Guards::new(&h);
        let docs = Some(h.join("Documents"));
        assert_eq!(g.root_of(&h.join("Documents/app")), docs);
        assert_eq!(g.root_of(&h.join("code")), None);
        // Case and look-alike letters (APFS folds them), `..`, and a doubled slash.
        assert_eq!(g.root_of(&h.join("documents/app")), docs);
        assert_eq!(g.root_of(&h.join("DOCUMENTS")), docs);
        assert_eq!(g.root_of(&h.join("Document\u{17f}")), docs);
        assert_eq!(g.root_of(&h.join("code/../Documents/x")), docs);
        assert_eq!(g.root_of(Path::new(&format!("{}//Documents", h.display()))), docs);
        assert_eq!(g.root_of(&h.join("Library/Containers/x")), Some(h.join("Library/Containers")));
        assert_eq!(g.root_of(&h.join("Library")), None);
        // Links into a guarded folder, relative and absolute, through a chain; a loop ends.
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink("../Documents/app", h.join("code/rel")).unwrap();
            symlink(h.join("Desktop"), h.join("code/abs")).unwrap();
            symlink(h.join("code/rel"), h.join("code/chain")).unwrap();
            symlink(h.join("code/loop"), h.join("code/loop")).unwrap();
            symlink(&h, h.join("code/home")).unwrap();
            assert_eq!(g.root_of(&h.join("code/rel/src")), docs);
            assert_eq!(g.root_of(&h.join("code/abs")), Some(h.join("Desktop")));
            assert_eq!(g.root_of(&h.join("code/chain")), docs);
            assert_eq!(g.root_of(&h.join("code/home/documents")), docs);
            assert_eq!(g.root_of(&h.join("code/loop/x")), None);
            // The home folder reached through a link: found by identity.
            let alias = std::env::temp_dir().join(format!("na-guard-alias-{}", std::process::id()));
            let _ = std::fs::remove_file(&alias);
            symlink(&h, &alias).unwrap();
            assert_eq!(g.root_of(&alias.join("Documents/app")), docs);
            let _ = std::fs::remove_file(&alias);
        }
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn the_gate_shuts_guarded_folders_for_remotes_without_full_disk_access() {
        let h = fake_home("gate");
        let gate = |fda, here, allowed: Vec<PathBuf>| Gate { data: h.clone(), fda, here, guards: Guards::new(&h), allowed };
        let app = h.join("Documents/app");
        assert_eq!(gate(Some(false), false, vec![]).shut(&app), Some(h.join("Documents")));
        assert_eq!(gate(Some(false), false, vec![]).check(&app).unwrap_err().message, NEEDS_FDA);
        assert!(gate(Some(false), false, vec![]).check(&h.join("code")).is_ok());
        // Full Disk Access, off macOS, the user at the computer, or macOS answered already.
        assert_eq!(gate(Some(true), false, vec![]).shut(&app), None);
        assert_eq!(gate(None, false, vec![]).shut(&app), None);
        assert_eq!(gate(Some(false), true, vec![]).shut(&app), None);
        assert_eq!(gate(Some(false), false, vec![h.join("Documents")]).shut(&app), None);
        assert!(gate(Some(false), false, vec![h.join("Documents")]).shut(&h.join("Desktop")).is_some());
        // Answers are remembered per guarded folder (in memory for a service without a host).
        let g = gate(Some(false), true, vec![]);
        g.answered(&app, &Ok(()));
        assert!(known(&h, |k| k.roots.contains(&h.join("Documents"))));
        g.answered(&h.join("documents/x"), &Err::<(), _>(std::io::Error::from(std::io::ErrorKind::PermissionDenied)));
        assert!(!known(&h, |k| k.roots.contains(&h.join("Documents"))));
        let _ = std::fs::remove_dir_all(&h);
    }
}
