// ANSI helpers for the fake terminals: colours, boxes and wrapping. The scripted output only uses
// what every terminal emulator (xterm.js here) renders the same: SGR colours, CR/LF and erase-line.

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const ITALIC = "\x1b[3m";
export const UNDERLINE = "\x1b[4m";
export const INVERSE = "\x1b[7m";

export const ERASE_LINE = "\x1b[2K";
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
/** What the daemon starts every snapshot with: reset, home, clear screen and scrollback. */
export const SNAPSHOT_HEAD = "\x1b[0m\x1b[H\x1b[2J\x1b[3J";

/** 256-colour foreground / background. */
export const fg = (n: number) => `\x1b[38;5;${n}m`;
export const bg = (n: number) => `\x1b[48;5;${n}m`;
export const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
export const bgRgb = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;

export const COLOR = {
  red: fg(203),
  green: fg(114),
  yellow: fg(221),
  blue: fg(75),
  magenta: fg(176),
  cyan: fg(80),
  orange: fg(209),
  grey: fg(244),
  white: fg(253),
} as const;

/** Wrap `s` in a colour and reset. */
export const paint = (color: string, s: string) => `${color}${s}${RESET}`;
export const dim = (s: string) => `${DIM}${s}${RESET}`;
export const bold = (s: string) => `${BOLD}${s}${RESET}`;

const SGR = /\x1b\[[0-9;?]*[A-Za-z]/g;
/** The printed length of a string (escape sequences removed; every character is one cell). */
export const width = (s: string) => [...s.replace(SGR, "")].length;
export const strip = (s: string) => s.replace(SGR, "");

/** Pad (or cut) to `n` printed cells. */
export function fit(s: string, n: number): string {
  const w = width(s);
  if (w <= n) return s + " ".repeat(n - w);
  // Cut plain text only; styled text is kept whole by callers that care.
  const plain = strip(s);
  return [...plain].slice(0, Math.max(0, n - 1)).join("") + "…";
}

/** Word-wrap plain text to `n` columns. */
export function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!line) line = word;
      else if ((line + " " + word).length <= n) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

const BORDERS = {
  round: ["╭", "╮", "╰", "╯", "─", "│"],
  square: ["┌", "┐", "└", "┘", "─", "│"],
  heavy: ["┏", "┓", "┗", "┛", "━", "┃"],
} as const;

/** A box around lines (already styled), `inner` cells wide inside the border. */
export function box(lines: string[], inner: number, opts: { style?: keyof typeof BORDERS; color?: string; title?: string } = {}): string[] {
  const [tl, tr, bl, br, h, v] = BORDERS[opts.style ?? "round"];
  const col = opts.color ?? COLOR.grey;
  const title = opts.title ? ` ${opts.title} ` : "";
  const top = col + tl + h + title + h.repeat(Math.max(0, inner + 1 - width(title) - 1)) + tr + RESET;
  const body = lines.map((l) => `${col}${v}${RESET} ${fit(l, inner)} ${col}${v}${RESET}`);
  return [top, ...body, col + bl + h.repeat(inner + 2) + br + RESET];
}

/** Lines to terminal text: CRLF joined, with a trailing CRLF. */
export const crlf = (lines: string[]) => lines.map((l) => l + "\r\n").join("");

/** A progress bar of `n` cells. */
export function bar(frac: number, n: number, on = "█", off = "░"): string {
  const k = Math.round(Math.max(0, Math.min(1, frac)) * n);
  return on.repeat(k) + off.repeat(n - k);
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const enc = new TextEncoder();
/** UTF-8 byte length (terminal sequence numbers count bytes). */
export const byteLength = (s: string) => enc.encode(s).length;

/** Base64 of the UTF-8 bytes of a string (the wire format of `term` messages). */
export function toBase64(s: string): string {
  const bytes = enc.encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
