import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build, INTENTS } from "./index.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("./connector.json", import.meta.url), "utf8"));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const env = { NA_SECRET_BOT_TOKEN: "tok", NA_CONFIG: JSON.stringify({ channels: ["c1"] }), NA_STATE_DIR: "/tmp/na-test-discord" };

function call(c, name, args = {}) {
  return c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

test("every tool in the manifest exists and has a class", async () => {
  const c = build({ env, fetchImpl: async () => json({}) });
  const r = await c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = r.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, Object.keys(manifest.tools).sort());
  assert.ok(manifest.tools[manifest.check]);
});

test("whoami builds the invite link", async () => {
  const seen = [];
  const c = build({ env, fetchImpl: async (u, i) => { seen.push([u, i.headers.Authorization]); return u.endsWith("/users/@me") ? json({ id: "9", username: "MyBot" }) : json({ id: "123" }); } });
  const r = await call(c, "whoami");
  const out = JSON.parse(r.result.content[0].text);
  assert.equal(out.text, "Signed in as MyBot");
  assert.match(out.invite_url, /client_id=123/);
  assert.equal(seen[0][1], "Bot tok");
});

test("list_channels returns pick options", async () => {
  const c = build({
    env,
    fetchImpl: async (u) => (u.endsWith("/guilds") ? json([{ id: "g", name: "Srv" }]) : json([{ id: "c1", name: "general", type: 0 }, { id: "v", name: "voice", type: 2 }])),
  });
  const r = await call(c, "list_channels");
  assert.deepEqual(JSON.parse(r.result.content[0].text), [{ value: "c1", label: "Srv / #general" }]);
});

test("reply posts a message reference; errors are plain words", async () => {
  let body;
  const c = build({ env, fetchImpl: async (u, i) => { body = JSON.parse(i.body); return json({ id: "m2" }); } });
  await call(c, "reply", { channel_id: "c1", message_id: "m1", text: "hi" });
  assert.equal(body.message_reference.message_id, "m1");
  const bad = build({ env, fetchImpl: async () => json({ message: "Missing Access" }, 403) });
  const r = await call(bad, "send_message", { channel_id: "c1", text: "x" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /not allowed/);
});

test("429 is retried", async () => {
  let n = 0;
  const c = build({ env, retryScale: 0, fetchImpl: async () => (n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : json({ id: "1", username: "B" })) });
  const r = await call(c, "whoami");
  assert.equal(n >= 2, true);
  assert.ok(!r.result.isError);
});

class FakeWS {
  static last;
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; FakeWS.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code) { this.readyState = 3; this.onclose?.({ code }); }
  recv(o) { this.onmessage({ data: JSON.stringify(o) }); }
}

test("gateway: identify with message content intent, events for chosen channels only, bots ignored, resume", async () => {
  const out = [];
  const c = build({ env, WebSocketImpl: FakeWS, retryScale: 0, output: { write: (s) => out.push(JSON.parse(s)) } });
  c.connect();
  const ws = FakeWS.last;
  ws.recv({ op: 10, d: { heartbeat_interval: 1000000 } });
  const id = ws.sent.find((m) => m.op === 2);
  assert.equal(id.d.intents, INTENTS);
  assert.ok(id.d.intents & 32768, "message content intent");
  ws.recv({ op: 0, s: 1, t: "READY", d: { session_id: "S", resume_gateway_url: "wss://r.example", user: { id: "bot" } } });
  const msg = (o) => ({ op: 0, s: 2, t: "MESSAGE_CREATE", d: { id: "m1", channel_id: "c1", guild_id: "g", content: "hello", author: { id: "u", username: "ann" }, ...o } });
  ws.recv(msg({}));
  ws.recv(msg({ id: "m2", author: { id: "b", username: "x", bot: true } }));
  ws.recv(msg({ id: "m3", channel_id: "other" }));
  assert.equal(out.length, 1);
  assert.equal(out[0].method, "notifications/neuralagent/event");
  assert.equal(out[0].params.id, "discord:m1");
  assert.equal(out[0].params.text, "hello");
  assert.equal(out[0].params.author, "ann");
  // connection drops: reconnect resumes with the session
  ws.close(1006);
  await new Promise((r) => setTimeout(r, 20));
  const ws2 = FakeWS.last;
  assert.notEqual(ws2, ws);
  assert.match(ws2.url, /^wss:\/\/r\.example/);
  ws2.recv({ op: 10, d: { heartbeat_interval: 1000000 } });
  const resume = ws2.sent.find((m) => m.op === 6);
  assert.equal(resume.d.session_id, "S");
  assert.equal(resume.d.seq, 2);
  c.stop();
});
