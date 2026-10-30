import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCv, emptyConversation, fromAttach, prepend } from "./cv.ts";
import type { CvMessage } from "./gen/index.ts";

const msg = (id: string, i: number, text = id): CvMessage => ({ i, id, role: "user", ts: 0, blocks: [{ k: "text", text }] });

test("upsert appends new ids and replaces known ones", () => {
  let c = fromAttach({ messages: [msg("a", 0)], more: true, meta: {} });
  c = applyCv(c, { k: "upsert", message: msg("b", 10) });
  c = applyCv(c, { k: "upsert", message: msg("a", 0, "changed") });
  assert.deepEqual(c.messages.map((m) => m.id), ["a", "b"]);
  assert.equal((c.messages[0]!.blocks[0] as { text: string }).text, "changed");
});

test("reset replaces, prepend skips duplicates", () => {
  let c = applyCv(emptyConversation(), { k: "reset", messages: [msg("c", 20)], more: true, meta: { model: "m" } });
  assert.equal(c.ready, true);
  c = prepend(c, [msg("a", 0), msg("c", 20)], false);
  assert.deepEqual(c.messages.map((m) => m.id), ["a", "c"]);
  assert.equal(c.more, false);
  c = applyCv(c, { k: "prompt", prompt: { title: "t", options: [] } });
  assert.equal(c.prompt?.title, "t");
});
