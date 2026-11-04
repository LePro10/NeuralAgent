//! Files explorer (D67): list a folder, read a file in pieces, save a text file, upload into a
//! folder and search by name, always inside an allowed root.
//!
//! Roots: the desktop window may use every workspace folder and the home folder. Phones and
//! browsers may use approved workspaces, plus the home folder (read only) when
//! `settings.remote_files_home` is on. Neural (the orchestrator) gets none; its agents have the
//! files already. Every path is resolved (`..` and symlinks) before the root check, so a link
//! that points outside a root cannot be opened through it.
//!
//! macOS asks before an app reads Desktop, Documents or Downloads. A listing never looks inside a
//! child folder, and a search never walks into those folders (or Library) from the home folder.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use na_protocol::{ApiError, ClientInfo, ClientKind, ErrorCode, FileChunk, FileEntry, FileListing, FileUploadResult, GitFileStatus, State};

use crate::core::err;
use crate::permissions::Gate;

/// One read answers with at most this much (base64 grows it by a third; relay frames stay small).
pub const MAX_CHUNK: u32 = 1 << 20;
pub const DEFAULT_CHUNK: u32 = 512 << 10;
/// Text files bigger than this are not saved from the editor.
pub const MAX_SAVE: usize = 4 << 20;
/// An upload may grow to this size.
pub const MAX_UPLOAD: u64 = 1 << 30;
/// An upload never leaves less than this free on the computer's disk.
pub const MIN_FREE: u64 = 1 << 30;
/// A listing stops after this many entries.
const MAX_ENTRIES: usize = 5000;
/// Names a listing looks at (before sorting and cutting to `MAX_ENTRIES`).
const MAX_SCAN: usize = 200_000;
const MAX_RESULTS: usize = 200;
/// Entries a search looks at before it gives up.
const MAX_VISITS: usize = 60_000;
/// Folders a search never walks into (build output, dependencies, VCS data).
const SKIP_DIRS: &[&str] =
    &[".git", "node_modules", "target", ".venv", "venv", "__pycache__", ".next", ".gradle", "Pods", "DerivedData", ".cache"];
/// Folders in the home folder that macOS guards with a permission prompt, or that hold guarded ones.
const PROTECTED: &[&str] = &["Desktop", "Documents", "Downloads", "Library", "Pictures", "Movies", "Music"];

/// A folder files may be used in.
#[derive(Debug, Clone)]
pub struct Root {
    /// Resolved (canonical).
    pub path: PathBuf,
    pub name: String,
    pub writable: bool,
    /// macOS would ask before it can be read (no Full Disk Access, see `permissions::Gate`):
    /// `path` is the saved spelling, never resolved.
    pub shut: bool,
}

/// The roots `client` may use, deepest first (a workspace inside another wins).
pub fn roots(state: &State, client: &ClientInfo, home: &Path, gate: &Gate) -> Vec<Root> {
    let mut out = vec![];
    let desktop = client.kind == ClientKind::Desktop;
    let remote = matches!(client.kind, ClientKind::Web | ClientKind::Android);
    if !desktop && !remote {
        return out;
    }
    // A root saved through a link (`/tmp` → `/private/tmp` on macOS) is also known by that
    // spelling, so the paths clients have pass the first, lexical check; what they resolve to is
    // checked against the real root.
    let mut add = |given: &Path, name: &str, writable: bool| {
        // Resolving it would already look inside a guarded folder.
        if gate.shut(given).is_some() {
            out.push(Root { path: lexical(given), name: name.to_string(), writable, shut: true });
            return;
        }
        if let Ok(path) = given.canonicalize() {
            let alias = lexical(given);
            if alias.is_absolute() && alias != path {
                out.push(Root { path: alias, name: name.to_string(), writable, shut: false });
            }
            out.push(Root { path, name: name.to_string(), writable, shut: false });
        }
    };
    for w in &state.workspaces {
        if w.ssh.is_none() && (desktop || w.approved) {
            add(Path::new(&w.path), &w.name, true);
        }
    }
    if desktop || state.settings.remote_files_home == Some(true) {
        add(home, "Home", desktop);
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.path.components().count()));
    out
}

/// One `file_*` request (run it on a blocking thread).
pub fn handle(home: &Path, roots: &[Root], gate: &Gate, req: na_protocol::Request) -> Result<serde_json::Value, ApiError> {
    use na_protocol::Request as R;
    use serde_json::json;
    if roots.is_empty() {
        return Err(forbidden());
    }
    // Where macOS would ask first (other spellings and links too), before anything resolves it.
    if let R::FileList { path, .. }
    | R::FileRead { path, .. }
    | R::FileSave { path, .. }
    | R::FileUpload { dir: path, .. }
    | R::FileSearch { path, .. } = &req
    {
        gate.check(&crate::fsbrowse::expand_lexical(home, path))?;
    }
    match req {
        R::FileList { path, hidden } => {
            let l = list(home, roots, &path, hidden)?;
            gate.answered(Path::new(&l.path), &Ok(()));
            Ok(json!(l))
        }
        R::FileRead { path, offset, len } => read(home, roots, &path, offset, len).map(|x| json!(x)),
        R::FileSave { path, text, mtime } => save(home, roots, &path, &text, mtime).map(|x| json!(x)),
        R::FileUpload { dir, name, id, offset, data, last, size } => {
            upload(home, roots, &dir, &name, &id, offset, &data, last, size).map(|x| json!(x))
        }
        R::FileSearch { path, query, hidden } => search(home, roots, &path, &query, hidden).map(|x| json!(x)),
        _ => Err(err(ErrorCode::BadRequest, "not a file request")),
    }
}

fn forbidden() -> ApiError {
    err(ErrorCode::Forbidden, "This file is outside the folders you can open here")
}

