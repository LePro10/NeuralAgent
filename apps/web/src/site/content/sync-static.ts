// Keeps the static parts of apps/web/index.html in step with content/faq.ts: the FAQPage JSON-LD and the no-JS content.
//   node --experimental-strip-types apps/web/src/site/content/sync-static.ts           rewrite index.html
//   node --experimental-strip-types apps/web/src/site/content/sync-static.ts --check   exit 1 when index.html is out of date
// The same functions are used by static.test.ts, so the test and the script cannot disagree.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FAQ, plain } from "./faq.ts";

export const INDEX = fileURLToPath(new URL("../../../index.html", import.meta.url));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

/** `code` and [text](href) in an answer, as HTML. Hash links point at the landing page itself, so they get an absolute path. */
export function richHtml(text: string): string {
  return text
    .split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g)
    .map((p) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
      if (link) return `<a href="${esc(link[2]!.startsWith("#") ? "/" + link[2] : link[2]!)}">${esc(link[1]!)}</a>`;
      if (p.startsWith("`")) return `<code>${esc(p.slice(1, -1))}</code>`;
      return esc(p);
    })
    .join("");
}

export function faqJsonLd(): string {
  return `<script type="application/ld+json">\n      ${json({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: plain(f.a) } })),
  })}\n    </script>`;
}

// The noscript page has no stylesheet, so it carries the dark ground's colours inline.
const INK = "#eef1ee", TEXT = "#c6c9c6", LINK = "#b9d3ff"; // token-ok: static page without CSS tokens

export function noscriptBlock(): string {
  const qa = FAQ.map((f) => `        <h3 style="margin:24px 0 4px;font-size:18px;color:${INK}">${esc(f.q)}</h3>\n        <p style="margin:0">${richHtml(f.a)}</p>`).join("\n");
  return `<noscript>
      <main style="max-width:46rem;margin:0 auto;padding:40px 24px 64px;color:${TEXT};font:17px/1.6 system-ui,sans-serif">
        <h1 style="margin:0 0 12px;font-size:34px;line-height:1.15;color:${INK}">Thirteen coding agents. One calm place.</h1>
        <p style="margin:0 0 16px">NeuralAgent runs Claude Code, Codex and eleven more coding agents side by side on your own computer. Talk to Neural, hand work to a team, and answer your agents from your phone, end-to-end encrypted. Open source, for macOS, Windows, Linux and Android.</p>
        <p style="margin:0 0 32px"><a href="/download/" style="color:${LINK}">Download</a> · <a href="/demo/" style="color:${LINK}">Live demo</a> · <a href="/changelog/" style="color:${LINK}">Changelog</a> · <a href="/privacy/" style="color:${LINK}">Privacy</a> · <a href="https://github.com/LePro10/NeuralAgent" style="color:${LINK}">GitHub</a></p>
        <h2 style="margin:0;font-size:24px;color:${INK}">Questions</h2>
${qa}
      </main>
    </noscript>`;
}

const BLOCKS: [string, () => string][] = [
  ["faq-jsonld", faqJsonLd],
  ["noscript", noscriptBlock],
];

/** index.html with every `<!-- static:NAME:start -->…<!-- static:NAME:end -->` region regenerated. */
export function synced(html: string): string {
  let out = html;
  for (const [name, make] of BLOCKS) {
    const re = new RegExp(`(<!-- static:${name}:start -->)[\\s\\S]*?(<!-- static:${name}:end -->)`);
    if (!re.test(out)) throw new Error(`index.html has no static:${name} markers`);
    out = out.replace(re, (_, a, b) => `${a}\n    ${make()}\n    ${b}`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cur = readFileSync(INDEX, "utf8");
  const next = synced(cur);
  if (process.argv.includes("--check")) {
    if (next !== cur) {
      console.error("apps/web/index.html is out of date with content/faq.ts. Run: node --experimental-strip-types apps/web/src/site/content/sync-static.ts");
      process.exit(1);
    }
    console.log("index.html is in step with faq.ts");
  } else if (next !== cur) {
    writeFileSync(INDEX, next);
    console.log("index.html updated");
  } else console.log("index.html already up to date");
}
