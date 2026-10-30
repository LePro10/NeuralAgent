// Docs guard: keeps the agent-facing docs pointing at things that exist.
//
//   node scripts/check-docs.mjs        (pnpm check:docs; also runs in CI)
//
// Checks AGENTS.md, CLAUDE.md, README.md, docs/**/*.md, .claude/skills/**/SKILL.md and
// scripts/**/README.md:
//   - relative markdown links [x](path) resolve to a file or folder,
//   - repo paths in backticks (`apps/…`, `packages/…`, `crates/…`, `scripts/…`, `docs/…`, …) exist
//     (globs and placeholders like <x> or … are skipped; {a,b} is expanded),
//   - no pointers to the old /tmp test kits (they live in scripts/dev now),
//   - CHANGELOG.md has a `## [Unreleased]` section.
// Warns (does not fail) when docs/CODEMAP.md is out of date.
// docs/archive/ is history: only its links are checked.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

function walk(dir, keep) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

const docs = [
  ...["AGENTS.md", "CLAUDE.md", "README.md", "CHANGELOG.md"].map((f) => join(ROOT, f)),
  ...walk(join(ROOT, "docs"), (p) => p.endsWith(".md")),
  ...walk(join(ROOT, ".claude/skills"), (p) => p.endsWith("SKILL.md")),
  ...walk(join(ROOT, "scripts"), (p) => p.endsWith("README.md")),
].filter(existsSync);

const PATH_ROOTS = /^(apps|packages|crates|scripts|docs|deploy|\.github|\.claude)\//;
const ROOT_FILES = /^(AGENTS|CLAUDE|README|CHANGELOG)\.md$|^(package\.json|Cargo\.toml|pnpm-workspace\.yaml|rustfmt\.toml)$/;
const OLD_KITS = /\/tmp\/na-(drive|orch|call|upd)\b|\/tmp\/na-android\/env2\.sh/;

/** {a,b}c → [ac, bc] (one level, enough for docs). */
const expand = (p) => {
  const m = p.match(/^(.*)\{([^{}]+)\}(.*)$/);
  return m ? m[2].split(",").flatMap((x) => expand(m[1] + x.trim() + m[3])) : [p];
};

for (const file of docs) {
  const rel = relative(ROOT, file);
  const archive = rel.startsWith("docs/archive/");
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  let fence = false;
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/^\s*```/.test(line)) fence = !fence;
    // Markdown links (outside code fences).
    if (!fence) {
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1];
        if (/^(https?:|mailto:|#|tel:)/.test(target)) continue;
        const path = decodeURIComponent(target.split("#")[0]);
        if (path && !existsSync(resolve(dirname(file), path))) errors.push(`${at}: broken link ${target}`);
      }
    }
    if (archive) return;
    if (OLD_KITS.test(line)) errors.push(`${at}: points to an old /tmp test kit (now scripts/dev): ${line.trim().slice(0, 100)}`);
    // Repo paths in inline code.
    if (fence) return;
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      let p = m[1].replace(/[:#]\d+(-\d+)?$/, "").replace(/[),.;]+$/, "");
      if (!(PATH_ROOTS.test(p) || ROOT_FILES.test(p))) continue;
      if (/[*<>…$]|\.\.\.|=/.test(p)) continue;
      if (/(^|\/)(dist|build|binaries)(\/|$)/.test(p)) continue; // build output, not in a fresh clone
      for (const q of expand(p)) if (!existsSync(join(ROOT, q))) errors.push(`${at}: missing path ${q}`);
    }
  });
}

// CHANGELOG: the Unreleased section must exist (set-version renames it and adds a new empty one).
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
if (!/^## \[Unreleased\]/m.test(changelog)) errors.push("CHANGELOG.md: no `## [Unreleased]` section (add one after a release)");

try {
  execFileSync(process.execPath, [join(ROOT, "scripts/codemap.mjs"), "--check"], { stdio: "pipe" });
} catch {
  warnings.push("docs/CODEMAP.md is out of date: run `pnpm codemap`");
}

for (const w of warnings) console.log(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`check-docs: ${errors.length} problem(s) in ${docs.length} files`);
  process.exit(1);
}
console.log(`check-docs: ${docs.length} files ok`);
