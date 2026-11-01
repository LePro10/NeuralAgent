// Folders, files and git as the app asks for them: the folder picker, the file browser, the changes
// sheet and diffs. All of it reads the fake disk.

import type { FileChunk, FileEntry, FileListing, FsEntry, FsRoots, GitChanges, GitDiff, GitFile, Request } from "@neuralagent/protocol";
import { counts, unified } from "../diff.ts";
import { ApiErr, type Conn } from "../server.ts";
import { HOST, type Sim } from "../sim.ts";
import { basename, dirname, join, mimeOf, normalize } from "../vfs.ts";

type P<M extends Request["m"]> = Extract<Request, { m: M }> extends { p: infer X } ? X : never;

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const insideHome = (p: string) => p === HOST.home || p.startsWith(HOST.home + "/");

function guard(sim: Sim, path: string): string {
  const p = normalize(path);
  if (!insideHome(p) && !sim.state.workspaces.some((w) => p === w.path || p.startsWith(w.path + "/"))) throw new ApiErr("forbidden", "This file is outside the folders you can open here");
  return p;
}

const hiddenName = (n: string) => n.startsWith(".");

// ── folder picker ──

export function fsRoots(sim: Sim): FsRoots {
  const code = join(HOST.home, "code");
  const projects: FsEntry[] = sim.vfs
    .list(code)
    .filter((e) => e.dir && !hiddenName(e.name))
    .map((e) => ({ name: e.name, path: e.path, dir: true, git: !!sim.vfs.repos.get(e.path) }));
  return { home: HOST.home, projects };
}

export function fsList(sim: Sim, p: P<"fs_list">) {
  const path = normalize(p.path || HOST.home);
  if (!sim.vfs.isDir(path)) throw new ApiErr("not_found", "That folder does not exist");
  const entries: FsEntry[] = sim.vfs
    .list(path)
    .filter((e) => e.dir && !hiddenName(e.name) && e.name !== "node_modules")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, path: e.path, dir: true, git: !!sim.vfs.repos.get(e.path) }));
  return { path, parent: path === "/" ? null : dirname(path), git: !!sim.vfs.repoOf(path), entries };
}

export function fsMkdir(sim: Sim, p: P<"fs_mkdir">) {
  const name = p.name.trim();
  if (!name || /[/\\]/.test(name)) throw new ApiErr("bad_request", "That is not a folder name");
  const path = join(guard(sim, p.path), name);
  if (sim.vfs.exists(path)) throw new ApiErr("conflict", "A file or folder with that name exists");
  sim.vfs.mkdir(path);
  return { name, path, dir: true, git: false } satisfies FsEntry;
}

// ── file browser ──

