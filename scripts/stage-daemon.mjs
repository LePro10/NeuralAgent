// Copies the release daemon to where the Tauri bundle picks it up as a sidecar
// (apps/desktop/src-tauri/binaries/neuralagentd-<target triple>). Build it first:
//   cargo build --release -p na-daemon [--target <triple>]
// Usage: node scripts/stage-daemon.mjs [<triple>]   (default: this machine's)
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = execSync("rustc -vV").toString().match(/host: (\S+)/)[1];
const triple = process.argv[2] ?? host;
const exe = triple.includes("windows") ? ".exe" : "";
const src = join(root, "target", process.argv[2] ? triple : "", "release", `neuralagentd${exe}`);
const dir = join(root, "apps/desktop/src-tauri/binaries");
mkdirSync(dir, { recursive: true });
copyFileSync(src, join(dir, `neuralagentd-${triple}${exe}`));
console.log(`staged ${src} → binaries/neuralagentd-${triple}${exe}`);
