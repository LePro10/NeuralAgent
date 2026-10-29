// Design contract check: app code uses design tokens only (packages/ui/DESIGN-CONTRACT.md).
// Flags raw colours (hex, rgb/hsl) and arbitrary Tailwind values (text-[…], rounded-[…], …)
// in our own code. The design library itself (packages/ui) is exempt.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["packages/app/src", "apps/desktop/src", "apps/web/src", "apps/mobile/src"];
const EXT = /\.(tsx?|css)$/;
const RULES = [
  { re: /#[0-9a-fA-F]{3,8}\b/g, what: "raw hex colour" },
  { re: /\b(?:rgba?|hsla?|oklch)\(/g, what: "raw colour function" },
  { re: /\b[a-z][a-z-]*-\[[^\]]+\]/g, what: "arbitrary Tailwind value" },
  { re: /\bfont-(?:bold|semibold|extrabold|black)\b/g, what: "bold weight (contract: no bold)" },
];

function* files(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (EXT.test(n)) yield p;
  }
}

let bad = 0;
for (const root of ROOTS) {
  for (const f of files(root)) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/token-ok/.test(line)) return; // explicit, reviewed exception
        const code = line.replace(/(["'`])(?:https?:|ws:|tauri:)[^"'`]*\1/g, "''");
        for (const { re, what } of RULES) {
          for (const m of code.matchAll(re)) {
            console.log(`${relative(".", f)}:${i + 1}: ${what}: ${m[0]}`);
            bad++;
          }
        }
      });
  }
}
if (bad) {
  console.log(`\n${bad} design-token violation(s).`);
  process.exit(1);
}
console.log("tokens ok");
