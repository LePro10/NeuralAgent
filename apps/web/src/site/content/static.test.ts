// Run: node --experimental-strip-types --test apps/web/src/site/content/static.test.ts
// (the web package's `test` glob covers src/demo only; add src/site/**/*.test.ts to run this in CI).
// Guards the static HTML a crawler or a no-JS visitor sees, and the internal links of the marketing pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { INDEX, synced } from "./sync-static.ts";
import { FAQ, plain } from "./faq.ts";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(INDEX, "utf8");

test("index.html FAQPage JSON-LD and noscript match faq.ts (run sync-static.ts to fix)", () => {
  assert.equal(html, synced(html));
});

test("FAQPage JSON-LD lists every FAQ entry with plain text answers", () => {
  const m = /<script type="application\/ld\+json">\s*(\{"@context":"https:\/\/schema\.org","@type":"FAQPage".*?\})\s*<\/script>/s.exec(html);
  assert.ok(m, "static FAQPage block missing");
  const ld = JSON.parse(m[1]);
  assert.equal(ld.mainEntity.length, FAQ.length);
  ld.mainEntity.forEach((q: { name: string; acceptedAnswer: { text: string } }, i: number) => {
    assert.equal(q.name, FAQ[i]!.q);
    assert.equal(q.acceptedAnswer.text, plain(FAQ[i]!.a));
    assert.ok(!/[`[\]]/.test(q.acceptedAnswer.text), "markup left in answer " + i);
  });
});

test("SoftwareApplication JSON-LD says what it costs and where to get it", () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">\s*(\{.*?\})\s*<\/script>/gs)].map((m) => JSON.parse(m[1]!));
  const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
  assert.ok(app, "SoftwareApplication missing");
  assert.equal(app.offers.price, "0");
  assert.match(app.downloadUrl, /^https:\/\/agent\.neuralhub\.dev\/download\/$/);
  assert.match(app.operatingSystem, /iOS/);
});

test("the no-JS page has an h1 and every FAQ question", () => {
  const ns = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? "";
  assert.match(ns, /<h1[^>]*>[^<]+<\/h1>/);
  for (const f of FAQ) assert.ok(ns.includes(f.q.replace(/&/g, "&amp;")), "missing in noscript: " + f.q);
});

/** Every file under site/ and the landing/brand entry files. */
function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = dir + "/" + n;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx?|css)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

test("internal page links use the trailing-slash form (the relay answers the bare form with a 307)", () => {
  const bad: string[] = [];
  for (const f of [...files(SITE), SITE + "../brand.tsx"]) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/["'`](\/(?:download|changelog|imprint|privacy|terms|demo|app|session))(["'`#?])/g)) bad.push(`${f.replace(SITE, "site/")}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("every aria-labelledby of a Section points at a heading id that exists in the sections", () => {
  const dir = SITE + "sections/";
  const src = readdirSync(dir).filter((n) => n.endsWith(".tsx")).map((n) => readFileSync(dir + n, "utf8")).join("\n");
  const ids = new Set([...src.matchAll(/\bid="([a-z0-9-]+-h)"/g)].map((m) => m[1]));
  // Section.tsx gives the first h1/h2 the id at runtime when a call site forgot it (the hero headline), so no region is unnamed.
  const fallback = /querySelector\("h1, h2"\)/.test(readFileSync(SITE + "ui/Section.tsx", "utf8"));
  for (const m of src.matchAll(/labelledBy="([a-z0-9-]+)"/g)) assert.ok(ids.has(m[1]!) || fallback, `labelledBy="${m[1]}" has no heading with that id`);
});
