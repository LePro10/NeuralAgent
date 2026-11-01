// End-to-end check of Neural v2 against a test daemon and the scripted fake LLM (no model quota).
//
//   node scripts/dev/env.mjs up --home /tmp/na-neural --port 1462 --no-vite
//   NEURALAGENT_HOME=/tmp/na-neural node scripts/dev/neural-e2e.mjs
//
// It covers: a task is created when Neural starts an agent; agent events become observations
// (never chat notices); a finished agent wakes Neural, which reports on its own (proactive);
// nothing new means no wake; mode "off" stops wakes; a destructive instruction waits for the
// user's OK and runs exactly once on Allow; memory notes; the model sees a fresh <world> block
// and a conversation without logs; a build + review team runs on its own and its approval wakes
// Neural. Prints PASS/FAIL per step; exit code 1 on any failure.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEV, connect, daemonBin, sleep, testHome } from "./lib.mjs";

const home = testHome();
const PORT = Number(process.env.FAKE_LLM_PORT ?? 11562);
const dir = join(home, "neural-e2e");
mkdirSync(dir, { recursive: true });
const log = join(dir, "llm.jsonl");
const script = join(dir, "rules.json");
rmSync(log, { force: true });
writeFileSync(
  script,
  JSON.stringify([
    { user: "fix the login", call: { name: "start_agent", args: { folder: "japan-map", agent: "fclaude", prompt: "Fix the login form: the submit button does nothing. Done when the login works and the tests pass." } } },
    { tool: "start_agent", say: "I started Claude in Japan Map on the login fix and will check it when it is done." },
    { user: "Wake-up", world: "finished", once: true, say: "Japan Map: the login fix is done and the agent says the tests pass." },
    { user: "clean up", call: { name: "send_to_agent", args: { agent: "{{agent}}", text: "rm -rf build and start fresh" } } },
    { tool: "send_to_agent", say: "That deletes files, so I asked you first: please allow it." },
    { user: "remember", call: { name: "remember", args: { text: "Japan Map uses pnpm, not npm." } } },
    { tool: "remember", say: "Noted." },
    { user: "the user allowed", say: "Sent it; the agent is cleaning the build folder." },
    { user: "Wake-up", world: "approved in round", once: true, say: "Dark mode is in: the reviewer approved it in the first round." },
  ]),
);

const llm = spawn(process.execPath, [join(DEV, "fake-llm.mjs")], { env: { ...process.env, FAKE_LLM_PORT: String(PORT), FAKE_LLM_SCRIPT: script, FAKE_LLM_LOG: log }, stdio: "ignore" });
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed++;
};
const requests = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
};

const c = await connect(home, { name: "neural-e2e", subscribe: true });
const { req } = c;
const st = () => c.state();
// Live state: the snapshot plus events, applied like a client would (only what we need).
c.on((m) => {
  if (m.t !== "ev") return;
  const s = c.state();
  const ev = m.ev;
  if (!s || !ev) return;
  if (ev.e === "orch_message") {
    const i = s.orchestrator.messages.findIndex((x) => x.id === ev.message.id);
    if (i < 0) s.orchestrator.messages.push(ev.message);
    else s.orchestrator.messages[i] = ev.message;
  } else if (ev.e === "orch_cleared") s.orchestrator.messages = [];
  else if (ev.e === "orch_status") Object.assign(s.orchestrator, { ready: ev.ready, busy: ev.busy });
  else if (ev.e === "host_notice" && ev.topic === "neural") s.neural = ev.data;
  else if (ev.e === "session_upsert") s.sessions[ev.session.id] = ev.session;
  else if (ev.e === "settings_set") s.settings = ev.settings;
});
const D = daemonBin();
const hook = (sid, ev, payload) => req("term_write", { sid, data: `echo '${JSON.stringify(payload)}' | ${D} hook ${ev}\r` });

