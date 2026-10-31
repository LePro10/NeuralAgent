import assert from "node:assert/strict";
import { test } from "node:test";
import type { CvBlock, CvMessage } from "@neuralagent/protocol";
import { entryCache, gallery, lastTurn, latestTodo, openTools, pendingUse, sepLabel, toEntries, type Turn } from "../components/claude/entries.ts";
import { changeRows, duration, isAsyncLaunch, patchRows, previewRows, stepSummary } from "../components/claude/toolText.ts";

let n = 0;
const T0 = Date.parse("2026-10-31T09:00:00Z");
const msg = (role: CvMessage["role"], blocks: CvBlock[], ts = T0 + n * 1000): CvMessage => ({ i: ++n, id: `m${n}`, role, ts, blocks });
const user = (text: string, ts?: number) => msg("user", [{ k: "text", text }], ts);
const think = (text = "") => msg("assistant", [{ k: "thinking", text }]);
const say = (text: string) => msg("assistant", [{ k: "text", text }]);
const call = (name: string, input: unknown = {}, id = `t${n + 1}`) => msg("assistant", [{ k: "tool_use", id, name, input }]);
const result = (id: string, text = "ok", extra: Partial<Extract<CvBlock, { k: "tool_result" }>> = {}) => msg("user", [{ k: "tool_result", tool_use_id: id, text, is_error: false, ...extra }]);
const idOf = (m: CvMessage) => (m.blocks[0] as { id: string }).id;
const turns = (es: ReturnType<typeof toEntries>) => es.filter((e): e is Turn => e.t === "turn");

test("empty thinking is dropped and all steps between two texts merge into one run", () => {
  const ms: CvMessage[] = [user("fix it"), say("Looking.")];
  for (let i = 0; i < 6; i++) {
    ms.push(think());
    const c = call(i % 2 ? "Read" : "Bash", { command: `cmd ${i}`, file_path: `/f${i}` });
    ms.push(c, result(idOf(c)));
  }
  ms.push(think(), say("Done."));
  const es = toEntries(ms);
  assert.deepEqual(es.map((e) => e.t), ["user", "turn"]);
  const t = turns(es)[0]!;
  assert.deepEqual(t.pieces.map((p) => p.t), ["text", "steps", "text"]);
  const steps = t.pieces[1]!;
  assert.equal(steps.t === "steps" && steps.steps.length, 6);
  assert.equal(t.text, "Looking.\n\nDone.");
});

test("thinking with text is a step with a duration; edits, agents, todos, plans, questions break the run", () => {
  const ms: CvMessage[] = [user("go"), think("let me see"), call("Bash", { command: "ls" })];
  ms.push(result(idOf(ms[2]!)));
  ms.push(call("Edit", { file_path: "/a.ts", old_string: "a", new_string: "b" }), call("Write", { file_path: "/b.ts", content: "x" }));
  ms.push(call("Agent", { description: "look around" }), call("TodoWrite", { todos: [] }), call("ExitPlanMode", { plan: "p" }), call("AskUserQuestion", { questions: [] }));
  const t = turns(toEntries(ms))[0]!;
  assert.deepEqual(t.pieces.map((p) => p.t), ["steps", "edits", "agents", "todos", "plan", "ask"]);
  const s = t.pieces[0]!;
  assert.ok(s.t === "steps" && s.steps[0]!.t === "think");
  const e = t.pieces[1]!;
  assert.equal(e.t === "edits" && e.uses.length, 2);
});

test("a call that returned pictures is lifted out of the run", () => {
  const a = call("Bash", { command: "a" });
  const shot = call("mcp__blender__look");
  const b = call("Bash", { command: "b" });
  const img = { id: "1-0-1", media_type: "image/png", bytes: 10, w: 100, h: 50 };
  const ms = [user("look"), a, result(idOf(a)), shot, result(idOf(shot), "", { images: [img] }), b, result(idOf(b))];
  const es = toEntries(ms);
  const t = turns(es)[0]!;
  assert.deepEqual(t.pieces.map((p) => p.t), ["steps", "media", "steps"]);
  const g = gallery(es, () => "look");
  assert.equal(g.length, 1);
  assert.equal(g[0]!.caption, "look");
});

test("stable identity: unchanged entries are reused, only the touched turn is rebuilt", () => {
  const cache = entryCache();
  const c1 = call("Bash", { command: "a" });
  const ms = [user("one"), say("first"), user("two"), c1];
  const a = toEntries(ms, cache);
  const ms2 = [...ms, result(idOf(c1))];
  const b = toEntries(ms2, cache);
  assert.equal(a[0], b[0]);
  assert.equal(a[1], b[1]);
  assert.equal(a[2], b[2]);
  assert.notEqual(a[3], b[3]);
  const c = toEntries(ms2, cache);
  assert.equal(b[3], c[3]);
});

test("parallel calls are all open at once; the newest open one is pending", () => {
  const a = call("Read", { file_path: "/a" }, "ra");
  const b = msg("assistant", [{ k: "tool_use", id: "rb", name: "Read", input: {} }, { k: "tool_use", id: "rc", name: "Read", input: {} }]);
  const es = toEntries([user("x"), a, b, result("rb")]);
  const t = lastTurn(es)!;
  assert.deepEqual([...openTools(t)].sort(), ["ra", "rc"]);
  assert.equal(pendingUse(t)?.id, "rc");
  assert.equal(openTools(null).size, 0);
});

