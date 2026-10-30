// Web Push in Chromium: the web remote (/app) against a local relay (test sign-in) + daemon, with
// a mock push service. Service worker registers, "Turn on" registers with the relay, a failing
// agent pushes while the page is hidden, a tap opens that agent.
//   pnpm --filter @neuralagent/web build && node scripts/dev/web-push.mjs   (env RELAY_PORT, OUT)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
const ROOT = new URL("../../", import.meta.url).pathname;
const R = ROOT + "target/debug/";
const PORT = process.env.RELAY_PORT ?? "8094";
const RELAY = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync("/tmp/na-web-push-");
const OUT = process.env.OUT ?? ROOT + "research-local/shots/web-push";
mkdirSync(tmp + "/proj");
mkdirSync(tmp + "/proj2");
const procs = [];
import { openSync } from "node:fs";
const run = (bin, args, env) => { const p = spawn(R + bin, args, { env: { ...process.env, RUST_LOG: "info", ...env }, stdio: ["ignore", "ignore", openSync(tmp + "/" + bin + ".log", "w")] }); procs.push(p); };
process.on("exit", () => procs.forEach((p) => p.kill("SIGKILL")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
run("neuralagent-relay", [], { NA_RELAY_BIND: `127.0.0.1:${PORT}`, PUBLIC_URL: RELAY, NA_RELAY_DB: tmp + "/relay.db", NA_RELAY_TEST_LOGIN: "1", ADMIN_EMAILS: "owner@example.com", NA_RELAY_WEB: ROOT + "apps/web/dist" });
run("neuralagentd", ["serve"], { NEURALAGENT_HOME: tmp + "/home", NEURALAGENT_RELAY: RELAY });
let info; for (let i = 0; i < 100 && !info; i++) { await sleep(100); try { info = JSON.parse(readFileSync(tmp + "/home/daemon.json", "utf8")); } catch {} }
const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
let id = 1; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "res") { pend.get(m.id)?.(m); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ t: "hello", v: 1, client: { kind: "desktop", name: "ui" } }));
const req = (m, p) => new Promise((res) => { const i = id++; pend.set(i, (x) => res(x.r ?? x.err)); ws.send(JSON.stringify({ t: "req", id: i, req: p === undefined ? { m } : { m, p } })); });
await sleep(300);
const { url } = await req("remote_sign_in", { provider: "test" });
await fetch(`${url}&email=owner@example.com&name=Owner`);
await sleep(1500);
const w = await req("workspace_add", { path: tmp + "/proj", name: "proj" });
const s = await req("session_start", { workspace_id: w.id, profile_id: "shell", cols: 80, rows: 24 });
await sleep(800);
await req("term_write", { sid: s.id, data: "echo hello-from-desktop\r" });

mkdirSync(OUT, { recursive: true });
const out = OUT + "/";
mkdirSync(out, { recursive: true });

// Mock push service: records what the relay posts.
const pushes = [];
const mock = createServer((q, r) => { q.resume(); q.on("end", () => { pushes.push(q.url); r.writeHead(201).end(); }); }).listen(0, "127.0.0.1");
await new Promise((r) => mock.once("listening", r));
const ENDPOINT = `http://127.0.0.1:${mock.address().port}/push/browser`;

const b = await chromium.launch({ channel: "chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await ctx.grantPermissions(["notifications"], { origin: RELAY });
// Headless Chromium has no push service: hand out a real-looking subscription that points at the mock.
await ctx.addInitScript((endpoint) => {
  if (!self.PushManager) return;
  let sub = null;
  PushManager.prototype.getSubscription = async () => sub;
  PushManager.prototype.subscribe = async (opts) => {
    const k = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey));
    const b64 = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const keys = { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) };
    sub = { endpoint, options: { applicationServerKey: opts.applicationServerKey.buffer ?? opts.applicationServerKey }, toJSON: () => ({ endpoint, keys }), unsubscribe: async () => ((sub = null), true) };
    return sub;
  };
}, ENDPOINT);
const errs = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errs.push(m.text()));
await p.goto(RELAY + "/app/");
await p.fill("#test-email", "owner@example.com");
await p.click("text=Test sign-in >> nth=-1");
await p.waitForSelector("text=Your computers", { timeout: 15000 });
await p.locator("button:has-text('Online')").first().click();
await p.waitForTimeout(4000);
const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.scriptURL; });
console.log("service worker:", sw);
// This device → Notifications → Turn on.
await p.mouse.click(390 * 0.9, 844 - 45); await p.waitForTimeout(800);
await p.locator("text=This device").last().click(); await p.waitForTimeout(1200);
await p.screenshot({ path: out + "p1-device.png" });
await p.locator("button:has-text('Turn on')").click();
await p.waitForSelector("button:has-text('Turn off')", { timeout: 8000 });
await p.screenshot({ path: out + "p2-on.png" });
console.log("turned on");

// Page hidden (another tab in front): an agent failing reaches the mock push service.
const other = await ctx.newPage(); await other.goto("about:blank"); await other.bringToFront();
await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await sleep(500);
const f = await req("session_start", { workspace_id: w.id, profile_id: "shell", cols: 80, rows: 24 });
await sleep(800);
await req("term_write", { sid: f.id, data: "exit 4\r" });
for (let i = 0; i < 50 && !pushes.length; i++) await sleep(100);
console.log("pushes at mock:", pushes);

// A notification tap: the worker posts "open" to the window; the app shows that agent.
await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); });
await p.bringToFront();
const host = await p.evaluate(() => localStorage.getItem("na-remote:host"));
const w2 = await req("workspace_add", { path: tmp + "/proj2", name: "second" });
const s2 = await req("session_start", { workspace_id: w2.id, profile_id: "shell", cols: 80, rows: 24 });
await sleep(1500);
const ui = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem("neuralagent.ui") || "{}").state?.workspace);
console.log("before tap, workspace is second:", (await ui(p)) === w2.id);
const worker = ctx.serviceWorkers()[0];
await worker.evaluate(([host, sid]) => self.clients.matchAll({ type: "window" }).then((cs) => cs.forEach((c) => c.postMessage({ t: "open", host, sid }))), [host, s2.id]);
await sleep(1500);
console.log("after tap, workspace is second:", (await ui(p)) === w2.id);
await p.screenshot({ path: out + "p3-opened.png" });

// The worker's own push handler: title from the cached agent names, data for the tap.
const shown = await worker.evaluate(async ([host, sid]) => {
  try {
    self.dispatchEvent(new PushEvent("push", { data: JSON.stringify({ t: "attention", kind: "waiting", host, sid }) }));
  } catch (e) { return "dispatch: " + e.message; }
  await new Promise((r) => setTimeout(r, 800));
  return (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, data: n.data }));
}, [host, s.id]);
console.log("worker notification:", JSON.stringify(shown));

// A tap that opened a fresh window: /app/?host&sid.
const q = await ctx.newPage();
await q.goto(`${RELAY}/app/?host=${host}&sid=${s.id}`);
await sleep(5000);
console.log("launch url opens first workspace:", (await ui(q)) === w.id, "url now:", new URL(q.url()).search === "");
await q.screenshot({ path: out + "p4-launch.png" });
console.log("errors:", errs.filter((e) => !/favicon/.test(e)).slice(0, 8));
await b.close();
process.exit(0);
