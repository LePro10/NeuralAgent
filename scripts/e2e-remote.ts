// End-to-end test of remote access: a local relay (test login), a daemon that signs in to it,
// and a simulated phone that pairs by code and drives a shell through the relay, sealed end to
// end. Nothing here touches the real relay or the user's NeuralAgent home.
//
// Usage: cargo build -p na-daemon && cargo build -p na-relay --features test-login
//        node --experimental-strip-types scripts/e2e-remote.ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64, clientStart, exportPublic, fingerprint, generateStaticKey, unb64, type Session } from "../packages/crypto/src/index.ts";

const root = new URL("..", import.meta.url).pathname;
const RELAY_PORT = 8090;
const RELAY = `http://127.0.0.1:${RELAY_PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "na-e2e-"));
const wsDir = join(tmp, "workspace");
const other = join(tmp, "other");
mkdirSync(wsDir);
mkdirSync(other);
const procs: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cleanup() {
  for (const p of procs) p.kill("SIGKILL");
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}
process.on("exit", cleanup);
process.on("unhandledRejection", (e) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  if (process.env.E2E_LOGS) console.error(relayLog(), daemonLog());
  process.exit(1);
});

const ok = (cond: unknown, what: string) => {
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
  console.log(`ok - ${what}`);
};

async function until<T>(f: () => T | undefined | Promise<T | undefined>, what: string, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timeout: ${what}`);
}

function run(bin: string, args: string[], env: Record<string, string>) {
  const p = spawn(join(root, "target/debug", bin), args, { env: { ...process.env, RUST_LOG: "info", ...env }, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  p.stderr!.on("data", (d) => (log += d));
  procs.push(p);
  return () => log;
}

// ───────────── relay and daemon ─────────────

let daemonLog = () => "";
const relayLog = run("neuralagent-relay", [], {
  NA_RELAY_BIND: `127.0.0.1:${RELAY_PORT}`,
  PUBLIC_URL: RELAY,
  NA_RELAY_DB: join(tmp, "relay.db"),
  NA_RELAY_TEST_LOGIN: "1",
  ADMIN_EMAILS: "owner@e2e.test",
});
await until(() => fetch(`${RELAY}/api/health`).then((r) => r.ok).catch(() => false), "relay up");
ok(true, "relay running");

const home = join(tmp, "home");
daemonLog = run("neuralagentd", ["serve"], { NEURALAGENT_HOME: home, NEURALAGENT_RELAY: RELAY });
const info = await until(() => {
  try {
    return JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")) as { port: number; token: string };
  } catch {
    return undefined;
  }
}, "daemon up");

/** A protocol client over any transport: `send` takes a JSON string. */
function client(send: (text: string) => void) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const seen: any[] = [];
  const onMessage = (m: any) => {
    seen.push(m);
    if (m.t === "res" && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      m.ok ? p.resolve(m.r) : p.reject(Object.assign(new Error(`${m.err.code}: ${m.err.message}`), { code: m.err.code }));
    }
  };
  const req = (m: string, p?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      setTimeout(() => pending.delete(id) && reject(new Error(`no answer to ${m}`)), 15000);
      send(JSON.stringify({ t: "req", id, req: p === undefined ? { m } : { m, p } }));
    });
  const waitFor = (pred: (m: any) => boolean, what: string, ms = 10000) => until(() => seen.find(pred), what, ms);
  return { onMessage, req, waitFor, seen, send: (m: unknown) => send(JSON.stringify(m)) };
}

const dws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
const desk = client((t) => dws.send(t));
dws.onmessage = (e) => desk.onMessage(JSON.parse(String(e.data)));
await new Promise((r) => (dws.onopen = r));
desk.send({ t: "hello", v: 1, client: { kind: "desktop", name: "e2e desktop" } });
await desk.waitFor((m) => m.t === "hello_ok", "desktop hello");
desk.send({ t: "sub" });
await desk.waitFor((m) => m.t === "snapshot", "desktop snapshot");
let remote: any = desk.seen.find((m) => m.t === "snapshot").state.remote;
const remoteNow = () => {
  for (const m of desk.seen) if (m.t === "ev" && m.ev.e === "remote_set") remote = m.ev.remote;
  return remote;
};
ok(remote.status === "signed_out", "daemon starts signed out");

