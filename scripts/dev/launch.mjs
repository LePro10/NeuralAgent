// Frame series of the launch sequence (a cold start) on each surface, to check that it is one
// clean motion: no blank flash, no wrong theme, no intermediate screen.
//
//   pnpm --filter @neuralagent/web build          # remote targets: the relay serves apps/web/dist
//   cargo build -p na-daemon && cargo build -p na-relay --features test-login
//   node scripts/dev/launch.mjs [--targets desk,phone,remote-out,remote-in] [--schemes dark,light]
//                               [--slow] [--ms 3500|8000 slow] [--label now] [--out dir] [--relay-port 8097]
//
// desk:       the desktop build (production CSS, dev.html entry) in WebKit 1440×900, test daemon.
// phone:      the same build in Chromium at phone size (the shared app as the Android shell shows it).
// remote-out: /app/ from a local relay, signed out (goes to sign-in).
// remote-in:  /app/ signed in with a computer that was opened before (goes straight to the app).
// --slow:     Chromium gets a slow network (CDP, ~1.6 Mbit/s, 150 ms) and a 4× slower CPU.
// Chromium records with the CDP screencast (a frame whenever the picture changes); WebKit polls
// screenshots. Output: <out>/<label>-<target>-<scheme>/<ms>.jpg and <out>/<label>-montage-*.png.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ROOT, connect, daemonBin, daemonInfo, launchBrowser, montage, openPage, relayBin, sleep, waitForFile } from "./lib.mjs";

const { values: o } = parseArgs({
  options: {
    targets: { type: "string", default: "desk,phone,remote-out,remote-in" },
    schemes: { type: "string", default: "dark,light" },
    slow: { type: "boolean", default: false },
    ms: { type: "string" },
    label: { type: "string", default: "now" },
    out: { type: "string", default: join(ROOT, "research-local/polish/launch-shots") },
    "relay-port": { type: "string", default: "8097" },
    "static-port": { type: "string", default: "1463" },
  },
});
const out = resolve(o.out);
const MS = Number(o.ms ?? (o.slow ? 8000 : 3500));
const targets = o.targets.split(",");
const schemes = o.schemes.split(",");
const tmp = mkdtempSync("/tmp/na-launch-");
const procs = [];
const run = (bin, args, env, log) => procs.push(spawn(bin, args, { env: { ...process.env, RUST_LOG: "info", ...env }, stdio: ["ignore", "ignore", openSync(join(tmp, log), "w")] }));
process.on("exit", () => procs.forEach((p) => p.kill("SIGTERM")));
process.on("SIGINT", () => process.exit(0));

/** Records frames from navigation start for `ms`. Returns the frame files. */
async function record(p, url, dir, { slow }) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  const t0 = Date.now();
  const save = (buf, ms) => {
    const f = join(dir, `${String(ms).padStart(5, "0")}.jpg`);
    writeFileSync(f, buf);
    files.push(f);
  };
  const chromium = p.context().browser().browserType().name() === "chromium";
  if (chromium) {
    const cdp = await p.context().newCDPSession(p);
    if (slow) {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 100_000 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    cdp.on("Page.screencastFrame", (f) => {
      save(Buffer.from(f.data, "base64"), Date.now() - t0);
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
    void p.goto(url).catch(() => {});
    await sleep(MS);
    await cdp.send("Page.stopScreencast").catch(() => {});
  } else {
    void p.goto(url).catch(() => {});
    while (Date.now() - t0 < MS) {
      const ms = Date.now() - t0;
      const buf = await p.screenshot({ type: "jpeg", quality: 70, timeout: 1500 }).catch(() => null);
      if (buf) save(buf, ms);
    }
  }
  return files;
}

/** About `n` frames for a montage: the last frame at or before each of `n` evenly spaced moments. */
function pick(files, n = 25) {
  const at = (f) => Number(f.match(/(\d+)\.jpg$/)[1]);
  const end = at(files[files.length - 1]);
  const chosen = new Set([files[0]]);
  for (let i = 1; i <= n; i++) chosen.add(files.findLast((f) => at(f) <= (end * i) / n) ?? files[0]);
  return [...chosen];
}

const all = {};
const browsers = {};
const browser = async (engine) => (browsers[engine] ??= await launchBrowser(engine));

// ---- Desktop build (dev.html, production CSS) served statically, against a test daemon. ----
if (targets.includes("desk") || targets.includes("phone")) {
  const desktop = join(ROOT, "apps/desktop");
  const vite = await import(pathToFileURL(createRequire(join(desktop, "package.json")).resolve("vite")).href);
  const dist = join(tmp, "desk");
  await vite.build({ root: desktop, configFile: join(desktop, "vite.config.ts"), logLevel: "error", build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: { dev: join(desktop, "dev.html") } } } });
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".wasm": "application/wasm" };
  const port = Number(o["static-port"]);
  createServer((q, r) => {
    const path = join(dist, decodeURIComponent(new URL(q.url, "http://x").pathname));
    if (!path.startsWith(dist) || !existsSync(path)) return r.writeHead(404).end();
    r.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
  }).listen(port, "127.0.0.1");
  const home = join(tmp, "home-desk");
  run(daemonBin(), ["serve"], { NEURALAGENT_HOME: home, NEURALAGENT_DEV_ORIGIN: `http://127.0.0.1:${port}` }, "daemon-desk.log");
  await waitForFile(join(home, "daemon.json"));
  await new Promise((res) => spawn(process.execPath, [join(ROOT, "scripts/dev/seed.mjs"), "base"], { env: { ...process.env, NEURALAGENT_HOME: home }, stdio: "ignore" }).on("exit", res));
  const info = daemonInfo(home);
  const url = `http://127.0.0.1:${port}/dev.html#port=${info.port}&token=${info.token}`;
  for (const target of ["desk", "phone"].filter((t) => targets.includes(t))) {
    for (const scheme of schemes) {
      const b = await browser(target === "desk" ? "webkit" : "chromium");
      const { ctx, p } = await openPage(b, target, { scheme });
      const name = `${o.label}-${target}-${scheme}`;
      all[name] = await record(p, url, join(out, name), { slow: o.slow });
      console.log(name, all[name].length, "frames");
      await ctx.close();
    }
  }
}

