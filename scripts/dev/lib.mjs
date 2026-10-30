// Shared helpers for the dev/test tools in scripts/dev: repo paths, a safe test-daemon home,
// a tiny daemon client, starting/stopping processes we own, and browser pages at standard sizes.
// See scripts/dev/README.md.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEV = join(ROOT, "scripts/dev");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Default test home for the UI kit. Never the user's real data dir. */
export const DEFAULT_HOME = "/tmp/na-ui";
export const DEFAULT_VITE_PORT = 1451;

/** The installed app's data dir (see crates/na-daemon/src/paths.rs). Tools refuse to touch it. */
export function realDataDir() {
  const id = "dev.neuralhub.neuralagent";
  if (platform() === "darwin") return join(homedir(), "Library/Application Support", id);
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"), id);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), id);
}

/** Resolve the test home (flag > NEURALAGENT_HOME > default) and refuse the real data dir. */
export function testHome(explicit) {
  const h = resolve(explicit ?? process.env.NEURALAGENT_HOME ?? DEFAULT_HOME);
  const real = realDataDir();
  const norm = (p) => (existsSync(p) ? realpathSync(p) : p);
  if (norm(h) === norm(real) || h.startsWith(real + "/")) {
    throw new Error(`refusing to use the installed app's data dir (${real}); pick a /tmp home`);
  }
  return h;
}

export const daemonBin = () => process.env.NA_DAEMON_BIN ?? join(ROOT, "target/debug/neuralagentd");
export const relayBin = () => process.env.NA_RELAY_BIN ?? join(ROOT, "target/debug/neuralagent-relay");

/** `daemon.json` of a home: { port, token, … }. Never print the token. */
export const daemonInfo = (home) => JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"));
export const readState = (home) => JSON.parse(readFileSync(join(home, "state.json"), "utf8"));

export async function waitForFile(path, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(path)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${path}`);
}

/**
 * Connect to a daemon over its local WebSocket. Returns { req, on, state, close }.
 * `req(m, p)` sends a request and resolves with the result (rejects on `ok:false`).
 * `on(fn)` receives every message; with `subscribe` the latest snapshot is in `state()`.
 */
export async function connect(home, { kind = "desktop", name = "dev-tool", subscribe = false } = {}) {
  const info = daemonInfo(home);
  const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
  let id = 1;
  let snapshot = null;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "snapshot") snapshot = m.state;
    if (m.t === "res" && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.ok ? p.res(m.r) : p.rej(new Error(m.err?.message ?? JSON.stringify(m.err)));
    }
    for (const l of listeners) l(m);
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`cannot connect to the daemon of ${home}`));
  });
  ws.send(JSON.stringify({ t: "hello", v: 1, client: { kind, name } }));
  if (subscribe) ws.send(JSON.stringify({ t: "sub" }));
  await sleep(subscribe ? 400 : 200);
  const req = (m, p) =>
    new Promise((res, rej) => {
      const i = id++;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ t: "req", id: i, req: p === undefined ? { m } : { m, p } }));
    });
  return { req, on: (fn) => listeners.add(fn), state: () => snapshot, close: () => ws.close() };
}

/** Hide daemon tokens in anything we print (URLs carry `token=…`). */
export const redact = (s) => String(s).replace(/token=[0-9a-zA-Z_-]+/g, "token=…");

/** Strip ANSI escapes from a terminal snapshot and keep the last `n` non-empty lines. */
export function screenText(snapshot, n = 25) {
  const t = snapshot
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "\n")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b./g, "");
  return t.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n).join("\n");
}

/**
 * Start a long-running process detached, output to `log`. Returns its pid. The process keeps
 * running after this script exits; stop it with `stopPid`.
 */
export function startDetached(cmd, args, { env = {}, cwd = ROOT, log }) {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, "a");
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  return child.pid;
}

/** The command line of a pid, or null if it is gone. */
export function pidCommand(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Stop a process we started, but only if its command line still contains `expect` (guards
 * against pid reuse). Kills its process group (it was started detached).
 */
export async function stopPid(pid, expect) {
  const cmd = pid && pidCommand(pid);
  if (!cmd || (expect && !cmd.includes(expect))) return false;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  for (let i = 0; i < 30 && pidCommand(pid); i++) await sleep(100);
  if (pidCommand(pid)) try { process.kill(-pid, "SIGKILL"); } catch {}
  return true;
}

/** Is something answering on http://127.0.0.1:<port>? */
export async function httpUp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}

// ---- Browser pages -------------------------------------------------------------------------

/** Standard sizes. Phones get touch + a mobile viewport; `kb` is a phone with the keyboard open. */
export const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  small: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
  kb: { viewport: { width: 390, height: 450 }, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  laptop: { viewport: { width: 1280, height: 800 } },
  desk: { viewport: { width: 1440, height: 900 } },
};
export const isPhone = (dev) => !!DEVICES[dev]?.isMobile;

/**
 * Engine per device: phones in Chromium (mobile emulation), desktop sizes in WebKit (closest to
 * the Tauri webview on macOS). Override with `engine`.
 */
export async function launchBrowser(engine, extraArgs = []) {
  const pw = await import("playwright-core").catch(() => {
    throw new Error("playwright-core missing: run `pnpm install` at the repo root (see scripts/dev/README.md)");
  });
  const args = engine === "chromium" ? extraArgs : [];
  return pw[engine].launch({ args });
}

/** A new context + page at a device size and colour scheme, logging page errors. */
export async function openPage(browser, dev, { scheme = "dark", dpr = 1, insetTop, errors = [] } = {}) {
  const d = DEVICES[dev];
  if (!d) throw new Error(`unknown device ${dev} (${Object.keys(DEVICES).join(", ")})`);
  const opts = { ...d, colorScheme: scheme, deviceScaleFactor: dpr };
  if (browser.browserType().name() !== "chromium") delete opts.isMobile;
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${redact(e.message).slice(0, 300)}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${redact(m.text()).slice(0, 200)}`));
  // Android status bar: Capacitor sets --safe-area-inset-top (env() is 0 there). Simulate it.
  if (isPhone(dev) && insetTop) {
    await p.addInitScript((px) => {
      document.addEventListener("DOMContentLoaded", () => document.documentElement.style.setProperty("--safe-area-inset-top", `${px}px`));
    }, insetTop);
  }
  return { ctx, p };
}

