// Repro harness for the phone's "Reconnecting to the daemon…": local relay (test login) + throwaway
// daemon + a simulated phone (RelayLink + DaemonClient) behind a TCP proxy that can throttle
// relay→phone traffic like a slow mobile link.
// Usage: node --experimental-strip-types scripts/dev/conn-repro.mts <scenario>
//   scenarios: idle (3.5 min), flood (terminal floods output over slow link), upload (7 × 3 MB)
//   env: SECS (scenario length), RELAY_PORT/PROXY_PORT (default 8097/8098; pick free ones if another
//   agent runs a relay), RATE/UP/SLOW/N/SIZE/SEQ/WAKE (see the scenarios below)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, connect as tcp } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { DaemonClient } = await import(`${R}/packages/protocol/src/client.ts`);
const { memoryKeyStore, memoryStore, parsePairLink, RelayLink, RemoteAccount } = await import(`${R}/packages/remote/src/index.ts`);

const scenario = process.argv[2] ?? "idle";
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 8097), PROXY_PORT = Number(process.env.PROXY_PORT ?? 8098);
const RELAY = `http://127.0.0.1:${RELAY_PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "na-repro-"));
const wsDir = join(tmp, "workspace");
mkdirSync(wsDir);
const procs: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
process.on("exit", () => {
  for (const p of procs) p.kill("SIGKILL");
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});
async function until<T>(f: () => T | undefined | Promise<T | undefined>, what: string, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timeout: ${what}`);
}
function run(bin: string, args: string[], env: Record<string, string>) {
  const p = spawn(join(R, "target/debug", bin), args, { env: { ...process.env, RUST_LOG: "info", ...env }, stdio: ["ignore", "ignore", "pipe"] });
  let out = "";
  p.stderr!.on("data", (d) => (out += d));
  procs.push(p);
  return () => out;
}
const relayLog = run("neuralagent-relay", [], { NA_RELAY_BIND: `127.0.0.1:${RELAY_PORT}`, PUBLIC_URL: RELAY, NA_RELAY_DB: join(tmp, "relay.db"), NA_RELAY_TEST_LOGIN: "1", ADMIN_EMAILS: "owner@example.com" });
await until(() => fetch(`${RELAY}/api/health`).then((r) => r.ok).catch(() => false), "relay up");

// Throttling proxy: relay→phone limited to RATE bytes/s (0 = unlimited).
let RATE = Number(process.env.RATE ?? 0);
let UP = Number(process.env.UP ?? 0);
const live = new Set<{ c: any; u: any }>();
const blackhole = () => {
  // Existing connections go silent both ways (like a phone whose network died); new ones work.
  for (const x of live) {
    x.c.unpipe(x.u);
    x.u.unpipe(x.c);
    x.c.removeAllListeners("data");
    x.u.removeAllListeners("data");
    x.c.pause();
    x.u.pause();
  }
  live.clear();
};
createServer((c) => {
  const u = tcp(RELAY_PORT, "127.0.0.1");
  live.add({ c, u });
  // Rates are read on every tick: a scenario can slow a running link down.
  const pump = (from: any, to: any, rate: () => number) => {
    const q: Buffer[] = [];
    from.on("data", (d: Buffer) => {
      if (!rate() && !q.length) return void to.write(d);
      q.push(d);
      from.pause();
    });
    const tick = setInterval(() => {
      let budget = rate() ? rate() / 10 : Infinity;
      while (q.length && budget > 0) {
        const b = q[0]!;
        const n = Math.min(b.length, budget);
        to.write(b.subarray(0, n));
        budget -= n;
        if (n === b.length) q.shift();
        else q[0] = b.subarray(n);
      }
      if (!q.length) from.resume();
    }, 100);
    from.on("close", () => (clearInterval(tick), to.end()));
  };
  pump(u, c, () => RATE);
  pump(c, u, () => UP);
  u.on("error", () => c.destroy());
  c.on("error", () => u.destroy());
  c.on("close", () => u.destroy());
}).listen(PROXY_PORT, "127.0.0.1");

