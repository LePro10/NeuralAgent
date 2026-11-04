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
  await new Promise((r) => setTimeout(r, 20));
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

// ---- extended connector ----
import { INVITE_PERMISSIONS, INTENT_MEMBERS } from "./index.mjs";
const out_ = (r) => JSON.parse(r.result.content[0].text);
const envWith = (cfg) => ({ ...env, NA_CONFIG: JSON.stringify({ channels: ["c1"], ...cfg }) });
function recorder(handler) {
  const calls = [];
  return { calls, fetchImpl: async (u, i = {}) => { const path = u.replace("https://discord.com/api/v10", ""); calls.push({ path, method: i.method || "GET", body: i.body ? JSON.parse(i.body) : undefined, headers: i.headers }); return handler(path, i) ?? json({}); } };
}

test("invite permissions: exactly the needed bits, no Administrator", () => {
  const P = BigInt(INVITE_PERMISSIONS);
  const bits = { view: 1n << 10n, send: 1n << 11n, sendThreads: 1n << 38n, createPublic: 1n << 35n, history: 1n << 16n, react: 1n << 6n, manage: 1n << 13n };
  assert.equal(P, Object.values(bits).reduce((a, b) => a | b, 0n));
  assert.equal(INVITE_PERMISSIONS, 309237722176);
  assert.equal(P & (1n << 3n), 0n);
});

test("manifest: write tools have a reason, classes, setup fields", async () => {
  assert.equal(manifest.tools.create_thread, "write");
  assert.equal(manifest.tools.pin_message, "write");
  for (const t of ["list_roles", "list_members", "search_messages", "get_message"]) assert.equal(manifest.tools[t], "read");
  for (const banned of ["ban", "kick", "timeout", "delete", "send_dm"]) assert.ok(!Object.keys(manifest.tools).some((k) => k.includes(banned)));
  const c = build({ env, fetchImpl: async () => json({}) });
  const r = await c.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  for (const t of r.result.tools) if (["external", "write"].includes(manifest.tools[t.name])) assert.ok(JSON.stringify(t).includes("reason"), t.name);
  assert.ok(manifest.setup.find((f) => f.key === "log_channel" && f.from === "list_channels"));
  assert.ok(manifest.setup.find((f) => f.key === "events"));
});

test("list_roles, list_members, get_message", async () => {
  const rec = recorder((p) => {
    if (p === "/users/@me/guilds") return json([{ id: "g" }]);
    if (p === "/guilds/g/roles") return json([{ id: "r1", name: "Mod", position: 2 }]);
    if (p.startsWith("/guilds/g/members")) return json([{ user: { id: "u", username: "ann" }, nick: "Annie", roles: ["r1"], joined_at: "t" }]);
    if (p === "/channels/c1/messages/m1") return json({ id: "m1", channel_id: "c1", content: "hey", author: { id: "u", username: "ann" } });
  });
  const c = build({ env, fetchImpl: rec.fetchImpl });
  assert.deepEqual(out_(await call(c, "list_roles")).map((r) => r.name), ["Mod"]);
  const ms = out_(await call(c, "list_members", { guild_id: "g", limit: 500, after: "5" }));
  assert.equal(ms[0].name, "Annie");
  assert.match(rec.calls.at(-1).path, /limit=100&after=5/);
  assert.equal(out_(await call(c, "get_message", { channel_id: "c1", message_id: "m1" })).text, "hey");
});

test("search_messages scans pages client-side", async () => {
  const mk = (i, t) => ({ id: String(i), channel_id: "c1", content: t, author: { id: "u", username: "a" } });
  const page1 = Array.from({ length: 100 }, (_, i) => mk(1000 - i, i === 3 ? "Where is the Invoice?" : "x"));
  const page2 = [mk(5, "invoice again"), mk(4, "nope")];
  const rec = recorder((p) => (p.includes("before=901") ? json(page2) : json(page1)));
  const c = build({ env, fetchImpl: rec.fetchImpl });
  const hits = out_(await call(c, "search_messages", { channel_id: "c1", query: "invoice", limit: 5 }));
  assert.deepEqual(hits.map((h) => h.id), ["997", "5"]);
  assert.equal(rec.calls.length, 2);
});

