// End-to-end test of remote access: a local relay (test login), a daemon that signs in to it,
// and a simulated phone that pairs by code and drives a shell through the relay, sealed end to
// end. Nothing here touches the real relay or the user's NeuralAgent home.
//
// Usage: cargo build -p na-daemon && cargo build -p na-relay --features test-login
//        node --experimental-strip-types scripts/e2e-remote.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64, clientStart, exportPublic, fingerprint, generateStaticKey, unb64, type Session } from "../packages/crypto/src/index.ts";
import { DaemonClient } from "../packages/protocol/src/client.ts";
import { memoryKeyStore, memoryStore, parsePairLink, RelayLink, RemoteAccount } from "../packages/remote/src/index.ts";

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
let relayLog = () => "";
const startRelay = () => {
  relayLog = run("neuralagent-relay", [], {
    NA_RELAY_BIND: `127.0.0.1:${RELAY_PORT}`,
    PUBLIC_URL: RELAY,
    NA_RELAY_DB: join(tmp, "relay.db"),
    NA_RELAY_TEST_LOGIN: "1",
    ADMIN_EMAILS: "owner@e2e.test",
  });
  // The relay is always procs[0], so a test can stop it.
  procs.unshift(procs.pop()!);
};
startRelay();
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
const signin = await fetch(`${url}&email=owner@e2e.test&name=Owner`);
const page = await signin.text();
ok(page.includes("You're signed in"), `browser comes back to the daemon (${signin.status} ${signin.url.replace(/\?.*/, "")}: ${page.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 160)})`);
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
await phone.req("term_write", { sid: s.id, data: "true\r" });
const audit: any[] = await desk.req("audit_list", {});
const acts = audit.map((a) => `${a.client}:${a.action}:${a.ok}`);
ok(acts.includes("android:session_start:true") && acts.includes("android:session_start:false"), "audit log has the phone's starts, refused ones too");
ok(acts.filter((a) => a === "android:term_write:true").length === 1, "typing is logged once a minute, not per keystroke");
const started = audit.find((a) => a.action === "session_start" && a.ok);
ok(started?.target === "approved" && audit[0].at >= audit.at(-1).at, `audit names the workspace, newest first (${started?.target})`);
ok(audit.find((a) => a.action === "term_write")?.target?.startsWith("approved — "), "audit names the agent typed into");

// ───────────── the web remote library (@neuralagent/remote) ─────────────

// A browser pairs by QR link, then drives the computer with the real DaemonClient.
const pairWeb = parsePairLink(new URL((await desk.req("remote_pair")).url).hash);
ok(pairWeb, "pairing link parses");
const webAcc = await RemoteAccount.open({ relay: RELAY, store: memoryStore(), keys: memoryKeyStore(), device: { name: "E2E Browser", platform: "web" } });
await webAcc.pair(pairWeb!.code, pairWeb!.host, "AAAA-BBBB").then(
  () => ok(false, "pairing with a wrong fingerprint"),
  (e) => ok(/does not match/.test(e.message) && !webAcc.signedIn, "library refuses a key that does not match the QR"),
);
const pairWeb2 = parsePairLink(new URL((await desk.req("remote_pair")).url).hash)!;
const host = await webAcc.pair(pairWeb2.code, pairWeb2.host, pairWeb2.fp);
ok(host.id === redeem.host.id && webAcc.trustedKey(host.id) === redeem.host.pubkey, "library pairs and pins the computer's key");
const link = new RelayLink(webAcc);
link.start();
await until(() => link.status === "online" && link.hosts.some((h) => h.id === host.id && h.online), "link online with the host");
ok(true, "relay link online, host visible");
const web = new DaemonClient(link.transport(host.id), { kind: "web", name: "E2E Browser" } as any);
await until(() => web.state, "web state over the relay");
ok(web.state!.workspaces.length === 2, "DaemonClient syncs state through the sealed transport");
await web.req({ m: "remote_pair" } as any).then(
  () => ok(false, "browser may not pair"),
  (e) => ok(e.code === "needs_approval", "browser is treated as a phone"),
);
let webOut = "";
const detach = web.attach(s.id, { reset: (snap) => void (webOut = snap), data: (b) => void (webOut += new TextDecoder().decode(b)) });
await sleep(800);
await web.req({ m: "term_write", p: { sid: s.id, data: "echo web-$((20+3))\r" } } as any);
await until(() => webOut.includes("web-23"), "web terminal output");
ok(true, "browser types into the shell and sees the output");
detach();

// Web Push: a mock push service stands in for Apple/Google and decrypts like a browser (RFC 8291).
const pushes: { auth: string; body: Buffer; path: string }[] = [];
const mock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    pushes.push({ auth: String(req.headers.authorization), body: Buffer.concat(chunks), path: req.url! });
    res.writeHead(201).end();
  });
}).listen(0, "127.0.0.1");
await new Promise((r) => mock.once("listening", r));
const mockPort = (mock.address() as any).port;
const subtle = crypto.subtle;
const ua = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
const uaPublic = new Uint8Array(await subtle.exportKey("raw", ua.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
await webAcc.api("PUT", "/api/me/push", { web: { endpoint: "https://evil.example/push", p256dh: b64u(uaPublic), auth: b64u(authSecret) } }).then(
  () => ok(false, "push to an unknown service"),
  () => ok(true, "relay refuses a push endpoint that is not a known push service"),
);
await webAcc.api("PUT", "/api/me/push", { web: { endpoint: `http://127.0.0.1:${mockPort}/push/e2e`, p256dh: b64u(uaPublic), auth: b64u(authSecret) } });
ok(true, "browser registers for Web Push");

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) =>
  new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));
