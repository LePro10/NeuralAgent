import assert from "node:assert/strict";
import { test } from "node:test";
import { RUN_GAP_MS, elapsed, feedBlocks, toLabel } from "./swarmFeed.ts";

const T = new Date(2026, 9, 30, 17, 0).getTime();
const msg = (id: string, from: string, to: string, at: number) => ({ id, from, to, text: id, at });

test("consecutive messages from one sender to one recipient form one run", () => {
  const b = feedBlocks([msg("a", "Scout", "Coordinator", T), msg("b", "Scout", "Coordinator", T + 1000), msg("c", "Builder", "Reviewer", T + 2000)]);
  assert.deepEqual(
    b.map((x) => (x.kind === "day" ? "day" : `${x.from}:${x.items.map((i) => i.id).join("")}`)),
    ["day", "Scout:ab", "Builder:c"],
  );
});

test("a new recipient or a long pause starts a new run", () => {
  const b = feedBlocks([msg("a", "Scout", "Coordinator", T), msg("b", "Scout", "Builder", T + 1000), msg("c", "Scout", "Builder", T + 1000 + RUN_GAP_MS + 1)]);
  assert.equal(b.filter((x) => x.kind === "run").length, 3);
});

test("a day label starts every day", () => {
  const b = feedBlocks([msg("a", "Scout", "all", T), msg("b", "Scout", "all", T + 86400000)]);
  assert.deepEqual(b.map((x) => x.kind), ["day", "run", "day", "run"]);
  assert.deepEqual(feedBlocks([]), []);
});

test("labels and elapsed time", () => {
  assert.equal(toLabel("all"), "everyone");
  assert.equal(toLabel("You"), "you");
  assert.equal(toLabel("Builder"), "Builder");
  assert.equal(elapsed(42_000), "42s");
  assert.equal(elapsed(12 * 60_000), "12m");
  assert.equal(elapsed(125 * 60_000), "2h 05m");
  assert.equal(elapsed(72 * 3600_000), "3d");
});
