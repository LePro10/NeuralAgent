// Call start timeline in a real browser: taps "Call Neural" N times and prints, per call, when
// each step happened (ms after the tap): microphone permission, AudioContext, worklet, resume,
// call_start sent, the daemon's first `connecting` / `listening`, the first microphone frame sent
// and when the call screen said it was connected. Works against the desktop UI of a test env
// (`env.mjs up --llm`) or, with `--url`, any page that shows a "Call Neural" button.
//
//   node scripts/dev/call-web.mjs [--home /tmp/na-ui] [--port 1451] [--device phone|desk]
//        [--runs 3] [--strict] [--no-gesture] [--warm] [--drop] [--fake-mic q.wav] [--url …]
//        [--relay http://127.0.0.1:8105]
//
// --strict keeps Chromium's real autoplay rules (no --autoplay-policy flag): an AudioContext made
// outside a user gesture starts suspended, as on phones; with --no-gesture the call is started
// from script (no user activation), like the Android quick tile. --warm opens the Neural page and waits
// 6 s before the first call (time for a pre-warm). --relay http://127.0.0.1:8105 goes through a
// local relay built with `--features test-login` (daemon signed in as owner@example.com).
// --drop closes the connection mid-call and times the recovery. Needs Chromium
// (`pnpm exec playwright-core install chromium`). Never touches the installed app.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_VITE_PORT, daemonInfo, httpUp, isPhone, launchBrowser, openPage, sleep, tap, testHome } from "./lib.mjs";

const { values: o } = parseArgs({
  options: {
    home: { type: "string" },
    port: { type: "string" },
    device: { type: "string", default: "phone" },
    runs: { type: "string", default: "3" },
    strict: { type: "boolean", default: false },
    "no-gesture": { type: "boolean", default: false },
    warm: { type: "boolean", default: false },
    drop: { type: "boolean", default: false },
    "fake-mic": { type: "string" },
    url: { type: "string" },
    relay: { type: "string" },
  },
});
const home = testHome(o.home);
const envFile = join(home, "dev-env.json");
const port = Number(o.port ?? (existsSync(envFile) ? JSON.parse(readFileSync(envFile, "utf8")).vite?.port : null) ?? DEFAULT_VITE_PORT);
let url = o.url ?? (o.relay ? `${o.relay}/app/` : undefined);
if (!url) {
  if (!(await httpUp(`http://127.0.0.1:${port}/dev.html`))) throw new Error(`no Vite on :${port}; run node scripts/dev/env.mjs up --llm`);
  const info = daemonInfo(home);
  url = `http://127.0.0.1:${port}/dev.html#port=${info.port}&token=${info.token}`;
}

const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
if (o["fake-mic"]) args.push(`--use-file-for-fake-audio-capture=${resolve(o["fake-mic"])}`);
if (!o.strict) args.push("--autoplay-policy=no-user-gesture-required");
const browser = await launchBrowser("chromium", args);
const errors = [];
const { p } = await openPage(browser, o.device, { errors });
const phone = isPhone(o.device);

// Marks in the page, relative to the last tap.
await p.addInitScript(() => {
  const w = window;
  w.__marks = [];
  w.__t0 = 0;
  const mark = (name) => w.__marks.push([name, Math.round(performance.now() - w.__t0)]);
  w.__mark = mark;
  addEventListener("pointerdown", () => ((w.__t0 = performance.now()), (w.__marks = [])), true);
  // The app's own timeline line (`call: connected (ms after tap: …)`): through the relay the
  // daemon's messages are end-to-end encrypted, so this is the only daemon-side mark there.
  const info = console.info.bind(console);
  console.info = (...a) => {
    if (typeof a[0] === "string" && a[0].startsWith("call: connected")) mark(a[0]);
    info(...a);
  };
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    mark("getUserMedia");
    const s = await gum(c);
    mark("mic granted");
    return s;
  };
  const AC = w.AudioContext;
  w.AudioContext = class extends AC {
    constructor(...a) {
      super(...a);
      mark(`AudioContext (${this.state})`);
      this.addEventListener("statechange", () => mark(`ctx ${this.state}`));
    }
    async resume() {
      mark("resume()");
      const r = await super.resume();
      mark("resumed");
      return r;
    }
  };
  const add = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = async function (...a) {
    mark("addModule");
    const r = await add.apply(this, a);
    mark("worklet loaded");
    return r;
  };
  const send = WebSocket.prototype.send;
  let audioSent = false;
  WebSocket.prototype.send = function (d) {
    if (typeof d === "string") {
      if (d.includes('"call_start"')) ((audioSent = false), mark("call_start sent"));
      else if (d.includes('"call_warm"')) mark("call_warm sent");
      else if (!audioSent && d.includes('"call_audio"')) ((audioSent = true), mark("first mic frame sent"));
    }
    return send.call(this, d);
  };
  const WS = w.WebSocket;
  w.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      (w.__sockets ??= []).push(this);
      const seen = new Set();
      this.addEventListener("message", (e) => {
        if (typeof e.data !== "string" || !e.data.startsWith('{"t":"call"')) return;
        const ev = JSON.parse(e.data).ev;
        if (ev.k === "state" && !seen.has(ev.state)) (seen.add(ev.state), mark(`daemon ${ev.state}`));
        if (ev.k === "state" && ev.state === "ended") seen.clear();
      });
    }
  };
});

