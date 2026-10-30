#!/usr/bin/env node
// Release CI: picks one platform's build outputs, gives them stable names and writes the part of
// the release manifest they fill (scripts/release-publish.mjs merges the parts).
//   node scripts/release-collect.mjs <target triple | android> <out dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const [target, out] = process.argv.slice(2);
if (!target || !out) {
  console.error("usage: node scripts/release-collect.mjs <target triple | android> <out dir>");
  process.exit(1);
}
const version = readFileSync(join(root, "Cargo.toml"), "utf8").match(/\[workspace\.package\][^[]*?\nversion = "([^"]+)"/)[1];
mkdirSync(out, { recursive: true });

/** The one file in `dir` ending in `suffix`. */
function find(dir, suffix) {
  const hits = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)) : [];
  if (hits.length !== 1) throw new Error(`expected one *${suffix} in ${dir}, found ${hits.length}`);
  return join(dir, hits[0]);
}

const part = { updates: {}, downloads: {} };
function take(src, name) {
  const file = `NeuralAgent_${version}_${name}`;
  copyFileSync(src, join(out, file));
  return file;
}
/** An updater bundle plus its signature (Tauri writes `<file>.sig` next to it). */
function update(platform, src, name) {
  const file = take(src, name);
  part.updates[platform] = { file, signature: readFileSync(`${src}.sig`, "utf8").trim() };
  return file;
}

const bundle = join(root, "target", target, "release", "bundle");
switch (target) {
  case "aarch64-apple-darwin":
  case "x86_64-apple-darwin": {
    const [platform, kind, label] =
      target === "aarch64-apple-darwin" ? ["darwin-aarch64", "mac", "mac-arm64"] : ["darwin-x86_64", "mac-intel", "mac-intel"];
    update(platform, find(join(bundle, "macos"), ".app.tar.gz"), `${label}.app.tar.gz`);
    part.downloads[kind] = take(find(join(bundle, "dmg"), ".dmg"), `${label}.dmg`);
    break;
  }
  case "x86_64-pc-windows-msvc":
    // The NSIS installer is both the download and the update.
    part.downloads.windows = update("windows-x86_64", find(join(bundle, "nsis"), "-setup.exe"), "windows-x64-setup.exe");
    break;
  case "x86_64-unknown-linux-gnu":
    part.downloads.linux = update("linux-x86_64", find(join(bundle, "appimage"), ".AppImage"), "linux-x86_64.AppImage");
    part.downloads["linux-deb"] = take(find(join(bundle, "deb"), ".deb"), "linux-amd64.deb");
    break;
  case "android":
    part.downloads.android = take(find(join(root, "apps/android/android/app/build/outputs/apk/release"), ".apk"), "android.apk");
    break;
  default:
    throw new Error(`unknown target ${target}`);
}
writeFileSync(join(out, `part-${target}.json`), `${JSON.stringify(part, null, 2)}\n`);
console.log(`${target}: ${[...Object.values(part.updates).map((u) => u.file), ...Object.values(part.downloads)].join(", ")}`);
