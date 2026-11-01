// The simulated computer's disk: a flat map of absolute paths to text files (and a few binary ones),
// plus a tiny git on top (HEAD snapshot per repository, working tree = the map). Everything the
// file browser, the changes sheet, the folder picker and the shell show comes from here.

export interface VFile {
  /** Text content; empty for binary files. */
  text: string;
  /** Base64 of the bytes for binary files (images). */
  b64?: string;
  mime?: string;
  mtime: number;
  size: number;
}

export type GitStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface Repo {
  root: string;
  branch: string;
  ahead: number;
  behind: number;
  /** Files at HEAD: path → text. */
  head: Map<string, string>;
  /** Commit log, newest first. */
  log: { hash: string; subject: string; author: string; at: number }[];
  /** Paths staged with `git add`. */
  staged: Set<string>;
}

const enc = new TextEncoder();

export const dirname = (p: string) => (p.lastIndexOf("/") <= 0 ? "/" : p.slice(0, p.lastIndexOf("/")));
export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const join = (a: string, b: string) => (b.startsWith("/") ? b : (a === "/" ? "" : a.replace(/\/$/, "")) + "/" + b);

/** Resolve `.` and `..` and double slashes. */
export function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

export class Vfs {
  files = new Map<string, VFile>();
  /** Directories that exist without files in them (and the ones created with mkdir). */
  dirs = new Set<string>(["/"]);
  repos = new Map<string, Repo>();
  private clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  // ── writing ──
  private ensureDirs(path: string) {
    for (let d = dirname(path); d !== "/" && !this.dirs.has(d); d = dirname(d)) this.dirs.add(d);
  }

  write(path: string, text: string, mtime = this.clock()) {
    path = normalize(path);
    this.ensureDirs(path);
    this.files.set(path, { text, mtime, size: enc.encode(text).length });
  }

  writeBinary(path: string, b64: string, mime: string, size: number, mtime = this.clock()) {
    path = normalize(path);
    this.ensureDirs(path);
    this.files.set(path, { text: "", b64, mime, mtime, size });
  }

  mkdir(path: string) {
    path = normalize(path);
    this.ensureDirs(path + "/x");
    this.dirs.add(path);
  }

