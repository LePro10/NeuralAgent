// Imported first by every demo entry. The demo runs the real app on a page of the real site, so this
// makes sure it cannot touch what belongs to the visitor or leave the page:
//
//   - localStorage / sessionStorage are in-memory (seeded), so the real origin's storage (the web
//     remote's account, theme and pairing live on the same origin) is neither read nor written;
//   - history is in-memory: pushState/back/forward still fire popstate/hashchange for the phone
//     router, but never add entries to the visitor's real back stack;
//   - no notifications, no service workers, no microphone, no clipboard reads, no foreign requests;
//   - window.open only for http(s) pages.
//
// The inline script in demo/index.html does the first bullet before the theme script runs; this file
// finishes the job (and does all of it when the page was loaded without that script).

export interface Isolation {
  local: Storage;
  session: Storage;
}

declare global {
  interface Window {
    __naMem?: Isolation;
  }
}

const noop = () => {};

/** A Storage that lives in memory. */
export function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(seed));
  const s = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(String(k), String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  return s as Storage;
}

function define(obj: object, key: string, value: unknown) {
  try {
    Object.defineProperty(obj, key, { value, configurable: true, writable: true });
    return true;
  } catch {
    return false;
  }
}

/** Seed for the keys the app reads at start. `look` becomes the theme store's persisted value. */
export function seedFor(look: { appearance?: string; scheme?: string; accent?: string | null } = {}): Record<string, string> {
  return {
    // Notifications are off in the demo: no sounds, no "allow notifications" nag.
    "na:alerts": "off",
    "neuralagent.theme": JSON.stringify({ state: { appearance: look.appearance ?? "dark", scheme: look.scheme ?? "night", accent: look.accent ?? null }, version: 0 }),
  };
}

function storage(look?: Parameters<typeof seedFor>[0]): Isolation {
  if (window.__naMem) return window.__naMem;
  const local = memoryStorage(seedFor(look));
  const session = memoryStorage();
  define(window, "localStorage", local);
  define(window, "sessionStorage", session);
  window.__naMem = { local, session };
  return window.__naMem;
}

// ── history ──

interface Entry {
  state: unknown;
  url: string;
}

function history(): void {
  const h = window.history;
  const real = { replace: h.replaceState.bind(h) };
  const stack: Entry[] = [{ state: h.state, url: location.href }];
  let idx = 0;
  const abs = (u?: string | URL | null) => (u == null ? location.href : new URL(String(u), location.href).href);
  const apply = (e: Entry) => {
    try {
      real.replace(e.state, "", e.url);
    } catch {
      /* a cross-origin url: keep the old one */
    }
  };
  define(h, "pushState", (state: unknown, _t: string, url?: string | URL | null) => {
    const e = { state, url: abs(url) };
    const before = location.href;
    stack.splice(idx + 1);
    stack.push(e);
    idx = stack.length - 1;
    apply(e);
    if (before !== location.href && before.split("#")[0] === location.href.split("#")[0]) window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: before, newURL: location.href }));
  });
  define(h, "replaceState", (state: unknown, _t: string, url?: string | URL | null) => {
    const e = { state, url: abs(url) };
    stack[idx] = e;
    apply(e);
  });
  const go = (n = 0) => {
    const to = idx + n;
    if (n === 0 || to < 0 || to >= stack.length) return;
    const before = location.href;
    idx = to;
    const e = stack[idx]!;
    apply(e);
    setTimeout(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: e.state }));
      if (before !== location.href && before.split("#")[0] === location.href.split("#")[0]) window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: before, newURL: location.href }));
    }, 0);
  };
  define(h, "go", go);
  define(h, "back", () => go(-1));
  define(h, "forward", () => go(1));
  try {
    Object.defineProperty(h, "length", { get: () => stack.length, configurable: true });
  } catch {
    /* some engines keep it fixed */
  }
  // Following a #link would add a real entry: route it through pushState instead.
  document.addEventListener(
    "click",
    (ev) => {
      const a = (ev.target as Element | null)?.closest?.("a[href^='#']") as HTMLAnchorElement | null;
      if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      ev.preventDefault();
      h.pushState(null, "", a.getAttribute("href"));
    },
    true,
  );
}

// ── the rest of the browser ──

function browser() {
  // Notifications: never asked, never shown.
  const N = class {
    static permission: NotificationPermission = "denied";
    static requestPermission() {
      return Promise.resolve("denied" as NotificationPermission);
    }
    close = noop;
    addEventListener = noop;
    removeEventListener = noop;
    constructor(_title?: string, _opts?: NotificationOptions) {}
  };
  define(window, "Notification", N);

  // No service worker, no push.
  if ("serviceWorker" in navigator) {
    const sw = navigator.serviceWorker;
    define(sw, "register", () => Promise.resolve({ scope: "/", unregister: () => Promise.resolve(true), update: () => Promise.resolve() }));
    define(sw, "getRegistrations", () => Promise.resolve([]));
    define(sw, "getRegistration", () => Promise.resolve(undefined));
  }

  // No microphone or camera.
  if (navigator.mediaDevices) {
    define(navigator.mediaDevices, "getUserMedia", () => Promise.reject(new DOMException("The microphone is not available in the demo.", "NotAllowedError")));
    define(navigator.mediaDevices, "getDisplayMedia", () => Promise.reject(new DOMException("Not available in the demo.", "NotAllowedError")));
  }

  // Writing to the clipboard (the copy buttons) is fine; reading what the visitor copied is not.
  if (navigator.clipboard) {
    const denied = () => Promise.reject(new DOMException("Reading the clipboard is not available in the demo.", "NotAllowedError"));
    define(navigator.clipboard, "readText", denied);
    define(navigator.clipboard, "read", denied);
  }

  // Nothing leaves the page: only this site's own files (code chunks, fonts) can be fetched.
  const realFetch = window.fetch.bind(window);
  define(window, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const u = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
      if (u.origin === location.origin && !u.pathname.startsWith("/api/") && !u.pathname.startsWith("/auth/")) return realFetch(input, init);
    } catch {
      /* fall through to the refusal */
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  });
  define(navigator, "sendBeacon", () => false);
  const Blocked = function (this: unknown) {
    throw new DOMException("The demo does not open connections.", "SecurityError");
  };
  define(window, "WebSocket", Blocked);
  define(window, "EventSource", Blocked);

  // window.open: web pages only (the app opens docs and links), never a script or data URL.
  const realOpen = window.open.bind(window);
  define(window, "open", (url?: string | URL, target?: string, features?: string) => {
    try {
      const u = new URL(String(url ?? ""), location.href);
      if (u.protocol === "https:" || u.protocol === "http:") return realOpen(u.href, target ?? "_blank", `${features ?? ""},noopener,noreferrer`);
    } catch {
      /* refused below */
    }
    return null;
  });
}

let done = false;

/** Install everything (once per window). Safe to call again. */
export function isolate(look?: Parameters<typeof seedFor>[0]): Isolation {
  const mem = storage(look);
  if (!done) {
    done = true;
    history();
    browser();
  }
  return mem;
}

if (typeof window !== "undefined") isolate();
