#!/usr/bin/env node
// Posters of the live demo: still WebP images of the scenes, shown on the site while the real demo
// loads (and wherever a still is enough). Starts nothing: pass the URL of a running Vite dev server
// (or a static server of the built site) that serves /demo/.
//
//   node scripts/dev/site-posters.mjs http://localhost:5194
//   node scripts/dev/site-posters.mjs http://localhost:5194 --only desk-grid,phone-grid --max-kb 100
//
// Output: apps/web/public/demo/{desk,phone}-{grid,permission,neural,team,files,agents}.webp plus
// desk-hero.webp and phone-hero.webp. Desk = 1280x800 css px, phone = 390x844, both at 2x.
// The browser clock is fixed and the world is seeded, so the same checkout gives the same posters.
//
// Needs playwright-core with Chromium (pnpm exec playwright-core install chromium). Uses `cwebp`
// when it is installed, else Chromium's own WebP encoder.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));
if (!base) {
  console.error("usage: node scripts/dev/site-posters.mjs <vite-url> [--out dir] [--only a,b] [--max-kb 120] [--seed 7]");
  process.exit(2);
}
const out = resolve(flag("out", join(root, "apps/web/public/demo")));
const only = flag("only", "")
  .split(",")
  .filter(Boolean);
const maxKb = Number(flag("max-kb", "120"));
const seed = flag("seed", "7");
const NOW = new Date("2026-10-31T10:24:00+01:00");

/** name -> what to shoot. `wait` is a text that must be visible (best effort), `ms` the extra settle time. */
const SHOTS = [
  { name: "desk-hero", view: "desk", scene: "grid", ms: 9000 },
  { name: "phone-hero", view: "phone", scene: "grid", ms: 9000 },
  { name: "desk-grid", view: "desk", scene: "grid", ms: 4500 },
  { name: "phone-grid", view: "phone", scene: "grid", ms: 4500 },
  { name: "desk-permission", view: "desk", scene: "permission", wait: /Do you want to proceed|Allow/i, ms: 2500 },
  { name: "phone-permission", view: "phone", scene: "permission", wait: /Do you want to proceed|Allow/i, ms: 2500 },
  { name: "desk-neural", view: "desk", scene: "neural", ms: 3500 },
  { name: "phone-neural", view: "phone", scene: "neural", ms: 3500 },
  { name: "desk-team", view: "desk", scene: "team", ms: 3500 },
  { name: "phone-team", view: "phone", scene: "team", ms: 3500 },
  { name: "desk-files", view: "desk", scene: "files", ms: 3500 },
  { name: "phone-files", view: "phone", scene: "files", ms: 3500 },
  { name: "desk-agents", view: "desk", scene: "agents", ms: 3500 },
  { name: "phone-agents", view: "phone", scene: "agents", ms: 3500 },
];

const VIEW = { desk: { width: 1280, height: 800, touch: false }, phone: { width: 390, height: 844, touch: true } };

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("playwright-core is missing: run `pnpm install` at the repo root.");
  process.exit(1);
}

const hasCwebp = spawnSync("cwebp", ["-version"], { encoding: "utf8" }).status === 0;

/** Encode PNG bytes to WebP below `maxKb`: lower the quality, then the size, until it fits. */
async function encode(png, page) {
  const tmp = join(tmpdir(), `na-poster-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const src = join(tmp, "in.png");
  const dst = join(tmp, "out.webp");
  writeFileSync(src, png);
  try {
    if (hasCwebp) {
      const run = (q, scale) => {
        const a = ["-quiet", "-q", String(q), "-m", "6", "-sharp_yuv"];
        if (scale < 1) a.push("-resize", String(Math.round(png.readUInt32BE(16) * scale)), "0");
        const r = spawnSync("cwebp", [...a, src, "-o", dst], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`cwebp failed: ${r.stderr}`);
        return readFileSync(dst);
      };
      // Quality first at full size, then smaller pictures at a middling quality.
      for (const [q, scale] of [[86, 1], [80, 1], [74, 1], [68, 1], [62, 1], [56, 1], [50, 1], [56, 0.9], [56, 0.8], [56, 0.7]]) {
        const data = run(q, scale);
        if (data.length <= maxKb * 1024) return { data, q, scale };
      }
      return { data: run(50, 0.6), q: 50, scale: 0.6 };
    }
    // No cwebp: let Chromium do it.
    const b64 = png.toString("base64");
    const res = await page.evaluate(
      async ({ b64, maxBytes }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        let best = null;
        for (const q of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46]) {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          const blob = await new Promise((r) => c.toBlob(r, "image/webp", q));
          best = { q, buf: new Uint8Array(await blob.arrayBuffer()) };
          if (best.buf.length <= maxBytes) break;
        }
        return { q: best.q, data: Array.from(best.buf) };
      },
      { b64, maxBytes: maxKb * 1024 },
    );
    return { data: Buffer.from(res.data), q: res.q, scale: 1 };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
  for (const shot of SHOTS) {
    if (only.length && !only.includes(shot.name)) continue;
    const v = VIEW[shot.view];
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 2,
      isMobile: v.touch,
      hasTouch: v.touch,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/ReadPixels|GPU stall/.test(m.text())) errors.push(m.text());
    });
    try {
      // Headless Chromium draws xterm's WebGL terminals at twice the size when the pixel ratio is 2
      // (a software-GL quirk; real GPUs and WebKit are fine). The terminals fall back to the DOM
      // renderer, which looks the same; the rest of the page keeps its WebGL.
      await page.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, attrs) {
          if (type === "webgl2" && attrs && attrs.antialias === false && attrs.depth === false) return null;
          return get.call(this, type, attrs);
        };
      });
      await page.clock.setFixedTime(NOW);
      const url = `${base.replace(/\/$/, "")}/demo/?embed=1&view=${shot.view}&scene=${shot.scene}&seed=${seed}&traffic=0`;
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => window.__naDemoFrame?.ready);
      if (shot.wait) await page.getByText(shot.wait).first().waitFor({ timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(shot.ms ?? 3000);
      await page.evaluate(() => document.fonts?.ready);
      const png = await page.screenshot({ type: "png" });
      const enc = await encode(png, page);
      const file = join(out, `${shot.name}.webp`);
      writeFileSync(file, enc.data);
      const kb = (enc.data.length / 1024).toFixed(1);
      const flagged = enc.data.length > maxKb * 1024 ? "  TOO BIG" : "";
      console.log(`${shot.name.padEnd(18)} ${kb.padStart(7)} kB  q${enc.q}${enc.scale < 1 ? ` x${enc.scale.toFixed(1)}` : ""}${errors.length ? `  errors: ${errors.length}` : ""}${flagged}`);
      if (errors.length) console.log("  ", errors.slice(0, 3).join(" | ").slice(0, 300));
      if (flagged) failed++;
    } catch (e) {
      failed++;
      console.error(`${shot.name}: ${e.message}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