// ---- Web remote from a local relay. ----
if (targets.some((t) => t.startsWith("remote"))) {
  if (!existsSync(join(ROOT, "apps/web/dist/app/index.html"))) throw new Error("apps/web/dist missing: pnpm --filter @neuralagent/web build");
  const RELAY = `http://127.0.0.1:${o["relay-port"]}`;
  run(relayBin(), [], { NA_RELAY_BIND: `127.0.0.1:${o["relay-port"]}`, PUBLIC_URL: RELAY, NA_RELAY_DB: join(tmp, "relay.db"), NA_RELAY_TEST_LOGIN: "1", ADMIN_EMAILS: "owner@example.com", NA_RELAY_WEB: join(ROOT, "apps/web/dist") }, "relay.log");
  const home = join(tmp, "home-remote");
  mkdirSync(join(tmp, "proj"), { recursive: true });
  run(daemonBin(), ["serve"], { NEURALAGENT_HOME: home, NEURALAGENT_RELAY: RELAY }, "daemon-remote.log");
  await waitForFile(join(home, "daemon.json"));
  await sleep(500);
  const d = await connect(home, { name: "launch" });
  const { url } = await d.req("remote_sign_in", { provider: "test" });
  if (!(await fetch(`${url}&email=owner@example.com&name=Owner`)).ok) throw new Error("test sign-in failed; build the relay with --features test-login");
  await sleep(1500);
  await d.req("workspace_add", { path: join(tmp, "proj"), name: "proj" });
  for (const scheme of schemes) {
    const b = await browser("chromium");
    if (targets.includes("remote-out")) {
      const { ctx, p } = await openPage(b, "phone", { scheme });
      const name = `${o.label}-remote-out-${scheme}`;
      all[name] = await record(p, `${RELAY}/app/`, join(out, name), { slow: o.slow });
      console.log(name, all[name].length, "frames");
      await ctx.close();
    }
    if (targets.includes("remote-in")) {
      const { ctx, p } = await openPage(b, "phone", { scheme });
      p.setDefaultTimeout(20000);
      await p.goto(`${RELAY}/app/`);
      await p.fill("#test-email", "owner@example.com");
      await p.getByRole("button", { name: "Test sign-in" }).click();
      await p.waitForSelector("text=Your computers");
      await p.getByText("Online").first().click();
      await sleep(4000);
      const q = await ctx.newPage();
      await p.close();
      const name = `${o.label}-remote-in-${scheme}`;
      all[name] = await record(q, `${RELAY}/app/`, join(out, name), { slow: o.slow });
      console.log(name, all[name].length, "frames");
      await ctx.close();
    }
  }
  d.close();
}

for (const b of Object.values(browsers)) await b.close();
for (const [name, files] of Object.entries(all)) {
  if (files.length) console.log("montage", await montage(join(out, `${name}-montage.png`), pick(files), 180));
}
process.exit(0);