/// `path` (absolute or `~/…`) resolved, with the root it lies in.
pub fn resolve<'a>(home: &Path, roots: &'a [Root], path: &str) -> Result<(PathBuf, &'a Root), ApiError> {
    let home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    let p = match path.strip_prefix("~") {
        Some("") => home.clone(),
        Some(rest) if rest.starts_with('/') => home.join(&rest[1..]),
        _ => PathBuf::from(path),
    };
    if !p.is_absolute() || path.contains('\0') {
        return Err(err(ErrorCode::BadRequest, "Use a full path"));
    }
    // Refused before the disk is touched (not even a stat in a guarded folder). Roots are resolved
    // paths and so are the paths in listings.
    match roots.iter().find(|r| lexical(&p).starts_with(&r.path)) {
        None => return Err(forbidden()),
        Some(r) if r.shut => return Err(err(ErrorCode::Forbidden, crate::permissions::NEEDS_FDA)),
        Some(_) => {}
    }
    // Then once more after resolving links: a link inside a root may point out of it.
    let real = p.canonicalize().map_err(|_| err(ErrorCode::NotFound, "This file or folder is gone"))?;
    let root = roots.iter().find(|r| !r.shut && real.starts_with(&r.path)).ok_or_else(forbidden)?;
    // The read-only home folder (phones) keeps out what macOS guards and where keys live.
    if !root.writable && off_limits(&home, &real) {
        return Err(err(ErrorCode::Forbidden, "This folder opens only on the computer"));
    }
    Ok((real, root))
}

/// Folders in the home folder where keys and tokens live; never opened from the read-only home root.
const SECRET: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".config",
    ".password-store",
    ".netrc",
    ".git-credentials",
    ".npmrc",
    ".pypirc",
];

/// Names in the home folder a phone may not open through the home root.
fn guarded_names() -> impl Iterator<Item = &'static str> {
    let mac: &[&str] = if cfg!(target_os = "macos") { PROTECTED } else { &[] };
    SECRET.iter().chain(mac).copied()
}

/// Whether `real` (resolved) lies in a guarded folder of `home` (resolved). Compared by the
/// folder's identity on disk too, so other spellings (`documents`, Unicode case folds on a
/// case-insensitive disk) and links to it are caught.
fn off_limits(home: &Path, real: &Path) -> bool {
    let Ok(rest) = real.strip_prefix(home) else { return false };
    let Some(first) = rest.components().next() else { return false };
    let first = first.as_os_str().to_string_lossy();
    let top = home.join(&*first);
    guarded_names().any(|g| {
        let gp = home.join(g);
        first.eq_ignore_ascii_case(g) || gp.canonicalize().is_ok_and(|c| real.starts_with(c)) || same_entry(&top, &gp)
    })
}

#[cfg(unix)]
fn same_entry(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
        _ => false,
    }
}

#[cfg(not(unix))]
fn same_entry(_: &Path, _: &Path) -> bool {
    false
}

/// `path` is still the very file behind `opened` and not a link.
#[cfg(unix)]
fn same_as_opened(path: &Path, opened: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(path).is_ok_and(|m| !m.file_type().is_symlink() && m.dev() == opened.dev() && m.ino() == opened.ino())
}

#[cfg(not(unix))]
fn same_as_opened(_: &Path, _: &std::fs::Metadata) -> bool {
    true
}

/// `a/./b/../c` → `a/c` without the disk.
fn lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            c => out.push(c),
        }
    }
    out
}

/// A link (outside a guarded folder) whose target lies in Desktop, Documents, … of `home`.
fn into_guarded(link: &Path, home: &Path) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let Ok(to) = std::fs::read_link(link) else { return false };
    let to = lexical(&link.parent().unwrap_or(Path::new("/")).join(to));
    PROTECTED.iter().any(|g| {
        let gp = home.join(g);
        to.starts_with(&gp) && !link.starts_with(&gp)
    })
}

fn ms(t: std::io::Result<SystemTime>) -> u64 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn entry_of(path: &Path, name: String, home: &Path) -> Option<FileEntry> {
    let lmeta = std::fs::symlink_metadata(path).ok()?;
    let link = lmeta.file_type().is_symlink();
    // A link shows what it points to (a broken one stays a small file), unless it points into a
    // folder macOS guards: looking there from a listing would raise a permission prompt.
    let meta = if link && !into_guarded(path, home) { std::fs::metadata(path).unwrap_or(lmeta) } else { lmeta };
    let protected = meta.is_dir() && path.parent() == Some(home) && PROTECTED.contains(&name.as_str());
    Some(FileEntry {
        path: path.to_string_lossy().into_owned(),
        dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        mtime: ms(meta.modified()),
        link,
        git: None,
        protected: cfg!(target_os = "macos") && protected,
        name,
    })
}

pub fn list(home: &Path, roots: &[Root], path: &str, hidden: bool) -> Result<FileListing, ApiError> {
    let (dir, root) = resolve(home, roots, path)?;
    if !dir.is_dir() {
        return Err(err(ErrorCode::BadRequest, "This is not a folder"));
    }
    let home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    let rd = std::fs::read_dir(&dir).map_err(|e| err(ErrorCode::Forbidden, format!("Cannot open this folder: {e}")))?;
    // Names first (cheap, no stat), sorted, so a cut-off huge folder shows its folders and first
    // names, not whatever the disk lists first.
    let mut names: Vec<(bool, String, PathBuf)> = vec![];
    let mut truncated = false;
    for e in rd.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().into_owned();
        if !hidden && name.starts_with('.') {
            continue;
        }
        if names.len() >= MAX_SCAN {
            truncated = true;
            break;
        }
        names.push((e.file_type().is_ok_and(|t| t.is_dir()), name, e.path()));
    }
    names.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    if names.len() > MAX_ENTRIES {
        truncated = true;
        names.truncate(MAX_ENTRIES);
    }
    let mut entries: Vec<FileEntry> = names.into_iter().filter_map(|(_, name, path)| entry_of(&path, name, &home)).collect();
    let marks = git_marks(&dir);
    let guard = !root.writable && dir == home;
    for e in &mut entries {
        e.git = marks.get(&e.name).copied();
        if guard && guarded_names().any(|g| e.name.eq_ignore_ascii_case(g)) {
            e.protected = true;
        }
    }
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(FileListing {
        path: dir.to_string_lossy().into_owned(),
        root: root.path.to_string_lossy().into_owned(),
        root_name: root.name.clone(),
        entries,
        writable: root.writable,
        truncated,
    })
}