test("create_thread (on a message and free) and pin_message pass the reason", async () => {
  const rec = recorder((p) => (p.includes("thread") ? json({ id: "t1" }) : null));
  const c = build({ env, fetchImpl: rec.fetchImpl });
  const r = out_(await call(c, "create_thread", { channel_id: "c1", message_id: "m1", name: "Bug", reason: "needs room" }));
  assert.equal(r.thread_id, "t1");
  assert.equal(rec.calls[0].path, "/channels/c1/messages/m1/threads");
  assert.equal(rec.calls[0].headers["X-Audit-Log-Reason"], "needs%20room");
  await call(c, "create_thread", { channel_id: "c1", name: "Free" });
  assert.equal(rec.calls[1].path, "/channels/c1/threads");
  assert.equal(rec.calls[1].body.type, 11);
  await call(c, "pin_message", { channel_id: "c1", message_id: "m1" });
  assert.deepEqual([rec.calls[2].method, rec.calls[2].path], ["PUT", "/channels/c1/pins/m1"]);
});

test("log channel: one line per write/external action with the reason; reads and failures stay quiet", async () => {
  const rec = recorder((p) => (p.includes("?limit") ? json([]) : json({ id: "m9" })));
  const c = build({ env: envWith({ log_channel: ["log1"] }), fetchImpl: rec.fetchImpl });
  await call(c, "reply", { channel_id: "c1", message_id: "m1", text: "SECRET-BODY", reason: "user asked" });
  await call(c, "pin_message", { channel_id: "c1", message_id: "m1" });
  await call(c, "read_messages", { channel_id: "c1" });
  const logs = rec.calls.filter((x) => x.path === "/channels/log1/messages");
  assert.equal(logs.length, 2);
  assert.match(logs[0].body.content, /replied.*<#c1>.*Reason: user asked/);
  assert.match(logs[1].body.content, /pinned.*No reason given/);
  for (const l of logs) { assert.ok(!l.body.content.includes("SECRET-BODY")); assert.ok(!JSON.stringify(l.body).includes("tok")); assert.deepEqual(l.body.allowed_mentions, { parse: [] }); }
  // log channel failing must not fail the action
  const bad = build({ env: envWith({ log_channel: "log1" }), fetchImpl: async (u, i) => (u.includes("/log1/") ? json({ message: "Missing Access" }, 403) : json({ id: "m" })) });
  const r = await call(bad, "send_message", { channel_id: "c1", text: "x" });
  assert.ok(!r.result.isError);
  // no log channel set: only the one call
  const rec2 = recorder(() => json({ id: "m" }));
  await call(build({ env, fetchImpl: rec2.fetchImpl }), "send_message", { channel_id: "c1", text: "x" });
  assert.equal(rec2.calls.length, 1);
});

test("429: retry_after from header or body, global flag, all REST verbs, gives up in plain words", async () => {
  for (const [tool, args] of [["list_roles", { guild_id: "g" }], ["add_reaction", { channel_id: "c1", message_id: "m", emoji: "👍" }], ["pin_message", { channel_id: "c1", message_id: "m" }], ["create_thread", { channel_id: "c1", name: "n" }], ["get_message", { channel_id: "c1", message_id: "m" }]]) {
    let n = 0;
    const c = build({ env, retryScale: 0, fetchImpl: async () => (n++ < 2 ? json({ message: "You are being rate limited.", retry_after: 0.01, global: n === 1 }, 429) : json([])) });
    const r = await call(c, tool, args);
    assert.equal(n, 3, tool);
    assert.ok(!r.result.isError, tool);
  }
  let n = 0;
  const waits = [];
  const real = globalThis.setTimeout;
  const c = build({ env, retryScale: 0, fetchImpl: async () => { n++; return json({ retry_after: 0, global: true }, 429); } });
  const r = await call(c, "get_message", { channel_id: "c1", message_id: "m" });
  assert.equal(r.result.isError, true);
  assert.equal(n, 5);
  void waits; void real;
});

test("gateway: threads, DMs, member_joined, reactions; toggles; bots ignored", async () => {
  const out = [];
  const fetchImpl = async (u) => (u.endsWith("/channels/th1") ? json({ id: "th1", type: 11, parent_id: "c1" }) : u.endsWith("/channels/th2") ? json({ id: "th2", type: 11, parent_id: "zzz" }) : json({}));
  async function run(cfg, frames) {
    out.length = 0;
    const c = build({ env: envWith(cfg), fetchImpl, WebSocketImpl: FakeWS, retryScale: 0, output: { write: (s) => out.push(JSON.parse(s).params) } });
    c.connect();
    const ws = FakeWS.last;
    ws.recv({ op: 10, d: { heartbeat_interval: 1e9 } });
    ws.recv({ op: 0, s: 1, t: "READY", d: { session_id: "S", resume_gateway_url: "wss://r", user: { id: "bot" } } });
    for (const [t, d] of frames) ws.recv({ op: 0, s: 2, t, d });
    await new Promise((r) => setTimeout(r, 20));
    c.stop();
    return ws;
  }
  const msg = (o) => ["MESSAGE_CREATE", { id: "m", channel_id: "c1", guild_id: "g", content: "hi", author: { id: "u", username: "ann" }, ...o }];
  const frames = [
    msg({ id: "t1", channel_id: "th1" }), msg({ id: "t2", channel_id: "th2" }),
    msg({ id: "d1", channel_id: "dm", guild_id: undefined }),
    msg({ id: "d2", channel_id: "dm", guild_id: undefined, author: { id: "b", bot: true } }),
    ["GUILD_MEMBER_ADD", { guild_id: "g", user: { id: "n", username: "newbie" }, joined_at: "T" }],
    ["GUILD_MEMBER_ADD", { guild_id: "g", user: { id: "bb", username: "bot2", bot: true } }],
    ["MESSAGE_REACTION_ADD", { guild_id: "g", channel_id: "c1", message_id: "m1", user_id: "u", emoji: { name: "👍" } }],
    ["MESSAGE_REACTION_ADD", { guild_id: "g", channel_id: "c1", message_id: "m1", user_id: "bot", emoji: { name: "👍" } }],
    ["MESSAGE_REACTION_ADD", { guild_id: "g", channel_id: "other", message_id: "m1", user_id: "u", emoji: { name: "👍" } }],
  ];
  // defaults: member_joined is off (privileged), no members intent requested
  let ws = await run({}, frames);
  assert.deepEqual(out.map((e) => e.id).sort(), ["discord:d1", "discord:react:m1:u:👍", "discord:t1"]);
  assert.equal(out.find((e) => e.id === "discord:t1").meta.thread, true);
  assert.equal(out.find((e) => e.id === "discord:d1").meta.dm, true);
  assert.equal(out.find((e) => e.type === "reaction_added").type, "reaction_added");
  assert.equal(ws.sent.find((m) => m.op === 2).d.intents & INTENT_MEMBERS, 0);
  // everything on
  ws = await run({ events: ["messages", "threads", "dms", "member_joined", "reaction_added"] }, frames);
  assert.equal(out.length, 4);
  const j = out.find((e) => e.type === "member_joined");
  assert.equal(j.text, "newbie joined the server");
  assert.equal(ws.sent.find((m) => m.op === 2).d.intents & INTENT_MEMBERS, INTENT_MEMBERS);
  // only plain messages
  await run({ events: ["messages"] }, [...frames, msg({ id: "plain" })]);
  assert.deepEqual(out.map((e) => e.id), ["discord:plain"]);
  // thread cache from THREAD_CREATE avoids a lookup
  let lookups = 0;
  const c2 = build({ env: envWith({}), fetchImpl: async () => { lookups++; return json({}); }, WebSocketImpl: FakeWS, retryScale: 0, output: { write: (s) => out.push(JSON.parse(s).params) } });
  out.length = 0;
  c2.connect();
  const w2 = FakeWS.last;
  w2.recv({ op: 10, d: { heartbeat_interval: 1e9 } });
  w2.recv({ op: 0, s: 1, t: "THREAD_CREATE", d: { id: "thX", parent_id: "c1" } });
  w2.recv({ op: 0, s: 2, t: "MESSAGE_CREATE", d: { id: "q", channel_id: "thX", guild_id: "g", content: "x", author: { id: "u", username: "a" } } });
  await new Promise((r) => setTimeout(r, 20));
  c2.stop();
  assert.equal(out.length, 1);
  assert.equal(lookups, 0);
});
