// Screenshot driver for the desktop UI (dev.html) against a test daemon, at standard sizes in
// light and dark. Start the environment first: `node scripts/dev/env.mjs up --seed`.
//
//   node scripts/dev/shot.mjs [scene] [scene args…] [options]
//
//   scene            name in scripts/dev/scenes (home, pages, call) or a path; default "home"
//   --devices a,b    phone, small, kb (keyboard open), tablet, laptop, desk   (default phone,desk)
//   --schemes a,b    dark, light                                              (default dark,light)
//   --out dir        default research-local/shots (git-ignored)
//   --tag name       file name prefix (default: the scene name)
//   --engine e       webkit | chromium (default: chromium for phones, webkit for desktop sizes)
//   --dpr n          device pixel ratio (default 1: small files; use 2 for a final close look)
//   --inset px       simulated Android status-bar inset on phones (default 28, 0 = off)
//   --status-bar     also draw a fake status bar (to spot content under it)
//   --hash "&k=v"    extra dev.html hash params (fake updates etc., see apps/desktop/src/dev-browser.tsx)
//   --fake-mic f.wav Chromium fake microphone (call tests)
//   --montage        also write one contact sheet <out>/<tag>-montage.png of this run
//   --home dir       test daemon home (default $NEURALAGENT_HOME or /tmp/na-ui)
//   --port n         Vite port (default from <home>/dev-env.json, else 1451)
//
// Scenes export `default async (ctx)` with ctx = { p, shot(name), tap(locator), go(tab),
// more(item), sleep, dev, phone, light, args, home, req }. See scenes/pages.mjs.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_VITE_PORT, DEV, DEVICES, ROOT, connect, daemonInfo, fakeStatusBar, httpUp, isPhone,
  launchBrowser, montage, openPage, sleep, tap as tapAt, testHome,
} from "./lib.mjs";

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    devices: { type: "string", default: "phone,desk" },
    schemes: { type: "string", default: "dark,light" },
    out: { type: "string", default: join(ROOT, "research-local/shots") },
    tag: { type: "string" },
    engine: { type: "string" },
    dpr: { type: "string", default: "1" },
    inset: { type: "string", default: "28" },
    "status-bar": { type: "boolean", default: false },
    hash: { type: "string", default: "" },
    "fake-mic": { type: "string" },
    montage: { type: "boolean", default: false },
    home: { type: "string" },
    port: { type: "string" },
  },
});
const [sceneArg = "home", ...args] = positionals;
const home = testHome(o.home);
const envFile = join(home, "dev-env.json");
const port = Number(o.port ?? (existsSync(envFile) ? JSON.parse(readFileSync(envFile, "utf8")).vite?.port : null) ?? DEFAULT_VITE_PORT);
const scenePath = existsSync(join(DEV, "scenes", `${sceneArg}.mjs`)) ? join(DEV, "scenes", `${sceneArg}.mjs`) : resolve(sceneArg);
if (!existsSync(scenePath)) throw new Error(`no scene ${sceneArg} (scripts/dev/scenes/*.mjs or a path)`);
const scene = (await import(pathToFileURL(scenePath).href)).default;
const tag = o.tag ?? sceneArg.replace(/^.*\//, "").replace(/\.mjs$/, "");
const out = isAbsolute(o.out) ? o.out : resolve(o.out);
mkdirSync(out, { recursive: true });

if (!(await httpUp(`http://127.0.0.1:${port}/dev.html`))) throw new Error(`no Vite on :${port}; run node scripts/dev/env.mjs up`);
const info = daemonInfo(home);
const url = `http://127.0.0.1:${port}/dev.html#port=${info.port}&token=${info.token}${o.hash}`;
const daemon = await connect(home, { name: "shot" });

const devices = o.devices.split(",").filter(Boolean);
const schemes = o.schemes.split(",").filter(Boolean);
for (const d of devices) if (!DEVICES[d]) throw new Error(`unknown device ${d}`);
const micArgs = o["fake-mic"]
  ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${resolve(o["fake-mic"])}`, "--autoplay-policy=no-user-gesture-required"]
  : [];
const browsers = {};
const browser = async (engine) => (browsers[engine] ??= await launchBrowser(engine, micArgs));
const files = [];
let failed = 0;

for (const dev of devices) {
  for (const scheme of schemes) {
    const phone = isPhone(dev);
    const engine = o.engine ?? (phone || o["fake-mic"] ? "chromium" : "webkit");
    const errors = [];
    const { ctx, p } = await openPage(await browser(engine), dev, { scheme, dpr: Number(o.dpr), insetTop: Number(o.inset), errors });
    p.setDefaultTimeout(8000);
    const prefix = `${tag}-${dev}-${scheme}`;
    const shot = async (name, opts = {}) => {
      if (o["status-bar"] && phone) await fakeStatusBar(p, Number(o.inset) || 28);
      const path = join(out, `${prefix}-${name}.png`);
      await p.screenshot({ path, ...opts });
      files.push(path);
      console.log("shot", path);
      return path;
    };
    const tap = (loc) => tapAt(p, loc, phone);
    const desk = (name) => p.locator(`nav [aria-label="${name}"], nav :text-is("${name}")`).or(p.getByRole("button", { name: new RegExp(`(^|, )${name}$`, "i") })).first();
    // Main navigation: phone tab bar or desktop sidebar; `more` opens an item behind "More".
    const go = async (name) => {
      if (phone) await tap(p.locator(`[role=tab][aria-label="${name}"]`).first());
      else await desk(name).click();
      await sleep(1100);
    };
    const more = async (name) => {
      if (phone) {
        await tap(p.locator('[role=tab][aria-label="More"]').first());
        await sleep(700);
        await tap(p.getByText(name, { exact: true }).first());
      } else if (name === "Settings") {
        // Desktop: Settings sits in the account menu at the foot of the sidebar.
        await p.locator('[aria-label$="account menu"]').first().click();
        await sleep(400);
        await p.getByRole("menuitem", { name: "Settings" }).first().click();
      } else {
        await desk(name === "MCP servers" ? "MCP" : name).click();
      }
      await sleep(1300);
    };
    await p.goto(url);
    try {
      await scene({ p, ctx, shot, tap, go, more, sleep, dev, phone, light: scheme === "light", args, home, req: daemon.req });
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
daemon.close();
if (o.montage && files.length) console.log("montage", await montage(join(out, `${tag}-montage.png`), files, devices.some((d) => !isPhone(d)) ? 320 : 240));
process.exit(failed ? 1 : 0);
