import assert from "node:assert/strict";
import { test } from "node:test";
import type { Profile, Session, Swarm } from "@neuralagent/protocol";
import { buildInbox, sectionOf } from "./inbox.ts";

const profiles = [
  { id: "claude", engine: "claude" },
  { id: "shell", engine: "shell" },
] as Profile[];

let n = 0;
const s = (status: Session["status"], extra: Partial<Session> = {}): Session =>
  ({ id: `s${++n}`, workspace_id: "w1", profile_id: "claude", title: `Agent ${n}`, status, status_since: n * 1000, alive: true, ...extra }) as Session;

test("sections by what the agent needs", () => {
  assert.equal(sectionOf(s("waiting")), "needs");
  assert.equal(sectionOf(s("error", { alive: false })), "needs");
  assert.equal(sectionOf(s("working")), "working");
  assert.equal(sectionOf(s("starting")), "working");
  assert.equal(sectionOf(s("done")), "done");
  assert.equal(sectionOf(s("idle")), "done");
  // A dead agent that still says "waiting" does not wait for anyone.
  assert.equal(sectionOf(s("waiting", { alive: false })), "done");
});

test("shells and installers are left out; counts are per agent", () => {
  const list = [s("waiting"), s("working"), s("idle", { profile_id: "shell" }), s("working", { profile_id: "install:codex" })];
  const inbox = buildInbox(Object.fromEntries(list.map((x) => [x.id, x])), profiles, []);
  assert.equal(inbox.counts.all, 2);
  assert.equal(inbox.counts.needs, 1);
  assert.equal(inbox.needs.length, 1);
  assert.equal(inbox.working.length, 1);
});

test("the longest waiting comes first; done is newest first", () => {
  const a = s("waiting", { status_since: 5 });
  const b = s("waiting", { status_since: 1 });
  const c = s("done", { status_since: 2 });
  const d = s("idle", { status_since: 9 });
  const inbox = buildInbox({ a, b, c, d } as unknown as Record<string, Session>, profiles, []);
  assert.deepEqual(inbox.needs.map((i) => i.id), [b.id, a.id]);
  assert.deepEqual(inbox.done.map((i) => i.id), [d.id, c.id]);
});

test("a running swarm is one row in its most urgent section; an ended one leaves", () => {
  const m1 = s("working");
  const m2 = s("waiting");
  const m3 = s("exited", { alive: false });
  const solo = s("working");
  const swarms = [
    { id: "w", workspace_id: "w1", goal: "Ship", members: [{ role: "Builder", session_id: m1.id }, { role: "Reviewer", session_id: m2.id }], started_at: 0, ended: false },
    { id: "old", workspace_id: "w1", goal: "Old", members: [{ role: "Scout", session_id: m3.id }], started_at: 0, ended: true },
  ] as Swarm[];
  const all = Object.fromEntries([m1, m2, m3, solo].map((x) => [x.id, x]));
  const inbox = buildInbox(all, profiles, swarms);
  assert.equal(inbox.needs.length, 1);
  const row = inbox.needs[0]!;
  assert.equal(row.kind, "swarm");
  assert.equal(row.kind === "swarm" && row.waiting.length, 1);
  assert.deepEqual(inbox.working.map((i) => i.id), [solo.id]);
  assert.equal(inbox.done.length, 0);
  assert.equal(inbox.counts.all, 4);
});

test("a project shows only its own agents", () => {
  const a = s("working", { workspace_id: "w1" });
  const b = s("working", { workspace_id: "w2" });
  const inbox = buildInbox({ a, b } as unknown as Record<string, Session>, profiles, [], { project: "w2" });
  assert.deepEqual(inbox.working.map((i) => i.id), [b.id]);
});
