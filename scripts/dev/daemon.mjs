// Talk to a test daemon from the command line (requests, sessions, Neural, usage).
//
//   NEURALAGENT_HOME=/tmp/na-ui node scripts/dev/daemon.mjs <command> [args]
//
//   state                      workspaces and live sessions with their status
//   req <method> [json]        any protocol request, prints the result (see crates/na-protocol)
//   add <dir> [name]           add a workspace (folder is created)
//   start [profile]            start a session (default "claude") in workspace WS=<index> (default 0);
//                              remembers its id for type/screen/stop
//   type <text>                write to the session; "\r" and "\n" in the text are keys
//   screen [lines]             the session's screen as plain text (default 25 lines)
//   stop [sid]                 stop the session
//   watch [sid] [seconds]      print status changes and attention events (hooks, permissions)
//   tick <dir>                 start a shell that appends a timestamp to <dir>/tick every second
//                              (proves sessions survive app/daemon updates)
//   orch "<text>"              ask Neural and wait for the answer (needs a model: env.mjs --llm,
//                              or NEURALAGENT_LLM_KEY for a real one)
//   orch-clear | orch-last     clear Neural's chat | print its last messages
//   usage [days]               usage report summary per engine/model
//
// Refuses the installed app's data dir. Never prints the daemon token.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { connect, readState, screenText, sleep, testHome } from "./lib.mjs";

const home = testHome();
const [cmd, ...a] = process.argv.slice(2);
const sidFile = join(home, "dev-sid");
const sid = (x) => x ?? (existsSync(sidFile) ? readFileSync(sidFile, "utf8").trim() : null);
const c = await connect(home, { name: "dev-cli", subscribe: ["state", "watch", "orch", "orch-last"].includes(cmd) });
const { req } = c;
const ws = () => {
  const st = readState(home);
  const w = st.workspaces[Number(process.env.WS ?? 0)];
  if (!w) throw new Error("no workspace: add one with `daemon.mjs add <dir>`");
  return w;
};

if (cmd === "state") {
  const st = c.state();
  for (const w of st.workspaces) console.log(`workspace ${w.name} ${w.path}${w.approved ? " (approved)" : ""}`);
  for (const s of Object.values(st.sessions).filter((s) => s.alive)) console.log(`session ${s.id} ${s.profile_id} "${s.title}" ${s.status}`);
} else if (cmd === "req") {
  console.log(JSON.stringify(await req(a[0], a[1] ? JSON.parse(a[1]) : undefined), null, 2));
} else if (cmd === "add") {
  mkdirSync(a[0], { recursive: true });
  const w = await req("workspace_add", { path: a[0], ...(a[1] ? { name: a[1] } : {}) });
  console.log(`workspace ${w.id} ${w.path}`);
} else if (cmd === "start") {
  const w = ws();
  const s = await req("session_start", { workspace_id: w.id, profile_id: a[0] ?? "claude", cols: 100, rows: 30 });
  writeFileSync(sidFile, s.id);
  console.log(`started ${s.id} (${s.profile_id}) in ${w.path}`);
} else if (cmd === "type") {
  await req("term_write", { sid: sid(), data: a.join(" ").replace(/\\r/g, "\r").replace(/\\n/g, "\n") });
} else if (cmd === "screen") {
  const r = await req("term_attach", { sid: sid() });
  console.log(screenText(r.snapshot, Number(a[0] ?? 25)));
} else if (cmd === "stop") {
  await req("session_stop", { id: sid(a[0]) });
  console.log("stopped");
} else if (cmd === "watch") {
  const id = sid(a[0]);
  const t0 = Date.now();
  const T = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
  let last = "";
  c.on((m) => {
    if (m.t !== "ev") return;
    const e = m.ev;
    if (e.e === "session_upsert" && (!id || e.session.id === id)) {
      const s = e.session;
      const k = `${s.title}: ${s.status}/${s.status_source}${s.last_message ? ` msg=${JSON.stringify(s.last_message.slice(0, 80))}` : ""}`;
      if (k !== last) console.log(T(), (last = k));
    }
    if (e.e === "attention" && (!id || e.session_id === id)) console.log(T(), "ATTENTION", e.kind, JSON.stringify(e.text.slice(0, 100)));
  });
  await sleep(Number(a[1] ?? 60) * 1000);
} else if (cmd === "tick") {
  mkdirSync(a[0], { recursive: true });
  const w = await req("workspace_add", { path: a[0] });
  const s = await req("session_start", { workspace_id: w.id, profile_id: "shell", cols: 100, rows: 30 });
  await sleep(1500);
  await req("term_write", { sid: s.id, data: `while true; do date +%s >> ${join(a[0], "tick")}; sleep 1; done\r` });
  writeFileSync(sidFile, s.id);
  console.log(`session ${s.id} ticks into ${join(a[0], "tick")}`);
} else if (cmd === "orch") {
  const msgs = new Map();
  let busy = true;
  let sawBusy = false;
  const t0 = Date.now();
  c.on((m) => {
    if (m.t !== "ev") return;
    const x = m.ev;
    if (x.e === "orch_message") {
      if (!msgs.has(x.message.id) && x.message.role === "assistant") x.message.first = Date.now() - t0;
      msgs.set(x.message.id, { ...msgs.get(x.message.id), ...x.message });
    }
    if (x.e === "orch_status") { busy = x.busy; if (busy) sawBusy = true; }
  });
  await req("orch_send", { text: a.join(" ") });
  while ((busy || !sawBusy) && Date.now() - t0 < 90000) await sleep(200);
  for (const m of msgs.values()) if (m.text || m.role !== "assistant") console.log(`[${m.role}${m.ok === false ? " ✗" : ""}${m.first ? ` first+${m.first}ms` : ""}] ${m.text}`);
} else if (cmd === "orch-clear") {
  await req("orch_clear");
  console.log("cleared");
} else if (cmd === "orch-last") {
  for (const x of c.state().orchestrator.messages.slice(-6)) console.log(x.role, x.text.slice(0, 200));
} else if (cmd === "usage") {
  const t = Date.now();
  const r = await req("usage_report", { days: Number(a[0] ?? 7) });
  const by = {};
  for (const x of r.rows) {
    const k = `${x.engine} ${x.model}`;
    by[k] ??= { calls: 0, cost: 0, unpriced: false, out: 0 };
    by[k].calls += x.calls;
    by[k].out += x.tokens.output;
    if (x.cost_usd == null) by[k].unpriced = true;
    else by[k].cost += x.cost_usd;
  }
  console.log(`${Date.now() - t} ms, ${r.rows.length} rows`);
  for (const [k, v] of Object.entries(by)) console.log(k, v.calls, "calls", v.out, "out", v.unpriced ? "unpriced" : `$${v.cost.toFixed(2)}`);
} else {
  console.error("usage: node scripts/dev/daemon.mjs state|req|add|start|type|screen|stop|watch|tick|orch|orch-clear|orch-last|usage (see header)");
  process.exit(2);
}
c.close();
process.exit(0);
