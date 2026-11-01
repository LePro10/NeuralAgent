// Background work of a Claude conversation: status, ids, summary, fade, tree (components/claude/work.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CvTask } from "@neuralagent/protocol";
import { agentIdOf, canOpen, detailOf, flatten, KEEP_MS, nextFade, statusOf, stripItems, summaryOf, trailOf, workTree, type WorkNode } from "../components/claude/work.ts";

const task = (id: string, o: Partial<CvTask> = {}): CvTask => ({ id, kind: "agent", description: id, status: "running", background: false, has_transcript: false, ...o });

test("status vocabulary", () => {
  assert.equal(statusOf(task("a")), "running");
  assert.equal(statusOf(task("a", { background: true })), "background");
  assert.equal(statusOf(task("a", { status: "killed" })), "stopped");
  assert.equal(statusOf(task("a", { status: "failed" })), "failed");
  assert.equal(statusOf(task("a", { status: "completed" })), "done");
});

test("a running agent opens as soon as its real id is known", () => {
  // Before the daemon linked it, the task carries the tool call id.
  assert.equal(agentIdOf(task("toolu_01abc")), undefined);
  assert.equal(canOpen(task("toolu_01abc")), false);
  assert.equal(agentIdOf(task("toolu_01abc"), "a77"), "a77");
  // Linked: open at once, even before its transcript file exists.
  assert.equal(agentIdOf(task("a0123456789abcdef")), "a0123456789abcdef");
  assert.equal(canOpen(task("a0123456789abcdef")), true);
  // Shells open their output.
  assert.equal(canOpen(task("b1", { kind: "bash", command: "sleep 9" })), true);
  assert.equal(canOpen(task("b1", { kind: "bash" })), false);
});

test("summary: running counts first, then what finished", () => {
  const list = [task("a1"), task("a2", { background: true }), task("a3", { status: "completed" }), task("b1", { kind: "bash" }), task("m1", { kind: "monitor" })];
  assert.equal(summaryOf(list), "2 agents running · 1 shell · 1 monitor");
  assert.equal(summaryOf([task("a1")]), "1 agent running");
  assert.equal(summaryOf([task("a1", { status: "completed" }), task("a2", { status: "failed" })]), "1 task done · 1 failed");
  assert.equal(summaryOf([]), "");
});

test("detail: live label, quiet time, elapsed and tokens; counts when done", () => {
  const now = 1_000_000;
  const t = task("a1", { label: "Read main.rs", started: now - 80_000, tokens: 12_400, active: now - 5_000 });
  assert.equal(detailOf(t, now), "Read main.rs · 1m 20s · 12k tokens");
  assert.equal(detailOf({ ...t, active: now - 125_000 }, now), "Read main.rs · quiet for 2m 5s · 1m 20s · 12k tokens");
  const done = task("a1", { status: "completed", started: now - 9_000, ended: now - 1_000, tokens: 800, tool_count: 3 });
  assert.equal(detailOf(done, now), "3 tools · 800 tokens · 8s");
});

test("finished items stay for a while, then fade out", () => {
  const now = 10_000_000;
  const list = [task("run"), task("fresh", { status: "completed", ended: now - 1000 }), task("old", { status: "completed", ended: now - KEEP_MS - 1 }), task("noend", { status: "completed" })];
  const seen = new Map([["noend", now - 2000]]);
  const at = (t: CvTask) => seen.get(t.id);
  assert.deepEqual(stripItems(list, now, at).map((t) => t.id), ["run", "fresh", "noend"]);
  // The phone saw "old" end only now (clock skew between computer and phone): it stays.
  seen.set("old", now - 10);
  assert.ok(stripItems(list, now, at).some((t) => t.id === "old"));
  assert.equal(nextFade(list, now, at), KEEP_MS - 2000);
  assert.equal(nextFade([task("run")], now, at), undefined);
});

const ids = (nodes: WorkNode[]): unknown[] => nodes.map((n) => (n.k === "task" ? (n.children.length ? [n.task.id, ids(n.children)] : n.task.id) : [n.label, ids(n.children)]));

test("tree: nested agents under their parent, running first, newest first", () => {
  const list = [
    task("p", { started: 100, background: true }),
    task("c1", { parent: "p", started: 200, status: "completed" }),
    task("c2", { parent: "p", started: 300 }),
    task("orphan", { parent: "gone", started: 50 }),
    task("b1", { kind: "bash", started: 400, status: "completed" }),
  ];
  assert.deepEqual(ids(workTree(list)), [["p", ["c2", "c1"]], "orphan", "b1"]);
  assert.deepEqual(flatten(workTree(list)).map((t) => t.id), ["p", "c2", "c1", "orphan", "b1"]);
  assert.deepEqual(trailOf(list, "c2").map((t) => t.id), ["p", "c2"]);
});

test("tree: a fan-out of four or more agents becomes one group", () => {
  const fan = ["w1", "w2", "w3", "w4", "w5"].map((id, i) => task(id, { agent_type: "Explore", started: 1000 + i * 300, status: i < 2 ? "completed" : "running" }));
  const nodes = workTree([...fan, task("solo", { started: 90_000 })]);
  assert.equal(nodes.length, 2);
  const g = nodes.find((n) => n.k === "group");
  assert.ok(g && g.k === "group");
  assert.equal(g.label, "5 Explore agents");
  assert.equal(g.running, 3);
  assert.deepEqual(g.children.map((c) => (c.k === "task" ? c.task.id : "")), ["w5", "w4", "w3", "w2", "w1"]);
  // Three at once stay single rows.
  assert.equal(workTree(fan.slice(0, 3)).every((n) => n.k === "task"), true);
  // The strip shows the three running ones of the same fan-out: still one group, like the sheet.
  const strip = workTree(fan.slice(2), [...fan, task("solo", { started: 90_000 })]);
  assert.equal(strip.length, 1);
  assert.ok(strip[0]!.k === "group" && strip[0]!.label === "3 Explore agents" && strip[0]!.running === 3);
});
