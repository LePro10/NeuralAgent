/**
 * Plain text out of an xterm.js buffer, for copying: rows that xterm soft-wrapped are joined back
 * into one line (so a long command or path copies as one line), trailing blanks are trimmed and
 * colours/escapes are gone (the buffer holds cells, not bytes).
 *
 * Typed structurally (a subset of xterm's `IBuffer`), so tests can use a fake buffer.
 */
export interface TextLine {
  isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}
export interface TextBuffer {
  length: number;
  /** First row of the screen (rows above it are scrollback). */
  baseY: number;
  getLine(y: number): TextLine | undefined;
}

/** Copy/show at most this much (the scrollback is 5000 rows; this keeps a huge screen fast). */
export const MAX_TEXT = 400_000;

/** Logical lines of rows [from, to): a wrapped row continues the line above it. */
export function bufferLines(buf: TextBuffer, from = 0, to = buf.length): string[] {
  to = Math.min(to, buf.length);
  // Start where the logical line starts, even when `from` lands on a continuation row.
  while (from > 0 && from < to && buf.getLine(from)?.isWrapped) from--;
  const out: string[] = [];
  let cur = "";
  for (let y = Math.max(0, from); y < to; y++) {
    const line = buf.getLine(y);
    if (!line) break;
    // A row that continues on the next one keeps its trailing spaces (they are real text).
    const cont = y + 1 < to && !!buf.getLine(y + 1)?.isWrapped;
    cur += line.translateToString(!cont);
    if (!cont) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur.trimEnd());
  // The screen below the last output is empty rows.
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** The newest `max` characters of `lines`, cut at a line start. */
export function capLines(lines: string[], max = MAX_TEXT): { text: string; lines: number; truncated: boolean } {
  let size = 0;
  let i = lines.length;
  while (i > 0 && size + lines[i - 1]!.length + 1 <= max) size += lines[--i]!.length + 1;
  // A single line longer than the cap: keep its end.
  if (i === lines.length && i > 0) return { text: lines[i - 1]!.slice(-max), lines: 1, truncated: true };
  const kept = i ? lines.slice(i) : lines;
  return { text: kept.join("\n"), lines: kept.length, truncated: i > 0 };
}

export interface TerminalText {
  /** Scrollback and screen. */
  all: string;
  /** Only the screen (what a full-screen program drew last). */
  screen: string;
  lines: number;
  truncated: boolean;
}

export function terminalText(buf: TextBuffer, max = MAX_TEXT): TerminalText {
  const all = capLines(bufferLines(buf), max);
  const screen = capLines(bufferLines(buf, buf.baseY), max);
  return { all: all.text, screen: screen.text, lines: all.lines, truncated: all.truncated };
}
