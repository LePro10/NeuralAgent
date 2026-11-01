// The small parts: random numbers, the clock, the disk, the shell and the terminal stream.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "./index.ts";
import { Cancelled, makeClock, makeScope } from "./clock.ts";
import { counts, hunks, unified } from "./diff.ts";
import { open, settle, snapshotOf } from "./harness.ts";
import { makeRng } from "./rng.ts";
import { strip } from "./ansi.ts";
import { Vfs, join, normalize } from "./vfs.ts";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

test("rng: the same seed repeats, forks do not disturb each other", () => {
  const a = makeRng("x");
  const b = makeRng("x");
  assert.deepEqual([a.next(), a.next(), a.next()], [b.next(), b.next(), b.next()]);
  const f1 = makeRng("x").fork("agents");
  const burn = makeRng("x");
  burn.next();
  burn.fork("other").next();
  assert.equal(f1.next(), makeRng("x").fork("agents").next());
  const r = makeRng(5);
  for (let i = 0; i < 500; i++) {
    const n = r.int(3, 6);
    assert.ok(n >= 3 && n <= 6);
  }
  assert.match(makeRng(1).hex(12), /^[0-9a-f]{12}$/);
});

test("clock: timers run in order, pause holds them, cancelled scopes throw", async () => {
  const c = makeClock({ start: 1000, auto: false });
  const log: string[] = [];
  c.after(300, () => log.push("c"));
  c.after(100, () => log.push("a"));
  c.after(200, () => log.push("b"));
  await c.advance(150);
  assert.deepEqual(log, ["a"]);
  assert.equal(c.now(), 1150);
  await c.advance(500);
  assert.deepEqual(log, ["a", "b", "c"]);

  let ticks = 0;
  const stop = c.every(100, () => ticks++);
  await c.advance(1000);
  assert.equal(ticks, 10);
  stop();
  await c.advance(1000);
  assert.equal(ticks, 10);

  const scope = makeScope();
  const slept = c.sleep(5000, scope).then(() => "woke", (e) => (e instanceof Cancelled ? "cancelled" : "other"));
  scope.cancel();
  assert.equal(await slept, "cancelled");

  const woke = c.sleep(50).then(() => true);
  await c.advance(60);
  assert.equal(await woke, true);
  c.dispose();
});

test("clock: sleeping code sees time advance exactly as asked", async () => {
  const c = makeClock({ start: 0, auto: false });
  const marks: number[] = [];
  void (async () => {
    for (let i = 0; i < 5; i++) {
      await c.sleep(1000);
      marks.push(c.now());
    }
  })();
  await c.advance(10_000);
  assert.deepEqual(marks, [1000, 2000, 3000, 4000, 5000]);
  c.dispose();
});

test("vfs: paths, edits, git status and diffs", () => {
  assert.equal(normalize("/a/b/../c/./d"), "/a/c/d");
  assert.equal(join("/a/", "b"), "/a/b");
  assert.equal(join("/a", "/z"), "/z");
  const t = 0;
  const v = new Vfs(() => t);
  v.write("/p/src/a.ts", "one\ntwo\nthree\n");
  v.repos.set("/p", { root: "/p", branch: "main", ahead: 0, behind: 0, head: new Map(), log: [], staged: new Set() });
  const repo = v.repoOf("/p/src")!;
  assert.ok(repo, "a repo above the file");
  v.commitAll(repo);
  assert.equal(v.status(repo).length, 0);
  assert.ok(v.edit("/p/src/a.ts", "two", "TWO"));
  assert.equal(v.edit("/p/src/a.ts", "nope", "x"), false);
  v.write("/p/new.ts", "n\n");
  const st = v.status(repo);
  assert.deepEqual(st.map((s) => `${s.path}:${s.status}`).sort(), ["new.ts:untracked", "src/a.ts:modified"]);
  assert.deepEqual(counts("one\ntwo\n", "one\nTWO\nthree\n"), { additions: 2, deletions: 1 });
  assert.equal(hunks("a\nb\nc\n", "a\nb\nc\n").length, 0);
  const u = unified("src/a.ts", "x\n", "y\n");
  assert.match(u, /^diff --git a\/src\/a\.ts b\/src\/a\.ts/m);
  assert.match(u, /^-x$/m);
  assert.match(u, /^\+y$/m);
  v.remove("/p/src");
  assert.equal(v.exists("/p/src/a.ts"), false);
});