await p.goto(url);
if (o.relay) {
  // A local relay with the test login (`--features test-login`), the daemon signed in as
  // owner@example.com: sign in and open the computer, like the web remote.
  await p.fill("#test-email", "owner@example.com");
  await p.getByRole("button", { name: "Test sign-in" }).click();
  await p.waitForSelector("text=Your computers");
  await sleep(800);
  await p.getByText("Online").first().click();
}
await sleep(2500);
const go = async (name) => {
  if (o["no-gesture"]) await p.locator(phone ? `[role=tab][aria-label="${name}"]` : `nav [aria-label="${name}"], nav :text-is("${name}")`).first().evaluate((b) => b.click());
  else if (phone) await tap(p, p.locator(`[role=tab][aria-label="${name}"]`).first(), true);
  else await p.locator(`nav [aria-label="${name}"], nav :text-is("${name}")`).first().click();
  await sleep(1100);
};
await go("Neural");
if (o.warm) await sleep(6000);

const runs = Number(o.runs);
for (let i = 0; i < runs; i++) {
  const button = p.getByRole("button", { name: /^Call( Neural)?$/ }).locator("visible=true").first();
  // --no-gesture: a click from script carries no user activation, like a call started from the
  // Android quick tile or the call notification.
  if (o["no-gesture"]) await button.evaluate((b) => ((window.__t0 = performance.now()), (window.__marks = []), b.click()));
  else await tap(p, button, phone);
  const t = Date.now();
  let connected = null;
  // Until the daemon listens and the screen shows the running time (or 20 s).
  while (Date.now() - t < 20000) {
    const txt = await p.locator("body").innerText();
    if (connected === null && /\b\d+:\d\d\b/.test(txt) && !/Connecting/.test(txt)) {
      connected = Date.now() - t;
      await p.evaluate(() => window.__mark("screen: connected (timer runs)"));
    }
    const done = await p.evaluate(() => window.__marks.some(([n]) => n === "daemon listening" || n === "daemon ended" || n.startsWith("call: connected")));
    if (connected !== null && done) break;
    await sleep(25);
  }
  await sleep(300);
  if (o.drop && connected !== null) {
    // The connection breaks mid-call (Wi-Fi switch, relay restart): close the page's sockets and
    // time how long until the call is back (daemon listening on a new socket, timer running).
    // Only the daemon's socket: closing Vite's HMR socket reloads the page.
    await p.evaluate((vite) => (window.__mark("network drop"), window.__sockets.filter((s) => !vite || !s.url.includes(location.host)).forEach((s) => s.close())), !o.relay);
    const d = Date.now();
    let notice = false;
    while (Date.now() - d < 20000) {
      const txt = await p.locator("body").innerText();
      if (/Reconnecting/.test(txt)) notice = true;
      const again = await p.evaluate(() => window.__marks.filter(([n]) => n === "daemon listening").length > 1);
      if ((notice || again) && /\b\d+:\d\d\b/.test(txt) && !/Reconnecting|Connecting/.test(txt)) break;
      await sleep(25);
    }
    console.log(`  drop: back after ${Date.now() - d} ms${notice ? " (showed Reconnecting…)" : ""}`);
  }
  const marks = await p.evaluate(() => window.__marks);
  const listening = marks.find(([n]) => n === "daemon listening")?.[1];
  console.log(`call ${i + 1}: screen ${connected === null ? "NEVER connected" : `connected ${connected} ms`}, daemon listening ${listening ?? "never"} ms`);
  for (const [n, ms] of marks) console.log(`  ${String(ms).padStart(5)} ms  ${n}`);
  // Hang up and wait for the screen to close.
  await p.getByRole("button", { name: /end call|hang up/i }).first().click().catch(() => {});
  await sleep(1500);
}
for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
await browser.close();
