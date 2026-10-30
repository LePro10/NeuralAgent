// A real swarm: four Claude Code (Haiku) members on a tiny task in a throwaway git repo.
// Uses the user's Claude quota (small). Prints the team's messages; stops the team at the end.
//
//   NEURALAGENT_HOME=/tmp/na-ui node scripts/dev/swarm-real.mjs ["goal"]
//   env PROJ (default /tmp/na-swarm-real, created with greet.py + git), TRUST=0 once Claude
//   trusts the folder (skips answering the trust prompt), MAX=<ms> (default 420000),
//   KEEP=1 keeps the team running, V=1 prints status changes.
// Reset the task: `git -C $PROJ checkout greet.py`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, sleep, testHome } from "./lib.mjs";

const PROJ = process.env.PROJ ?? "/tmp/na-swarm-real";
if (!existsSync(join(PROJ, "greet.py"))) {
  mkdirSync(PROJ, { recursive: true });
  writeFileSync(join(PROJ, "greet.py"), 'print("Hello")\n');
  execFileSync("git", ["init", "-q"], { cwd: PROJ });
  execFileSync("git", ["add", "."], { cwd: PROJ });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "start"], { cwd: PROJ });
}
const c = await connect(testHome(), { name: "swarm-real", subscribe: true });
const msgs = new Map();
const sessions = new Map();
const t0 = Date.now();
const T = () => `${Math.round((Date.now() - t0) / 1000)}s`;
c.on((m) => {
  if (m.t !== "ev") return;
  const x = m.ev;
  if (x.e === "swarm_message" && !msgs.has(x.message.id)) {
    msgs.set(x.message.id, x.message);
    console.log(`${T()} (${x.message.from}→${x.message.to}) ${x.message.text.replace(/\n/g, " ⏎ ").slice(0, 400)}`);
  }
  if (x.e === "session_upsert") {
    const old = sessions.get(x.session.id);
    sessions.set(x.session.id, x.session);
    if (old && old.status !== x.session.status && process.env.V) console.log(`${T()}   ${x.session.title}: ${x.session.status}`);
  }
  if (x.e === "attention") console.log(`${T()} ATTENTION ${x.kind}: ${x.text}`);
});
const req = (m, p) => c.req(m, p).catch((e) => (console.log("ERR", m, e.message), null));
await req("profile_save", { profile: { id: "claude-haiku", name: "Claude (Haiku)", engine: "claude", command: "claude", args: ["--model", "haiku"], env: {}, icon: "claude", builtin: false } });
const w = await req("workspace_add", { path: PROJ, name: "swarm-real" });
const goal = process.argv[2] ?? "Add a --name option to greet.py so `python3 greet.py --name Ada` prints Hello, Ada (without it, still Hello). Keep it tiny.";
const sw = await req("swarm_start", { workspace_id: w.id, goal, members: ["Coordinator", "Scout", "Builder", "Reviewer"].map((role) => ({ role, profile_id: "claude-haiku" })) });
console.log("swarm", sw.id);
// The trust prompt of a new folder: Down + Enter = "Yes, proceed".
if (process.env.TRUST !== "0") {
  await sleep(5000);
  for (const m of sw.members) await req("term_write", { sid: m.session_id, data: "\x1b[B" });
  await sleep(300);
  for (const m of sw.members) await req("term_write", { sid: m.session_id, data: "\r" });
}
const end = Date.now() + Number(process.env.MAX ?? 420000);
while (Date.now() < end && ![...msgs.values()].some((m) => m.to === "You")) await sleep(1000);
await sleep(3000);
for (const m of sw.members) {
  const s = sessions.get(m.session_id);
  console.log(`${m.role}: ${s?.status} busy ${Math.round((s?.busy_ms ?? 0) / 1000)}s src=${s?.status_source}`);
}
if (!process.env.KEEP) await req("swarm_stop", { swarm_id: sw.id });
console.log("delivered all:", [...msgs.values()].every((m) => m.delivered), "after", T());
c.close();
process.exit(0);