const home = join(tmp, "home");
mkdirSync(join(tmp, "hosthome"));
run("neuralagentd", ["serve"], { NEURALAGENT_HOME: home, HOME: join(tmp, "hosthome"), NEURALAGENT_RELAY: RELAY });
const daemonLog = () => {
  try {
    return readFileSync(join(home, "logs", "daemon.log"), "utf8");
  } catch {
    return "";
  }
};
const info = await until(() => {
  try {
    return JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")) as { port: number; token: string };
  } catch {
    return undefined;
  }
}, "daemon up");
const desk = new DaemonClient(
  () =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
      const t: any = { send: (x: string) => ws.send(x), close: () => ws.close(), onmessage: null, onclose: null };
      ws.onopen = () => resolve(t);
      ws.onmessage = (e) => t.onmessage?.(String(e.data));
      ws.onclose = () => t.onclose?.("closed");
    }),
  { kind: "desktop", name: "repro" } as any,
);
await until(() => desk.state, "desk state");
const { url } = await desk.req<any>({ m: "remote_sign_in", p: { provider: "test", message: "x" } } as any);
await fetch(`${url}&email=owner@example.com&name=Owner`).then((r) => r.text());
await until(() => desk.state?.remote.status === "online", "daemon online");
const ws = await desk.req<any>({ m: "workspace_add", p: { path: wsDir, name: "w" } } as any);
await desk.req({ m: "workspace_update", p: { id: ws.id, approved: true } } as any);
const pair = parsePairLink(new URL((await desk.req<any>({ m: "remote_pair" } as any)).url).hash)!;
const acc = await RemoteAccount.open({ relay: `http://127.0.0.1:${PROXY_PORT}`, store: memoryStore(), keys: memoryKeyStore(), device: { name: "Phone", platform: "android" } });
const host = await acc.pair(pair.code, pair.host, pair.fp);
const link = new RelayLink(acc);
let linkStatus = "";
link.subscribe(() => {
  if (link.status !== linkStatus) log(`link: ${(linkStatus = link.status)} ${link.error ?? ""}`);
});
link.start();
await until(() => link.status === "online" && link.hosts.some((h: any) => h.online), "link online");
const open = link.transport(host.id);
let sessions = 0;
const phone = new DaemonClient(
  () =>
    open().then((t: any) => {
      sessions++;
      log(`e2e session #${sessions} open`);
      const oc = t;
      const orig = Object.getOwnPropertyDescriptor(oc, "onclose");
      void orig;
      return t;
    }),
  { kind: "web", name: "Phone" } as any,
);
let st = "";
phone.subscribe(() => {
  if (phone.status !== st) log(`client: ${(st = phone.status)}`);
});
await until(() => phone.status === "open", "phone open");
log("phone connected");

if (scenario === "idle") {
  await sleep(Number(process.env.SECS ?? 210) * 1000);
} else if (scenario === "drop") {
  // The phone's relay socket dies (network change): how long until the UI is "open" again?
  const td = Date.now();
  (link as any).ws.close();
  await until(() => phone.status !== "open", "noticed", 5000).catch(() => {});
  await until(() => phone.status === "open", "open again", Number(process.env.SECS ?? 20) * 1000).then(
    () => log(`open again after ${Date.now() - td} ms`),
    () => log(`STILL ${phone.status} after ${process.env.SECS ?? 20}s`),
  );
} else if (scenario === "blackhole") {
  const td = Date.now();
  blackhole();
  log("network went silent");
  if (process.env.WAKE) setTimeout(() => (log("app comes back: wake"), link.wake(), phone.poke()), Number(process.env.WAKE));
  await until(() => phone.status !== "open", "noticed", 60000).then(() => log(`noticed after ${Date.now() - td} ms`), () => log("NOT noticed in 60 s"));
  await until(() => phone.status === "open", "open again", 30000).then(() => log(`open again after ${Date.now() - td} ms`), () => log(`STILL ${phone.status}`));
} else if (scenario === "flood") {
  const s = await phone.req<any>({ m: "session_start", p: { workspace_id: ws.id, profile_id: "shell", cols: 100, rows: 30 } } as any);
  let got = 0;
  phone.attach(s.id, { reset: () => {}, data: (b: Uint8Array) => void (got += b.length) });
  await sleep(1000);
  RATE = Number(process.env.SLOW ?? 50_000);
  log(`throttle to ${RATE} B/s; flooding`);
  // Many small writes: like a TUI repainting a spinner.
  await phone.req({ m: "term_write", p: { sid: s.id, data: `for i in $(seq 1 30000); do echo "line $i ......................................"; done\r` } } as any);
  await sleep(Number(process.env.SECS ?? 60) * 1000);
  log(`got ${got} bytes`);
} else if (scenario === "upload") {
  const s = await phone.req<any>({ m: "session_start", p: { workspace_id: ws.id, profile_id: "shell", cols: 100, rows: 30 } } as any);
  UP = Number(process.env.SLOW ?? 0);
  const n = Number(process.env.N ?? 7), size = Number(process.env.SIZE ?? 3_000_000);
  const data = Buffer.alloc(size, 7).toString("base64");
  const t = Date.now();
  const one = (i: number) => phone.req<any>({ m: "upload", p: { sid: s.id, name: `p${i}.jpg`, data } } as any);
  let res: PromiseSettledResult<any>[];
  if (process.env.SEQ) {
    res = [];
    for (let i = 0; i < n; i++) res.push(await one(i).then((v) => ({ status: "fulfilled", value: v }) as const, (e) => ({ status: "rejected", reason: e }) as const));
  } else res = await Promise.allSettled(Array.from({ length: n }, (_, i) => one(i)));
  log(`uploads in ${Date.now() - t} ms:`, res.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as Error).message)));
}
log(`sessions opened: ${sessions}`);
console.log("relay log:\n" + relayLog().split("\n").filter((l) => /WARN|ERROR|close|slow/i.test(l)).slice(-20).join("\n"));
console.log("daemon log:\n" + daemonLog().split("\n").filter((l) => /remote|WARN|ERROR/.test(l)).slice(-20).join("\n"));
process.exit(0);
