#!/usr/bin/env node
// Sets the release version everywhere it lives: the Cargo workspace (daemon, desktop app, relay;
// Tauri reads it from the crate) and the Android app. Then refreshes Cargo.lock.
// CHANGELOG.md must describe the version: an existing `## [x.y.z]` section is kept, otherwise
// `## [Unreleased]` becomes that version with today's date. With neither it refuses.
//   node scripts/set-version.mjs 0.2.0
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHANGELOG, cutRelease, findRelease, parseChangelog } from "./changelog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version ?? "")) {
  console.error("usage: node scripts/set-version.mjs <major.minor.patch[-pre]>");
  process.exit(1);
}

// The changelog first: nothing is changed when it has no entries for this version.
const log = readFileSync(CHANGELOG, "utf8");
const have = findRelease(parseChangelog(log), version);
if (have && have.groups.length === 0) {
  console.error(`CHANGELOG.md: the section for ${version} is empty. Write what changed first (docs/RELEASING.md).`);
  process.exit(1);
}
if (!have) {
  const date = new Date().toISOString().slice(0, 10);
  try {
    writeFileSync(CHANGELOG, cutRelease(log, version, date));
  } catch (e) {
    console.error(`${e.message}\nWrite the changes under "## [Unreleased]" first (docs/RELEASING.md).`);
    process.exit(1);
  }
  console.log(`CHANGELOG.md: Unreleased is now ${version} (${date})`);
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
