import assert from "node:assert/strict";
import { test } from "node:test";
import { approach, barProfile, listeningHeight, METER_REST, writingHeight } from "./voiceMeter.ts";

test("approach rises faster than it falls", () => {
  const up = approach(0, 1, 33);
  const down = 1 - approach(1, 0, 33);
  assert.ok(up > down && up < 1 && down > 0);
  assert.equal(approach(0.4, 0.4, 16), 0.4);
  assert.equal(approach(0.2, 1, -5), 0.2);
});

test("barProfile arches to the middle", () => {
  const p = barProfile(7);
  assert.equal(p[3], 1);
  assert.ok(p[0] < p[1] && p[1] < p[2] && p[2] < p[3]);
  assert.equal(p[0], p[6]);
  assert.deepEqual(barProfile(1), [1]);
});

test("silence rests, speech fills, nothing overflows", () => {
  for (let t = 0; t < 3; t += 0.1) {
    assert.equal(listeningHeight(0, 1, 2, t), METER_REST);
    const h = listeningHeight(5, 1, 2, t);
    assert.ok(h <= 1 && h > 0.7);
    const w = writingHeight(4, t);
    assert.ok(w >= METER_REST && w <= METER_REST + 0.14);
  }
});
