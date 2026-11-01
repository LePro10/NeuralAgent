// Short smoke test of Neural v2 with a REAL model (costs a few cents). The test daemon must have
// the key in its environment and run on a test home:
//
//   node scripts/dev/env.mjs down --home /tmp/na-neural
//   NEURALAGENT_LLM_KEY="$(security find-generic-password -s neuralagent-llm -w)" \
//     node scripts/dev/env.mjs up --home /tmp/na-neural --port 1462 --no-vite
//   NEURALAGENT_HOME=/tmp/na-neural node scripts/dev/neural-smoke.mjs [model]
//
// Starts a stand-in agent through Neural, lets it "finish" via a hook and prints what Neural did
// and said (the transcript is for a human to judge; a few hard checks fail the run).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEV, connect, daemonBin, sleep, testHome } from "./lib.mjs";

const home = testHome();
const model = process.argv[2] ?? "claude/claude-haiku-5-5";
const c = await connect(home, { name: "neural-smoke", subscribe: true });
const { req } = c;
const st = () => c.state();
c.on((m) => {
  if (m.t !== "ev" || !c.state()) return;
  const s = c.state();
  const ev = m.ev;
  if (ev.e === "orch_message") {
    const i = s.orchestrator.messages.findIndex((x) => x.id === ev.message.id);
    if (i < 0) s.orchestrator.messages.push(ev.message);
    else s.orchestrator.messages[i] = ev.message;
  } else if (ev.e === "orch_cleared") s.orchestrator.messages = [];
  else if (ev.e === "orch_status") Object.assign(s.orchestrator, { ready: ev.ready, busy: ev.busy });
  else if (ev.e === "host_notice" && ev.topic === "neural") s.neural = ev.data;
  else if (ev.e === "settings_set") s.settings = ev.settings;
});
const until = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(300);
  }
  return false;
};
// A turn: wait until Neural starts working, then until it is done.
const idle = async () => {
  await until(() => st().orchestrator.busy, 5000);
  await until(() => !st().orchestrator.busy, 120000);
};
const D = daemonBin();
const hook = (sid, ev, payload) => req("term_write", { sid, data: `echo '${JSON.stringify(payload)}' | ${D} hook ${ev}\r` });
let bad = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) bad++;
};

try {
  const path = join(home + "-ws", "japan-map");
  mkdirSync(path, { recursive: true });
  if (!st().workspaces.some((w) => w.path === path)) await req("workspace_add", { path, name: "japan-map" });
  await req("profile_save", { profile: { id: "fclaude", name: "Claude Code", engine: "claude", command: join(DEV, "fake-cli.sh"), args: [], env: {}, icon: "claude", builtin: false } });
  await req("settings_set", { settings: { ...st().settings, default_profile: "fclaude", llm: { provider: "neuralhub", base_url: "", model, call_model: "" } } });
  await req("orch_clear");
  await req("neural_mode", { mode: "active" });
  for (const t of st().neural?.tasks ?? []) await req("neural_task_edit", { id: t.id, remove: true });
  for (const n of st().neural?.notes ?? []) await req("neural_note_remove", { id: n.id });
  await sleep(500);
  if (!st().orchestrator.ready) throw new Error("Neural is not ready: is NEURALAGENT_LLM_KEY set for the test daemon?");

  await req("orch_send", { text: "Kannst du in japan-map einen Agent starten, der das kaputte Login-Formular repariert? Fertig, wenn die Tests grün sind (pnpm test)." });
  await idle();
  const task = st().neural?.tasks.find((t) => t.agents.length);
  check("Neural started an agent and tracks a task", !!task);
  if (task) {
    const sid = task.agents[0];
    await sleep(1000);
    await hook(sid, "UserPromptSubmit", { prompt: "fix login" });
    await sleep(800);
    await hook(sid, "Stop", { last_assistant_message: "Fixed the login: the submit handler was not bound. I did not run the tests." });
    const reported = await until(() => st().orchestrator.messages.some((m) => m.proactive && m.text), 90000);
    check("Neural followed up on its own after the agent finished", reported);
    await idle();
  }
  await req("orch_send", { text: "Merk dir bitte: in japan-map nehmen wir pnpm, nicht npm." });
  await idle();
  check("Neural kept a memory note", (st().neural?.notes ?? []).some((n) => /pnpm/i.test(n.text)));
} catch (e) {
  bad++;
  console.log(`FAIL ${e.message}`);
}
console.log("\n--- conversation");
for (const m of st().orchestrator.messages) if (m.text) console.log(`${m.proactive ? "neural (on its own)" : m.role}: ${m.text}`);
console.log("\n--- tasks");
for (const t of st().neural?.tasks ?? []) console.log(`${t.id} ${t.status} ${t.title}${t.check ? ` [check: ${t.check}]` : ""}${t.note ? ` — ${t.note}` : ""}`);
console.log("--- notes");
for (const n of st().neural?.notes ?? []) console.log(`${n.id} ${n.text}`);
c.close();
process.exit(bad ? 1 : 0);