/** Tap on phones, click on desktop, at the centre of a locator's box. */
export async function tap(p, loc, phone) {
  const bb = await loc.boundingBox();
  if (!bb) throw new Error("tap: element not visible");
  if (phone) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  else await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
}

/** Draw a fake Android status bar (to see what sits under it). */
export async function fakeStatusBar(p, px = 28) {
  await p.evaluate((h) => {
    if (document.getElementById("fake-sb")) return;
    const d = document.createElement("div");
    d.id = "fake-sb";
    d.style.cssText = `position:fixed;left:0;right:0;top:0;height:${h}px;z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font:600 13px system-ui;color:currentColor;border-bottom:1px dashed rgba(255,0,80,.7)`;
    d.innerHTML = "<span>12:50</span><span>▲ ◆ 87%</span>";
    document.body.appendChild(d);
  }, px);
}

/**
 * One labelled contact sheet of many screenshots (cheaper to review than many images).
 * `tile` is the width of each tile in px.
 */
export async function montage(out, files, tile = 240) {
  const { chromium } = await import("playwright-core");
  const imgs = files
    .map((f) => {
      const type = f.endsWith(".jpg") ? "jpeg" : "png";
      return `<figure><img src="data:image/${type};base64,${readFileSync(f).toString("base64")}"><figcaption>${basename(f).replace(/\.(png|jpg)$/, "")}</figcaption></figure>`;
    })
    .join("");
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 400 } });
  await p.setContent(
    `<style>body{margin:0;background:#777;display:flex;flex-wrap:wrap;align-items:flex-start;gap:4px;padding:4px;width:992px}figure{margin:0;width:${tile}px}img{width:${tile}px;display:block}figcaption{font:11px system-ui;color:#000;background:#ddd;padding:1px 3px;overflow:hidden;white-space:nowrap}</style>${imgs}`,
  );
  await p.waitForTimeout(300);
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
  return out;
}
