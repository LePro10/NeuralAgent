/**
 * OSC 52: a program in the terminal puts text on the clipboard (`ESC ] 52 ; c ; <base64> BEL`).
 * Claude Code, Codex, tmux, Neovim and others copy their own mouse selections this way, because
 * while they track the mouse the terminal itself cannot select. Only writes are honoured: a read
 * request (`?`) would let any program read the user's clipboard.
 */

/** Largest text we take from a program (decoded), like other terminals' limits. */
export const OSC52_MAX = 1_000_000;

/**
 * The text an OSC 52 payload (everything after `52;`) asks to copy, or null for a read request,
 * a clear, a malformed payload or one that is too big.
 */
export function parseOsc52(data: string): string | null {
  const semi = data.indexOf(";");
  if (semi < 0) return null;
  const targets = data.slice(0, semi);
  const b64 = data.slice(semi + 1).replace(/\s+/g, "");
  // Targets: c (clipboard), p/s (primary/selection), 0-7 (cut buffers); empty means "s 0".
  if (!/^[cpsq0-7]*$/.test(targets)) return null;
  if (!b64 || b64 === "?") return null;
  if (b64.length > Math.ceil(OSC52_MAX / 3) * 4) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1) return null;
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return text || null;
  } catch {
    return null;
  }
}