test("time separators before user messages after a gap or a new day", () => {
  n = 0;
  const es = toEntries([user("a", T0), say("b"), user("c", T0 + 5 * 60_000), say("d"), user("e", T0 + 60 * 60_000)]);
  const seps = es.filter((e) => e.t === "user").map((e) => (e.t === "user" ? e.sep : null));
  assert.equal(seps[0], T0);
  assert.equal(seps[1], null);
  assert.equal(seps[2], T0 + 60 * 60_000);
});

test("only the newest TodoWrite is the card", () => {
  const es = toEntries([user("a"), call("TodoWrite", { todos: [] }, "td1"), user("b"), call("TodoWrite", { todos: [] }, "td2")]);
  assert.equal(latestTodo(es), "td2");
});

test("separator labels", () => {
  const now = Date.parse("2026-10-31T15:00:00");
  assert.match(sepLabel(Date.parse("2026-10-31T14:32:00"), now), /^Today /);
  assert.match(sepLabel(Date.parse("2026-10-30T09:10:00"), now), /^Yesterday /);
  assert.doesNotMatch(sepLabel(Date.parse("2026-10-28T09:10:00"), now), /Today|Yesterday/);
});

test("step summaries count by kind, MCP by server", () => {
  assert.equal(stepSummary(["Bash", "Read", "Bash", "Read", "Read", "Grep"]), "Ran 2 commands, read 3 files, searched code");
  assert.equal(stepSummary(["mcp__blender__look", "mcp__blender__exec", "mcp__blender__look"]), "Used blender 3 times");
  assert.equal(stepSummary([], 5000), "Thought for 5s");
  assert.match(stepSummary(["Bash", "Read", "Grep", "LS", "WebFetch"]), /and 2 more$/);
});

test("durations", () => {
  assert.equal(duration(4200), "4s");
  assert.equal(duration(130_000), "2m 10s");
  assert.equal(duration(65 * 60_000), "1h 5m");
});

test("structuredPatch rows carry real line numbers; preview starts at the change", () => {
  const rows = patchRows([{ old_start: 62, new_start: 62, lines: [" ctx", "-old", "+new", " end"] }])[0]!;
  assert.deepEqual(rows.map((r) => [r.kind, r.n]), [[" ", 62], ["-", 63], ["+", 63], [" ", 64]]);
  const res = { k: "tool_result" as const, tool_use_id: "e", text: "", is_error: false, meta: { patch: [{ old_start: 10, old_lines: 1, new_start: 10, new_lines: 1, lines: ["-a", "+b"] }] } };
  const use = { k: "tool_use" as const, id: "e", name: "Edit", input: { old_string: "a", new_string: "b" } };
  assert.equal(changeRows(use, res)![0]!.n, 10);
  const many = Array.from({ length: 30 }, (_, i) => ({ kind: (i === 20 ? "+" : " ") as "+" | " ", text: String(i) }));
  assert.equal(previewRows(many, 8)[1]!.text, "20");
});

test("a background launch result is metadata", () => {
  assert.equal(isAsyncLaunch({ k: "tool_result", tool_use_id: "a", text: "Async agent launched successfully. agentId: x", is_error: false }), true);
  assert.equal(isAsyncLaunch({ k: "tool_result", tool_use_id: "a", text: "Found 3 places", is_error: false }), false);
});

test("notifications, peers and hooks are notices; API errors stay in the turn as a note", () => {
  const note = { ...msg("user", [{ k: "task_note", task_id: "a1", status: "completed", summary: "Agent finished", kind: "agent" }]), kind: "task" };
  const peer = { ...msg("user", [{ k: "text", text: "hi from b" }]), kind: "peer", from: "b", from_name: "Explore" };
  const err = { ...msg("assistant", [{ k: "error", text: "Rate limited", code: "rate_limit" }]), kind: "error" };
  const es = toEntries([user("go"), say("ok"), note, peer, err]);
  assert.deepEqual(es.map((e) => e.t), ["user", "turn", "system", "system", "turn"]);
  const t = lastTurn(es)!;
  assert.deepEqual(t.pieces.map((p) => p.t), ["note"]);
});

test("a user line with a pasted block is a prompt, not a stray result", () => {
  const p = msg("user", [{ k: "pasted", text: "a\nb", lines: 2 }]);
  assert.deepEqual(toEntries([p]).map((e) => e.t), ["user"]);
});

const hookLine = (role: CvMessage["role"], text = "blocked") =>
  ({ ...msg(role, [{ k: "hook", event: "PreToolUse", text, is_error: true } as unknown as CvBlock]), kind: "hook" }) as CvMessage;

test("a hook line inside a turn does not end it; the later result is kept", () => {
  const c = call("Bash", {}, "tx");
  const es = toEntries([user("go"), c, hookLine("system"), result("tx", "denied"), say("done")]);
  assert.deepEqual(es.map((e) => e.t), ["user", "turn"]);
  const t = turns(es)[0]!;
  assert.equal(t.res.get("tx")?.text, "denied");
  assert.ok(t.pieces.some((p) => p.t === "note"));
  assert.equal(openTools(t).size, 0);
});

test("a PostToolUse hook line after a result does not split the turn", () => {
  const es = toEntries([user("go"), call("Bash", {}, "ty"), result("ty"), hookLine("user", "post"), say("done")]);
  assert.deepEqual(es.map((e) => e.t), ["user", "turn"]);
});

test("a real user prompt still starts a new turn", () => {
  const es = toEntries([user("go"), call("Bash", {}, "tz"), hookLine("system"), result("tz"), say("a"), user("next"), say("b")]);
  assert.deepEqual(es.map((e) => e.t), ["user", "turn", "user", "turn"]);
});
