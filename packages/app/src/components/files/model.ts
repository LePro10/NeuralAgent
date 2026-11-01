// Files explorer (D67): the pure parts. What kind of file this is, how to sort a folder, the
// breadcrumbs from the root down, sizes, and the plan for reading a file in pieces.
import type { FileEntry, GitFileStatus } from "@neuralagent/protocol";

export type FileKind = "markdown" | "code" | "text" | "image" | "pdf" | "audio" | "video" | "binary";

/** Text above this size opens as its first part only (with a way to load the rest). */
export const PREVIEW_BYTES = 512 * 1024;
/** The whole text is never loaded past this (download it instead). */
export const MAX_TEXT = 4 * 1024 * 1024;
/** Pictures, audio and video are shown inline up to this size; bigger ones are downloads. */
export const MAX_MEDIA = 48 * 1024 * 1024;
/** One `file_read` / `file_upload` piece (the daemon caps reads at 1 MiB). */
export const CHUNK = 512 * 1024;

const ext = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

const LANG: Record<string, string> = {
  ts: "ts", tsx: "ts", mts: "ts", cts: "ts", js: "js", jsx: "js", mjs: "js", cjs: "js",
  rs: "rust", py: "py", rb: "rb", go: "go", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", m: "c", mm: "cpp", cs: "cs",
  sh: "sh", bash: "sh", zsh: "sh", fish: "sh", ps1: "sh",
  json: "json", jsonc: "json", json5: "json", toml: "toml", yaml: "yaml", yml: "yaml", ini: "toml", env: "sh",
  css: "css", scss: "css", less: "css", html: "html", htm: "html", xml: "html", svg: "html", vue: "html", svelte: "html",
  sql: "sql", lua: "lua", php: "php", dart: "dart", gradle: "kotlin", dockerfile: "sh", makefile: "sh",
};
const NAMED: Record<string, string> = { dockerfile: "sh", makefile: "sh", justfile: "sh", ".zshrc": "sh", ".bashrc": "sh", ".gitignore": "sh", ".env": "sh" };

/** The highlighter's language for a file name, or "" for plain text. */
export function langOf(name: string): string {
  const n = name.toLowerCase();
  return NAMED[n] ?? (n.startsWith(".env") ? "sh" : (LANG[ext(n)] ?? ""));
}

/** How the viewer shows a file: by its type, then by whether its first bytes look like text. */
export function kindOf(name: string, mime: string, text: boolean): FileKind {
  const e = ext(name);
  if (e === "md" || e === "markdown" || e === "mdx") return "markdown";
  if (mime === "image/svg+xml") return "image";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (!text) return "binary";
  return langOf(name) ? "code" : "text";
}

export type SortKey = "name" | "date" | "size" | "kind";
export interface Sort {
  key: SortKey;
  /** Newest / biggest first for date and size, A→Z for name and kind. */
  desc?: boolean;
}

/** Folders first, then by the chosen key (names compare like Finder: "file 2" before "file 10"). */
export function sortEntries(entries: FileEntry[], sort: Sort): FileEntry[] {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const by = (a: FileEntry, b: FileEntry): number => {
    switch (sort.key) {
      case "date":
        return b.mtime - a.mtime;
      case "size":
        return b.size - a.size;
      case "kind":
        return coll.compare(ext(a.name), ext(b.name));
      default:
        return 0;
    }
  };
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    const d = by(a, b) * (sort.desc ? -1 : 1);
    return d || coll.compare(a.name, b.name);
  });
}

/** Entries whose name contains `q` (any case). */
export function filterEntries(entries: FileEntry[], q: string): FileEntry[] {
  const s = q.trim().toLowerCase();
  return s ? entries.filter((e) => e.name.toLowerCase().includes(s)) : entries;
}

export interface Crumb {
  name: string;
  path: string;
}