async function openPush(body: Buffer) {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const peer = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: peer }, ua.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.subarray(21 + idlen)));
  ok(plain[plain.length - 1] === 2, "push is a single last record");
  return JSON.parse(dec.decode(plain.subarray(0, -1)));
}

// While the browser is on screen it gets no push; once hidden, an agent failing wakes it.
const failing = async () => {
  const x = await web.req({ m: "session_start", p: { workspace_id: ws.id, profile_id: "shell", cols: 80, rows: 24 } } as any);
  await sleep(800);
  await web.req({ m: "term_write", p: { sid: x.id, data: "exit 3\r" } } as any);
  return x.id as string;
};
await failing();
await sleep(1500);
ok(pushes.length === 0, "no push while the browser is on screen");
link.setVisible(false);
await sleep(300);
const failed = await failing();
const got = await until(() => pushes[0], "web push delivered");
ok(got.path === "/push/e2e", "push goes to the registered endpoint");
const cfg = await fetch(`${RELAY}/api/config`).then((r) => r.json());
const vapid = /^vapid t=([^,]+), k=(.+)$/.exec(got.auth);
ok(vapid && vapid[2] === cfg.vapid, "VAPID header carries the relay's public key from /api/config");
const [h, pl, sig] = vapid![1]!.split(".");
const vk = await subtle.importKey("raw", Buffer.from(cfg.vapid, "base64url"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const claims = JSON.parse(Buffer.from(pl!, "base64url").toString());
ok(
  (await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk, Buffer.from(sig!, "base64url"), enc.encode(`${h}.${pl}`))) &&
    claims.aud === `http://127.0.0.1:${mockPort}` && claims.exp > Date.now() / 1000,
  "VAPID token is signed by the relay and scoped to the push service",
);
const note = await openPush(got.body);
ok(note.t === "attention" && note.kind === "error" && note.host === host.id && note.sid === failed, "push decrypts to kind, computer and session");
ok(Object.keys(note).sort().join() === "host,kind,sid,t", "push carries nothing else (no terminal text)");
await webAcc.api("PUT", "/api/me/push", null);
const before = pushes.length;
await failing();
await sleep(1500);
ok(pushes.length === before, "unregistered browser gets no more pushes");
mock.close();
web.close();

// Signing in on the web with the same account (no QR): the computer's key is trusted on first use.
const webAcc2 = await RemoteAccount.open({ relay: RELAY, store: memoryStore(), keys: memoryKeyStore(), device: { name: "E2E Laptop", platform: "web" } });
const start = await webAcc2.signInUrl("test", `${RELAY}/app/`, { email: "owner@e2e.test", name: "Owner" });
const back = await fetch(start, { redirect: "manual" });
const loc = new URL(back.headers.get("location")!, RELAY);
ok(loc.pathname === "/app/" && loc.searchParams.get("code"), "test sign-in returns to /app/ with a code");
const me = await webAcc2.finishSignIn(loc.searchParams);
ok(me.email === "owner@e2e.test" && webAcc2.signedIn, "library finishes sign-in (PKCE exchange)");
const devs = await webAcc2.api("GET", "/api/devices");
ok(Array.isArray(devs.devices ?? devs), "authenticated API call");
const link2 = new RelayLink(webAcc2);
link2.start();
await until(() => link2.status === "online" && link2.hosts.some((h) => h.online), "second link online");
const web2 = new DaemonClient(link2.transport(host.id), { kind: "web", name: "E2E Laptop" } as any);
await until(() => web2.state, "second web state");
ok(webAcc2.trustedKey(host.id) === redeem.host.pubkey, "signed-in browser reaches the computer and pins its key");
web2.close();
await webAcc2.signOut();
await until(() => link2.status === "signed_out", "library sign out");
ok(!webAcc2.signedIn, "library signs out");
link2.stop();
link.stop();

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

// A relay restart (deploy) forgets access tokens: the computer reconnects and stays signed in.
procs.shift()!.kill("SIGKILL");
await until(() => remoteNow().status === "offline", "daemon notices the relay is gone");
startRelay();
await until(() => fetch(`${RELAY}/api/health`).then((r) => r.ok).catch(() => false), "relay back");
await until(() => remoteNow().status === "online", "daemon back online after relay restart", 40000);
ok(remoteNow().account?.email === "owner@e2e.test", "relay restart: still signed in, online again");
const pair2 = await desk.req("remote_pair");
ok(pair2.url.includes("#c="), "relay API works again with a fresh access token");
await desk.req("remote_sign_out");
await until(() => remoteNow().status === "signed_out", "signed out");
ok(true, "sign out");

clearInterval(pump);
if (process.env.E2E_LOGS) console.log(relayLog(), daemonLog());
console.log("all ok");
process.exit(0);
