import assert from "node:assert/strict";
import { test } from "node:test";
import { joinArgs, splitArgs } from "./profiles.ts";

test("splitArgs handles quotes", () => {
  assert.deepEqual(splitArgs(`--model haiku  --name "two words" ''`), ["--model", "haiku", "--name", "two words", ""]);
  assert.deepEqual(splitArgs(joinArgs(["a b", "c"])), ["a b", "c"]);
});
