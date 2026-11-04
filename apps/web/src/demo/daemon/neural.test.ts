// What a visitor means when they write to Neural (pure), and Neural answering, starting and stopping agents,
// asking before it acts, all through the protocol.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "./index.ts";
import { open, settle, snapshotOf, type Probe } from "./harness.ts";
import { matchNeural, projectOf, taskOf } from "./neural-brain.ts";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const PROJECTS = ["billing-api", "web-shop", "docs-site"];

test("neural brain: what a visitor writes is read the way a person means it", () => {
  const k = (t: string) => matchNeural(t, PROJECTS).k;
  assert.equal(k("hello"), "greeting");
  assert.equal(k("thanks!"), "thanks");
  assert.equal(k("what can you do"), "help");
  assert.equal(k("what are my agents doing"), "status");
  assert.equal(k("what is going on?"), "status");
  assert.equal(k("who is waiting for me?"), "waiting");
  assert.equal(k("catch me up"), "catchup");
  assert.equal(k("approve"), "approve");
  assert.equal(k("yes please"), "approve");
  assert.equal(k("deny"), "deny");
  assert.equal(k("run the tests in web-shop"), "tests");
  assert.equal(k("summarise billing-api"), "summarise");
  assert.equal(k("billing api"), "summarise");
  assert.deepEqual(matchNeural("be quiet", PROJECTS), { k: "mode", mode: "quiet" });
  assert.deepEqual(matchNeural("speak up again", PROJECTS), { k: "mode", mode: "active" });
  assert.deepEqual(matchNeural("remember that we use pnpm", PROJECTS), { k: "remember", note: "we use pnpm" });
  // Start and stop name an engine and a project.
  assert.deepEqual(matchNeural("start codex in web-shop to add a free shipping hint", PROJECTS), { k: "start", engine: "codex", project: "web-shop", task: "Add a free shipping hint." });
  assert.deepEqual(matchNeural("ask Gemini in docs-site to add a Next section to the guide", PROJECTS), { k: "start", engine: "gemini", project: "docs-site", task: "Add a Next section to the guide." });
  assert.deepEqual(matchNeural("stop claude in billing-api", PROJECTS), { k: "stop", engine: "claude", project: "billing-api" });
  // Not understood: say so instead of guessing.
  assert.equal(k("order me a pizza"), "unknown");
  assert.equal(k(" "), "unknown");
  assert.equal(projectOf("how is the shop doing", PROJECTS), "web-shop");
  assert.equal(taskOf("start claude"), "");
});

async function neuralWorld(scene: "neural" | "grid" = "neural") {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene });
  const c = await open(w);
  return { w, c };
}

/** Send a line to Neural and let it answer (its streaming takes a few virtual seconds). */
async function tell(w: Awaited<ReturnType<typeof createWorld>>, c: Probe, text: string, ms = 6000) {
  const r = await c.req("orch_send", { text });
  assert.equal(r.ok, true);
  await w.clock.advance(ms);
  await settle(5);
}

/** The orchestrator thread as the daemon holds it (a fresh connection's snapshot). */
async function thread(w: Awaited<ReturnType<typeof createWorld>>) {
  const c2 = await open(w);
  const t = snapshotOf(c2).orchestrator.messages as { role: string; text: string; proactive?: boolean; ok?: boolean }[];
  c2.close();
  return t;
}
const neuralOf = async (w: Awaited<ReturnType<typeof createWorld>>) => {
  const c2 = await open(w);
  const n = snapshotOf(c2).neural;
  const sessions = Object.values<any>(snapshotOf(c2).sessions);
  c2.close();
  return { n, sessions };
};

test("neural: answers a question about the agents with the live summary", async () => {
  const { w, c } = await neuralWorld();
  try {
    await tell(w, c, "what are my agents doing");
    const t = await thread(w);
    const last = t.filter((m) => m.role === "assistant" && !m.proactive).at(-1)!;
    assert.match(last.text, /Working|Needs you|Finished/);
    assert.match(last.text, /billing-api/);
    await tell(w, c, "hello");
    assert.match((await thread(w)).filter((m) => m.role === "assistant" && !m.proactive).at(-1)!.text, /Hi|Hello/);
    await tell(w, c, "order me a pizza");
    const unknown = (await thread(w)).filter((m) => m.role === "assistant" && !m.proactive).at(-1)!.text;
    assert.match(unknown, /did not follow|can see every agent/);
    assert.match(unknown, /billing-api/);
  } finally {
    c.close();
    w.dispose();
  }
});

test("neural: start really starts a session and tracks it as a task, stop really stops it", async () => {
  const { w, c } = await neuralWorld();
  try {
    const before = await neuralOf(w);
    await tell(w, c, "start codex in web-shop to add a free shipping hint to the cart", 4000);
    const after = await neuralOf(w);
    assert.equal(after.sessions.length, before.sessions.length + 1);
    const started = after.sessions.find((s) => !before.sessions.some((b) => b.id === s.id))!;
    assert.equal(started.profile_id, "codex");
    assert.ok(after.n.tasks.some((t: any) => t.agents.includes(started.id) && /shipping hint/i.test(t.title)));
    const said = await thread(w);
    assert.ok(said.some((m) => m.role === "action" && /Started Codex/.test(m.text)));

    await tell(w, c, "stop codex in web-shop", 3000);
    const stopped = (await neuralOf(w)).sessions.find((s) => s.id === started.id)!;
    assert.ok(stopped.status === "done" || stopped.status === "exited", `status ${stopped.status}`);
    const task = (await neuralOf(w)).n.tasks.find((t: any) => t.agents.includes(started.id));
    assert.equal(task.status, "failed");
  } finally {
    c.close();
    w.dispose();
  }
});

test("neural: asks before it starts something, Allow does it, Deny does not", async () => {
  const { w, c } = await neuralWorld();
  try {
    const first = await neuralOf(w);
    const pending = first.n.pending[0];
    assert.ok(pending, "the scene has a question waiting");
    await c.req("neural_confirm", { id: pending.id, allow: true });
    await w.clock.advance(3000);
    await settle(3);
    const allowed = await neuralOf(w);
    assert.equal(allowed.n.pending.length, 0);
    assert.equal(allowed.sessions.length, first.sessions.length + 1);
    assert.ok(allowed.sessions.some((s) => s.profile_id === "gemini" && /getting-started/.test(s.prompt ?? "")));
  } finally {
    c.close();
    w.dispose();
  }
  const b = await neuralWorld();
  try {
    const first = await neuralOf(b.w);
    await b.c.req("neural_confirm", { id: first.n.pending[0].id, allow: false });
    await b.w.clock.advance(1500);
    await settle(3);
    const denied = await neuralOf(b.w);
    assert.equal(denied.n.pending.length, 0);
    assert.equal(denied.sessions.length, first.sessions.length);
    assert.ok((await thread(b.w)).some((m) => m.role === "action" && m.ok === false));
  } finally {
    b.c.close();
    b.w.dispose();
  }
});

test("neural: memory, mode and approve", async () => {
  const { w, c } = await neuralWorld();
  try {
    await tell(w, c, "remember that releases go out on Tuesdays", 3000);
    assert.ok((await neuralOf(w)).n.notes.some((n: any) => /Tuesdays/.test(n.text)));
    await tell(w, c, "be quiet", 2500);
    assert.equal((await neuralOf(w)).n.mode, "quiet");
    await tell(w, c, "speak up", 2500);
    assert.equal((await neuralOf(w)).n.mode, "active");
  } finally {
    c.close();
    w.dispose();
  }
});


