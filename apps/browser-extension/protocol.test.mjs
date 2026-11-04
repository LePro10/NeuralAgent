import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { KeyedQueue, backoff, browserLabel, clipText, parsePairCode, withTimeout } from "./protocol.js";

test("pairing codes", () => {
  assert.deepEqual(parsePairCode(" NA-4455-AB12CD "), { port: 4455, code: "AB12CD" });
  assert.equal(parsePairCode("NA-80-AB12CD"), null);
  assert.equal(parsePairCode("hello"), null);
  assert.equal(parsePairCode("NA-4455-"), null);
});

test("clip and backoff", () => {
  assert.equal(clipText("abc", 5), "abc");
  assert.ok(clipText("x".repeat(50_000)).length < 40_020);
  assert.deepEqual([0, 1, 2, 3, 9].map(backoff), [1000, 2000, 4000, 8000, 30000]);
});

test("browser label", () => {
  assert.equal(browserLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36"), "Chrome 141 on macOS");
});

test("commands of one tab run one after the other", async () => {
  const q = new KeyedQueue();
  const log = [];
  const job = (n, ms) => () => new Promise((r) => setTimeout(() => (log.push(n), r(n)), ms));
  const a = q.run(1, job("a", 30));
  const b = q.run(1, job("b", 1));
  const c = q.run(2, job("c", 1));
  await Promise.all([a, b, c]);
  assert.deepEqual(log, ["c", "a", "b"]);
  await assert.rejects(q.run(1, () => Promise.reject(new Error("x"))), /x/);
  assert.equal(await q.run(1, async () => "still works"), "still works");
});

test("timeout says so in words", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10, "The page"), /took longer/);
});

test("manifest sticks to tabs and scripting only", () => {
  const m = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  assert.ok(!m.permissions.includes("debugger"));
  assert.deepEqual([...m.permissions].sort(), ["alarms", "scripting", "storage", "tabGroups", "tabs"]);
  const src = fs.readFileSync(new URL("./background.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /chrome\.debugger/);
});
