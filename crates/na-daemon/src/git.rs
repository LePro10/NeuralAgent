//! Git through the `git` CLI: a summary per workspace, the changed files and their diff, and one
//! worktree per agent (`<repo>/.neuralagent/worktrees/<name>`, hidden via `.git/info/exclude`)
//! that can be merged back or thrown away.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};
use na_protocol::{GitChanges, GitDiff, GitFile, GitFileStatus, GitSummary, WorktreeInfo};

/// Diffs bigger than this are cut (the UI says so).
const MAX_DIFF: usize = 512 * 1024;
/// `git hash-object -t tree /dev/null`: what to diff against before the first commit.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
pub const WORKTREE_DIR: &str = ".neuralagent/worktrees";

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "core.quotepath=off"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .context("running git (is it installed?)")?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        bail!("{}", msg.trim().lines().last().unwrap_or("git failed").trim_start_matches("fatal: "));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn is_repo(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--is-inside-work-tree"]).is_ok_and(|s| s.trim() == "true")
}

/// Branch, number of changed files, ahead/behind upstream. `None` if not a repository.
pub fn summary(dir: &Path) -> Option<GitSummary> {
    let out = git(dir, &["status", "--porcelain=v2", "--branch", "-z"]).ok()?;
    let mut s = GitSummary { branch: String::new(), changed: 0, ahead: 0, behind: 0 };
    let mut fields = out.split('\0');
    while let Some(f) = fields.next() {
        if let Some(b) = f.strip_prefix("# branch.head ") {
            s.branch = b.to_string();
        } else if let Some(ab) = f.strip_prefix("# branch.ab ") {
            let mut it = ab.split(' ');
            s.ahead = it.next().and_then(|a| a.trim_start_matches('+').parse().ok()).unwrap_or(0);
            s.behind = it.next().and_then(|b| b.trim_start_matches('-').parse().ok()).unwrap_or(0);
        } else if f.starts_with("2 ") {
            // A rename is followed by its original path.
            fields.next();
            s.changed += 1;
        } else if f.starts_with(['1', 'u', '?']) {
            s.changed += 1;
        }
    }
    if s.branch == "(detached)" {
        s.branch = git(dir, &["rev-parse", "--short", "HEAD"]).map(|h| h.trim().to_string()).unwrap_or(s.branch);
    }
    Some(s)
}

fn head_or_empty(dir: &Path) -> String {
    git(dir, &["rev-parse", "--verify", "-q", "HEAD"]).map(|h| h.trim().to_string()).unwrap_or_else(|_| EMPTY_TREE.into())
}