export function fileList(sim: Sim, p: P<"file_list">): FileListing {
  const path = guard(sim, p.path || HOST.home);
  if (!sim.vfs.isDir(path)) throw new ApiErr("not_found", "That folder does not exist");
  const ws = sim.state.workspaces.find((w) => path === w.path || path.startsWith(w.path + "/"));
  const root = ws ? ws.path : HOST.home;
  const entries: FileEntry[] = sim.vfs
    .list(path)
    .filter((e) => p.hidden || !hiddenName(e.name))
    .map((e) => {
      const git = sim.vfs.statusOf(e.path);
      return {
        name: e.name,
        path: e.path,
        dir: e.dir,
        size: e.file?.size ?? 0,
        mtime: e.file?.mtime ?? sim.now() - 86_400_000,
        link: false,
        protected: false,
        ...(git ? { git } : {}),
      } satisfies FileEntry;
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { path, root, root_name: ws ? ws.name : "Home", entries, writable: true, truncated: false };
}

export function fileRead(sim: Sim, p: P<"file_read">): FileChunk {
  const path = guard(sim, p.path);
  const f = sim.vfs.stat(path);
  if (!f) throw new ApiErr("not_found", "That file does not exist");
  const mime = f.mime ?? mimeOf(basename(path));
  const all = f.b64 ? unb64(f.b64) : enc.encode(f.text);
  const len = Math.min(p.len ?? 262_144, 1_048_576);
  const chunk = all.subarray(p.offset, p.offset + len);
  return {
    path,
    name: basename(path),
    size: all.length,
    mtime: f.mtime,
    offset: p.offset,
    data: b64(chunk),
    eof: p.offset + chunk.length >= all.length,
    mime,
    text: !mime.startsWith("image/"),
    writable: true,
  };
}

export function fileSave(sim: Sim, p: P<"file_save">) {
  const path = guard(sim, p.path);
  const f = sim.vfs.stat(path);
  if (f && p.mtime !== undefined && p.mtime !== f.mtime) throw new ApiErr("conflict", "The file changed on disk; reload it first");
  sim.vfs.write(path, p.text);
  sim.refreshAllGit();
  return { mtime: sim.vfs.stat(path)!.mtime };
}

const uploads = new Map<string, string[]>();

export function fileUpload(sim: Sim, p: P<"file_upload">) {
  const dir = guard(sim, p.dir);
  const parts = uploads.get(p.id) ?? [];
  parts[p.offset > 0 ? 1 : 0] = p.data;
  uploads.set(p.id, parts);
  const received = parts.reduce((n, s) => n + (s ? unb64(s).length : 0), 0);
  if (!p.last) return { received };
  uploads.delete(p.id);
  const path = join(dir, p.name);
  const bytes = parts.filter(Boolean).flatMap((s) => [...unb64(s)]);
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  sim.vfs.write(path, text);
  const f = sim.vfs.stat(path)!;
  return { received: bytes.length, entry: { name: p.name, path, dir: false, size: f.size, mtime: f.mtime, link: false, protected: false } satisfies FileEntry };
}

export function fileSearch(sim: Sim, p: P<"file_search">): FileEntry[] {
  const root = guard(sim, p.path);
  const q = p.query.trim().toLowerCase();
  if (!q) return [];
  const out: FileEntry[] = [];
  for (const rel of sim.vfs.walk(root)) {
    if (rel.includes("node_modules/")) continue;
    if (!p.hidden && rel.split("/").some(hiddenName)) continue;
    if (!rel.toLowerCase().includes(q)) continue;
    const path = join(root, rel);
    const f = sim.vfs.stat(path)!;
    out.push({ name: basename(rel), path, dir: false, size: f.size, mtime: f.mtime, link: false, protected: false });
    if (out.length >= 60) break;
  }
  return out;
}

// ── git ──

const rootOf = (sim: Sim, workspaceId: string, sessionId?: string) => {
  const s = sessionId ? sim.session(sessionId) : undefined;
  const w = sim.state.workspaces.find((x) => x.id === (s?.workspace_id ?? workspaceId));
  if (!w) throw new ApiErr("not_found", "Unknown project");
  const cwd = s?.worktree?.path ?? s?.cwd ?? w.path;
  const repo = sim.vfs.repoOf(cwd);
  if (!repo) throw new ApiErr("bad_request", "this folder is not a git repository");
  return repo;
};

export function gitChanges(sim: Sim, p: P<"git_changes">): GitChanges {
  const repo = rootOf(sim, p.workspace_id, p.session_id);
  const files: GitFile[] = sim.vfs.status(repo).map((e) => {
    const now = sim.vfs.read(join(repo.root, e.path));
    const old = repo.head.get(e.path) ?? null;
    const c = counts(old ?? "", now ?? "");
    return { path: e.path, status: e.status, additions: c.additions, deletions: c.deletions } satisfies GitFile;
  });
  return { branch: repo.branch, ahead: repo.ahead, behind: repo.behind, files };
}

export function gitDiff(sim: Sim, p: P<"git_diff">): GitDiff {
  const repo = rootOf(sim, p.workspace_id, p.session_id);
  const one = p.path ? p.path.replace(repo.root + "/", "") : undefined;
  const parts: string[] = [];
  for (const e of sim.vfs.status(repo)) {
    if (one && e.path !== one) continue;
    parts.push(
      unified(
        e.path,
        repo.head.get(e.path) ?? null,
        sim.vfs.read(join(repo.root, e.path)),
      ),
    );
  }
  let text = parts.join("");
  const truncated = text.length > 200_000;
  if (truncated) text = text.slice(0, 200_000);
  return { text, truncated };
}

/** Merge an agent's worktree back: copy its files over the project and commit them there. */
export function worktreeMerge(sim: Sim, p: P<"worktree_merge">) {
  const s = sim.session(p.session_id);
  if (!s?.worktree) throw new ApiErr("bad_request", "This agent does not work in a separate copy");
  const wt = s.worktree.path;
  const ws = sim.state.workspaces.find((w) => w.id === s.workspace_id);
  if (!ws) throw new ApiErr("not_found", "Unknown project");
  const repo = sim.vfs.repoOf(wt)!;
  for (const e of sim.vfs.status(repo)) {
    if (e.status === "deleted") sim.vfs.remove(join(ws.path, e.path));
    else sim.vfs.write(join(ws.path, e.path), sim.vfs.read(join(wt, e.path)) ?? "");
  }
  sim.refreshAllGit();
  return `Merged ${s.worktree.branch} into ${s.worktree.base}`;
}

export function worktreeDiscard(sim: Sim, p: P<"worktree_discard">) {
  const s = sim.session(p.session_id);
  if (!s?.worktree) throw new ApiErr("bad_request", "This agent does not work in a separate copy");
  sim.vfs.remove(s.worktree.path);
  sim.vfs.repos.delete(s.worktree.path);
  sim.refreshAllGit();
  return "Discarded";
}

export function workspaceAdd(sim: Sim, p: P<"workspace_add">, conn: Conn) {
  const path = guard(sim, p.path);
  if (!sim.vfs.isDir(path)) throw new ApiErr("not_found", "That folder does not exist");
  const existing = sim.state.workspaces.find((w) => w.path === path);
  if (existing) return existing;
  const order = Math.max(-1, ...sim.state.workspaces.map((w) => w.order)) + 1;
  const ws = { id: sim.id("workspace"), name: p.name?.trim() || basename(path), path, approved: false, pinned: false, order, created_at: sim.now() };
  sim.emit({ e: "workspace_upsert", workspace: ws });
  sim.refreshGit(ws.id);
  sim.record(conn.kind, conn.name, "workspace_add", ws.name);
  return sim.state.workspaces.find((w) => w.id === ws.id) ?? ws;
}
