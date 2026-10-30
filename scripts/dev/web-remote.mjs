// The web remote (/app, also what the Android app loads) in a browser against a local relay
// (test sign-in) + a throwaway daemon, at phone and desktop sizes in dark and light.
//
//   pnpm --filter @neuralagent/web build          # the relay serves apps/web/dist
//   cargo build -p na-daemon && cargo build -p na-relay --features test-login
//   node scripts/dev/web-remote.mjs [--devices phone,desk] [--schemes dark,light] [--out dir]
//                                   [--relay-port 8093] [--engine chromium|webkit] [--montage] [--keep]
//
// Chromium by default: in headless WebKit the test sign-in currently never reaches "Your
// computers" (seen 2026-10-30, cause not investigated). Each device signs in with the relay's test login, opens the computer and takes screenshots
// (computers list, workspace, Agents, More/This device). `--keep` leaves relay + daemon running
// until Ctrl+C (to explore by hand at http://127.0.0.1:<relay-port>/app/). Everything runs in a
// fresh /tmp/na-web-remote-* folder and is stopped at the end.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ROOT, connect, daemonBin, isPhone, launchBrowser, montage, openPage, relayBin, sleep, tap, waitForFile } from "./lib.mjs";

const { values: o } = parseArgs({
  options: {
    devices: { type: "string", default: "phone,desk" },
    schemes: { type: "string", default: "dark,light" },
    out: { type: "string", default: join(ROOT, "research-local/shots") },
    "relay-port": { type: "string", default: "8093" },
    engine: { type: "string", default: "chromium" },
    montage: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
});
const out = resolve(o.out);
mkdirSync(out, { recursive: true });
const RELAY = `http://127.0.0.1:${o["relay-port"]}`;
const dist = join(ROOT, "apps/web/dist/app/index.html");
if (!existsSync(dist)) throw new Error("apps/web/dist missing: pnpm --filter @neuralagent/web build");

const tmp = mkdtempSync("/tmp/na-web-remote-");
mkdirSync(join(tmp, "proj"));
const procs = [];
const run = (bin, args, env, log) => {
  const p = spawn(bin, args, { env: { ...process.env, RUST_LOG: "info", ...env }, stdio: ["ignore", "ignore", openSync(join(tmp, log), "w")] });
  procs.push(p);
};
const stopAll = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("exit", stopAll);
process.on("SIGINT", () => process.exit(0));

run(relayBin(), [], { NA_RELAY_BIND: `127.0.0.1:${o["relay-port"]}`, PUBLIC_URL: RELAY, NA_RELAY_DB: join(tmp, "relay.db"), NA_RELAY_TEST_LOGIN: "1", ADMIN_EMAILS: "owner@example.com", NA_RELAY_WEB: join(ROOT, "apps/web/dist") }, "relay.log");
run(daemonBin(), ["serve"], { NEURALAGENT_HOME: join(tmp, "home"), NEURALAGENT_RELAY: RELAY }, "daemon.log");
await waitForFile(join(tmp, "home/daemon.json"));
await sleep(500);

// The computer: signed in with the test login, one workspace with a shell.
const d = await connect(join(tmp, "home"), { name: "web-remote" });
const { url } = await d.req("remote_sign_in", { provider: "test" });
const r = await fetch(`${url}&email=owner@example.com&name=Owner`);
if (!r.ok) throw new Error(`test sign-in failed (${r.status}); build the relay with --features test-login`);
await sleep(1500);
const w = await d.req("workspace_add", { path: join(tmp, "proj"), name: "proj" });
const s = await d.req("session_start", { workspace_id: w.id, profile_id: "shell", cols: 80, rows: 24 });
await sleep(800);
await d.req("term_write", { sid: s.id, data: "echo hello-from-desktop\r" });
console.log(`relay ${RELAY}, daemon home ${join(tmp, "home")}`);

const files = [];
let failed = 0;
const browsers = {};
for (const dev of o.devices.split(",")) {
  for (const scheme of o.schemes.split(",")) {
    const phone = isPhone(dev);
    const engine = o.engine;
    const b = (browsers[engine] ??= await launchBrowser(engine));
    const errors = [];
    const { ctx, p } = await openPage(b, dev, { scheme, errors });
    p.setDefaultTimeout(15000);
    const prefix = `remote-${dev}-${scheme}`;
    const shot = async (name) => {
      const path = join(out, `${prefix}-${name}.png`);
      await p.screenshot({ path });
      files.push(path);
      console.log("shot", path);
    };
    try {
      await p.goto(`${RELAY}/app/`);
      await p.waitForSelector("#test-email");
      await shot("1-signin");
      await p.fill("#test-email", "owner@example.com");
      await p.getByRole("button", { name: "Test sign-in" }).click();
      await p.waitForSelector("text=Your computers");
      await sleep(800);
      await shot("2-computers");
      await p.getByText("Online").first().click();
      await sleep(5000);
      await shot("3-app");
      if (phone) {
        await tap(p, p.locator('[role=tab][aria-label="Agents"]').first(), true);
        await sleep(1200);
        await shot("4-agents");
        await tap(p, p.locator('[role=tab][aria-label="More"]').first(), true);
        await sleep(1200);
        await shot("5-more");
      } else {
        const proj = p.locator('nav :text-is("proj")').first();
        if (await proj.count()) {
          await proj.click();
          await sleep(2000);
          await shot("4-workspace");
        }
      }
    } catch (e) {
      failed++;
      console.log(`ERR ${prefix}: ${e.message.split("\n")[0]}`);
      await p.screenshot({ path: join(out, `${prefix}-zz-error.png`) }).catch(() => {});
    }
    for (const e of errors.slice(0, 5)) console.log(`  ${prefix} ${e}`);
    await ctx.close();
  }
}
for (const b of Object.values(browsers)) await b.close();
d.close();
if (o.montage && files.length) console.log("montage", await montage(join(out, "remote-montage.png"), files, 240));
if (o.keep) {
  console.log(`running: ${RELAY}/app/ (test sign-in owner@example.com). Ctrl+C stops relay and daemon.`);
  await new Promise(() => {});
}
process.exit(failed ? 1 : 0);
