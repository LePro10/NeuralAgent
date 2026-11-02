import assert from "node:assert/strict";
import { test } from "node:test";
import { dictationTime, wordCount } from "./dictations.ts";

const now = new Date(2026, 10, 2, 18, 30).getTime();
const hm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

test("today shows only the time", () => {
  const at = new Date(2026, 10, 2, 18, 4).getTime();
  assert.equal(dictationTime(at, now), hm(at));
});

test("this week adds the weekday, older the date", () => {
  const week = new Date(2026, 9, 31, 9, 0).getTime();
  assert.equal(dictationTime(week, now), `${new Date(week).toLocaleDateString(undefined, { weekday: "short" })} ${hm(week)}`);
  const old = new Date(2026, 8, 1, 9, 0).getTime();
  assert.ok(dictationTime(old, now).endsWith(`, ${hm(old)}`));
});

test("counts words", () => {
  assert.equal(wordCount("  Hey  Neural, start\nClaude "), 4);
  assert.equal(wordCount(""), 0);
});