  remove(path: string) {
    path = normalize(path);
    this.files.delete(path);
    for (const k of [...this.files.keys()]) if (k.startsWith(path + "/")) this.files.delete(k);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(path + "/")) this.dirs.delete(d);
  }

  /** Replace `oldText` by `newText` once; false when `oldText` is not in the file. */
  edit(path: string, oldText: string, newText: string): boolean {
    const f = this.files.get(normalize(path));
    if (!f || !f.text.includes(oldText)) return false;
    this.write(path, f.text.replace(oldText, () => newText));
    return true;
  }

  // ── reading ──
  isDir(path: string) {
    path = normalize(path);
    return this.dirs.has(path) || [...this.files.keys()].some((k) => k.startsWith(path === "/" ? "/" : path + "/"));
  }
  isFile(path: string) {
    return this.files.has(normalize(path));
  }
  exists(path: string) {
    return this.isFile(path) || this.isDir(path);
  }
  read(path: string): string | null {
    return this.files.get(normalize(path))?.text ?? null;
  }
  stat(path: string): VFile | undefined {
    return this.files.get(normalize(path));
  }

  /** Direct children: directories (name only) and files. */
  list(path: string): { name: string; path: string; dir: boolean; file?: VFile }[] {
    path = normalize(path);
    const prefix = path === "/" ? "/" : path + "/";
    const out = new Map<string, { name: string; path: string; dir: boolean; file?: VFile }>();
    for (const [p, f] of this.files) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const i = rest.indexOf("/");
      if (i < 0) out.set(rest, { name: rest, path: p, dir: false, file: f });
      else out.set(rest.slice(0, i), { name: rest.slice(0, i), path: prefix + rest.slice(0, i), dir: true });
    }
    for (const d of this.dirs) {
      if (!d.startsWith(prefix) || d === path) continue;
      const rest = d.slice(prefix.length);
      const name = rest.split("/")[0]!;
      if (name && !out.has(name)) out.set(name, { name, path: prefix + name, dir: true });
    }
    return [...out.values()];
  }

  /** Every file under a folder, relative paths, sorted. */
  walk(path: string): string[] {
    path = normalize(path);
    const prefix = path === "/" ? "/" : path + "/";
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)).sort();
  }

  // ── git ──
  /** The repo that contains `path`, if any. */
  repoOf(path: string): Repo | undefined {
    path = normalize(path);
    let best: Repo | undefined;
    for (const r of this.repos.values()) if ((path === r.root || path.startsWith(r.root + "/")) && (!best || r.root.length > best.root.length)) best = r;
    return best;
  }

  /** Mark the current working tree of a repo as HEAD (used when seeding). */
  commitAll(repo: Repo) {
    repo.head = new Map();
    for (const rel of this.walk(repo.root)) repo.head.set(rel, this.read(join(repo.root, rel)) ?? "");
    repo.staged.clear();
  }

  /** `git status` entries: relative path and status, sorted by path. */
  status(repo: Repo): { path: string; status: GitStatus; staged: boolean }[] {
    const now = new Map(this.walk(repo.root).map((rel) => [rel, this.read(join(repo.root, rel)) ?? ""]));
    const out: { path: string; status: GitStatus; staged: boolean }[] = [];
    for (const [rel, text] of now) {
      const old = repo.head.get(rel);
      if (old === undefined) out.push({ path: rel, status: repo.staged.has(rel) ? "added" : "untracked", staged: repo.staged.has(rel) });
      else if (old !== text) out.push({ path: rel, status: "modified", staged: repo.staged.has(rel) });
    }
    for (const rel of repo.head.keys()) if (!now.has(rel)) out.push({ path: rel, status: "deleted", staged: repo.staged.has(rel) });
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  /** Git status of one absolute path (or, for a folder, the most important one inside). */
  statusOf(path: string): GitStatus | undefined {
    const repo = this.repoOf(path);
    if (!repo) return undefined;
    const rel = normalize(path).slice(repo.root.length + 1);
    const all = this.status(repo);
    const hit = all.find((e) => e.path === rel);
    if (hit) return hit.status;
    const inside = all.filter((e) => e.path.startsWith(rel + "/"));
    return inside.length ? inside[0]!.status : undefined;
  }

  /** Mutable git operations used by the shell. */
  add(repo: Repo, rel: string | null) {
    for (const e of this.status(repo)) if (rel === null || e.path === rel || e.path.startsWith(rel.replace(/\/$/, "") + "/")) repo.staged.add(e.path);
  }

  commit(repo: Repo, subject: string, author: string, at: number) {
    const staged = this.status(repo).filter((e) => repo.staged.has(e.path));
    if (!staged.length) return null;
    for (const e of staged) {
      if (e.status === "deleted") repo.head.delete(e.path);
      else repo.head.set(e.path, this.read(join(repo.root, e.path)) ?? "");
    }
    repo.staged.clear();
    const hash = Math.abs(hashStr(subject + at)).toString(16).padStart(7, "0").slice(0, 7);
    repo.log.unshift({ hash, subject, author, at });
    return { hash, files: staged.length };
  }
}

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

/** A guess of the mime type from the file name. */
export function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    svg: "image/svg+xml",
    json: "application/json",
    md: "text/markdown",
    html: "text/html",
    css: "text/css",
    ts: "text/plain",
    tsx: "text/plain",
    js: "text/plain",
    mjs: "text/plain",
    sql: "text/plain",
    yml: "text/plain",
    yaml: "text/plain",
    toml: "text/plain",
    sh: "text/plain",
  };
  return map[ext] ?? "text/plain";
}