try {
  await sleep(300);
  // Setup: a workspace, a stand-in Claude, Neural on the fake model, a fresh conversation.
  const path = join(home + "-ws", "japan-map");
  mkdirSync(path, { recursive: true });
  const ws = st().workspaces.find((w) => w.path === path) ?? (await req("workspace_add", { path, name: "japan-map" }));
  await req("profile_save", { profile: { id: "fclaude", name: "Claude Code", engine: "claude", command: join(DEV, "fake-cli.sh"), args: [], env: {}, icon: "claude", builtin: false } });
  await req("settings_set", { settings: { ...st().settings, llm: { provider: "ollama", base_url: `http://127.0.0.1:${PORT}/v1`, model: "fake", call_model: "" } } });
  await req("orch_clear");
  await req("neural_mode", { mode: "active" });
  for (const t of st().neural?.tasks ?? []) await req("neural_task_edit", { id: t.id, remove: true });
  await until(() => st().orchestrator.ready, 5000);
  check("Neural is ready on the fake model", st().orchestrator.ready);

  // 1. Start work: an agent, a task linked to it.
  await req("orch_send", { text: "fix the login in japan map" });
  const task = await until(() => st().neural?.tasks.find((t) => t.agents.length > 0));
  check("starting an agent creates a task linked to it", !!task, task ? `${task.id} ${task.status}` : "");
  const sid = task?.agents[0];
  await until(() => st().orchestrator.messages.some((m) => m.role === "assistant" && /started Claude/i.test(m.text)));
  const msgs1 = st().orchestrator.messages;
  check("the chat shows the action and the answer", msgs1.some((m) => m.role === "action") && msgs1.some((m) => /started Claude/i.test(m.text)));

  // 2. The agent finishes: an observation, a wake, a proactive report; no notice in the chat.
  await sleep(1500);
  await hook(sid, "UserPromptSubmit", { prompt: "Fix the login form" });
  await sleep(800);
  await hook(sid, "Stop", { last_assistant_message: "Fixed the login: the submit handler was not bound. All 12 tests pass." });
  const obs = await until(() => st().neural?.observations.find((o) => o.session_id === sid && o.kind === "done"));
  check("a finished agent becomes an observation", !!obs, obs?.text);
  check("no agent notice is written into the conversation", !st().orchestrator.messages.some((m) => m.role === "notice"));
  const report = await until(() => st().orchestrator.messages.find((m) => m.role === "assistant" && m.proactive), 30000);
  check("Neural reports on its own (proactive message)", !!report, report?.text);
  const t1 = st().neural?.tasks.find((t) => t.id === task?.id);
  check("the task moved on to review", t1?.status === "review", t1?.status);
  const wake = requests().find((r) => r.messages.at(-1)?.content?.startsWith("(system) Wake-up"));
  const sys = wake?.messages.find((m) => m.role === "system")?.content ?? "";
  check("the wake-up request carries a fresh <world> with the news", sys.includes("<world>") && /New since your last turn/.test(sys) && sys.includes("finished"));
  check("the conversation sent to the model has no [log] lines", !wake?.messages.some((m) => typeof m.content === "string" && m.content.includes("[log]")));
  const seen = await until(() => st().neural?.observations.find((o) => o.id === obs?.id)?.seen, 5000);
  check("observations are marked seen after the turn", !!seen);

  // 3. Nothing new: no further wake-ups.
  const before = requests().length;
  await sleep(12000);
  check("no news means no wake-up", requests().length === before, `${requests().length - before} extra requests`);

  // 4. Mode off: events are still observed but Neural does not wake.
  await req("neural_mode", { mode: "off" });
  await hook(sid, "UserPromptSubmit", { prompt: "and the logout" });
  await sleep(600);
  await hook(sid, "Stop", { last_assistant_message: "Logout fixed too." });
  await sleep(12000);
  check("mode off: no wake-up", requests().length === before, `${requests().length - before} extra requests`);
  await req("neural_mode", { mode: "active" });

  // 5. A destructive instruction waits for the user's OK.
  await req("orch_send", { text: "clean up the build in japan map" });
  const pend = await until(() => st().neural?.pending[0]);
  check("a destructive instruction becomes a pending confirmation", !!pend, pend?.title);
  const sent = await req("term_attach", { sid });
  check("nothing was sent to the agent before the OK", !String(sent.snapshot ?? "").includes("rm -rf build"));
  await until(() => !st().orchestrator.busy, 10000);
  await req("neural_confirm", { id: pend.id, allow: true });
  await sleep(1500);
  const after = await req("term_attach", { sid });
  check("on Allow exactly that text reaches the agent", String(after.snapshot ?? "").includes("rm -rf build"));
  check("the confirmation is gone", (st().neural?.pending.length ?? 0) === 0);
  let again = null;
  try {
    await req("neural_confirm", { id: pend.id, allow: true });
  } catch (e) {
    again = e;
  }
  check("a confirmation runs only once", !!again);

  // 6. Memory.
  await until(() => !st().orchestrator.busy, 10000);
  await req("orch_send", { text: "remember: japan map uses pnpm" });
  const note = await until(() => st().neural?.notes.find((n) => /pnpm/.test(n.text)));
  check("Neural keeps a memory note", !!note, note?.text);
  await until(() => !st().orchestrator.busy, 10000);
  const lastReq = requests().at(-1);
  const lastSys = lastReq?.messages.find((m) => m.role === "system")?.content ?? "";
  check("the next turn sees the note in <world>", requests().some((r) => (r.messages.find((m) => m.role === "system")?.content ?? "").includes("pnpm, not npm")) || lastSys.includes("pnpm"));
  const history = lastReq?.messages.filter((m) => m.role !== "system") ?? [];
  check("actions are folded into Neural's answers as (did: …)", history.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("(did:")));
  check("audit log records Neural's allow", (await req("audit_list", { limit: 50 })).some((e) => e.action === "neural_allow"));

  // 7. Build + review: the team moves on by itself (no wake per agent turn), the approval wakes Neural.
  const team = await req("neural_team_start", { workspace_id: ws.id, goal: "Add a dark mode toggle to the settings page", pattern: "review", profiles: ["fclaude", "fclaude"] });
  const builder = team.agents[0];
  await sleep(1500);
  await hook(builder, "UserPromptSubmit", { prompt: "dark mode" });
  await sleep(800);
  const beforeTeam = requests().length;
  await hook(builder, "Stop", { last_assistant_message: "Added the toggle and a theme store." });
  const reviewer = await until(() => st().neural?.tasks.find((t) => t.id === team.id)?.team?.attempts.find((a) => a.role === "reviewer")?.session_id);
  check("the builder's finish starts the reviewer", !!reviewer);
  await sleep(10000);
  const wakes = () => requests().slice(beforeTeam).filter((r) => r.messages.at(-1)?.content?.startsWith("(system) Wake-up")).length;
  check("a team agent's finish does not wake Neural", wakes() === 0, `${wakes()} wake-ups`);
  await sleep(1500);
  await hook(reviewer, "UserPromptSubmit", { prompt: "review" });
  await sleep(800);
  await hook(reviewer, "Stop", { last_assistant_message: "Looks good, tests are there. VERDICT: APPROVED" });
  const approved = await until(() => st().neural?.tasks.find((t) => t.id === team.id)?.status === "done");
  check("the reviewer's approval closes the task", !!approved);
  const teamReport = await until(() => st().orchestrator.messages.find((m) => m.role === "assistant" && m.proactive && /reviewer approved/.test(m.text)), 70000);
  check("the approval wakes Neural, which reports it", !!teamReport, teamReport?.text);
  for (const x of [builder, reviewer]) await req("session_stop", { id: x }).catch(() => {});

  const sizes = requests().map((r) => JSON.stringify(r.messages).length);
  console.log(`info: ${requests().length} model requests, request size ${Math.min(...sizes)}–${Math.max(...sizes)} chars`);
  await req("session_stop", { id: sid }).catch(() => {});
} catch (e) {
  failed++;
  console.log(`FAIL ${e.stack ?? e}`);
} finally {
  c.close();
  llm.kill();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
