import assert from "node:assert/strict";
import { test } from "node:test";
import { OSC52_MAX, parseOsc52 } from "./osc52.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

test("decodes a clipboard write, UTF-8 included", () => {
  assert.equal(parseOsc52(`c;${b64("hello")}`), "hello");
  assert.equal(parseOsc52(`c;${b64("Grüße → 世界\nzweite Zeile")}`), "Grüße → 世界\nzweite Zeile");
});

test("accepts other and empty targets", () => {
  assert.equal(parseOsc52(`;${b64("x")}`), "x");
  assert.equal(parseOsc52(`pc;${b64("y")}`), "y");
  assert.equal(parseOsc52(`s0;${b64("z")}`), "z");
});

test("refuses reads, clears and junk", () => {
  assert.equal(parseOsc52("c;?"), null);
  assert.equal(parseOsc52("c;"), null);
  assert.equal(parseOsc52("c"), null);
  assert.equal(parseOsc52("x;aGk="), null);
  assert.equal(parseOsc52("c;not base64!"), null);
});

test("ignores line breaks inside the base64 and refuses huge payloads", () => {
  assert.equal(parseOsc52(`c;${b64("abcdef").replace(/(.{4})/, "$1\n")}`), "abcdef");
  assert.equal(parseOsc52(`c;${"A".repeat(Math.ceil(OSC52_MAX / 3) * 4 + 4)}`), null);
});