/// How much a git state matters for a folder that holds several.
fn rank(s: GitFileStatus) -> u8 {
    match s {
        GitFileStatus::Conflicted => 5,
        GitFileStatus::Modified => 4,
        GitFileStatus::Added => 3,
        GitFileStatus::Renamed => 3,
        GitFileStatus::Deleted => 2,
        GitFileStatus::Untracked => 1,
    }
}

fn status_of(xy: &str) -> GitFileStatus {
    let (x, y) = (xy.chars().next().unwrap_or(' '), xy.chars().nth(1).unwrap_or(' '));
    match (x, y) {
        ('?', _) => GitFileStatus::Untracked,
        ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D') => GitFileStatus::Conflicted,
        ('R' | 'C', _) => GitFileStatus::Renamed,
        ('A', _) => GitFileStatus::Added,
        ('D', _) | (_, 'D') => GitFileStatus::Deleted,
        _ => GitFileStatus::Modified,
    }
}

fn git_out(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        // No fsmonitor hook: a listing must never run a program named in a repo's config.
        .args(["-c", "core.quotepath=off", "-c", "status.relativePaths=false", "-c", "core.fsmonitor=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Git state per child name of `dir` (folders get the strongest state inside). Empty outside a repo.
fn git_marks(dir: &Path) -> HashMap<String, GitFileStatus> {
    let mut out = HashMap::new();
    let Some(top) = git_out(dir, &["rev-parse", "--show-toplevel"]) else { return out };
    let top = PathBuf::from(top.trim());
    let top = top.canonicalize().unwrap_or(top);
    let Ok(rel) = dir.strip_prefix(&top) else { return out };
    let spec = if rel.as_os_str().is_empty() { ".".to_string() } else { rel.to_string_lossy().into_owned() };
    let Some(st) = git_out(&top, &["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--", &spec]) else { return out };
    parse_status(&st, rel, &mut out);
    out
}

fn parse_status(st: &str, rel: &Path, out: &mut HashMap<String, GitFileStatus>) {
    let mut it = st.split('\0').filter(|s| s.len() > 3);
    while let Some(rec) = it.next() {
        let (xy, path) = rec.split_at(3);
        let status = status_of(xy);
        if matches!(status, GitFileStatus::Renamed) {
            it.next(); // the old name
        }
        let Ok(inner) = Path::new(path.trim_end_matches('/')).strip_prefix(rel) else { continue };
        let Some(first) = inner.components().next() else { continue };
        let name = first.as_os_str().to_string_lossy().into_owned();
        let deeper = inner.components().count() > 1;
        // A changed file inside a folder marks the folder as changed (not as "added").
        let s = if deeper && !matches!(status, GitFileStatus::Untracked | GitFileStatus::Conflicted) {
            GitFileStatus::Modified
        } else {
            status
        };
        let e = out.entry(name).or_insert(s);
        if rank(s) > rank(*e) {
            *e = s;
        }
    }
}

/// Types that are never shown as text, whatever their bytes look like.
const BINARY: &[&str] = &["image/", "audio/", "video/", "application/pdf", "application/zip", "application/gzip"];

/// A type for the viewer: from the name, then the first bytes.
pub fn mime_of(name: &str, head: &[u8]) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let by_ext = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "md" | "markdown" | "mdx" => "text/markdown",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "csv" => "text/csv",
        "json" => "application/json",
        "js" | "mjs" | "cjs" => "text/javascript",
        _ => "",
    };
    if !by_ext.is_empty() {
        return by_ext;
    }
    match head {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xff, 0xd8, 0xff, ..] => "image/jpeg",
        [b'G', b'I', b'F', b'8', ..] => "image/gif",
        [b'%', b'P', b'D', b'F', ..] => "application/pdf",
        _ if looks_text(head) => "text/plain",
        _ => "application/octet-stream",
    }
}

/// No NUL bytes and valid UTF-8 (a character cut at the end of the piece is fine).
pub fn looks_text(b: &[u8]) -> bool {
    if b.starts_with(&[0xff, 0xfe]) || b.starts_with(&[0xfe, 0xff]) || utf16_plain(b) {
        return true;
    }
    if b.contains(&0) {
        return false;
    }
    match std::str::from_utf8(b) {
        Ok(_) => true,
        Err(e) if e.error_len().is_none() => true,
        // A one-byte code page (Latin-1, Windows-1252): hardly any control characters.
        Err(_) => b.iter().filter(|&&c| c < 0x20 && !matches!(c, b'\t' | b'\n' | b'\r' | 0x0c)).count() * 100 <= b.len(),
    }
}

/// UTF-16 without a byte-order mark, mostly ASCII: every other byte is zero.
fn utf16_plain(b: &[u8]) -> bool {
    let pairs = b.len() / 2;
    if pairs < 2 {
        return false;
    }
    let zeros = |at: usize| b.as_chunks::<2>().0.iter().filter(|p| p[at] == 0).count();
    let (even, odd) = (zeros(0), zeros(1));
    (odd * 10 >= pairs * 9 && even * 20 <= pairs) || (even * 10 >= pairs * 9 && odd * 20 <= pairs)
}

