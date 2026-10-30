import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSays } from "./agentui.ts";

const notice = (session_id: string, text: string) => ({ role: "notice", session_id, text });

test("a waiting agent says why it waits, not the terminal menu", () => {
  const s = { id: "a", status: "waiting", last_line: "❯ 1. Yes", prompt: "Write a haiku" };
  assert.equal(agentSays(s, [notice("a", "product-docs — Claude needs input: Wants to use **Write**")]), "Wants to use Write");
});

test("menu lines are skipped without a notice", () => {
  assert.equal(agentSays({ id: "a", status: "waiting", last_line: "❯ 1. Yes", prompt: "Write a haiku" }), "Write a haiku");
  assert.equal(agentSays({ id: "a", status: "waiting", last_line: "› 2. No" }), "");
  assert.equal(agentSays({ id: "a", status: "working", last_line: "Reading 3 files" }), "Reading 3 files");
});

test("only the newest notice of that agent counts", () => {
  const s = { id: "a", status: "waiting", last_message: "Done." };
  const list = [notice("a", "x needs input: Old"), notice("b", "y needs input: Other"), notice("a", "x finished: Done.")];
  assert.equal(agentSays(s, list), "Done.");
  assert.equal(agentSays({ ...s, status: "done" }, [notice("a", "x needs input: Old")]), "Done.");
});