/** "app › src › components" from the root (named `rootName`) down to `path`. */
export function crumbsOf(path: string, root: string, rootName: string): Crumb[] {
  const r = root.replace(/\/+$/, "") || "/";
  const out: Crumb[] = [{ name: rootName, path: r }];
  if (path !== r && !path.startsWith(r === "/" ? "/" : `${r}/`)) return out;
  let cur = r === "/" ? "" : r;
  for (const part of path.slice(cur.length).split("/").filter(Boolean)) {
    cur = `${cur}/${part}`;
    out.push({ name: part, path: cur });
  }
  return out;
}

/** The folder a path is in ("/a/b/c.txt" → "/a/b"). */
export const dirOf = (path: string) => path.replace(/\/[^/]*\/?$/, "") || "/";
export const baseName = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? path;

/** The path relative to `root` ("src/App.tsx"), or the full path outside it. */
export function relPath(path: string, root: string): string {
  const r = root.replace(/\/+$/, "");
  return path === r ? "." : path.startsWith(`${r}/`) ? path.slice(r.length + 1) : path;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "Today 14:05", "Yesterday", "3 Oct", "3 Oct 2024". */
export function formatDate(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const today = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(today) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
}

export const GIT_LABEL: Record<GitFileStatus, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "New",
  conflicted: "Conflict",
};
export const GIT_LETTER: Record<GitFileStatus, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!" };

/** The pieces to fetch for `size` bytes, as [offset, length] pairs. */
export function chunksOf(size: number, chunk = CHUNK): [number, number][] {
  const out: [number, number][] = [];
  for (let o = 0; o < size; o += chunk) out.push([o, Math.min(chunk, size - o)]);
  return out;
}

/** Base64 → bytes (any size). */
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Bytes → base64 in slices, so a big piece never overflows the call stack. */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Text decoded from pieces that may cut a character in two. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** The text encoding of a file's bytes, when it is not UTF-8. */
export type Encoding = "UTF-16LE" | "UTF-16BE" | "Latin-1";

/** UTF-16 by its byte-order mark, or (without one) by every other byte being zero. */
export function utf16Of(b: Uint8Array): "UTF-16LE" | "UTF-16BE" | null {
  if (b[0] === 0xff && b[1] === 0xfe) return "UTF-16LE";
  if (b[0] === 0xfe && b[1] === 0xff) return "UTF-16BE";
  const pairs = Math.floor(Math.min(b.length, 4096) / 2);
  if (pairs < 2) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < pairs; i++) {
    if (b[2 * i] === 0) even++;
    if (b[2 * i + 1] === 0) odd++;
  }
  if (odd * 10 >= pairs * 9 && even * 20 <= pairs) return "UTF-16LE";
  if (even * 10 >= pairs * 9 && odd * 20 <= pairs) return "UTF-16BE";
  return null;
}

/**
 * Text from bytes, checked. UTF-8 (a byte-order mark is kept, so a save keeps it too) can be
 * edited. UTF-16 and, as the fallback, Latin-1 (Windows-1252) are decoded for reading and marked
 * `lossy` with their `encoding`: a save would write UTF-8, so they stay read-only. `complete:
 * false` (the first part of a file) lets a character cut at the end pass.
 */
export function decodeChecked(bytes: Uint8Array, complete: boolean): { text: string; lossy: boolean; encoding?: Encoding } {
  const u16 = utf16Of(bytes);
  if (u16) return { text: new TextDecoder(u16.toLowerCase()).decode(bytes, { stream: !complete }), lossy: true, encoding: u16 };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes, { stream: !complete }), lossy: false };
  } catch {
    // WHATWG maps "latin1" to Windows-1252, a superset for the printable range.
    return { text: new TextDecoder("windows-1252").decode(bytes), lossy: true, encoding: "Latin-1" };
  }
}

/** Line count shown in the viewer header. */
export const lineCount = (text: string) => (text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0);

/** A name for a quick upload id. */
export const uploadId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Control characters (newline, escape, …) in a file name. */
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * A path as typed into a terminal: never a control character (a newline in a file name would
 * press Enter), and quoted for a shell when it has anything but plain path characters, so a name
 * like `$(rm -rf ~)` stays a name.
 */
export function termToken(path: string): string {
  const p = path.replace(CONTROL, "?");
  return /^[\w./~+@%:,=-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}
