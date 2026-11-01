// The fake daemon, end to end through its Transport: node --test --experimental-strip-types
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SCENES, type DemoScene, type DemoSignal } from "../api.ts";
import { createWorld } from "./index.ts";
import { open, settle, snapshotOf } from "./harness.ts";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
/** The newest status of a session as one client saw it (snapshot, then events). */
function statusOf(c: Awaited<ReturnType<typeof open>>, sid: string): string {
  const up = c.msgs.filter((m) => m.t === "ev" && m.ev.e === "session_upsert" && m.ev.session.id === sid).at(-1);
  return up ? up.ev.session.status : snapshotOf(c).sessions[sid].status;
}

/** Let the scripted Claude get to its question (the permission scene stops a moment before it asks). */
async function waiting(w: Awaited<ReturnType<typeof make>>, c: Awaited<ReturnType<typeof open>>, sid: string) {
  for (let i = 0; i < 40 && statusOf(c, sid) !== "waiting"; i++) {
    await w.clock.advance(1000);
    await settle(4);
  }
  assert.equal(statusOf(c, sid), "waiting", "Claude asks within 40 virtual seconds");
}

const make = (scene: DemoScene = "grid", extra: Record<string, unknown> = {}) => createWorld({ latency: 0, auto: false, now: NOW, scene, ...extra });

test("handshake: hello_ok first, then the snapshot", async () => {
  const w = await make();
  const c = await open(w);
  assert.equal(c.msgs[0].t, "hello_ok");
  assert.equal(c.msgs[1].t, "snapshot");
  assert.equal(c.msgs[0].v, 1);
  assert.ok(c.msgs[0].features.includes("neural"));
  const st = snapshotOf(c);
  assert.equal(st.workspaces.length, 3);
  assert.deepEqual(st.workspaces.map((x: any) => x.name).sort(), ["billing-api", "docs-site", "web-shop"]);
  assert.equal(c.msgs[0].host.name, "Studio");
  c.close();
  w.dispose();
});

test("every request kind gets an answer (never a hang)", async () => {
  const src = readFileSync(new URL("../../../../../packages/protocol/src/gen/Request.ts", import.meta.url), "utf8");
  const kinds = [...new Set([...src.matchAll(/"m": "([a-z_0-9]+)"/g)].map((m) => m[1]!))];
  assert.ok(kinds.length > 60, `found ${kinds.length} request kinds`);
  const w = await make();
  const c = await open(w, "desk", true);
  const st = snapshotOf(c);
  const sid = Object.keys(st.sessions)[0]!;
  const ws = st.workspaces[0].id;
  const skip = new Set(["quit", "shutdown", "host_restart"]);
  for (const m of kinds) {
    if (skip.has(m)) continue;
    // Plausible parameters; a sensible error is as good as an answer, silence is not.
    const r = await c.req(m, { sid, workspace_id: ws, path: "/Users/demo/code/billing-api", id: sid, query: "a", name: "x", profile_id: "shell", cols: 80, rows: 24, data: "", text: "hi", goal: "g", days: 7 }, 4000);
    assert.equal(r.t, "res", m);
    assert.equal(typeof r.ok, "boolean", m);
  }
  c.close();
  w.dispose();
});

test("events carry one strictly increasing seq, above the snapshot's", async () => {
  const w = await make();
  const c = await open(w);
  const snap = c.msgs.find((m) => m.t === "snapshot");
  await w.clock.advance(40_000);
  await settle(40);
  const seqs = c.msgs.filter((m) => m.t === "ev").map((m) => m.seq);
  assert.ok(seqs.length > 5, `only ${seqs.length} events in 40 s`);
  assert.ok(seqs[0] > snap.seq);
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], `seq ${seqs[i - 1]} then ${seqs[i]}`);
  c.close();
  w.dispose();
});

test("two connections share one world; the answer of one reaches the other", async () => {
  const w = await make("permission");
  const signals: DemoSignal[] = [];
  w.on((s) => signals.push(s));
  const desk = await open(w, "desk");
  const phone = await open(w, "phone");
  const sid = w.resolve("claude-billing")!;
  await waiting(w, desk, sid);
  const a = await phone.req("cv_attach", { sid, features: ["tasks"] });
  assert.ok(a.ok);
  assert.equal(a.r.prompt?.kind, "permission", "the permission question is open");
  assert.equal(statusOf(desk, sid), "waiting");
  const r = await phone.req("cv_action", { sid, action: { k: "answer", n: "1", prompt_id: a.r.prompt.id } });
  assert.ok(r.ok);
  await settle(30);
  const answered = signals.find((s) => s.type === "prompt-answered");
  assert.ok(answered && answered.type === "prompt-answered");
  assert.equal(answered.by, "phone");
  assert.equal(answered.allow, true);
  const up = desk.msgs.filter((m) => m.t === "ev" && m.ev.e === "session_upsert" && m.ev.session.id === sid).at(-1);
  assert.equal(up.ev.session.status, "working");
  phone.close();
  desk.close();
  w.dispose();
});

test("a Claude view that watched before a scene switch hears the new prompt", async () => {
  // The client lets only the last attach answer, and only to its own sink: the inbox row that attached
  // first must still learn that the permission question is open.
  const w = await make("permission");
  const phone = await open(w, "phone");
  const sid = w.resolve("claude-billing")!;
  assert.ok((await phone.req("cv_attach", { sid, features: ["tasks"] })).ok, "the inbox row watches");
  const before = phone.msgs.filter((m) => m.t === "snapshot").length;
  w.play("phone");
  await phone.until(() => phone.msgs.filter((m) => m.t === "snapshot").length > before);
  const mark = phone.msgs.length;
  const a = await phone.req("cv_attach", { sid: w.resolve("claude-billing")!, features: ["tasks"] });
  assert.equal(a.r.prompt?.kind, "permission", "the new scene is already asking");
  await settle(30);
  const kinds = phone.msgs.slice(mark).filter((m) => m.t === "cv" && m.sid === sid).map((m) => m.ev.k);
  assert.ok(kinds.includes("reset"), "the view is reset");
  assert.ok(kinds.includes("prompt"), "the open prompt follows the attach");
  phone.close();
  w.dispose();
});