/// Files changed in `dir` compared to `base` (default: HEAD), including untracked ones.
pub fn changes(dir: &Path, base: Option<&str>) -> Result<GitChanges> {
    if !is_repo(dir) {
        bail!("this folder is not a git repository");
    }
    let base = base.map(str::to_string).unwrap_or_else(|| head_or_empty(dir));
    let mut files: Vec<GitFile> = Vec::new();
    // `--name-status -z`: status NUL path [NUL new-path for renames/copies]
    let names = git(dir, &["diff", "--name-status", "-z", "-M", &base, "--"])?;
    let mut it = names.split('\0').filter(|f| !f.is_empty());
    while let Some(st) = it.next() {
        let Some(path) = it.next() else { break };
        let (status, path, from) = match st.chars().next() {
            Some('A') => (GitFileStatus::Added, path.to_string(), None),
            Some('D') => (GitFileStatus::Deleted, path.to_string(), None),
            Some('R' | 'C') => (GitFileStatus::Renamed, it.next().unwrap_or(path).to_string(), Some(path.to_string())),
            Some('U') => (GitFileStatus::Conflicted, path.to_string(), None),
            _ => (GitFileStatus::Modified, path.to_string(), None),
        };
        files.push(GitFile { path, from, status, additions: 0, deletions: 0 });
    }
    // `--numstat -z`: "add\tdel\tpath" NUL, or for renames "add\tdel\t" NUL from NUL to
    let nums = git(dir, &["diff", "--numstat", "-z", "-M", &base, "--"])?;
    let mut it = nums.split('\0').filter(|f| !f.is_empty());
    while let Some(rec) = it.next() {
        let mut p = rec.splitn(3, '\t');
        let (a, d, path) = (p.next().unwrap_or("-"), p.next().unwrap_or("-"), p.next().unwrap_or(""));
        let path = if path.is_empty() {
            it.next();
            it.next().unwrap_or("").to_string()
        } else {
            path.to_string()
        };
        if let Some(f) = files.iter_mut().find(|f| f.path == path) {
            f.additions = a.parse().unwrap_or(0);
            f.deletions = d.parse().unwrap_or(0);
        }
    }
    for path in git(dir, &["ls-files", "--others", "--exclude-standard", "-z"])?.split('\0').filter(|f| !f.is_empty()) {
        let lines = std::fs::read(dir.join(path)).map(|b| if b.contains(&0) { 0 } else { bytecount_lines(&b) }).unwrap_or(0);
        files.push(GitFile { path: path.to_string(), from: None, status: GitFileStatus::Untracked, additions: lines, deletions: 0 });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let s = summary(dir);
    Ok(GitChanges {
        branch: s.as_ref().map(|s| s.branch.clone()).unwrap_or_default(),
        ahead: s.as_ref().map_or(0, |s| s.ahead),
        behind: s.as_ref().map_or(0, |s| s.behind),
        files,
    })
}

fn bytecount_lines(b: &[u8]) -> u32 {
    let n = b.iter().filter(|&&c| c == b'\n').count();
    (n + usize::from(!b.is_empty() && !b.ends_with(b"\n"))) as u32
}

/// Unified diff of everything (or one file) in `dir` compared to `base`; untracked files show
/// as added.
pub fn diff(dir: &Path, base: Option<&str>, file: Option<&str>) -> Result<GitDiff> {
    let base = base.map(str::to_string).unwrap_or_else(|| head_or_empty(dir));
    let mut args = vec!["diff", "-M", "--no-color", "--no-ext-diff", &base, "--"];
    if let Some(f) = file {
        args.push(f);
    }
    let mut text = git(dir, &args)?;
    let untracked = git(dir, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    for path in untracked.split('\0').filter(|p| !p.is_empty() && file.is_none_or(|f| f == *p)) {
        if text.len() > MAX_DIFF {
            break;
        }
        // Exit code 1 means "there are differences", which is the point here.
        if let Ok(out) =
            Command::new("git").arg("-C").arg(dir).args(["diff", "--no-color", "--no-index", "--", null_device(), path]).output()
        {
            text.push_str(&String::from_utf8_lossy(&out.stdout));
        }
    }
    let truncated = text.len() > MAX_DIFF;
    if truncated {
        let mut cut = MAX_DIFF;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
    }
    Ok(GitDiff { text, truncated })
}

fn null_device() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

/// A new branch `neuralagent/<name>` checked out in `<repo>/.neuralagent/worktrees/<name>`.
pub fn worktree_create(repo: &Path, name: &str) -> Result<WorktreeInfo> {
    if !is_repo(repo) {
        bail!("this workspace is not a git repository");
    }
    let base = git(repo, &["rev-parse", "--verify", "-q", "HEAD"]).map_err(|_| anyhow::anyhow!("the repository has no commits yet"))?;
    let base = base.trim().to_string();
    let top = PathBuf::from(git(repo, &["rev-parse", "--show-toplevel"])?.trim());
    hide_worktrees(&top)?;
    let path = top.join(WORKTREE_DIR).join(name);
    let branch = format!("neuralagent/{name}");
    std::fs::create_dir_all(path.parent().unwrap_or(&top))?;
    git(&top, &["worktree", "add", "-q", "-b", &branch, &path.to_string_lossy(), &base])?;
    Ok(WorktreeInfo { path: path.to_string_lossy().into_owned(), branch, base })
}

/// Keeps `.neuralagent/` out of `git status` without touching the user's `.gitignore`.
fn hide_worktrees(top: &Path) -> Result<()> {
    let common = PathBuf::from(git(top, &["rev-parse", "--git-common-dir"])?.trim());
    let common = if common.is_absolute() { common } else { top.join(common) };
    let exclude = common.join("info").join("exclude");
    let current = std::fs::read_to_string(&exclude).unwrap_or_default();
    if !current.lines().any(|l| l.trim() == "/.neuralagent/") {
        std::fs::create_dir_all(exclude.parent().unwrap_or(&common))?;
        let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
        std::fs::write(&exclude, format!("{current}{sep}# NeuralAgent agent worktrees\n/.neuralagent/\n"))?;
    }
    Ok(())
}

/// Whether the agent changed anything in its worktree (committed or not).
pub fn worktree_dirty(wt: &WorktreeInfo) -> bool {
    let dir = Path::new(&wt.path);
    let committed = git(dir, &["rev-list", "--count", &format!("{}..HEAD", wt.base)]).is_ok_and(|n| n.trim() != "0");
    committed || git(dir, &["status", "--porcelain"]).is_ok_and(|s| !s.trim().is_empty())
}

/// Commits what the agent left uncommitted, merges its branch into the branch checked out in
/// `repo`, then removes the worktree. On a conflict nothing is changed.
pub fn worktree_merge(repo: &Path, wt: &WorktreeInfo, message: &str) -> Result<String> {
    let dir = Path::new(&wt.path);
    if git(dir, &["status", "--porcelain"])?.trim().is_empty() {
        // nothing uncommitted
    } else {
        git(dir, &["add", "-A"])?;
        let mut args = identity(dir);
        args.extend(["commit", "-q", "-m", message].map(String::from));
        git(dir, &args.iter().map(String::as_str).collect::<Vec<_>>())?;
    }
    let commits: u32 = git(dir, &["rev-list", "--count", &format!("{}..HEAD", wt.base)])?.trim().parse().unwrap_or(0);
    let target = summary(repo).map(|s| s.branch).unwrap_or_else(|| "the current branch".into());
    if commits > 0 {
        let mut args = identity(repo);
        args.extend(["merge", "--no-edit", "-m", message, &wt.branch].map(String::from));
        if let Err(e) = git(repo, &args.iter().map(String::as_str).collect::<Vec<_>>()) {
            let conflicts = git(repo, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();
            if !conflicts.trim().is_empty() {
                let _ = git(repo, &["merge", "--abort"]);
                let files: Vec<&str> = conflicts.lines().take(5).collect();
                bail!(
                    "merging into {target} would conflict in {}. Nothing was changed; ask the agent to merge {target} into its branch first",
                    files.join(", ")
                );
            }
            bail!("could not merge into {target}: {e}");
        }
    }
    worktree_remove(repo, wt)?;
    Ok(match commits {
        0 => "No changes to merge; the worktree was removed".into(),
        1 => format!("Merged 1 commit into {target}"),
        n => format!("Merged {n} commits into {target}"),
    })
}

/// Removes the worktree folder and its branch.
pub fn worktree_remove(repo: &Path, wt: &WorktreeInfo) -> Result<()> {
    if Path::new(&wt.path).exists() {
        git(repo, &["worktree", "remove", "--force", &wt.path])?;
    } else {
        let _ = git(repo, &["worktree", "prune"]);
    }
    let _ = git(repo, &["branch", "-D", &wt.branch]);
    Ok(())
}

/// `-c user.name=… -c user.email=…` when the user has not set an identity, so commits work.
fn identity(dir: &Path) -> Vec<String> {
    let set = |k: &str| git(dir, &["config", k]).is_ok_and(|v| !v.trim().is_empty());
    let mut a = Vec::new();
    if !set("user.name") {
        a.extend(["-c".into(), "user.name=NeuralAgent".into()]);
    }
    if !set("user.email") {
        a.extend(["-c".into(), "user.email=agent@neuralagent.invalid".into()]);
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> PathBuf {
        let d = std::env::temp_dir().join(format!("na-git-{}", rand::random::<u32>()));
        std::fs::create_dir_all(&d).unwrap();
        git(&d, &["init", "-q", "-b", "main"]).unwrap();
        std::fs::write(d.join("a.txt"), "one\ntwo\n").unwrap();
        git(&d, &["add", "."]).unwrap();
        let mut c = identity(&d);
        c.extend(["commit", "-q", "-m", "init"].map(String::from));
        git(&d, &c.iter().map(String::as_str).collect::<Vec<_>>()).unwrap();
        d
    }

    #[test]
    fn changes_and_diff() {
        let d = repo();
        std::fs::write(d.join("a.txt"), "one\nTWO\nthree\n").unwrap();
        std::fs::write(d.join("new file.txt"), "hi\n").unwrap();
        let c = changes(&d, None).unwrap();
        assert_eq!(c.branch, "main");
        let a = c.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!((a.status, a.additions, a.deletions), (GitFileStatus::Modified, 2, 1));
        let n = c.files.iter().find(|f| f.path == "new file.txt").unwrap();
        assert_eq!((n.status, n.additions), (GitFileStatus::Untracked, 1));
        assert_eq!(summary(&d).unwrap().changed, 2);
        let t = diff(&d, None, None).unwrap().text;
        assert!(t.contains("+TWO") && t.contains("-two") && t.contains("+hi"), "{t}");
        let one = diff(&d, None, Some("new file.txt")).unwrap().text;
        assert!(one.contains("+hi") && !one.contains("TWO"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn worktree_merge_and_discard() {
        let d = repo();
        let wt = worktree_create(&d, "claude-1").unwrap();
        assert!(Path::new(&wt.path).join("a.txt").exists());
        // the worktree folder does not show up as a change in the main checkout
        assert_eq!(summary(&d).unwrap().changed, 0);
        assert!(!worktree_dirty(&wt));
        std::fs::write(Path::new(&wt.path).join("b.txt"), "agent\n").unwrap();
        assert!(worktree_dirty(&wt));
        let c = changes(Path::new(&wt.path), Some(&wt.base)).unwrap();
        assert_eq!(c.files.len(), 1);
        let msg = worktree_merge(&d, &wt, "Claude: add b").unwrap();
        assert_eq!(msg, "Merged 1 commit into main");
        assert_eq!(std::fs::read_to_string(d.join("b.txt")).unwrap(), "agent\n");
        assert!(!Path::new(&wt.path).exists());
        assert!(git(&d, &["branch", "--list", &wt.branch]).unwrap().trim().is_empty());

        // a conflicting merge changes nothing
        let wt = worktree_create(&d, "codex-2").unwrap();
        std::fs::write(Path::new(&wt.path).join("a.txt"), "agent version\n").unwrap();
        std::fs::write(d.join("a.txt"), "my version\n").unwrap();
        let mut c = identity(&d);
        c.extend(["commit", "-qam", "mine"].map(String::from));
        git(&d, &c.iter().map(String::as_str).collect::<Vec<_>>()).unwrap();
        let e = worktree_merge(&d, &wt, "Codex").unwrap_err().to_string();
        assert!(e.contains("conflict in a.txt"), "{e}");
        assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "my version\n");
        assert_eq!(summary(&d).unwrap().changed, 0);
        worktree_remove(&d, &wt).unwrap();
        assert!(!Path::new(&wt.path).exists());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
