#!/usr/bin/env node
// CHANGELOG.md as data. Used by the web build (changelog.json + the /changelog page), the release
// scripts (manifest notes, "is there a section for this version?") and set-version.mjs.
//
//   node scripts/changelog.mjs json            all versions as JSON (stdout)
//   node scripts/changelog.mjs notes <version> that version's section as Markdown (stdout)
//   node scripts/changelog.mjs check <version> exit 1 unless the version has a section with entries
//   node scripts/changelog.mjs cut <version> [YYYY-MM-DD]
//                                              turn "Unreleased" into <version> (today by default)
//                                              and start a new, empty "Unreleased"
//
// Format (Keep a Changelog): `## [x.y.z] - YYYY-MM-DD` or `## [Unreleased]`, an optional summary
// paragraph, then `### New` / `### Improved` / `### Fixed` with `- ` items (continuation lines
// indented). Items may use **bold**, `code` and [links](https://…).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CHANGELOG = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
export const GROUPS = ["New", "Improved", "Fixed"];
const HEAD = /^## \[([^\]]+)\](?:\s*[-–—]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

/**
 * @typedef {{ title: string, items: string[] }} Group
 * @typedef {{ version: string, date: string | null, unreleased: boolean, summary: string, groups: Group[] }} Release
 * @param {string} text
 * @returns {Release[]} newest first, as in the file
 */
export function parseChangelog(text) {
  /** @type {Release[]} */
  const out = [];
  /** @type {Release | null} */
  let rel = null;
  /** @type {Group | null} */
  let group = null;
  const summary = [];
  const flush = () => {
    if (rel) rel.summary = summary.join(" ").trim();
    summary.length = 0;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h = HEAD.exec(line);
    if (h) {
      flush();
      const unreleased = h[1].toLowerCase() === "unreleased";
      rel = { version: unreleased ? "Unreleased" : h[1], date: h[2] ?? null, unreleased, summary: "", groups: [] };
      group = null;
      out.push(rel);
      continue;
    }
    if (!rel) continue; // preamble
    if (line.startsWith("## ")) throw new Error(`changelog: bad version heading "${line}" (want "## [x.y.z] - YYYY-MM-DD")`);
    const g = /^### (.+)$/.exec(line);
    if (g) {
      group = { title: g[1].trim(), items: [] };
      rel.groups.push(group);
      continue;
    }
    if (/^- /.test(line)) {
      if (!group) throw new Error(`changelog: item outside a group in ${rel.version}: "${line}"`);
      group.items.push(line.slice(2).trim());
    } else if (/^\s+\S/.test(line) && group?.items.length) {
      group.items[group.items.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() && !group) {
      summary.push(line.trim());
    }
  }
  flush();
  for (const r of out) r.groups = r.groups.filter((g) => g.items.length);
  return out;
}

export const readChangelog = (path = CHANGELOG) => parseChangelog(readFileSync(path, "utf8"));

/** The section of `version` (not "Unreleased"), or null. */
export const findRelease = (releases, version) => releases.find((r) => !r.unreleased && r.version === version) ?? null;

/** A release as Markdown (manifest notes, GitHub release text). */
export function releaseMarkdown(r) {
  const parts = [];
  if (r.summary) parts.push(r.summary);
  for (const g of r.groups) parts.push(`### ${g.title}\n${g.items.map((i) => `- ${i}`).join("\n")}`);
  return parts.join("\n\n");
}

/** CHANGELOG.md text with "Unreleased" renamed to `version` and a new empty "Unreleased" above it. */
export function cutRelease(text, version, date) {
  const releases = parseChangelog(text);
  if (findRelease(releases, version)) throw new Error(`CHANGELOG.md already has a section for ${version}`);
  const next = releases.find((r) => r.unreleased);
  if (!next || next.groups.length === 0) throw new Error(`CHANGELOG.md has no entries under "## [Unreleased]" to release as ${version}`);
  return text.replace(/^## \[Unreleased\][^\n]*$/im, `## [Unreleased]\n\n## [${version}] - ${date}`);
}

const today = () => new Date().toISOString().slice(0, 10);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, version, date] = process.argv.slice(2);
  const fail = (msg) => {
    console.error(msg);
    process.exit(1);
  };
  const releases = readChangelog();
  if (cmd === "json") {
    console.log(JSON.stringify({ versions: releases }, null, 2));
  } else if (cmd === "notes" || cmd === "check") {
    if (!version) fail(`usage: node scripts/changelog.mjs ${cmd} <version>`);
    const r = findRelease(releases, version);
    if (!r || r.groups.length === 0) fail(`CHANGELOG.md has no entries for ${version}. Write them first (docs/RELEASING.md).`);
    if (cmd === "notes") console.log(releaseMarkdown(r));
    else console.log(`changelog ok: ${version} (${r.date ?? "no date"}, ${r.groups.map((g) => `${g.items.length} ${g.title.toLowerCase()}`).join(", ")})`);
  } else if (cmd === "cut") {
    if (!version) fail("usage: node scripts/changelog.mjs cut <version> [YYYY-MM-DD]");
    try {
      writeFileSync(CHANGELOG, cutRelease(readFileSync(CHANGELOG, "utf8"), version, date ?? today()));
    } catch (e) {
      fail(e.message);
    }
    console.log(`CHANGELOG.md: Unreleased is now ${version}`);
  } else {
    fail("usage: node scripts/changelog.mjs json | notes <version> | check <version> | cut <version> [date]");
  }
}
