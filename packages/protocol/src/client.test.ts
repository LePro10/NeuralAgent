import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { DaemonClient, PING_EVERY, PING_TIMEOUT, SEND_STALL, WAKE_TIMEOUT, type Transport } from "./client.ts";

/** A transport the test plays the daemon on. */
class Fake implements Transport {
  sent: any[] = [];
  closed = false;
  stale = mock.fn();
  sending?: () => number;
  onmessage: ((text: string) => void) | null = null;
  onclose: ((reason: string) => void) | null = null;
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
  }
  in(m: object) {
    this.onmessage?.(JSON.stringify(m));
  }
  last(t: string) {
    return this.sent.filter((m) => m.t === t).at(-1);
  }
}

const host = { name: "Mac", os: "macos" } as any;
const state = { workspaces: [], layouts: {}, sessions: {}, profiles: [] } as any;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A client whose `connect` hands out fresh fakes; the daemon side answers hello and sub. */
async function setup() {
  const ts: Fake[] = [];
  const c = new DaemonClient(async () => {
    const t = new Fake();
    ts.push(t);
    return t;
  }, { kind: "web", name: "test" } as any);
  await flush();
  const t = ts[0]!;
  t.in({ t: "hello_ok", v: 1, daemon_version: "1", host });
  t.in({ t: "snapshot", seq: 5, state });
  return { c, ts };
}

test("a dead connection is noticed by the heartbeat and replaced at once", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const { c, ts } = await setup();
    assert.equal(c.status, "open");
    // Quiet but alive: a ping, answered, keeps it open.
    mock.timers.tick(PING_EVERY + 2000);
    assert.ok(ts[0]!.last("ping"), "pings after silence");
    ts[0]!.in({ t: "pong", at: 1 });
    mock.timers.tick(PING_TIMEOUT + 2000);
    assert.equal(c.status, "open");
    // Silent after the next ping: dead, the carrier is told, a new transport opens right away.
    mock.timers.tick(PING_EVERY + PING_TIMEOUT + 4000);
    await flush();
    assert.equal(ts[0]!.closed, true);
    assert.equal(ts[0]!.stale.mock.callCount(), 1);
    assert.equal(ts.length, 2, "reconnected without waiting for a backoff");
    // Resume: `sub since`, and the daemon's pong (nothing missed) makes it live again.
    ts[1]!.in({ t: "hello_ok", v: 1, daemon_version: "1", host });
    assert.deepEqual(ts[1]!.last("sub"), { t: "sub", since: 5 });
    assert.equal(c.status, "connecting");
    ts[1]!.in({ t: "pong", at: 2 });
    assert.equal(c.status, "open");
    assert.ok(c.state, "the state stayed through the reconnect");
    c.close();
  } finally {
    mock.timers.reset();
  }
});

test("requests made while reconnecting wait for the connection", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const { c, ts } = await setup();
    ts[0]!.onclose?.("gone");
    assert.equal(c.status, "offline");
    const r = c.req<string>({ m: "fs_roots" } as any);
    mock.timers.tick(10);
    await flush();
    const t = ts[1]!;
    t.in({ t: "hello_ok", v: 1, daemon_version: "1", host });
    await flush();
    const sent = t.last("req");
    assert.equal(sent?.req.m, "fs_roots", "sent once the connection is back");
    t.in({ t: "res", id: sent.id, ok: true, r: "ok" });
    assert.equal(await r, "ok");
    c.close();
  } finally {
    mock.timers.reset();
  }
});

test("poke checks an open connection quickly and reconnects a dead one", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const { c, ts } = await setup();
    c.poke();
    assert.ok(ts[0]!.last("ping"), "poke pings an open connection");
    mock.timers.tick(WAKE_TIMEOUT + 100);
    await flush();
    assert.equal(ts.length, 2, "no answer within the wake timeout: new connection");
    c.close();
  } finally {
    mock.timers.reset();
  }
});

test("a big upload on a slow uplink is not mistaken for a dead connection", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const { c, ts } = await setup();
    let out = 0;
    ts[0]!.sending = () => out;
    // A 2 MB request: at a slow uplink the daemon's answers wait behind it.
    void c.req({ m: "upload", p: { sid: "s", name: "a.jpg", data: "x".repeat(2_000_000) } } as any).catch(() => {});
    out = 1_500_000;
    mock.timers.tick(PING_EVERY + PING_TIMEOUT + 4000);
    await flush();
    assert.equal(ts.length, 1, "still the same connection while the upload goes out");
    assert.equal(c.status, "open");
    // Stuck for good (nothing moves, nothing arrives): dead after all.
    mock.timers.tick(SEND_STALL + 2000);
    await flush();
    assert.equal(ts.length, 2, "a stalled send ends in a reconnect");
    c.close();
  } finally {
    mock.timers.reset();
  }
});
