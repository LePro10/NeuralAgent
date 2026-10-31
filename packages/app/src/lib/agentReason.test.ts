import assert from "node:assert/strict";
import { test } from "node:test";
import { humanError, isNoiseLine } from "./agentReason.ts";
import { agentSays } from "./agentui.ts";

test("hook calls and shell plumbing are noise", () => {
  assert.ok(isNoiseLine("/Users/me/NeuralAgent/target/debug/neuralagentd hook StopFailure"));
  assert.ok(isNoiseLine(`echo '{"error":"x"}' | /tmp/neuralagentd hook StopFailure`));
  assert.ok(isNoiseLine("…ent/target/debug/neuralagentd hook StopFail"));
  assert.ok(isNoiseLine("$ pnpm test"));
  assert.ok(isNoiseLine("ptSubmit"));
  assert.ok(!isNoiseLine("Stop"));
  assert.ok(isNoiseLine("/Users/someone/projects/very/long/path/to/a/file.ts"));
  assert.ok(!isNoiseLine("Reading 3 files"));
  assert.ok(!isNoiseLine("Rate limit reached. Try again in 4 minutes."));
  assert.ok(!isNoiseLine("Edited src/app.ts and /tmp/x"));
});

test("known failures get plain words and keep the raw text", () => {
  const o = humanError('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
  assert.equal(o.text, "Claude is overloaded right now");
  assert.match(o.detail!, /529/);
  assert.equal(humanError("API Error: 401 authentication_error · Please run /login").text, "Not signed in: log in to the agent again");
  assert.equal(humanError("Error: connect ECONNREFUSED 127.0.0.1:443").text, "No connection to the model");
  assert.equal(humanError("Prompt is too long").text, "The conversation is too long: compact it or start fresh");
});

test("a readable reason stays as it is; noise becomes a generic line", () => {
  assert.deepEqual(humanError("Rate limit reached. Try again in 4 minutes."), { text: "Rate limit reached. Try again in 4 minutes.", detail: undefined });
  const n = humanError("/Users/me/target/debug/neuralagentd hook StopFailure");
  assert.equal(n.text, "Stopped with an error");
  assert.match(n.detail!, /hook StopFailure/);
  assert.equal(humanError("").text, "Stopped with an error");
  assert.equal(humanError('API Error: 400 {"error":{"message":"tool_use ids must be unique"}}').text, "tool_use ids must be unique");
});

test("a failed agent says the error from Neural's notice, never a hook line", () => {
  const s = { id: "a", status: "error", last_line: "/x/target/debug/neuralagentd hook StopFailure" };
  assert.equal(agentSays(s, [{ role: "notice", session_id: "a", text: "web — Claude stopped with an error: Rate limit reached." }]), "Rate limit reached.");
  assert.equal(agentSays(s), "");
  assert.equal(agentSays({ id: "b", status: "working", last_line: "$ echo hi" }), "");
});