pub fn read(home: &Path, roots: &[Root], path: &str, offset: u64, len: Option<u32>) -> Result<FileChunk, ApiError> {
    let (real, root) = resolve(home, roots, path)?;
    // Check before opening: opening a FIFO would block.
    let meta = std::fs::metadata(&real).map_err(|_| err(ErrorCode::NotFound, "This file is gone"))?;
    if !meta.is_file() {
        return Err(err(ErrorCode::BadRequest, "This is not a file"));
    }
    let len = len.unwrap_or(DEFAULT_CHUNK).clamp(1, MAX_CHUNK) as u64;
    let mut f = std::fs::File::open(&real).map_err(|e| err(ErrorCode::Forbidden, format!("Cannot open this file: {e}")))?;
    // What was opened is what was checked (not a link swapped in meanwhile).
    let meta = f.metadata().map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    if !meta.is_file() || !same_as_opened(&real, &meta) {
        return Err(forbidden());
    }
    let size = meta.len();
    let offset = offset.min(size);
    f.seek(SeekFrom::Start(offset)).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    let mut buf = Vec::with_capacity(len.min(size - offset) as usize);
    f.take(len).read_to_end(&mut buf).map_err(|e| err(ErrorCode::Internal, e.to_string()))?;
    let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    // The type comes from the file's start, whichever piece this is.
    let head: Vec<u8> = if offset == 0 {
        buf.iter().take(8192).copied().collect()
    } else {
        let mut h = vec![0u8; 8192];
        let n = std::fs::File::open(&real).and_then(|mut g| g.read(&mut h)).unwrap_or(0);
        h.truncate(n);
        h
    };
    let mime = mime_of(&name, &head);
    Ok(FileChunk {
        path: real.to_string_lossy().into_owned(),
        text: mime == "image/svg+xml" || (looks_text(&head) && !BINARY.iter().any(|b| mime.starts_with(b))),
        mime: mime.to_string(),
        eof: offset + buf.len() as u64 >= size,
        data: base64::engine::general_purpose::STANDARD.encode(&buf),
        size,
        mtime: ms(meta.modified()),
        offset,
        writable: root.writable && !meta.permissions().readonly(),
        name,
    })
}

fn temp_name(tag: &str) -> String {
    format!(".na-{tag}-{:08x}.part", rand::random::<u32>())
}

pub fn save(home: &Path, roots: &[Root], path: &str, text: &str, mtime: Option<u64>) -> Result<FileEntry, ApiError> {
    if text.len() > MAX_SAVE {
        return Err(err(ErrorCode::BadRequest, "This file is too big to save from here"));
    }
    let (real, root) = resolve(home, roots, path)?;
    if !root.writable {
        return Err(err(ErrorCode::Forbidden, "Files here can only be read from this device"));
    }
    let meta = std::fs::metadata(&real).map_err(|_| err(ErrorCode::NotFound, "This file is gone"))?;
    if !meta.is_file() {
        return Err(err(ErrorCode::BadRequest, "This is not a file"));
    }
    if meta.permissions().readonly() {
        return Err(err(ErrorCode::Forbidden, "This file is read-only"));
    }
    if mtime.is_some_and(|m| m != ms(meta.modified())) {
        return Err(err(ErrorCode::Conflict, "The file changed on the computer since you opened it"));
    }
    let dir = real.parent().ok_or_else(forbidden)?;
    // Write next to it, then swap: a cut connection or a full disk never leaves half a file.
    let tmp = dir.join(temp_name("save"));
    let write = || -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        std::fs::set_permissions(&tmp, meta.permissions())?;
        std::fs::rename(&tmp, &real)
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_file(&tmp);
        return Err(err(ErrorCode::Internal, format!("Could not save: {e}")));
    }
    let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    entry_of(&real, name, home).ok_or_else(|| err(ErrorCode::Internal, "saved, but the file is gone"))
}

/// A file name from a phone: one level, no control characters.
pub fn clean_name(name: &str) -> Option<String> {
    // No control characters and no direction marks (a right-to-left override makes
    // "photo\u{202E}gpj.exe" look like "photoexe.jpg").
    let bidi = |c: char| matches!(c, '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}');
    let n: String = name.trim().chars().filter(|&c| !c.is_control() && !bidi(c)).collect();
    let n = n.rsplit(['/', '\\']).next().unwrap_or("").trim().to_string();
    (!n.is_empty() && n != "." && n != ".." && n.len() <= 255).then_some(n)
}

