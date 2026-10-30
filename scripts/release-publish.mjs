#!/usr/bin/env node
// Release CI: uploads every collected file to the relay and then publishes the merged manifest.
// Until the manifest is published nobody sees the release; the relay then drops all but the
// newest three.
//   RELEASE_UPLOAD_TOKEN=… node scripts/release-publish.mjs <dir with part-*.json> [<relay url>]
import { openAsBlob, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRelease, readChangelog, releaseMarkdown } from "./changelog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const [dir, base = "https://agent.neuralhub.dev"] = process.argv.slice(2);
const token = process.env.RELEASE_UPLOAD_TOKEN;
if (!dir || !token) {
  console.error("usage: RELEASE_UPLOAD_TOKEN=… node scripts/release-publish.mjs <dir> [<relay url>]");
  process.exit(1);
}
const version = readFileSync(join(root, "Cargo.toml"), "utf8").match(/\[workspace\.package\][^[]*?\nversion = "([^"]+)"/)[1];
const auth = { authorization: `Bearer ${token}` };

// Notes: this version's CHANGELOG.md section. Fallback for tags cut before CHANGELOG.md existed
// (≤ 0.2.1): the tagged commit's message (RELEASE_NOTES), without trailers.
const section = findRelease(readChangelog(), version);
const notes = section ? releaseMarkdown(section) : (process.env.RELEASE_NOTES ?? "").replace(/\n[\w-]+: .*$/gm, "").trim();
if (!section) console.warn(`CHANGELOG.md has no section for ${version}; using the commit message as notes`);
const manifest = { version, notes, pub_date: new Date().toISOString(), updates: {}, downloads: {} };
for (const f of readdirSync(dir).filter((f) => /^part-.*\.json$/.test(f))) {
  const part = JSON.parse(readFileSync(join(dir, f), "utf8"));
  Object.assign(manifest.updates, part.updates);
  Object.assign(manifest.downloads, part.downloads);
}
const files = new Set([...Object.values(manifest.updates).map((u) => u.file), ...Object.values(manifest.downloads)]);
if (files.size === 0) throw new Error("nothing to publish");

async function check(res, what) {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
}
for (const file of files) {
  const body = await openAsBlob(join(dir, file));
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}/api/releases/${version}/files/${file}`, { method: "PUT", headers: auth, body, duplex: "half" });
      await check(res, `upload ${file}`);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`${e.message}; retrying`);
    }
  }
  console.log(`uploaded ${file} (${(body.size / 1048576).toFixed(1)} MiB)`);
}
const res = await fetch(`${base}/api/releases/${version}/publish`, {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify(manifest),
});
await check(res, "publish");
console.log(`published ${version}: ${Object.keys(manifest.updates).join(", ")} | ${Object.keys(manifest.downloads).join(", ")}`);
