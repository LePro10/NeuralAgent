import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, inlineParts, notesBetween, notesFromMarkdown } from "./changelog.ts";

const entry = (version: string, unreleased = false) => ({ version, date: "2026-10-30", unreleased, summary: "", groups: [{ title: "Fixed", items: [version] }] });

test("compareVersions orders numbers and pre-releases", () => {
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
  assert.ok(compareVersions("1.0.0-beta.1", "1.0.0") < 0);
  assert.equal(compareVersions("v0.2.1", "0.2.1"), 0);
});

test("notesBetween keeps versions after current up to target, newest first", () => {
  const all = [entry("Unreleased", true), entry("0.3.0"), entry("0.2.1"), entry("0.2.0"), entry("0.1.2")];
  assert.deepEqual(notesBetween(all, "0.2.0", "0.3.0").map((e) => e.version), ["0.3.0", "0.2.1"]);
  assert.deepEqual(notesBetween(all, "0.3.0", "0.3.0"), []);
});

test("notesFromMarkdown reads the manifest notes", () => {
  const e = notesFromMarkdown("0.3.0", "Big one.\n\n### New\n- A **thing**\n  more\n### Fixed\n- Bug");
  assert.equal(e?.summary, "Big one.");
  assert.deepEqual(e?.groups, [{ title: "New", items: ["A **thing** more"] }, { title: "Fixed", items: ["Bug"] }]);
  assert.equal(notesFromMarkdown("1.0.0", "  "), null);
  assert.deepEqual(notesFromMarkdown("1.0.0", "Fix remote access (0.2.1)")?.summary, "Fix remote access (0.2.1)");
});

test("inlineParts splits bold, code and links", () => {
  assert.deepEqual(inlineParts("a **b** `c` [d](https://e.f) g"), [
    { t: "text", s: "a " }, { t: "b", s: "b" }, { t: "text", s: " " }, { t: "code", s: "c" }, { t: "text", s: " " },
    { t: "link", s: "d", href: "https://e.f" }, { t: "text", s: " g" },
  ]);
});
