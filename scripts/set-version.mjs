#!/usr/bin/env node
// Sets the release version everywhere it lives: the Cargo workspace (daemon, desktop app, relay;
// Tauri reads it from the crate) and the Android app. Then refreshes Cargo.lock.
//   node scripts/set-version.mjs 0.2.0
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version ?? "")) {
  console.error("usage: node scripts/set-version.mjs <major.minor.patch[-pre]>");
  process.exit(1);
}

const cargo = `${root}/Cargo.toml`;
const toml = readFileSync(cargo, "utf8");
const bumped = toml.replace(/(\[workspace\.package\][^[]*?\nversion = )"[^"]*"/, `$1"${version}"`);
if (bumped === toml && !toml.includes(`version = "${version}"`)) throw new Error("workspace version not found");
writeFileSync(cargo, bumped);

const android = `${root}/apps/android/package.json`;
const pkg = JSON.parse(readFileSync(android, "utf8"));
pkg.version = version;
writeFileSync(android, `${JSON.stringify(pkg, null, 2)}\n`);

execFileSync("cargo", ["update", "--workspace", "--offline"], { cwd: root, stdio: "inherit" });
console.log(`version ${version}`);
