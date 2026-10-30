// node --test scripts/changelog.test.mjs (part of `pnpm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { cutRelease, findRelease, parseChangelog, readChangelog, releaseMarkdown } from "./changelog.mjs";

const SAMPLE = `# Changelog
Preamble.

## [Unreleased]

### New
- Shiny thing

## [1.2.0] - 2026-01-02

Big one.

### Improved
- Faster **start**,
  and less memory.
### Fixed
- A crash
`;

test("parses versions, summary, groups and continuation lines", () => {
  const r = parseChangelog(SAMPLE);
  assert.deepEqual(r.map((x) => [x.version, x.date, x.unreleased]), [["Unreleased", null, true], ["1.2.0", "2026-01-02", false]]);
  assert.equal(r[1].summary, "Big one.");
  assert.deepEqual(r[1].groups, [{ title: "Improved", items: ["Faster **start**, and less memory."] }, { title: "Fixed", items: ["A crash"] }]);
  assert.match(releaseMarkdown(r[1]), /^Big one\.\n\n### Improved\n- Faster/);
});

test("cut turns Unreleased into the version and refuses twice or when empty", () => {
  const cut = cutRelease(SAMPLE, "1.3.0", "2026-02-03");
  const r = parseChangelog(cut);
  assert.equal(r[0].version, "Unreleased");
  assert.equal(r[0].groups.length, 0);
  assert.deepEqual(findRelease(r, "1.3.0")?.groups, [{ title: "New", items: ["Shiny thing"] }]);
  assert.throws(() => cutRelease(cut, "1.3.0", "2026-02-03"), /already/);
  assert.throws(() => cutRelease(cut, "1.4.0", "2026-02-03"), /no entries/);
});

test("the real CHANGELOG.md parses and every release has entries", () => {
  const r = readChangelog();
  for (const x of r.filter((x) => !x.unreleased)) {
    assert.match(x.version, /^\d+\.\d+\.\d+/);
    assert.match(x.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(x.groups.length > 0, `${x.version} has entries`);
  }
});