/// `name`, or "name 2.ext", "name 3.ext", … for the first that is free.
fn numbered(name: &str, i: u32) -> String {
    if i < 2 {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem} {i}.{ext}"),
        _ => format!("{name} {i}"),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn upload(
    home: &Path,
    roots: &[Root],
    dir: &str,
    name: &str,
    id: &str,
    offset: u64,
    data: &str,
    last: bool,
    size: Option<u64>,
) -> Result<FileUploadResult, ApiError> {
    let name = clean_name(name).ok_or_else(|| err(ErrorCode::BadRequest, "This file name cannot be used"))?;
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(err(ErrorCode::BadRequest, "bad upload id"));
    }
    if data.len() as u64 > (MAX_CHUNK as u64) * 4 / 3 + 16 {
        return Err(err(ErrorCode::BadRequest, "piece too big"));
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| err(ErrorCode::BadRequest, "piece is not base64"))?;
    let (dir, root) = resolve(home, roots, dir)?;
    if !root.writable {
        return Err(err(ErrorCode::Forbidden, "Files cannot be added here from this device"));
    }
    if !dir.is_dir() {
        return Err(err(ErrorCode::BadRequest, "This is not a folder"));
    }
    let part = dir.join(format!(".na-upload-{id}.part"));
    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if offset == 0 {
        prune_parts(&dir);
    } else if !part.exists() || have != offset {
        return Err(err(ErrorCode::Conflict, "The upload lost a piece; try again"));
    }
    if offset + bytes.len() as u64 > MAX_UPLOAD || size.is_some_and(|s| s > MAX_UPLOAD) {
        let _ = std::fs::remove_file(&part);
        return Err(err(ErrorCode::BadRequest, "This file is too big (1 GB at most)"));
    }
    // What is still to come must fit and leave room for the computer itself.
    let need = size.map_or(bytes.len() as u64, |s| s.saturating_sub(offset).max(bytes.len() as u64));
    if let Some(free) = free_space(&dir)
        && free < need + MIN_FREE
    {
        let _ = std::fs::remove_file(&part);
        return Err(err(ErrorCode::BadRequest, no_space(free, need)));
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(&part)
        .map_err(|e| err(ErrorCode::Forbidden, format!("Cannot write here: {e}")))?;
    f.write_all(&bytes).map_err(|e| err(ErrorCode::Internal, format!("Could not write: {e}")))?;
    let received = offset + bytes.len() as u64;
    if !last {
        return Ok(FileUploadResult { received, entry: None });
    }
    drop(f);
    // A hard link never replaces an existing file (a rename would): try names until one is free.
    for i in 1..1000 {
        let target = dir.join(numbered(&name, i));
        match std::fs::hard_link(&part, &target) {
            Ok(()) => {
                let _ = std::fs::remove_file(&part);
                let n = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                return Ok(FileUploadResult { received, entry: entry_of(&target, n, home) });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                // File systems without hard links: check, then rename.
                if target.exists() {
                    continue;
                }
                std::fs::rename(&part, &target).map_err(|e| err(ErrorCode::Internal, format!("Could not finish the upload: {e}")))?;
                let n = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                return Ok(FileUploadResult { received, entry: entry_of(&target, n, home) });
            }
        }
    }
    Err(err(ErrorCode::Conflict, "Too many files with this name"))
}

/// Pieces of uploads that never finished (older than a day).
/// Bytes free for this user on the disk that holds `dir` (None when unknown).
#[cfg(unix)]
pub fn free_space(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid C string and `st` a properly sized out value.
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    Some((st.f_bavail as u64).saturating_mul(st.f_frsize as u64))
}

#[cfg(not(unix))]
pub fn free_space(_: &Path) -> Option<u64> {
    None
}

fn gb(b: u64) -> String {
    format!("{:.1} GB", b as f64 / (1u64 << 30) as f64)
}

fn no_space(free: u64, need: u64) -> String {
    format!(
        "Not enough space on the computer: {} free, this file needs {} and 1 GB must stay free. Free up space on the computer, then try again.",
        gb(free),
        gb(need)
    )
}

fn prune_parts(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.filter_map(|e| e.ok()) {
        let n = e.file_name().to_string_lossy().into_owned();
        let old = e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t.elapsed().unwrap_or_default() > Duration::from_secs(86_400));
        if n.starts_with(".na-upload-") && n.ends_with(".part") && old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

pub fn search(home: &Path, roots: &[Root], path: &str, query: &str, hidden: bool) -> Result<Vec<FileEntry>, ApiError> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let (dir, root) = resolve(home, roots, path)?;
    let read_only = !root.writable;
    let home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    let mut found: Vec<(u8, usize, FileEntry)> = vec![];
    let mut queue = std::collections::VecDeque::from([(dir, 0usize)]);
    let mut visits = 0;
    'walk: while let Some((d, depth)) = queue.pop_front() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            visits += 1;
            if visits > MAX_VISITS {
                break 'walk;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if !hidden && name.starts_with('.') {
                continue;
            }
            // Never follow links while walking (loops, and places outside the root).
            let Ok(ft) = e.file_type() else { continue };
            let lower = name.to_lowercase();
            if let Some(at) = lower.find(&q)
                && let Some(x) = entry_of(&e.path(), name.clone(), &home)
            {
                found.push((u8::from(at != 0), depth, x));
            }
            let guarded =
                d == home && (PROTECTED.contains(&name.as_str()) || (read_only && guarded_names().any(|g| name.eq_ignore_ascii_case(g))));
            if ft.is_dir() && depth < 12 && !guarded && !SKIP_DIRS.contains(&name.as_str()) {
                queue.push_back((e.path(), depth + 1));
            }
        }
    }
    // Names that start with the query first, then the shallow ones.
    found.sort_by_key(|a| (a.0, a.1, a.2.name.len()));
    Ok(found.into_iter().take(MAX_RESULTS).map(|(_, _, e)| e).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use na_protocol::{Settings, Workspace};

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("na-files-{tag}-{}-{}", std::process::id(), rand::random::<u32>()));
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn ws(path: &Path, approved: bool) -> Workspace {
        serde_json::from_value(
            serde_json::json!({"id": "w", "name": "app", "path": path, "approved": approved, "pinned": false, "order": 0, "created_at": 0}),
        )
        .unwrap()
    }

    fn client(kind: ClientKind) -> ClientInfo {
        ClientInfo { kind, name: "t".into(), device_id: None }
    }

    fn state(ws_path: &Path, approved: bool, home_opt_in: bool) -> State {
        let mut s = State::default();
        s.workspaces.push(ws(ws_path, approved));
        s.settings = Settings { remote_files_home: Some(home_opt_in), ..Settings::default() };
        s
    }

    #[test]
    fn roots_follow_client_and_approval() {
        let home = tmp("roots");
        let w = home.join("code/app");
        std::fs::create_dir_all(&w).unwrap();
        let s = state(&w, false, false);
        let desk = roots(&s, &client(ClientKind::Desktop), &home, &Gate::open());
        assert_eq!(desk.len(), 2);
        assert_eq!(desk[0].name, "app", "the deepest root comes first");
        assert!(roots(&s, &client(ClientKind::Web), &home, &Gate::open()).is_empty(), "unapproved workspace, no home opt-in");
        assert!(roots(&s, &client(ClientKind::Orchestrator), &home, &Gate::open()).is_empty());
        let s = state(&w, true, true);
        let phone = roots(&s, &client(ClientKind::Android), &home, &Gate::open());
        assert_eq!(phone.len(), 2);
        assert!(phone[0].writable && !phone[1].writable, "home is read-only from a phone");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn a_workspace_saved_through_a_link_opens_by_both_names() {
        // Like `/tmp/x` on macOS, which is really `/private/tmp/x`.
        let home = tmp("alias");
        std::fs::create_dir_all(home.join("real/app")).unwrap();
        std::fs::write(home.join("real/app/a.txt"), "hi").unwrap();
        std::fs::write(home.join("real/secret.txt"), "no").unwrap();
        std::os::unix::fs::symlink(home.join("real"), home.join("link")).unwrap();
        let s = state(&home.join("link/app"), true, false);
        let r = roots(&s, &client(ClientKind::Android), &home, &Gate::open());
        assert_eq!(r.len(), 2, "the real folder and its spelling through the link");
        let (real, root) = resolve(&home, &r, &home.join("link/app/a.txt").to_string_lossy()).unwrap();
        assert_eq!(real, home.join("real/app/a.txt"));
        assert_eq!(root.path, home.join("real/app"), "results name the real root");
        let l = list(&home, &r, &home.join("link/app").to_string_lossy(), false).unwrap();
        assert_eq!(l.root, home.join("real/app").to_string_lossy());
        let out = home.join("link/app/../secret.txt");
        assert_eq!(resolve(&home, &r, &out.to_string_lossy()).unwrap_err().code, ErrorCode::Forbidden);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn paths_cannot_escape_the_roots() {
        let base = tmp("guard");
        let w = base.join("ws");
        std::fs::create_dir_all(w.join("src")).unwrap();
        std::fs::write(w.join("src/a.txt"), "hi").unwrap();
        std::fs::write(base.join("secret.txt"), "no").unwrap();
        let r = vec![Root { path: w.clone(), name: "ws".into(), writable: true, shut: false }];
        let home = base.join("home");
        assert!(resolve(&home, &r, &w.join("src/a.txt").to_string_lossy()).is_ok());
        let up = format!("{}/src/../../secret.txt", w.display());
        assert_eq!(resolve(&home, &r, &up).unwrap_err().code, ErrorCode::Forbidden);
        assert_eq!(resolve(&home, &r, "src/a.txt").unwrap_err().code, ErrorCode::BadRequest);
        assert_eq!(resolve(&home, &r, &base.join("secret.txt").to_string_lossy()).unwrap_err().code, ErrorCode::Forbidden);
        assert_eq!(resolve(&home, &r, "/etc/passwd").unwrap_err().code, ErrorCode::Forbidden);
        #[cfg(unix)]
        {
            // A link inside the workspace that points out of it is refused; one that stays in works.
            std::os::unix::fs::symlink(base.join("secret.txt"), w.join("out")).unwrap();
            std::os::unix::fs::symlink(w.join("src/a.txt"), w.join("in")).unwrap();
            assert_eq!(resolve(&home, &r, &w.join("out").to_string_lossy()).unwrap_err().code, ErrorCode::Forbidden);
            assert!(resolve(&home, &r, &w.join("in").to_string_lossy()).is_ok());
            let l = list(&home, &r, &w.to_string_lossy(), false).unwrap();
            assert!(l.entries.iter().any(|e| e.name == "out" && e.link), "links are listed");
            assert_eq!(read(&home, &r, &w.join("out").to_string_lossy(), 0, None).unwrap_err().code, ErrorCode::Forbidden);
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_read_only_home_keeps_keys_and_guarded_folders_out() {
        let home = tmp("guarded");
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::fs::write(home.join(".ssh/id_ed25519"), "key").unwrap();
        std::fs::create_dir_all(home.join("Documents")).unwrap();
        std::fs::write(home.join("Documents/tax.pdf"), "x").unwrap();
        std::fs::create_dir_all(home.join("notes")).unwrap();
        std::fs::write(home.join("notes/a.md"), "hi").unwrap();
        let ro = vec![Root { path: home.clone(), name: "Home".into(), writable: false, shut: false }];
        let rw = vec![Root { path: home.clone(), name: "Home".into(), writable: true, shut: false }];
        let h = |p: &str| home.join(p).to_string_lossy().into_owned();
        assert!(read(&home, &ro, &h("notes/a.md"), 0, None).is_ok());
        assert!(read(&home, &ro, "~/notes/a.md", 0, None).is_ok());
        for p in [".ssh/id_ed25519", ".ssh", "notes/../.ssh/id_ed25519"] {
            assert_eq!(resolve(&home, &ro, &h(p)).unwrap_err().code, ErrorCode::Forbidden, "{p}");
        }
        assert_eq!(resolve(&home, &ro, "~/.ssh/id_ed25519").unwrap_err().code, ErrorCode::Forbidden);
        assert!(resolve(&home, &rw, &h(".ssh/id_ed25519")).is_ok(), "the desktop's own home is not limited");
        #[cfg(unix)]
        {
            // A link to the keys elsewhere in home is caught by where it leads.
            std::os::unix::fs::symlink(home.join(".ssh"), home.join("notes/keys")).unwrap();
            assert_eq!(resolve(&home, &ro, &h("notes/keys/id_ed25519")).unwrap_err().code, ErrorCode::Forbidden);
        }
        let case_insensitive = home.join(".SSH").exists();
        if case_insensitive {
            assert_eq!(resolve(&home, &ro, &h(".SSH/id_ed25519")).unwrap_err().code, ErrorCode::Forbidden);
            // "ſ" (long s) folds to "s" on some disks: never the keys either.
            if let Ok((real, _)) = resolve(&home, &ro, &h(".\u{17F}sh/id_ed25519")) {
                panic!("{} opened through a case fold", real.display());
            }
        }
        if cfg!(target_os = "macos") {
            assert_eq!(resolve(&home, &ro, &h("Documents/tax.pdf")).unwrap_err().code, ErrorCode::Forbidden);
            if case_insensitive {
                assert_eq!(resolve(&home, &ro, &h("documents/tax.pdf")).unwrap_err().code, ErrorCode::Forbidden);
            }
            let l = list(&home, &ro, &home.to_string_lossy(), true).unwrap();
            assert!(l.entries.iter().any(|e| e.name == ".ssh" && e.protected));
            assert!(l.entries.iter().any(|e| e.name == "Documents" && e.protected));
            assert!(l.entries.iter().any(|e| e.name == "notes" && !e.protected));
        }
        let found = search(&home, &ro, &home.to_string_lossy(), "id_ed", true).unwrap();
        assert!(found.is_empty(), "search does not walk into key folders");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_workspace_macos_guards_stays_shut_without_full_disk_access() {
        let home = tmp("fda");
        let w = home.join("Documents/app");
        std::fs::create_dir_all(&w).unwrap();
        std::fs::write(w.join("a.txt"), "hi").unwrap();
        let home = home.canonicalize().unwrap();
        let w = home.join("Documents/app");
        let mut s = state(&w, true, true);
        s.workspaces[0].path = home.join("documents/app").to_string_lossy().into_owned();
        let gate = Gate::remote_without_fda(&home);
        let phone = roots(&s, &client(ClientKind::Android), &home, &gate);
        assert!(phone.iter().any(|r| r.shut && r.name == "app"));
        for p in [w.join("a.txt"), home.join("documents/app"), home.join("DOCUMENTS")] {
            let req = na_protocol::Request::FileList { path: p.to_string_lossy().into_owned(), hidden: false };
            assert_eq!(handle(&home, &phone, &gate, req).unwrap_err().message, crate::permissions::NEEDS_FDA, "{}", p.display());
        }
        let req = na_protocol::Request::FileRead { path: w.join("a.txt").to_string_lossy().into_owned(), offset: 0, len: None };
        assert_eq!(handle(&home, &phone, &gate, req).unwrap_err().message, crate::permissions::NEEDS_FDA);
        // The desktop opens it.
        let desk = roots(&s, &client(ClientKind::Desktop), &home, &Gate::open());
        assert!(list(&home, &desk, &w.to_string_lossy(), false).is_ok());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_huge_folder_is_cut_after_sorting() {
        let w = tmp("huge");
        for i in 0..(MAX_ENTRIES + 50) {
            std::fs::write(w.join(format!("f{i:05}.txt")), "").unwrap();
        }
        std::fs::create_dir_all(w.join("zz-last-folder")).unwrap();
        let r = vec![Root { path: w.clone(), name: "w".into(), writable: true, shut: false }];
        let l = list(&w, &r, &w.to_string_lossy(), false).unwrap();
        assert!(l.truncated && l.entries.len() == MAX_ENTRIES);
        assert_eq!(l.entries[0].name, "zz-last-folder", "folders survive the cut");
        assert_eq!(l.entries[1].name, "f00000.txt");
        let _ = std::fs::remove_dir_all(&w);
    }

    #[test]
    fn lists_sorts_and_hides_dotfiles() {
        let w = tmp("list");
        std::fs::create_dir_all(w.join("b-dir")).unwrap();
        std::fs::write(w.join("a.txt"), "x").unwrap();
        std::fs::write(w.join(".env"), "x").unwrap();
        let r = vec![Root { path: w.clone(), name: "w".into(), writable: true, shut: false }];
        let l = list(&w, &r, &w.to_string_lossy(), false).unwrap();
        let names: Vec<_> = l.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["b-dir", "a.txt"]);
        assert_eq!(list(&w, &r, &w.to_string_lossy(), true).unwrap().entries.len(), 3);
        assert_eq!(l.root_name, "w");
        let _ = std::fs::remove_dir_all(&w);
    }

    #[test]
    fn reads_in_pieces_and_spots_binaries() {
        let w = tmp("read");
        let big: Vec<u8> = (0..(DEFAULT_CHUNK as usize * 2 + 10)).map(|i| b'a' + (i % 26) as u8).collect();
        std::fs::write(w.join("big.txt"), &big).unwrap();
        std::fs::write(w.join("bin.dat"), [0u8, 1, 2, 3, 0, 255]).unwrap();
        std::fs::write(w.join("pic.png"), [0x89, b'P', b'N', b'G', 0, 0]).unwrap();
        let r = vec![Root { path: w.clone(), name: "w".into(), writable: true, shut: false }];
        let p = w.join("big.txt").to_string_lossy().into_owned();
        let b64 = base64::engine::general_purpose::STANDARD;
        let mut got = vec![];
        let mut off = 0;
        loop {
            let c = read(&w, &r, &p, off, None).unwrap();
            assert!(c.text && c.mime == "text/plain" && c.size == big.len() as u64);
            got.extend(b64.decode(&c.data).unwrap());
            off = c.offset + DEFAULT_CHUNK as u64;
            if c.eof {
                break;
            }
        }
        assert_eq!(got, big);
        // Pieces are capped.
        let c = read(&w, &r, &p, 0, Some(u32::MAX)).unwrap();
        assert_eq!(b64.decode(&c.data).unwrap().len(), MAX_CHUNK as usize);
        let bin = read(&w, &r, &w.join("bin.dat").to_string_lossy(), 0, None).unwrap();
        assert!(!bin.text && bin.mime == "application/octet-stream");
        let png = read(&w, &r, &w.join("pic.png").to_string_lossy(), 0, None).unwrap();
        assert!(!png.text && png.mime == "image/png");
        assert_eq!(read(&w, &r, &w.to_string_lossy(), 0, None).unwrap_err().code, ErrorCode::BadRequest);
        let _ = std::fs::remove_dir_all(&w);
    }

    #[test]
    fn saves_with_a_conflict_check_and_respects_read_only_roots() {
        let w = tmp("save");
        std::fs::write(w.join("a.md"), "old").unwrap();
        let p = w.join("a.md").to_string_lossy().into_owned();
        let r = vec![Root { path: w.clone(), name: "w".into(), writable: true, shut: false }];
        let m = read(&w, &r, &p, 0, None).unwrap().mtime;
        assert_eq!(save(&w, &r, &p, "new", Some(m + 1)).unwrap_err().code, ErrorCode::Conflict);
        save(&w, &r, &p, "new", Some(m)).unwrap();
        assert_eq!(std::fs::read_to_string(w.join("a.md")).unwrap(), "new");
        assert!(!std::fs::read_dir(&w).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".part")));
        let ro = vec![Root { path: w.clone(), name: "w".into(), writable: false, shut: false }];
        assert_eq!(save(&w, &ro, &p, "x", None).unwrap_err().code, ErrorCode::Forbidden);
        let _ = std::fs::remove_dir_all(&w);
    }

    #[test]
    fn uploads_in_pieces_without_replacing_files() {
        let w = tmp("up");
        std::fs::write(w.join("photo.jpg"), "existing").unwrap();
        let r = vec![Root { path: w.clone(), name: "w".into(), writable: true, shut: false }];
        let d = w.to_string_lossy().into_owned();
        let b64 = base64::engine::general_purpose::STANDARD;
        let a = upload(&w, &r, &d, "../photo.jpg", "u1", 0, &b64.encode(b"hello "), false, None).unwrap();
        assert_eq!((a.received, a.entry.is_none()), (6, true));
        assert_eq!(upload(&w, &r, &d, "photo.jpg", "u1", 3, &b64.encode(b"x"), false, None).unwrap_err().code, ErrorCode::Conflict);
        let done = upload(&w, &r, &d, "photo.jpg", "u1", 6, &b64.encode(b"world"), true, None).unwrap();
        let e = done.entry.unwrap();
        assert_eq!(e.name, "photo 2.jpg");
        assert_eq!(std::fs::read_to_string(w.join("photo 2.jpg")).unwrap(), "hello world");
        assert_eq!(std::fs::read_to_string(w.join("photo.jpg")).unwrap(), "existing");
        assert!(!w.join(".na-upload-u1.part").exists());
        assert_eq!(upload(&w, &r, &d, "x", "../../evil", 0, "", true, None).unwrap_err().code, ErrorCode::BadRequest);
        assert_eq!(upload(&w, &r, &d, "..", "u2", 0, "", true, None).unwrap_err().code, ErrorCode::BadRequest);
        assert_eq!(upload(&w, &r, "/tmp", "x", "u3", 0, "", true, None).unwrap_err().code, ErrorCode::Forbidden);
        // A file that would fill the disk is refused before anything is written.
        let free = free_space(&w).expect("statvfs works here");
        let big = upload(&w, &r, &d, "big.bin", "u4", 0, &b64.encode(b"x"), false, Some(free.min(MAX_UPLOAD)));
        if free < MAX_UPLOAD + MIN_FREE {
            assert!(big.unwrap_err().message.starts_with("Not enough space on the computer"));
        }
        assert!(!w.join(".na-upload-u4.part").exists() || free >= MAX_UPLOAD + MIN_FREE);
        assert!(no_space(3 << 29, 1 << 30).contains("1.5 GB free, this file needs 1.0 GB"));
        let _ = std::fs::remove_dir_all(&w);
    }

    #[test]
    fn searches_by_name_and_skips_heavy_folders() {
        let w = tmp("search");
        std::fs::create_dir_all(w.join("src/deep")).unwrap();
        std::fs::create_dir_all(w.join("node_modules/pkg")).unwrap();
        std::fs::write(w.join("src/deep/Button.tsx"), "").unwrap();
        std::fs::write(w.join("src/my-button.css"), "").unwrap();
        std::fs::write(w.join("node_modules/pkg/button.js"), "").unwrap();
        let r = vec![Root { path: w.clone(), name: "w".into(), writable: true, shut: false }];
        let found = search(&w, &r, &w.to_string_lossy(), "button", false).unwrap();
        let names: Vec<_> = found.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Button.tsx", "my-button.css"]);
        let _ = std::fs::remove_dir_all(&w);
    }

    #[test]
    fn git_status_lines_mark_children() {
        let mut out = HashMap::new();
        let st = " M src/a.ts\0?? new.txt\0A  src/b.ts\0R  c.ts\0old.ts\0UU d.ts\0?? tmp/\0";
        parse_status(st, Path::new(""), &mut out);
        assert_eq!(out["src"], GitFileStatus::Modified);
        assert_eq!(out["new.txt"], GitFileStatus::Untracked);
        assert_eq!(out["c.ts"], GitFileStatus::Renamed);
        assert!(!out.contains_key("old.ts"));
        assert_eq!(out["d.ts"], GitFileStatus::Conflicted);
        assert_eq!(out["tmp"], GitFileStatus::Untracked);
        let mut sub = HashMap::new();
        parse_status(st, Path::new("src"), &mut sub);
        assert_eq!((sub["a.ts"], sub["b.ts"]), (GitFileStatus::Modified, GitFileStatus::Added));
    }

    #[test]
    fn names_and_types() {
        assert_eq!(clean_name("  a/b/../c.txt "), Some("c.txt".into()));
        assert_eq!(clean_name("..").as_deref(), None);
        assert_eq!(clean_name("photo\u{202E}gpj.exe\n").as_deref(), Some("photogpj.exe"));
        assert_eq!(numbered("a.tar.gz", 2), "a.tar 2.gz");
        assert_eq!(numbered(".env", 3), ".env 3");
        assert_eq!(mime_of("x.PDF", b""), "application/pdf");
        assert_eq!(mime_of("Makefile", b"all:\n"), "text/plain");
        assert!(looks_text("héllo".as_bytes()) && looks_text(&"é".as_bytes()[..1]) && !looks_text(b"a\0b"));
        // UTF-16 with and without a mark, Latin-1; random bytes with a NUL stay binary.
        let le: Vec<u8> = "héllo wörld".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let be: Vec<u8> = "hello world".encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
        assert!(looks_text(&[&[0xff, 0xfe][..], &le].concat()) && looks_text(&le) && looks_text(&be));
        assert!(looks_text(b"caf\xe9 cr\xe8me br\xfbl\xe9e\r\n"));
        assert!(!looks_text(b"\x01\x02\x03\x04\xff\x05\x06x") && !looks_text(b"PK\x03\x04\x00\x14\x00\x00"));
    }
}
