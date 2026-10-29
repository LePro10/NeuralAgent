// End-to-end smoke test for neuralagentd over its local WebSocket.
// Usage: NEURALAGENT_HOME=<dir> node scripts/daemon-smoke.mjs   (daemon must be running)
import { readFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.NEURALAGENT_HOME;
if (!home) throw new Error("set NEURALAGENT_HOME");
const info = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"));

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  const seen = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "ev") seen.push(m);
    if (m.t === "res" && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.ok ? resolve(m.r) : reject(new Error(`${m.err.code}: ${m.err.message}`));
    }
    for (const l of listeners) l(m);
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", v: 1, client: { kind: "desktop", name: "smoke" } }));
    ws.onerror = reject;
    listeners.add((m) => m.t === "hello_ok" && resolve(m));
  });
  const req = (m, p) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ t: "req", id, req: p === undefined ? { m } : { m, p } }));
    });
  // Events can arrive before the response to the request that caused them: check those too.
  const waitFor = (pred, ms = 8000) =>
    new Promise((resolve, reject) => {
      const past = seen.find(pred);
      if (past) return resolve(past);
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      const l = (m) => {
        if (pred(m)) {
          clearTimeout(t);
          listeners.delete(l);
          resolve(m);
        }
      };
      listeners.add(l);
    });
  return { ws, ready, req, waitFor, send: (m) => ws.send(JSON.stringify(m)) };
}

const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  console.log(`ok - ${what}`);
};

const a = connect();
const hello = await a.ready;
ok(hello.v === 1 && hello.host.name, "hello");
a.send({ t: "sub" });
const snap = await a.waitFor((m) => m.t === "snapshot");
ok(Array.isArray(snap.state.workspaces), "snapshot");

const ws = await a.req("workspace_add", { path: process.env.SMOKE_DIR || "/tmp" });
ok(ws.id, "workspace_add");
const s = await a.req("session_start", { workspace_id: ws.id, profile_id: "shell", cols: 100, rows: 30 });
ok(s.id && s.alive, "session_start shell");
const layoutEv = await a.waitFor((m) => m.t === "ev" && m.ev.e === "layout_set" && JSON.stringify(m.ev.layout).includes(s.id));
ok(layoutEv, "session placed in layout");

const att = await a.req("term_attach", { sid: s.id });
ok(typeof att.snapshot === "string" && att.cols === 100, "term_attach");
let out = "";
a.waitFor((m) => {
  if (m.t === "term" && m.sid === s.id) out += Buffer.from(m.d, "base64").toString();
  return false;
}, 60000).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await a.req("term_write", { sid: s.id, data: "echo smoke-$((40+2))\r" });
await new Promise((r) => setTimeout(r, 1200));
ok(out.includes("smoke-42"), "shell output streamed");

// Second client: attach must reproduce the screen (persistent terminal).
const b = connect();
await b.ready;
const att2 = await b.req("term_attach", { sid: s.id });
ok(att2.snapshot.includes("smoke-42"), "second client snapshot has output");

// Reconnect with since: replay instead of snapshot.
const seq = snap.seq;
b.send({ t: "sub", since: seq });
const first = await b.waitFor((m) => m.t === "ev" || m.t === "snapshot");
ok(first.t === "ev", "sub since replays events");

await a.req("term_resize", { sid: s.id, cols: 80, rows: 20 });
const up = await a.waitFor((m) => m.t === "ev" && m.ev.e === "session_upsert" && m.ev.session.id === s.id && m.ev.session.cols === 80);
ok(up, "resize propagates");

await a.req("session_close", { id: s.id });
await a.waitFor((m) => m.t === "ev" && m.ev.e === "session_removed");
ok(true, "session_close");
await a.req("workspace_remove", { id: ws.id });
console.log("all ok");
process.exit(0);
