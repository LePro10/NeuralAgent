import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeuralObs, NeuralTask, State } from "@neuralagent/protocol";
import { awayLine, awayOf, neuralNotices, neuralNoticesMemo, obsDetail, taskActivity, taskWord } from "./neural.ts";

const obs = (id: string, kind: NeuralObs["kind"], at: number, text: string, session_id = "s1"): NeuralObs => ({ id, kind, at, text, session_id, seen: false });

function state(over: Partial<State> = {}): State {
  return {
    orchestrator: { ready: true, keys: [], busy: false, messages: [{ id: "u", role: "user", text: "hi", at: 1_000 }] },
    neural: { mode: "active", tasks: [], notes: [], observations: [], pending: [], summary_upto: 0 },
    ...over,
  } as State;
}

test("notices come from observations and from older daemons' conversation", () => {
  const s = state();
  s.orchestrator.messages.push({ id: "n", role: "notice", text: "A — B finished", at: 2, session_id: "old" });
  s.neural!.observations.push(obs("o1", "waiting", 5, "A — C needs input: wants to use Bash: `ls`"), obs("o2", "allowed", 6, "A — C: allowed Bash"));
  const n = neuralNotices(s);
  assert.deepEqual(n.map((x) => x.id), ["n", "o1"]);
  assert.equal(neuralNoticesMemo(s), neuralNoticesMemo(s), "memoised");
  assert.deepEqual(neuralNotices({ ...s, neural: undefined }).map((x) => x.id), ["n"], "old daemon");
});

test("observation detail drops who and what", () => {
  assert.equal(obsDetail(obs("o", "done", 0, "Japan Map — Claude finished: Tests pass.")), "Tests pass.");
  assert.equal(obsDetail(obs("o", "done", 0, "Japan Map — Claude finished")), "");
  assert.equal(obsDetail(obs("o", "team", 0, "Race “x” complete.")), "Race “x” complete.");
});

test("the away card shows only after a break with news", () => {
  const s = state();
  assert.equal(awayOf(s, 1_000 + 60 * 60_000), null, "nothing happened");
  s.neural!.observations.push(obs("a", "done", 2_000, "x finished"), obs("b", "done", 3_000, "x finished"), obs("c", "error", 4_000, "y stopped with an error", "s2"));
  assert.equal(awayOf(s, 1_000 + 5 * 60_000), null, "too soon");
  const a = awayOf(s, 1_000 + 60 * 60_000)!;
  assert.equal(a.done, 1, "one agent, counted once");
  assert.equal(a.failed, 1);
  assert.equal(awayLine(a), "1 agent finished · 1 failed");
});

test("a race with every attempt in asks the user to pick, not 'checking'", () => {
  const attempt = { session_id: "s1", profile_id: "claude", role: "racer", state: "ready", files: 1, additions: 2, deletions: 0 };
  const race = { id: "t1", title: "x", done_when: "", status: "review", agents: ["s1"], note: "", created_at: 0, updated_at: 0, team: { pattern: "race", profiles: [], attempts: [attempt], round: 0 } } as unknown as NeuralTask;
  assert.equal(taskWord(race), "Pick one");
  assert.equal(taskActivity(race), "waiting");
  assert.equal(taskWord({ ...race, team: undefined }), "Checking");
  assert.equal(taskWord({ ...race, status: "done", team: { ...race.team!, winner: "s1" } }), "Done");
});
