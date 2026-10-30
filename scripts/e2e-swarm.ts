// End-to-end test of a swarm: daemon + four stand-in agents (scripts/fake-agent.mjs) that hand a
// task around through the swarm's MCP bridge. No model, no network.
// Run after `cargo build -p na-daemon`: node --experimental-strip-types scripts/e2e-swarm.ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "target/debug", process.platform === "win32" ? "neuralagentd.exe" : "neuralagentd");
const tmp = mkdtempSync(join(tmpdir(), "na-swarm-"));
const home = join(tmp, "home");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let daemon: ChildProcess | null = null;

process.on("exit", () => {
  daemon?.kill();
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
});
const fail = (what: string) => {
  console.error(`FAIL: ${what}`);
  try {
    const log = readFileSync(join(home, "logs", "daemon.log"), "utf8");
    console.error(log.split("\n").filter((l) => /WARN|ERROR|panicked/.test(l)).join("\n"));
  } catch {}
  process.exit(1);
};
process.on("unhandledRejection", (e) => fail(e instanceof Error ? e.message : String(e)));
const ok = (cond: unknown, what: string) => (cond ? console.log(`ok - ${what}`) : fail(what));

async function until<T>(f: () => T | undefined, what: string, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = f();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timeout: ${what}`);
}

daemon = spawn(exe, ["serve"], { env: { ...process.env, NEURALAGENT_HOME: home }, stdio: "ignore" });
const info = await until(() => {
  try {
    return JSON.parse(readFileSync(join(home, "daemon.json"), "utf8")) as { port: number; token: string };
  } catch {
    return undefined;
  }
}, "daemon up");

// A desktop client that keeps the state up to date.
const sock = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
const seen: any[] = [];
const pending = new Map<number, (m: any) => void>();
let state: any = null;
let nextId = 1;
sock.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  seen.push(m);
  if (m.t === "res") pending.get(m.id)?.(m);
  if (m.t === "snapshot") state = m.state;
};
const req = (m: string, p?: unknown) =>
  new Promise<any>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (r) => (r.ok ? resolve(r.r) : reject(new Error(`${m}: ${r.err.message}`))));
    sock.send(JSON.stringify({ t: "req", id, req: p === undefined ? { m } : { m, p } }));
  });
await new Promise((r) => (sock.onopen = r));
sock.send(JSON.stringify({ t: "hello", v: 1, client: { kind: "desktop", name: "e2e swarm" } }));
sock.send(JSON.stringify({ t: "sub" }));
await until(() => state, "snapshot");
const events = () => seen.filter((m) => m.t === "ev").map((m) => m.ev);
const messages = () => {
  const byId = new Map<string, any>();
  for (const ev of events()) if (ev.e === "swarm_message") byId.set(ev.message.id, ev.message);
  return [...byId.values()];
};

const dir = join(tmp, "project");
mkdirSync(dir);
writeFileSync(join(dir, "hello.txt"), "Hello.\n");
const ws = await req("workspace_add", { path: dir, name: "swarm test" });
await req("profile_save", {
  profile: {
    id: "fake",
    name: "Fake",
    engine: "custom",
    command: "node",
    args: [join(root, "scripts/fake-agent.mjs")],
    env: { FAKE_AGENT_DAEMON: exe },
    icon: "bot",
    builtin: false,
  },
});

await req("swarm_start", { workspace_id: ws.id, goal: "x", members: [{ role: "all", profile_id: "fake" }] }).then(
  () => fail("a member called \"all\" is refused"),
  () => ok(true, "a member called \"all\" is refused"),
);
const team = ["Coordinator", "Scout", "Builder", "Reviewer"].map((role) => ({ role, profile_id: "fake" }));
const swarm = await req("swarm_start", { workspace_id: ws.id, goal: "Change the greeting", members: team });
ok(swarm.members.length === 4, "swarm of four started");
await sleep(300);
const layout = events().filter((e) => e.e === "layout_set" && e.workspace_id === ws.id).at(-1)?.layout;
const tab = layout?.tabs.find((t: any) => t.title.startsWith("Swarm: "));
const panes = (n: any): number => (n.type === "pane" ? 1 : n.children.reduce((a: number, c: any) => a + panes(c), 0));
ok(tab && panes(tab.root) === 4 && layout.active_tab === tab.id, `the team has its own tab with four panes (${JSON.stringify(layout?.tabs.map((t: any) => [t.title, panes(t.root)]))})`);

const report = await until(() => messages().find((m) => m.to === "You"), "the team reports to the user", 90000);
const flow = messages().map((m) => `${m.from}→${m.to}`);
ok(
  flow.join(" ") === "Coordinator→Scout Scout→Coordinator Coordinator→Builder Builder→Reviewer Reviewer→Coordinator Coordinator→You",
  `tasks handed through the whole team (${flow.join(", ")})`,
);
ok(report.text.startsWith("Done:"), "the coordinator's summary reached the user");
ok(readFileSync(join(dir, "hello.txt"), "utf8") === "Hello, swarm.\n", "the builder did the work");
ok(messages().every((m) => m.delivered), "every message was delivered");
const att = events().filter((e) => e.e === "attention");
ok(att.length === 1 && att[0].text.startsWith("Done:"), `one notification, for the report (${att.map((a) => a.text).join(" | ")})`);

await req("swarm_send", { swarm_id: swarm.id, to: "all", text: "Thanks, team." });
await until(() => messages().find((m) => m.from === "You" && m.delivered), "the user's message reaches every member", 20000);
ok(true, "the user's message reaches every member");
await req("swarm_send", { swarm_id: swarm.id, to: "Tester", text: "?" }).then(
  () => fail("unknown recipient refused"),
  (e) => ok(/the team is Coordinator, Scout, Builder, Reviewer/.test(e.message), "unknown recipient refused with the team's roles"),
);

await req("swarm_stop", { swarm_id: swarm.id });
const sessions = () => {
  const s = new Map<string, any>();
  for (const ev of events()) if (ev.e === "session_upsert") s.set(ev.session.id, ev.session);
  return swarm.members.map((m: any) => s.get(m.session_id));
};
await until(() => sessions().every((s: any) => !s.alive), "members stopped", 10000);
ok(sessions().every((s: any) => s.status === "exited"), "stopped members are not errors");
await until(() => events().some((e) => e.e === "swarm_upsert" && e.swarm.id === swarm.id && e.swarm.ended), "the swarm has ended");
ok(true, "the swarm has ended");
await req("swarm_send", { swarm_id: swarm.id, to: "all", text: "hello?" }).then(
  () => fail("an ended swarm takes no messages"),
  () => ok(true, "an ended swarm takes no messages"),
);
await req("swarm_remove", { swarm_id: swarm.id });
await until(() => events().some((e) => e.e === "swarm_removed" && e.id === swarm.id), "the swarm can be removed");
ok(true, "the swarm can be removed");
console.log("all ok");
process.exit(0);
