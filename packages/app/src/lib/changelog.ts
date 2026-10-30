// Release notes for the update dialog and Settings → Updates. The data is CHANGELOG.md parsed by
// scripts/changelog.mjs and served by the relay as /changelog.json (web build). Pure functions,
// tested in changelog.test.ts.
import type { ChangelogEntry } from "./platform.ts";

/** Semver order, numbers only; a pre-release (`1.0.0-beta.1`) comes before its release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core = "", pre] = v.replace(/^v/, "").split(/-(.*)/s);
    return { n: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) - (y.n[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The released versions after `current` up to and including `target`, newest first. */
export function notesBetween(entries: ChangelogEntry[], current: string, target: string): ChangelogEntry[] {
  return entries
    .filter((e) => !e.unreleased && compareVersions(e.version, current) > 0 && compareVersions(e.version, target) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * The update manifest's notes (Markdown: optional summary, `### Group`, `- item`) as an entry,
 * for when the full changelog cannot be loaded. Plain text becomes the summary.
 */
export function notesFromMarkdown(version: string, md: string | null | undefined): ChangelogEntry | null {
  const text = (md ?? "").trim();
  if (!text) return null;
  const entry: ChangelogEntry = { version, date: null, summary: "", groups: [] };
  const summary: string[] = [];
  let group: ChangelogEntry["groups"][number] | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h = /^#{2,4}\s+(.+)$/.exec(line);
    if (h) {
      group = { title: h[1]!.trim(), items: [] };
      entry.groups.push(group);
    } else if (/^\s*[-*] /.test(line)) {
      if (!group) entry.groups.push((group = { title: "Changes", items: [] }));
      group.items.push(line.replace(/^\s*[-*] /, "").trim());
    } else if (/^\s+\S/.test(line) && group?.items.length) {
      group.items[group.items.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() && !group) {
      summary.push(line.trim());
    }
  }
  entry.summary = summary.join(" ");
  entry.groups = entry.groups.filter((g) => g.items.length);
  return entry;
}

export type InlinePart = { t: "text" | "b" | "code"; s: string } | { t: "link"; s: string; href: string };

/** `**bold**`, `` `code` `` and `[text](https://…)` inside an entry; the rest stays text. */
export function inlineParts(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ t: "text", s: text.slice(last, m.index) });
    if (m[1]) out.push({ t: "b", s: m[1] });
    else if (m[2]) out.push({ t: "code", s: m[2] });
    else out.push({ t: "link", s: m[3]!, href: m[4]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", s: text.slice(last) });
  return out;
}
