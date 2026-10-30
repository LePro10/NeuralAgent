import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { b64, exportPublic, generateStaticKey } from "@neuralagent/crypto";
import { memoryKeyStore, memoryStore, RELAY_PING_EVERY, RELAY_PING_TIMEOUT, RELAY_WAKE_TIMEOUT, RelayLink, RemoteAccount } from "./index.ts";

/** Stands in for the browser's WebSocket; the test plays the relay. */
class FakeWs {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeWs[] = [];
  readyState = FakeWs.CONNECTING;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWs.all.push(this);
  }
  send(t: string) {
    if (this.readyState !== FakeWs.OPEN) throw new Error("not open");
    this.sent.push(JSON.parse(t));
  }
  close() {
    if (this.readyState === FakeWs.CLOSED) return;
    this.readyState = FakeWs.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeWs.OPEN;
    this.onopen?.();
  }
  in(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  routed(k: string) {
    return this.sent.filter((m) => m.t === "route").map((m) => JSON.parse(m.env)).filter((e) => e.k === k);
  }
}

const user = { id: "u", email: "a@b.c", name: "A", status: "approved", is_admin: false, remote: true };
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

async function setup() {
  FakeWs.all = [];
  (globalThis as any).WebSocket = FakeWs;
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ access: "acc", refresh: "r2", expires_in: 900, device_id: "phone", user }), { status: 200 });
  const hostKey = b64(await exportPublic(await generateStaticKey()));
  const store = memoryStore();
  await store.set("account", JSON.stringify({ device_id: "phone", refresh: "r1", user, hosts: {} }));
  const account = await RemoteAccount.open({ relay: "http://relay.test", store, keys: memoryKeyStore(), device: { name: "t", platform: "android" } });
  const link = new RelayLink(account);
  const online = async (ws: FakeWs) => {
    ws.open();
    ws.in({ t: "ready", device: "phone", user });
    ws.in({ t: "presence", devices: [{ id: "mac", kind: "host", online: true, pubkey: hostKey, name: "Mac", platform: "macos", last_seen: 0, created_at: 0 }] });
  };
  return { link, online };
}

test("a session opened while the relay socket is down waits for the next socket", async () => {
  const { link, online } = await setup();
  link.start();
  await flush();
  await online(FakeWs.all[0]!);
  assert.equal(link.status, "online");
  FakeWs.all[0]!.close();
  assert.equal(link.status, "offline");
  // Before the fix this routed the handshake into the closed socket and hung for 15 s.
  const pending = link.transport("mac")();
  pending.catch(() => {});
  await flush();
  assert.equal(FakeWs.all[0]!.routed("hs1").length, 0);
  link.wake();
  await flush();
  const ws2 = FakeWs.all[1]!;
  assert.ok(ws2, "wake reconnects at once");
  await online(ws2);
  await flush();
  assert.equal(ws2.routed("hs1").length, 1, "the handshake goes out on the new socket");
  link.stop();
});

test("heartbeat: a relay that answers pings is judged by them", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const { link, online } = await setup();
    link.start();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // fetch resolves on the real event loop: let it, with the clock frozen.
    mock.timers.reset();
    await flush();
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    const ws = FakeWs.all[0]!;
    await online(ws);
    assert.ok(ws.sent.some((m) => m.t === "ping"), "asks once whether this relay answers pings");
    ws.in({ t: "pong" });
    mock.timers.tick(RELAY_PING_EVERY + 2000);
    assert.equal(ws.sent.filter((m) => m.t === "ping").length, 2, "pings after silence");
    ws.in({ t: "pong" });
    mock.timers.tick(RELAY_PING_TIMEOUT + 2000);
    assert.equal(link.status, "online", "answered: still online");
    // Wake: a quick check; no answer means the socket is dead and is replaced at once.
    link.wake();
    mock.timers.tick(RELAY_WAKE_TIMEOUT + 100);
    assert.notEqual(link.status, "online");
    assert.equal(ws.onclose, null, "the dead socket was let go");
    assert.equal(link.status, "connecting", "and a new one is on its way without a backoff");
    link.stop();
  } finally {
    mock.timers.reset();
  }
});
