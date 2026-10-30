// Generates docs/CODEMAP.md: one line per code file with its purpose (first doc comment) and its
// main types, functions and exports, so agents can find the right file without a full scan.
//
//   node scripts/codemap.mjs            write docs/CODEMAP.md
//   node scripts/codemap.mjs --check    exit 1 if docs/CODEMAP.md is out of date (date line ignored)
//
// Files come from git (tracked + untracked, not ignored), so node_modules, target, dist and
// research-local never appear. Same layout as the owner's global `codemap` skill.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/CODEMAP.md");
const EXT = new Set([".rs", ".ts", ".tsx", ".mjs", ".mts", ".js", ".java", ".kt", ".swift", ".sh"]);
// Generated or vendored code: listed as one line per folder instead of per file.
const COLLAPSE = ["packages/protocol/src/gen/"];
const SKIP = [/\.d\.ts$/, /\.min\.js$/, /^apps\/android\/android\/app\/src\/main\/assets\//];
const MAX_ITEMS = 14;
const MAX_DESC = 110;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && EXT.has(extname(f)) && !SKIP.some((r) => r.test(f)) && existsSync(join(ROOT, f)));

/** First doc/comment line at the top of a file (module docs, header comments). */
function purpose(lines, ext) {
  for (const raw of lines.slice(0, 25)) {
    const l = raw.trim();
    if (!l || l.startsWith("#!") || l.startsWith("import ") || l.startsWith("use ") || l === "/**" || l.startsWith("#![") || l.startsWith("@")) continue;
    let m;
    if (ext === ".rs" && (m = l.match(/^\/\/!\s?(.*)/))) return m[1];
    if ((m = l.match(/^(?:\/\/\/?|\/\*\*?|\*|#)\s?(.*?)(?:\*\/)?$/)) && m[1] && !/^(eslint|@ts-|prettier|biome|SPDX|set -e)/.test(m[1])) return m[1];
    if (ext !== ".rs") break;
    if (!l.startsWith("//")) break;
  }
  return "";
}

const rsItem = /^pub(?:\((?:crate|super)\))?\s+(?:async\s+)?(?:unsafe\s+)?(struct|enum|trait|fn|type|const|static|mod)\s+(\w+)/;
const rsImpl = /^impl(?:<[^>]*>)?\s+(?:(\w+)(?:<[^>]*>)?\s+for\s+)?(\w+)/;
const tsItem = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|const|let|class|interface|type|enum|abstract class)\s+(\w+)/;
const tsList = /^export\s*\{([^}]*)\}/;
const javaItem = /^\s*(?:public\s+|protected\s+)?(?:static\s+|final\s+|abstract\s+)*(class|interface|enum|record|object)\s+(\w+)/;
const javaMethod = /^\s*(?:@\w+\s+)*(?:public|protected)\s+(?:static\s+|final\s+|synchronized\s+)*[\w<>\[\],.? ]+\s+(\w+)\s*\(/;
const kotlinFun = /^\s*(?:override\s+)?fun\s+(\w+)/;
const swiftItem = /^(?:public\s+)?(class|struct|enum|func)\s+(\w+)/;
const shFn = /^(\w+)\s*\(\)\s*\{/;

function items(lines, ext) {
  const out = [];
  const push = (s) => !out.includes(s) && out.push(s);
  for (const l of lines) {
    let m;
    if (ext === ".rs") {
      if ((m = l.match(rsItem))) push(m[1] === "fn" ? `${m[2]}()` : `${m[1]} ${m[2]}`);
      else if ((m = l.match(rsImpl)) && m[1]) push(`impl ${m[1]} for ${m[2]}`);
    } else if ([".ts", ".tsx", ".mjs", ".mts", ".js"].includes(ext)) {
      if ((m = l.match(tsItem))) push(m[1].startsWith("function") ? `${m[2]}()` : m[1] === "const" || m[1] === "let" ? m[2] : `${m[1].replace("abstract ", "")} ${m[2]}`);
      else if ((m = l.match(tsList))) for (const n of m[1].split(",")) { const k = n.trim().split(/\s+as\s+/).pop(); if (k && !k.startsWith("type ")) push(k); }
    } else if (ext === ".java" || ext === ".kt") {
      if ((m = l.match(javaItem))) push(`${m[1]} ${m[2]}`);
      else if (ext === ".java" && (m = l.match(javaMethod)) && !["if", "for", "while", "switch", "return", "new"].includes(m[1])) push(`${m[1]}()`);
      else if (ext === ".kt" && (m = l.match(kotlinFun))) push(`${m[1]}()`);
    } else if (ext === ".swift") {
      if ((m = l.match(swiftItem))) push(m[1] === "func" ? `${m[2]}()` : `${m[1]} ${m[2]}`);
    } else if (ext === ".sh") {
      if ((m = l.match(shFn))) push(`${m[1]}()`);
    }
  }
  return out;
}

const groups = new Map();
const collapsed = new Map();
for (const f of files.sort()) {
  const c = COLLAPSE.find((p) => f.startsWith(p));
  if (c) { collapsed.set(c, (collapsed.get(c) ?? 0) + 1); continue; }
  const path = join(ROOT, f);
  if (statSync(path).size > 600_000) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  const ext = extname(f);
  const desc = purpose(lines, ext).replace(/\s+/g, " ").trim();
  const its = items(lines, ext);
  const more = its.length > MAX_ITEMS ? ` +${its.length - MAX_ITEMS}` : "";
  const parts = [];
  if (desc) parts.push(desc.length > MAX_DESC ? `${desc.slice(0, MAX_DESC - 1)}…` : desc);
  if (its.length) parts.push(`\`${its.slice(0, MAX_ITEMS).join(", ")}\`${more}`);
  const dir = dirname(f);
  if (!groups.has(dir)) groups.set(dir, []);
  groups.get(dir).push(`- **${basename(f)}** (${lines.length})${parts.length ? ` — ${parts.join(" · ")}` : ""}`);
}

const today = new Date().toISOString().slice(0, 10);
const out = [
  "# CODEMAP – NeuralAgent",
  "",
  `Generated ${today} by \`node scripts/codemap.mjs\` (${files.length} files). Do not edit by hand; regenerate after adding,`,
  "renaming or deleting files. Per file: (lines) — purpose (first doc comment) · main types/functions/exports.",
  "Look here first, then read only the files you need (Grep this file instead of reading it whole).",
  "",
];
for (const [c, n] of collapsed) out.push(`Generated, not listed: \`${c}\` (${n} files, from \`crates/na-protocol\` via \`cargo test\`).`, "");
for (const dir of [...groups.keys()].sort()) out.push(`## ${dir}/`, ...groups.get(dir), "");
const text = out.join("\n");

if (process.argv.includes("--check")) {
  const strip = (s) => s.replace(/^Generated \d{4}-\d{2}-\d{2} /m, "Generated ");
  const old = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (strip(old) !== strip(text)) {
    console.error("docs/CODEMAP.md is out of date: run node scripts/codemap.mjs");
    process.exit(1);
  }
  console.log("docs/CODEMAP.md is up to date");
} else {
  writeFileSync(OUT, text);
  console.log(`${OUT}: ${files.length} files, ${text.length} chars (~${Math.round(text.length / 4)} tokens)`);
}