// ───────────── sign-in (browser → relay → daemon loopback) ─────────────

const { url } = await desk.req("remote_sign_in", { provider: "test", message: "e2e" });
ok(url.startsWith(`${RELAY}/auth/test/start?`) && url.includes("code_challenge="), "sign-in URL with PKCE");
const page = await fetch(`${url}&email=owner@e2e.test&name=Owner`).then((r) => r.text());
ok(page.includes("You're signed in"), "browser comes back to the daemon");
await until(() => remoteNow().status === "online", "daemon online");
ok(remoteNow().account?.email === "owner@e2e.test" && remoteNow().fingerprint, "account and fingerprint in state");
ok(!JSON.stringify(desk.seen).includes("refresh"), "no tokens in the shared state");

// ───────────── workspaces ─────────────

const ws = await desk.req("workspace_add", { path: wsDir, name: "approved" });
await desk.req("workspace_update", { id: ws.id, approved: true });
// New workspaces are approved by default (D-decision); take it back for this one.
const ws2 = await desk.req("workspace_add", { path: other, name: "not approved" });
await desk.req("workspace_update", { id: ws2.id, approved: false });

// ───────────── add phone by code ─────────────

const pair = await desk.req("remote_pair");
ok(pair.url.startsWith(`${RELAY}/app/pair#c=`) && pair.expires_in === 120, "pairing code");
const frag = new URLSearchParams(pair.url.split("#")[1]);
const phoneKey = await generateStaticKey();
const redeem = await fetch(`${RELAY}/api/pair/redeem`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: frag.get("c"), device: { name: "E2E Phone", platform: "android", kind: "client", pubkey: b64(await exportPublic(phoneKey)) } }),
}).then((r) => r.json());
ok(redeem.tokens?.access && redeem.host.id === frag.get("h"), "phone redeems the code");
const hostPub = unb64(redeem.host.pubkey);
await until(() => remoteNow().devices.some((d: any) => d.name === "E2E Phone" && !d.online), "new phone listed on the desktop");
ok(true, "paired phone appears on the desktop at once");
ok((await fingerprint(hostPub)) === frag.get("f"), "host key matches the fingerprint from the QR");
const again = await fetch(`${RELAY}/api/pair/redeem`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: frag.get("c"), device: { name: "x", platform: "android", kind: "client", pubkey: b64(await exportPublic(phoneKey)) } }),
});
ok(again.status >= 400, "a code works only once");

// ───────────── phone ↔ relay ↔ daemon, sealed ─────────────

const rws = new WebSocket(`${RELAY.replace("http", "ws")}/ws`);
const relayIn: any[] = [];
rws.onmessage = (e) => relayIn.push(JSON.parse(String(e.data)));
await new Promise((r) => (rws.onopen = r));
rws.send(JSON.stringify({ t: "auth", token: redeem.tokens.access }));
await until(() => relayIn.find((m) => m.t === "ready"), "phone ready on relay");
await until(() => relayIn.find((m) => m.t === "presence" && m.devices.some((d: any) => d.id === redeem.host.id && d.online)), "host online in presence");
const route = (env: unknown) => rws.send(JSON.stringify({ t: "route", to: redeem.host.id, env: JSON.stringify(env) }));
const envs = () => relayIn.filter((m) => m.t === "route").map((m) => ({ from: m.from, ...JSON.parse(m.env) }));

// A handshake with a key that is not the phone's registered key is ignored.
const stranger = await generateStaticKey();
const bad = await clientStart(stranger, hostPub);
route({ k: "hs1", sid: "bad", e: b64(bad.e), c: b64(bad.c) });
await sleep(800);
ok(!envs().some((e) => e.sid === "bad"), "handshake with a foreign key refused");

