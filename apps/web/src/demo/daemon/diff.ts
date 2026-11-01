// Line diffs for the fake git: a classic LCS table (files in the demo are small), unified output
// with real hunk headers, and the +/- counts the changes sheet shows.

export interface DiffLine {
  /** " " context, "+" added, "-" removed. */
  t: " " | "+" | "-";
  text: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

const split = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/** The edit script between two texts, whole file, as context/add/remove lines. */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = split(a);
  const y = split(b);
  const n = x.length;
  const m = y.length;
  // lcs[i][j]: length of the common subsequence of x[i..] and y[j..].
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ t: " ", text: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ t: "-", text: x[i++]! });
    } else {
      out.push({ t: "+", text: y[j++]! });
    }
  }
  while (i < n) out.push({ t: "-", text: x[i++]! });
  while (j < m) out.push({ t: "+", text: y[j++]! });
  return out;
}

/** Hunks with `context` lines around each change, merged when they touch. */
export function hunks(a: string, b: string, context = 3): Hunk[] {
  const all = diffLines(a, b);
  const changed = all.map((l, i) => (l.t === " " ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const out: Hunk[] = [];
  let start = Math.max(0, changed[0]! - context);
  let end = Math.min(all.length, changed[0]! + context + 1);
  const flush = () => {
    const lines = all.slice(start, end);
    const before = all.slice(0, start);
    const oldStart = before.filter((l) => l.t !== "+").length + 1;
    const newStart = before.filter((l) => l.t !== "-").length + 1;
    const oldLines = lines.filter((l) => l.t !== "+").length;
    const newLines = lines.filter((l) => l.t !== "-").length;
    out.push({ oldStart: oldLines ? oldStart : oldStart - 1, oldLines, newStart: newLines ? newStart : newStart - 1, newLines, lines });
  };
  for (const c of changed.slice(1)) {
    if (c - context <= end) {
      end = Math.min(all.length, c + context + 1);
    } else {
      flush();
      start = Math.max(0, c - context);
      end = Math.min(all.length, c + context + 1);
    }
  }
  flush();
  return out;
}

export function counts(a: string, b: string): { additions: number; deletions: number } {
  const d = diffLines(a, b);
  return { additions: d.filter((l) => l.t === "+").length, deletions: d.filter((l) => l.t === "-").length };
}

const header = (h: Hunk) => `@@ -${h.oldStart}${h.oldLines === 1 ? "" : `,${h.oldLines}`} +${h.newStart}${h.newLines === 1 ? "" : `,${h.newLines}`} @@`;

/** A `git diff` block for one file. `a`/`b` null: the file does not exist on that side. */
export function unified(path: string, a: string | null, b: string | null): string {
  const head = [`diff --git a/${path} b/${path}`];
  if (a === null) head.push("new file mode 100644", "index 0000000..8f3e2a1", "--- /dev/null", `+++ b/${path}`);
  else if (b === null) head.push("deleted file mode 100644", "index 8f3e2a1..0000000", `--- a/${path}`, "+++ /dev/null");
  else head.push("index 4c1d9e0..8f3e2a1 100644", `--- a/${path}`, `+++ b/${path}`);
  const hs = hunks(a ?? "", b ?? "");
  return [...head, ...hs.flatMap((h) => [header(h), ...h.lines.map((l) => l.t + l.text)])].join("\n") + "\n";
}