const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

async function shellOut(cmd: string, wait: RegExp) {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w, "desk");
  const sid = w.resolve("shell-billing")!;
  assert.ok(sid, "a shell session exists");
  const a = await c.req("term_attach", { sid });
  const seq0 = a.r.seq;
  c.msgs.length = 0;
  void c.req("term_write", { sid, data: cmd + "\r" });
  const read = () => c.msgs.filter((m) => m.t === "term" && m.sid === sid && m.seq > seq0).map((m) => decode(m.d)).join("");
  try {
    let out = "";
    for (let i = 0; i < 60 && !wait.test(strip(out)); i++) {
      await w.clock.advance(500);
      await settle(4);
      out = read();
    }
    // The reply arrives in several chunks: let the rest land before reading it (a busy machine delivers late).
    await settle(40);
    return strip(read());
  } finally {
    c.close();
    w.dispose();
  }
}

test("shell: pwd, ls and git status answer like a real terminal", async () => {
  assert.match(await shellOut("pwd", /billing-api/), /\/Users\/demo\/code\/billing-api/);
  const ls = await shellOut("ls", /package\.json/);
  assert.match(ls, /package\.json/);
  assert.match(ls, /src/);
  const git = await shellOut("git status", /On branch/);
  assert.match(git, /On branch feat\/webhook-retries/);
  const nope = await shellOut("frobnicate", /not found/);
  assert.match(nope, /command not found/);
});

test("terminal stream: snapshot plus the chunks after it equals a fresh snapshot", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "grid" });
  const c = await open(w, "desk");
  const sid = w.resolve("claude-billing")!;
  const first = await c.req("term_attach", { sid });
  c.msgs.length = 0;
  for (let i = 0; i < 6; i++) {
    await w.clock.advance(1000);
    await settle(6);
  }
  await settle(60); // a busy machine delivers the last chunks late
  const chunks = c.msgs.filter((m) => m.t === "term" && m.sid === sid && m.seq > first.r.seq);
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].seq > chunks[i - 1].seq, "chunk seq grows");
  const rebuilt = first.r.snapshot + chunks.map((m) => decode(m.d)).join("");
  const second = await c.req("term_attach", { sid });
  assert.equal(strip(second.r.snapshot), strip(rebuilt));
  assert.equal(second.r.seq, chunks.at(-1)?.seq ?? first.r.seq);
  c.close();
  w.dispose();
});

test("reset keeps the ids and drops what the visitor did", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "idle" });
  const c = await open(w, "desk");
  const before = Object.keys(snapshotOf(c).sessions).sort();
  const ws = snapshotOf(c).workspaces[0].id;
  const r = await c.req("session_start", { workspace_id: ws, profile_id: "shell" }, 4000);
  assert.ok(r.ok);
  w.reset();
  await c.until(() => c.msgs.filter((m) => m.t === "snapshot").length >= 2);
  const after = Object.keys(c.msgs.filter((m) => m.t === "snapshot").at(-1).state.sessions).sort();
  assert.deepEqual(after, before);
  c.close();
  w.dispose();
});

test("Restart service: the page shows a fresh start, the agents keep working", async () => {
  const w = await createWorld({ latency: 0, auto: false, now: NOW, scene: "grid" });
  const c = await open(w, "desk");
  try {
    const before = (await c.req("host_system", {})).r;
    await w.clock.advance(60_000);
    const r = await c.req("host_restart", {});
    assert.ok(r.ok, "the restart is answered");
    const after = (await c.req("host_system", {})).r;
    assert.equal(after.restarts, before.restarts + 1);
    assert.ok(after.started_at > before.started_at, "the service says it started just now");
    const working = Object.values(snapshotOf(c).sessions).filter((s: any) => s.alive);
    assert.ok(working.length > 0, "nothing really stopped");
  } finally {
    c.close();
    w.dispose();
  }
});