const hs = await clientStart(phoneKey, hostPub);
route({ k: "hs1", sid: "s1", e: b64(hs.e), c: b64(hs.c) });
const hs2 = await until(() => envs().find((e) => e.k === "hs2" && e.sid === "s1"), "handshake reply");
const session: Session = await hs.finish(unb64(hs2.f));
ok(true, "end-to-end session established");

const enc = new TextEncoder();
const dec = new TextDecoder();
const phone = client((text) => {
  void session.seal(enc.encode(text)).then((ct) => route({ k: "d", sid: "s1", ct: b64(ct) }));
});
let handled = 0;
const pump = setInterval(async () => {
  const list = envs().filter((e) => e.k === "d" && e.sid === "s1");
  while (handled < list.length) {
    const e = list[handled++];
    phone.onMessage(JSON.parse(dec.decode(await session.open(unb64(e.ct)))));
  }
}, 20);

// It claims to be the desktop; the daemon decides from the relay's device record instead.
phone.send({ t: "hello", v: 1, client: { kind: "desktop", name: "liar" } });
await phone.waitFor((m) => m.t === "hello_ok", "phone hello over the relay");
ok(true, "hello over the relay");
ok(!relayIn.some((m) => m.t === "route" && m.env.includes("hello_ok")), "relay only sees ciphertext");
phone.send({ t: "sub" });
const snap = await phone.waitFor((m) => m.t === "snapshot", "phone snapshot");
ok(snap.state.workspaces.length === 2, "phone sees the state");
ok(remoteNow().devices.some((d: any) => d.name === "E2E Phone" && d.online), "desktop sees the phone online");

await phone.req("remote_pair").then(
  () => ok(false, "phone may not pair"),
  (e) => ok(e.code === "needs_approval", "phone is not treated as the desktop"),
);
await phone.req("session_start", { workspace_id: ws2.id, profile_id: "shell", cols: 80, rows: 24 }).then(
  () => ok(false, "start outside approved workspace"),
  (e) => ok(e.code === "needs_approval", "no agent outside an approved workspace"),
);

const s = await phone.req("session_start", { workspace_id: ws.id, profile_id: "shell", cols: 100, rows: 30 });
ok(s.id && s.alive, "phone starts a shell in the approved workspace");
await phone.req("term_attach", { sid: s.id });
await sleep(1200);
await phone.req("term_write", { sid: s.id, data: "echo remote-$((40+2))\r" });
await until(
  () => phone.seen.filter((m) => m.t === "term" && m.sid === s.id).map((m) => Buffer.from(m.d, "base64").toString()).join("").includes("remote-42"),
  "shell output on the phone",
);
ok(true, "typed on the phone, output streamed back through the relay");

// The emergency switch works from the phone and cuts the connection.
await phone.req("remote_enable", { enabled: false });
await until(() => remoteNow().status === "off", "remote off");
ok(true, "disconnect remote from the phone");
await until(() => relayIn.find((m) => m.t === "presence" && m.devices.some((d: any) => d.id === redeem.host.id && !d.online)), "host offline for the phone");
ok(true, "host left the relay");
await desk.req("remote_enable", { enabled: true });
await until(() => remoteNow().status === "online", "online again");
ok(true, "desktop switches remote back on");

// Revoke the phone from the desktop: the relay drops it at once.
const phoneId = remoteNow().devices.find((d: any) => d.name === "E2E Phone").id;
await desk.req("remote_revoke", { device_id: phoneId });
await until(() => rws.readyState === WebSocket.CLOSED || relayIn.some((m) => m.t === "revoked"), "phone revoked");
ok(true, "revoked phone is cut off");

await desk.req("remote_sign_out");
await until(() => remoteNow().status === "signed_out", "signed out");
ok(true, "sign out");

clearInterval(pump);
if (process.env.E2E_LOGS) console.log(relayLog(), daemonLog());
console.log("all ok");
process.exit(0);