test("same seed, same world", async () => {
  const a = await make("grid", { seed: 7 });
  const b = await make("grid", { seed: 7 });
  const sa = JSON.stringify(snapshotOf(await open(a)));
  const sb = JSON.stringify(snapshotOf(await open(b)));
  assert.equal(sa, sb);
  const c = await make("grid", { seed: 8 });
  assert.notEqual(sa, JSON.stringify(snapshotOf(await open(c))));
  a.dispose();
  b.dispose();
  c.dispose();
});

test("scenes reach their moments", async () => {
  const check: Record<DemoScene, (st: any, w: Awaited<ReturnType<typeof make>>) => void> = {
    grid: (st) => {
      const live = Object.values<any>(st.sessions).filter((s) => s.cwd.endsWith("billing-api") && s.profile_id !== "shell");
      assert.equal(live.length, 4);
      assert.ok(live.every((s) => s.status === "working" || s.status === "waiting" || s.status === "done"));
      assert.ok(live.filter((s) => s.status === "working").length >= 3, "the hero is busy");
    },
    permission: (st, w) => assert.equal(st.sessions[w.resolve("claude-billing")!].status, "working", "a moment before the question"),
    phone: (st, w) => assert.equal(st.sessions[w.resolve("claude-billing")!].status, "waiting"),
    neural: (st) => {
      assert.ok(st.neural.pending.length >= 1);
      assert.ok(st.orchestrator.messages.length >= 4);
    },
    team: (st) => {
      const teams = st.neural.tasks.filter((x: any) => x.team);
      assert.ok(teams.length >= 3, "a finished race, a build + review and a race");
      assert.ok(teams.some((t: any) => t.team.pattern === "race" && t.status === "done"), "a finished team");
      const race = teams.find((t: any) => t.team.pattern === "race" && t.status === "review");
      assert.ok(race, "a race at Pick one");
      assert.ok(race.team.attempts.every((a: any) => a.state === "ready"), "every attempt is ready");
      const rev = teams.find((t: any) => t.team.pattern === "review");
      assert.ok(rev && rev.status !== "done", "a build + review that is still looping");
      assert.equal(rev.team.attempts.find((a: any) => a.role === "reviewer").verdict, "changes");
      assert.ok(st.swarms.length === 2 && st.swarms.some((x: any) => x.ended) && st.swarms.some((x: any) => !x.ended), "a live and an ended swarm");
      assert.ok(st.swarm_messages.filter((m: any) => !st.swarms.find((x: any) => x.id === m.swarm_id)?.ended).length >= 5, "the live swarm already talks");
    },
    files: (st, w) => {
      const s = st.sessions[w.resolve("claude-billing")!];
      assert.equal(s.status, "done");
      const billing = st.workspaces.find((x: any) => x.name === "billing-api");
      assert.ok(billing.git && billing.git.changed > 0, "git has changes to show");
    },
    agents: (st) => {
      const all = Object.values<any>(st.sessions);
      assert.ok(all.some((s) => s.status === "waiting"), "one needs you");
      assert.ok(all.filter((s) => s.status === "working").length >= 2, "some are working");
      assert.ok(all.filter((s) => s.status === "done").length >= 2, "some are done");
      assert.ok(new Set(all.map((s) => s.workspace_id)).size >= 3, "all three projects");
    },
    idle: (st) => {
      const busy = Object.values<any>(st.sessions).filter((s) => s.status === "working" || s.status === "waiting");
      assert.equal(busy.length, 0);
    },
  };
  for (const scene of SCENES) {
    const w = await make(scene);
    const c = await open(w);
    check[scene](snapshotOf(c), w);
    c.close();
    w.dispose();
  }
});

test("play() resets to a scene and connected clients get a fresh snapshot with the same ids", async () => {
  const w = await make("grid");
  const c = await open(w);
  const id = w.resolve("claude-billing");
  w.play("idle");
  await c.until(() => c.msgs.filter((m) => m.t === "snapshot").length >= 2);
  const snap = c.msgs.filter((m) => m.t === "snapshot").at(-1);
  assert.ok(snap.state.sessions[id!], "ids stay stable");
  assert.equal(Object.values<any>(snap.state.sessions).filter((s) => s.status === "working").length, 0);
  assert.ok(snap.seq > c.msgs[1].seq, "seq never goes back");
  c.close();
  w.dispose();
});

test("alive for twelve minutes: no throw, bounded buffers, still talking", async () => {
  const w = await make("grid");
  const c = await open(w);
  const sid = w.resolve("claude-billing")!;
  await c.req("term_attach", { sid });
  const t0 = c.msgs.length;
  for (let i = 0; i < 12; i++) {
    await w.clock.advance(60_000);
    await settle(8);
  }
  assert.ok(c.msgs.length - t0 > 50, "events kept coming");
  const st = (await c.req("term_attach", { sid })).r;
  assert.ok(st.snapshot.length < 70_000, `terminal snapshot is ${st.snapshot.length} chars`);
  const again = await c.req("fs_roots");
  assert.ok(again.ok, "still answering after twelve minutes");
  c.close();
  w.dispose();
});
