// Generates the four 1200x630 share cards (apps/web/public/og.png, og/download.png, og/changelog.png, og/app.png) from the real
// app posters in apps/web/public/demo, set on the site's dark ground in the site's fonts. Run from the repo root:
//   node scripts/dev/site-og.mjs      (run it in the release routine after the posters changed)
// Needs playwright-core (already a root dev dependency) and a Chromium. The copy lives in CARDS below: keep it in step with the
// hero headline and the page titles.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.REPO_ROOT || resolve(dirname(new URL(import.meta.url).pathname), "../..");
const WEB = resolve(ROOT, "apps/web");
const MIME = { webp: "image/webp", woff2: "font/woff2" };
// Fonts and posters go in as data URLs, so the card renders the same wherever the temp file sits.
const url = (p) => `data:${MIME[p.split(".").pop()]};base64,${readFileSync(resolve(WEB, p)).toString("base64")}`;

const CARDS = [
  { out: "public/og.png", l1: "Thirteen coding agents.", l2: "One calm place.", poster: "public/demo/desk-hero.webp", kind: "desk" },
  { out: "public/og/download.png", l1: "Download NeuralAgent.", l2: "Free and open source.", poster: "public/demo/desk-agents.webp", kind: "desk" },
  { out: "public/og/changelog.png", l1: "What is new", l2: "in NeuralAgent.", poster: "public/demo/desk-team.webp", kind: "desk" },
  { out: "public/og/app.png", l1: "Your agents,", l2: "from any screen.", poster: "public/demo/phone-hero.webp", kind: "phone" },
];

const html = (c) => `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "DM Sans Variable"; font-weight: 100 1000; src: url("${url("src/site/fonts/dm-sans-latin-opsz-normal.woff2")}") format("woff2-variations"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; src: url("${url("src/site/fonts/ibm-plex-mono-latin-400-normal.woff2")}") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; position: relative; background: #080909; color: #eef1ee; font-family: "DM Sans Variable", system-ui, sans-serif; font-optical-sizing: auto; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(to right, rgba(238,241,238,.045) 1px, transparent 1px); background-size: 80px 100%; background-position: 72px 0; mask-image: linear-gradient(to bottom, #000, transparent 85%); }
.brand { position: absolute; left: 72px; top: 64px; display: flex; align-items: center; gap: 14px; font-size: 28px; font-weight: 520; letter-spacing: -0.02em; }
.brand svg { width: 36px; height: 36px; }
.h { position: absolute; left: 72px; top: 196px; width: 540px; font-size: 76px; line-height: 1.02; font-weight: 500; letter-spacing: -0.04em; font-variation-settings: "opsz" 40; }
.h span { display: block; }
.url { position: absolute; left: 72px; bottom: 58px; font: 400 24px/1 "IBM Plex Mono", monospace; color: #7d817e; letter-spacing: -0.01em; }
.shot { position: absolute; border: 1.5px solid rgba(238,241,238,.16); border-radius: 18px; overflow: hidden; background: #0d0f0e; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
.shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
.desk .shot { left: 640px; top: 150px; width: 760px; height: 475px; }
.phone .shot { left: 770px; top: 70px; width: 300px; height: 649px; border-radius: 36px; }
.phone .shot2 { left: 1090px; top: 150px; }
</style>
<div class="grid"></div>
<div class="brand"><svg viewBox="0 0 64 64" fill="#eef1ee"><rect x="8" y="8" width="10" height="48" rx="3"/><rect x="46" y="8" width="10" height="48" rx="3"/><rect x="20" y="9" width="12" height="14" rx="3"/><rect x="26" y="25" width="12" height="14" rx="3" fill="#b9d3ff"/><rect x="32" y="41" width="12" height="14" rx="3"/></svg>NeuralAgent</div>
<div class="h"><span>${c.l1}</span><span>${c.l2}</span></div>
<div class="url">agent.neuralhub.dev</div>
<div class="${c.kind}"><div class="shot"><img src="${url(c.poster)}"></div>${c.kind === "phone" ? `<div class="shot shot2"><img src="${url("public/demo/phone-grid.webp")}"></div>` : ""}</div>`;

const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const c of CARDS) {
  const out = resolve(WEB, c.out);
  mkdirSync(dirname(out), { recursive: true });
  const tmp = resolve(tmpdir(), "na-og-card.html");
  writeFileSync(tmp, html(c));
  await p.goto(pathToFileURL(tmp).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: out, type: "png" });
  rmSync(tmp);
  console.log(c.out, Math.round(statSync(out).size / 1024) + " KB");
}
await br.close();
