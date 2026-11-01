// Regenerates every web / PWA / Discord icon from one master geometry (OG cards: scripts/dev/site-og.mjs).
// Usage (from the repo root):
//   PW=/path/to/node_modules/playwright-core/index.mjs node docs/brand/build-web-icons.mjs
// Needs playwright-core with a Chromium build installed (npx playwright install chromium).
// Optional: pngquant + oxipng on PATH (brew install pngquant oxipng) shrink the PNGs.
// See docs/brand/README.md ("Web icon pipeline").
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const pub = join(root, "apps/web/public");
const { chromium } = await import(process.env.PW ?? "playwright-core");

// ── Brand ────────────────────────────────────────────────────────────────
const C = { bg: "#080909", top: "#1c1f1e", mid: "#0d0f0e", ink: "#eef1ee", accent: "#b9d3ff", deep: "#3b5bff" };
// The pane-built "N" from neuralagent-icon.svg, in its 64-unit space (bbox 8..56).
const RECTS = [
  [8, 8, 10, 48], [46, 8, 10, 48],
  [20, 9, 12, 14], [26, 25, 12, 14, "accent"], [32, 41, 12, 14],
];

/** The mark with its bbox placed at (x, y) and `size` wide. */
function mark(x, y, size, ink = C.ink, accent = C.accent) {
  const s = size / 48;
  const r = RECTS.map(([rx, ry, w, h, a]) => `<rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="3"${a ? ` fill="${accent}"` : ""}/>`).join("");
  return `<g transform="translate(${+(x - 8 * s).toFixed(3)} ${+(y - 8 * s).toFixed(3)}) scale(${+s.toFixed(5)})" fill="${ink}">${r}</g>`;
}

/** Superellipse (n = 5, same curve as the 1024 master) centred at c with half-size r. */
function squircle(c, r, steps = 72) {
  const p = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps, co = Math.cos(t), si = Math.sin(t);
    const x = c + r * Math.sign(co) * Math.abs(co) ** 0.4, y = c + r * Math.sign(si) * Math.abs(si) ** 0.4;
    p.push(`${+x.toFixed(2)} ${+y.toFixed(2)}`);
  }
  return `M${p.join("L")}Z`;
}

const grad = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.top}"/><stop offset=".45" stop-color="${C.mid}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>`;
const svg = (w, body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}" width="${w}" height="${w}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;

/** Transparent canvas, squircle tile with `pad` margin, hairline rim, mark `markPct` of the canvas. */
function tile(w, pad, markPct) {
  const r = w / 2 - pad, path = squircle(w / 2, r), m = w * markPct;
  return svg(w, `<path d="${path}" fill="url(#g)"/><path d="${path}" fill="none" stroke="${C.ink}" stroke-opacity=".16" stroke-width="${(w / 64).toFixed(2)}"/>${mark((w - m) / 2, (w - m) / 2, m)}`, grad("g"));
}
/** Opaque full-bleed square (iOS, maskable, Discord crop it themselves). */
function bleed(w, markPct, glow = false) {
  const m = w * markPct;
  const g = glow ? `<rect width="${w}" height="${w}" fill="url(#h)"/>` : "";
  const defs = grad("g") + (glow ? `<radialGradient id="h" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="${C.deep}" stop-opacity=".22"/><stop offset="1" stop-color="${C.deep}" stop-opacity="0"/></radialGradient>` : "");
  return svg(w, `<rect width="${w}" height="${w}" fill="url(#g)"/>${g}${mark((w - m) / 2, (w - m) / 2, m)}`, defs);
}
/** 128 px Discord status badge: coloured disc + one glyph that still reads at 20 px. */
function badge(fill, glyph) {
  return svg(128, `<circle cx="64" cy="64" r="64" fill="${fill}"/>${glyph}`);
}
const GLYPH = {
  working: `<path d="M50 38 L94 64 L50 90 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>`,
  waiting: `<rect x="56" y="26" width="16" height="50" rx="8" fill="#1d1406"/><circle cx="64" cy="96" r="9.5" fill="#1d1406"/>`,
  idle: `<defs><mask id="m"><rect width="128" height="128" fill="#fff"/><circle cx="80" cy="46" r="30" fill="#000"/></mask></defs><circle cx="64" cy="66" r="36" fill="${C.ink}" mask="url(#m)"/>`,
};

// ── Render helpers ───────────────────────────────────────────────────────
const browser = await chromium.launch();
async function shot(html, w, h, out, transparent = true) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  return out;
}
function optimise(file, lossy = true) {
  try { if (lossy) execFileSync("pngquant", ["--force", "--skip-if-larger", "--quality=80-98", "--speed=1", "--strip", "--ext", ".png", file]); } catch {}
  try { execFileSync("oxipng", ["-o", "4", "--strip", "safe", "-q", file]); } catch {}
}
/** ICO with PNG-compressed entries (supported by every browser since IE 11 / Vista). */
function ico(pngs, out) {
  const bufs = pngs.map((f) => readFileSync(f));
  const head = Buffer.alloc(6 + 16 * bufs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(bufs.length, 4);
  let off = head.length;
  bufs.forEach((b, i) => {
    const w = b.readUInt32BE(16), e = 6 + 16 * i;
    head.writeUInt8(w >= 256 ? 0 : w, e); head.writeUInt8(w >= 256 ? 0 : w, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += b.length;
  });
  writeFileSync(out, Buffer.concat([head, ...bufs]));
}

// ── Favicons ─────────────────────────────────────────────────────────────
// SVG favicon: full-bleed squircle tile so it reads on light and dark tab bars.
const fav = tile(64, 0, 0.78).replace(` width="64" height="64"`, "");
writeFileSync(join(pub, "favicon.svg"), fav + "\n");
const tmp = join(root, "research-local/polish/icon-build");
mkdirSync(tmp, { recursive: true });
const icoParts = [];
for (const s of [16, 32, 48]) {
  const f = await shot(tile(s, 0, 0.78), s, s, join(tmp, `fav-${s}.png`));
  optimise(f, false);
  icoParts.push(f);
}
ico(icoParts, join(pub, "favicon.ico"));
writeFileSync(join(pub, "favicon-32.png"), readFileSync(icoParts[1]));

// ── Touch / PWA / logo ───────────────────────────────────────────────────
const out = [
  [bleed(180, 0.5), 180, join(pub, "apple-touch-icon.png"), false],
  [tile(192, 8, 0.44), 192, join(pub, "app/icon-192.png"), true],
  [tile(512, 20, 0.44), 512, join(pub, "app/icon-512.png"), true],
  [tile(512, 20, 0.44), 512, join(pub, "logo.png"), true],
  [bleed(512, 0.42), 512, join(pub, "app/icon-maskable-512.png"), false],
  // Discord Rich Presence: Discord rounds the large image itself, so it is opaque and full-bleed.
  [bleed(512, 0.5, true), 512, join(pub, "discord/logo-512.png"), false],
  [badge(C.deep, GLYPH.working), 128, join(pub, "discord/small-working.png"), true],
  [badge("#ffb454", GLYPH.waiting), 128, join(pub, "discord/small-waiting.png"), true],
  [badge("#5d6560", GLYPH.idle), 128, join(pub, "discord/small-idle.png"), true],
];
for (const [s, w, f, t] of out) optimise(await shot(s, w, w, f, t));

// The Open Graph cards (public/og.png, public/og/*.png) are made by scripts/dev/site-og.mjs from
// the demo posters, in the website's own look.
await browser.close();
console.log("done");
