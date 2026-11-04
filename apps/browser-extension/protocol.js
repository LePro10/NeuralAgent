// Pure helpers shared by the service worker and the tests (no chrome.* here).

/** "NA-<port>-<code>" -> { port, code } or null. */
export function parsePairCode(input) {
  const m = /^\s*NA-(\d{2,5})-([A-Za-z0-9]{4,32})\s*$/i.exec(String(input ?? ""));
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1024 || port > 65535) return null;
  return { port, code: m[2] };
}

export const MAX_TEXT = 40_000;
export const COMMAND_TIMEOUT_MS = 30_000;

/** Clip page text to the limit and say so. */
export function clipText(text, max = MAX_TEXT) {
  const t = String(text ?? "");
  return t.length > max ? t.slice(0, max) + "\n[clipped]" : t;
}

/** Reconnect delay: 1 s, 2 s, 4 s … at most 30 s. */
export function backoff(attempt) {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
}

/** "Chrome 141 on macOS" from a user-agent string. */
export function browserLabel(ua) {
  const v = /Chrome\/(\d+)/.exec(ua)?.[1];
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux|X11/.test(ua) ? "Linux" : /CrOS/.test(ua) ? "ChromeOS" : "";
  return `Chrome${v ? " " + v : ""}${os ? " on " + os : ""}`;
}

/** Runs async jobs one after the other per key (one command at a time per tab). */
export class KeyedQueue {
  #tails = new Map();
  run(key, job) {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(job);
    const tail = next.catch(() => {});
    this.#tails.set(key, tail);
    tail.then(() => this.#tails.get(key) === tail && this.#tails.delete(key));
    return next;
  }
}

/** Rejects with a plain message after `ms`. */
export function withTimeout(promise, ms, what = "The page") {
  let t;
  const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds.`)), ms)));
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
