import assert from "node:assert/strict";
import { test } from "node:test";
import { ctrlSeq, CTRL_LETTERS } from "./termKeys.ts";

test("ctrl + letter is the control byte, either case", () => {
  assert.equal(ctrlSeq("c"), "\x03");
  assert.equal(ctrlSeq("C"), "\x03");
  assert.equal(ctrlSeq("a"), "\x01");
  assert.equal(ctrlSeq("z"), "\x1a");
});

test("ctrl + punctuation and space", () => {
  assert.equal(ctrlSeq("["), "\x1b");
  assert.equal(ctrlSeq(" "), "\x00");
  assert.equal(ctrlSeq("?"), "\x7f");
});

test("no control byte for other input", () => {
  assert.equal(ctrlSeq("1"), null);
  assert.equal(ctrlSeq("ab"), null);
  assert.equal(ctrlSeq(""), null);
});

test("every offered letter has a byte", () => {
  for (const l of CTRL_LETTERS) assert.ok(ctrlSeq(l));
});
