// The phone terminal key bar's keys (KeyBar.tsx): escape sequences a phone keyboard lacks, and
// the sticky Ctrl modifier. Pure, so it is tested without a terminal.

export const SEQ = {
  esc: "\x1b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
} as const;

/** Ctrl + a key: the control byte (Ctrl+C → 0x03, Ctrl+[ → Esc, Ctrl+Space → NUL); null if it has none. */
export function ctrlSeq(ch: string): string | null {
  if (ch.length !== 1) return null;
  if (ch === " " || ch === "@" || ch === "2") return "\x00";
  const c = ch.toUpperCase().charCodeAt(0);
  if (c >= 65 && c <= 90) return String.fromCharCode(c - 64);
  const extra: Record<string, string> = { "[": "\x1b", "\\": "\x1c", "]": "\x1d", "^": "\x1e", "_": "\x1f", "?": "\x7f" };
  return extra[ch] ?? null;
}

/** The control letters most CLIs use, for the row Ctrl shows. */
export const CTRL_LETTERS = ["C", "D", "Z", "L", "R", "A", "E", "U", "W", "K"] as const;
