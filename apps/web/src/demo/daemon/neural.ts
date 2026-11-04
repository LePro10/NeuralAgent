// Neural, the orchestrator: the conversation (streamed word by word), what it noticed, its notes,
// questions waiting for you.

import type { NeuralObs, NeuralState, NeuralTask, ObsKind, OrchMessage, Session } from "@neuralagent/protocol";
import { counts } from "./diff.ts";
import { createSession, taskFor } from "./agents/spawn.ts";
import { replyTo, testOutput } from "./agents/scripts.ts";
import { strip as stripAnsi } from "./ansi.ts";
import { matchIntent } from "./claude/intent.ts";
import { matchNeural } from "./neural-brain.ts";
import type { Sim } from "./sim.ts";
import { join } from "./vfs.ts";

const MIN = 60_000;

/** A ready-made task per project, for "start Codex in web-shop" without saying what to do. */
const DEFAULT_TASK: Record<string, string> = {
  "billing-api": "Run the tests and tell me if anything looks flaky.",
  "web-shop": "Where is the cart total computed?",
  "docs-site": "Which docs pages mention webhooks?",
};

const pickPhrase = (s: string, ...opts: string[]) => opts[Math.abs([...s].reduce((a, c) => a + c.charCodeAt(0), 0)) % opts.length]!;
const firstSentence = (t: string) => (t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "").replace(/[`*]/g, "");
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export class Neural {
  readonly sim: Sim;
  private stream = 0;
  /** The assistant message that is being written right now (so a stop can close it). */
  private live: OrchMessage | null = null;
  /** Sessions whose task Neural already reported as finished. */
  private reported = new Set<string>();

  constructor(sim: Sim) {
    this.sim = sim;
  }

  private get n() {
    return this.sim.state.neural!;
  }

  private set(patch: Partial<NeuralState>) {
    this.sim.state.neural = { ...this.n, ...patch };
    this.sim.emitNeural();
  }

  // ── conversation ───────────────────────────────────────────────────────────────────────────

  message(role: OrchMessage["role"], text: string, extra: Partial<OrchMessage> = {}): OrchMessage {
    const m: OrchMessage = { id: this.sim.id("orchm", 12), role, text, at: this.sim.now(), ...(role === "action" ? { ok: true } : {}), ...extra };
    this.sim.emit({ e: "orch_message", message: m });
    return m;
  }

  private setBusy(busy: boolean) {
    const o = this.sim.state.orchestrator;
    this.sim.emit({ e: "orch_status", ready: o.ready, keys: o.keys, busy });
  }

  /** The assistant's words appear a few at a time, like a model streaming; the last upsert carries `ok`. */
  private async say(text: string, extra: Partial<OrchMessage> = {}) {
    const sim = this.sim;
    const gen = ++this.stream;
    const m = this.message("assistant", "", extra);
    this.live = m;
    const words = text.split(/(?<=\s)/);
    let shown = "";
    for (let i = 0; i < words.length; i += 3) {
      if (gen !== this.stream || sim.scope.dead) return;
      shown += words.slice(i, i + 3).join("");
      this.live = { ...m, text: shown };
      sim.emit({ e: "orch_message", message: this.live });
      await sim.clock.sleep(62, sim.scope).catch(() => {});
    }
    if (gen !== this.stream || sim.scope.dead) return;
    sim.emit({ e: "orch_message", message: { ...m, text, ok: true } });
    this.live = null;
    sim.signal({ type: "neural-message", role: "assistant", text });
  }

  /** Neural speaks first (an agent finished, a task is ready). No typing: the message arrives whole. */
  private proactive(text: string, extra: Partial<OrchMessage> = {}) {
    if (this.n.mode !== "active") return;
    this.message("assistant", text, { proactive: true, ok: true, ...extra });
    this.sim.signal({ type: "neural-message", role: "assistant", text });
  }

  /** The visitor wrote to Neural. */
  async send(text: string): Promise<void> {
    const sim = this.sim;
    this.message("user", text);
    sim.signal({ type: "neural-message", role: "user", text });
    this.setBusy(true);
    try {
      await sim.clock.sleep(650, sim.scope);
      await this.answer(text);
    } catch {
      /* the world was reset or the answer cancelled */
    } finally {
      this.setBusy(false);
    }
  }

  stop() {
    this.stream++;
    if (this.live) this.sim.emit({ e: "orch_message", message: { ...this.live, ok: true } });
    this.live = null;
    this.setBusy(false);
  }

  clear() {
    this.stream++;
    this.live = null;
    this.sim.emit({ e: "orch_cleared" });
  }

  private liveAgents(): Session[] {
    return Object.values(this.sim.state.sessions).filter((s) => s.alive && this.sim.engineOf(s.id) !== "shell");
  }

  private nameOf(s: Session) {
    return this.sim.profileOf(s.id)?.name.replace(/ Code$| CLI$/, "") ?? "Agent";
  }

  private wsName(id: string) {
    return this.sim.state.workspaces.find((w) => w.id === id)?.name ?? "a project";
  }

  private projects() {
    return this.sim.state.workspaces.map((w) => w.name);
  }

  summary(): string {
    const live = this.liveAgents();
    if (!live.length) return "Everything is calm. Nobody is working and nobody is waiting for you.";
    const waiting = live.filter((s) => s.status === "waiting");
    const working = live.filter((s) => s.status === "working" || s.status === "starting");
    const lines: string[] = [];
    if (waiting.length) lines.push(`**Needs you:** ${waiting.map((s) => `${this.nameOf(s)} in ${this.wsName(s.workspace_id)} (${s.last_line || "waiting"})`).join("; ")}.`);
    if (working.length) lines.push(`**Working:** ${working.map((s) => `${this.nameOf(s)} in ${this.wsName(s.workspace_id)}, ${(s.title || "a task").toLowerCase()}`).join("; ")}.`);
    const done = live.filter((s) => s.status === "done" || s.status === "idle");
    if (done.length) lines.push(`**Finished or idle:** ${this.byProject(done)}.`);
    return lines.join("\n\n");
  }

  /** "billing-api: Codex, OpenCode; web-shop: Claude, 2 Codex" */
  private byProject(list: Session[]): string {
    const groups = new Map<string, Map<string, number>>();
    for (const s of list) {
      const g = groups.get(this.wsName(s.workspace_id)) ?? new Map<string, number>();
      g.set(this.nameOf(s), (g.get(this.nameOf(s)) ?? 0) + 1);
      groups.set(this.wsName(s.workspace_id), g);
    }
    return [...groups].map(([ws, g]) => `${ws}: ${[...g].map(([n, c]) => (c > 1 ? `${c} ${n}` : n)).join(", ")}`).join("; ");
  }

  private findAgent(engine: string | null, project: string | null, pref: (s: Session) => boolean): Session | undefined {
    const sim = this.sim;
    const ws = project ? sim.state.workspaces.find((w) => w.name === project) : undefined;
    const pool = this.liveAgents().filter((s) => (!engine || sim.engineOf(s.id) === engine) && (!ws || s.workspace_id === ws.id));
    return pool.find(pref) ?? undefined;
  }

  /** The prompt a visitor can approve from here: a permission prompt, not a question or a plan. */
  private approvable(s: Session) {
    const run = this.sim.runs.get(s.id);
    const kind = this.sim.cvs.get(s.id)?.prompt?.kind;
    return s.status === "waiting" && !!run?.gate && kind !== "question" && kind !== "plan";
  }

  private async answer(text: string) {
    const sim = this.sim;
    const it = matchNeural(text, this.projects());
    switch (it.k) {
      case "greeting":
        return this.say(`Hi. ${this.liveAgents().some((s) => s.status === "waiting") ? "Someone is waiting for you." : "Nothing needs you right now."} Ask me what the agents are doing, or tell me to start one.`);
      case "thanks":
        return this.say("Anytime. I will keep watching.");
      case "help":
        return this.say(
          [
            "I watch every agent on this computer and act when you ask. Try:",
            "",
            "- **What are my agents doing?**",
            "- **Start Codex in web-shop to add a wishlist**",
            "- **Stop Claude in billing-api**",
            "- **Summarise billing-api**, or **run the tests in web-shop**",
            "- **Remember that we use pnpm**, or **catch me up**",
          ].join("\n"),
        );
      case "status":
        return this.say(this.summary());
      case "waiting": {
        const w = this.liveAgents().filter((s) => s.status === "waiting");
        return this.say(
          w.length
            ? `${w.length === 1 ? "One agent is" : `${w.length} agents are`} waiting: ${w.map((s) => `**${this.nameOf(s)}** in ${this.wsName(s.workspace_id)}: ${s.last_line}`).join("; ")}. Say "approve" and I will allow the first one, or open it to look first.`
            : "Nobody is waiting for you right now.",
        );
      }
      case "catchup":
        return this.catchUp();
      case "approve": {
        const s = this.liveAgents().find((x) => this.approvable(x));
        if (!s) return this.say("Nothing is waiting for an answer from me. If an agent asks something, I will tell you.");
        if (sim.runs.get(s.id)?.answer("1", "world")) {
          this.message("action", `Sent “yes” to ${this.nameOf(s)} in ${this.wsName(s.workspace_id)}`, { session_id: s.id });
          this.observe("allowed", `${this.wsName(s.workspace_id)} — ${this.nameOf(s)}: you allowed it through Neural`, { session_id: s.id });
          return this.say(`Done. ${this.nameOf(s)} is working again; I will tell you when it finishes.`);
        }
        return this.say("That prompt just changed under me, so I did not answer it. Look at it first.");
      }
      case "deny": {
        const s = this.liveAgents().find((x) => this.approvable(x));
        const run = s ? sim.runs.get(s.id) : undefined;
        if (!s || !run?.gate) return this.say("There is nothing waiting that I could say no to.");
        run.answer(String(run.gate.options.length), "world");
        this.message("action", `Denied what ${this.nameOf(s)} asked for in ${this.wsName(s.workspace_id)}`, { ok: false, session_id: s.id });
        return this.say(`Understood. ${this.nameOf(s)} was told no and will ask how to continue.`);
      }
      case "start": {
        const ws = (it.project ? sim.state.workspaces.find((w) => w.name === it.project) : undefined) ?? sim.state.workspaces.find((w) => w.name === "billing-api") ?? sim.state.workspaces[0]!;
        const profile = it.engine ?? "claude";
        const task = it.task || DEFAULT_TASK[ws.name] || "Look around the project and tell me what you find.";
        const label = sim.state.profiles.find((p) => p.id === profile)?.name.replace(/ Code$| CLI$/, "") ?? profile;
        await this.say(`${it.project ? "" : `You did not name a project, so I took **${ws.name}**. `}I will start **${label}** in **${ws.name}** with: "${task.replace(/\.$/, "")}".`);
        this.startAgent(ws.id, profile, task);
        await sim.clock.sleep(500, sim.scope);
        return this.say(`It is running. I will tell you when it needs you or when it finishes${/test/i.test(task) ? "" : ", and I will run the tests before I call it done"}.`);
      }
      case "stop": {
        const s = this.findAgent(it.engine, it.project, (x) => x.status === "working") ?? this.findAgent(it.engine, it.project, (x) => x.status === "waiting");
        if (!s) return this.say(`Nothing${it.engine ? ` from ${cap(it.engine)}` : ""}${it.project ? ` in ${it.project}` : ""} is running, so there is nothing to stop.`);
        sim.runs.get(s.id)?.interrupt();
        this.message("action", `Stopped ${this.nameOf(s)} in ${this.wsName(s.workspace_id)}`, { session_id: s.id });
        return this.say(`I interrupted ${this.nameOf(s)}. Everything it wrote so far stays in the project.`);
      }
      case "summarise":
        return this.projectSummary(it.project);
      case "tests":
        return this.runTests(it.project);
      case "remember": {
        const note = it.note || text;
        this.addNote(note);
        this.message("action", `Remembered: ${note.slice(0, 80)}`);
        return this.say("I will keep that in mind for every agent I talk to. You can remove it under Memory.");
      }
      case "forget":
        return this.say("Open Memory in the panel and use **Forget this** next to the note you want gone. I do not delete notes on my own.");
      case "mode":
        this.setMode(it.mode);
        return this.say(it.mode === "active" ? "Back to speaking up when something finishes or needs you." : it.mode === "quiet" ? "I will stay quiet. I still watch, and I will collect what happens for when you ask." : "I am off. I will not act or report until you turn me on again in Settings.");
      case "unknown":
        return this.say(pickPhrase(text, "I can see every agent on this computer. Ask me what is going on, tell me to start one (\"ask Codex in billing-api to add pagination\").", "I did not follow that. Try \"what is going on?\", \"start Claude in web-shop to fix the footer\"") + "\n\n" + this.summary());
    }
  }

  private async catchUp() {
    const n = this.n;
    const users = this.sim.state.orchestrator.messages.filter((m) => m.role === "user");
    const since = users.length > 1 ? users[users.length - 2]!.at : (users[0]?.at ?? 0);
    const fresh = n.observations.filter((o) => o.at > since && !["started", "allowed"].includes(o.kind));
    const unseen = n.observations.filter((o) => !o.seen);
    this.set({ observations: n.observations.map((o) => ({ ...o, seen: true })) });
    const count = (k: string) => fresh.filter((o) => o.kind === k).length;
    const parts = [count("done") && `**${count("done")} finished**`, count("waiting") && `**${count("waiting")} waiting for you**`, count("error") && `**${count("error")} failed**`, count("team") && `**${count("team")} team update${count("team") > 1 ? "s" : ""}**`].filter(Boolean);
    if (!fresh.length && !unseen.length) return this.say("Nothing happened while you were away. Everything is as you left it.");
    const lines = [...new Map([...fresh, ...unseen].map((o) => [o.id, o])).values()].slice(-5).map((o) => `- ${o.text}`);
    const waiting = this.liveAgents().filter((s) => s.status === "waiting");
    return this.say([`While you were away: ${parts.join(", ") || "a few things"}.`, "", ...lines, "", waiting.length ? `${this.nameOf(waiting[0]!)} in ${this.wsName(waiting[0]!.workspace_id)} still waits for you. Say "approve" to let it through.` : "Nobody is waiting for you now."].join("\n"));
  }

  private async projectSummary(project: string | null) {
    const sim = this.sim;
    const ws = (project ? sim.state.workspaces.find((w) => w.name === project) : undefined) ?? sim.state.workspaces.find((w) => w.name === "billing-api")!;
    const repo = sim.vfs.repoOf(ws.path);
    const st = repo ? sim.vfs.status(repo) : [];
    let add = 0;
    let del = 0;
    for (const e of st) {
      const c = counts(repo!.head.get(e.path) ?? "", sim.vfs.read(join(repo!.root, e.path)) ?? "");
      add += c.additions;
      del += c.deletions;
    }
    const agents = this.liveAgents().filter((s) => s.workspace_id === ws.id);
    const byState = (k: string[]) => agents.filter((s) => k.includes(s.status));
    const tests = sim.vfs.walk(ws.path).filter((f) => /\.test\.tsx?$/.test(f) && !f.includes("node_modules")).length;
    const lines = [
      `**${ws.name}** is on \`${repo?.branch ?? "main"}\`${st.length ? ` with ${st.length} changed file${st.length > 1 ? "s" : ""} (+${add}/-${del})` : " with a clean working tree"}.${repo?.log[0] ? ` The last commit is “${repo.log[0].subject}”.` : ""}`,
      "",
      agents.length ? agents.map((s) => `- ${this.nameOf(s)}: ${s.status === "working" ? "working on" : s.status === "waiting" ? "waits for you on" : "finished"} ${(s.title || "a task").toLowerCase()}`).join("\n") : "- No agent has worked here yet.",
      "",
      `${tests} test file${tests === 1 ? "" : "s"}. ${byState(["waiting"]).length ? "One prompt is waiting for you." : "Nothing is waiting for you."} Say “run the tests in ${ws.name}” and I will.`,
    ];
    return this.say(lines.join("\n"));
  }

  private async runTests(project: string | null) {
    const sim = this.sim;
    const ws = (project ? sim.state.workspaces.find((w) => w.name === project) : undefined) ?? sim.state.workspaces.find((w) => w.name === "billing-api")!;
    await this.say(`Running \`pnpm test\` in **${ws.name}**.`);
    await sim.clock.sleep(1500, sim.scope);
    const out = testOutput(sim, ws.path).map(stripAnsi);
    const total = Number(out.join("\n").match(/Tests\s+(\d+) passed/)?.[1] ?? 0);
    const files = Number(out.join("\n").match(/Test Files\s+(\d+) passed/)?.[1] ?? 0);
    this.message("action", `Ran pnpm test in ${ws.name}`);
    return this.say(`All ${total} tests pass in ${files} file${files === 1 ? "" : "s"}. Nothing failed and nothing was skipped.`);
  }

  // ── memory, observations, questions ────────────────────────────────────────────────────────

  addNote(text: string) {
    const n = this.n;
    this.sim.state.neural = { ...n, notes: [...n.notes, { id: this.sim.id("note", 10), text, at: this.sim.now() }] };
    this.sim.emitNeural();
  }

  observe(kind: ObsKind, text: string, extra: Partial<NeuralObs> = {}) {
    const n = this.n;
    const o: NeuralObs = { id: this.sim.id("obs", 10), at: this.sim.now(), kind, text, seen: false, ...extra };
    this.sim.state.neural = { ...n, observations: [...n.observations, o].slice(-60) };
    this.sim.emitNeural();
  }

  setMode(mode: "active" | "quiet" | "off") {
    this.sim.state.neural = { ...this.n, mode };
    this.sim.emitNeural();
  }

  editTask(id: string, patch: { status?: NeuralTask["status"]; remove: boolean }) {
    const n = this.n;
    const tasks = patch.remove ? n.tasks.filter((t) => t.id !== id) : n.tasks.map((t) => (t.id === id ? { ...t, ...(patch.status ? { status: patch.status } : {}), updated_at: this.sim.now() } : t));
    this.sim.state.neural = { ...n, tasks };
    this.sim.emitNeural();
  }

  removeNote(id: string) {
    const n = this.n;
    this.sim.state.neural = { ...n, notes: n.notes.filter((x) => x.id !== id) };
    this.sim.emitNeural();
  }

  // ── agents Neural follows ──────────────────────────────────────────────────────────────────

  /** Start an agent and follow its task: Neural reports when it finishes or needs you. */
  startAgent(workspaceId: string, profile: string, task: string): Session {
    const sim = this.sim;
    const ws = sim.state.workspaces.find((w) => w.id === workspaceId)!;
    // A prompt the Claude skills do not know is answered with the honest generic work instead of a question.
    const engine = sim.state.profiles.find((p) => p.id === profile)?.engine ?? profile;
    const known = !!taskFor(sim, ws.name, engine, task) || (profile === "claude" && matchIntent(task).k !== "unknown");
    const s = createSession(sim, { workspaceId, profileId: profile, prompt: task, ...(known ? {} : { beats: replyTo(sim, ws.path, task) }) });
    this.message("action", `Started ${this.nameOf(s)} in ${ws.name}`, { session_id: s.id });
    this.track(s.id, { title: task.replace(/\.$/, ""), ...(/test/i.test(task) ? { check: "pnpm test" } : {}) });
    this.observe("started", `${ws.name} — ${this.nameOf(s)} started: ${task.replace(/\.$/, "")}`, { session_id: s.id, seen: true });
    return s;
  }

  /** Neural follows a session that is already running (the scenes use this for the agents that "were started earlier"). */
  follow(sid: string, check?: string): void {
    const s = this.sim.session(sid);
    if (!s) return;
    this.track(sid, { title: s.title, ...(check ? { check } : {}) });
    this.observe("started", `${this.wsName(s.workspace_id)} — ${this.nameOf(s)} started: ${s.title}`, { session_id: sid, seen: true });
  }

  /** A task for a session Neural follows (also used by the scenes for the agents that are "already running"). */
  track(sid: string, o: { title: string; doneWhen?: string; check?: string }): NeuralTask {
    const sim = this.sim;
    const s = sim.session(sid)!;
    const task: NeuralTask = {
      id: sim.id("task", 12),
      title: o.title,
      ...(o.doneWhen ? { done_when: o.doneWhen } : {}),
      status: "working",
      workspace_id: s.workspace_id,
      agents: [sid],
      ...(o.check ? { check: o.check } : {}),
      note: s.last_line && s.status === "working" ? `${this.nameOf(s)}: ${s.last_line.replace(/\s+/g, " ").slice(0, 90)}` : `${this.nameOf(s)} is getting started`,
      created_at: sim.now(),
      updated_at: sim.now(),
    };
    this.set({ tasks: [...this.n.tasks, task] });
    return task;
  }

  /** Does a task of Neural's own follow this session (its observations are then written by the task)? */
  tracks(sid: string): boolean {
    return !!this.n?.tasks.some((t) => t.agents.includes(sid));
  }

  private noteAt = new Map<string, number>();

  /** What a followed agent is doing right now, as the note of its task (at most every few seconds). */
  lineChanged(s: Session) {
    if (!this.n) return;
    const task = this.n.tasks.find((t) => t.status === "working" && t.agents.includes(s.id));
    if (!task) return;
    const now = this.sim.now();
    if (now - (this.noteAt.get(s.id) ?? 0) < 4000) return;
    this.noteAt.set(s.id, now);
    const line = (s.last_line ?? "").replace(/\s+/g, " ").slice(0, 90);
    this.set({ tasks: this.n.tasks.map((t) => (t.id === task.id ? { ...t, note: `${this.nameOf(s)}: ${line}`, updated_at: now } : t)) });
  }

  /** `Sim.patch` tells Neural when a session changes status; tasks and observations follow. */
  sessionChanged(old: Session, next: Session) {
    if (old.status === next.status || !this.n) return;
    const sim = this.sim;
    const task = this.n.tasks.find((t) => t.agents.includes(next.id));
    if (!task) return;
    const who = this.nameOf(next);
    const ws = this.wsName(next.workspace_id);
    const upd = (status: NeuralTask["status"], note: string) => this.set({ tasks: this.n.tasks.map((t) => (t.id === task.id ? { ...t, status, note, updated_at: sim.now() } : t)) });
    if (next.status === "working") return upd("working", `${who} is working`);
    if (next.status === "waiting") {
      upd("blocked", `${who}: ${next.last_line || "needs a permission"}`);
      return this.observe("waiting", `${ws} — ${who} needs input: ${next.last_line || "waiting for you"}`, { session_id: next.id, task_id: task.id });
    }
    if (next.status === "error") {
      upd("blocked", `${who} stopped with an error`);
      return this.observe("error", `${ws} — ${who} stopped with an error: ${next.last_line || "it exited"}`, { session_id: next.id, task_id: task.id });
    }
    if (next.status === "done" && old.status !== "idle") {
      if (next.last_line === "Interrupted") {
        upd("failed", "Stopped by you");
        return this.observe("exited", `${ws} — ${who} exited: stopped by you`, { session_id: next.id, task_id: task.id, seen: true });
      }
      const said = firstSentence(next.last_message || "");
      let note = said || `${who} finished`;
      if (task.check) {
        const lines = testOutput(sim, sim.session(next.id)?.cwd ?? "/").map(stripAnsi);
        const total = lines.join("\n").match(/Tests\s+(\d+) passed/)?.[1];
        note = `Check passed${total ? `: ${total} tests` : ""}`;
        this.observe("check_passed", `${ws} — ${who}: check passed (${task.check})`, { session_id: next.id, task_id: task.id, seen: true });
      }
      upd("done", note);
      this.observe("done", `${ws} — ${who} finished${said ? `: ${said}` : ""}`, { session_id: next.id, task_id: task.id });
      if (!this.reported.has(next.id)) {
        this.reported.add(next.id);
        this.proactive(`**${ws}** is done: ${said || `${who} finished its task`}${task.check ? " The check passed." : ""}`, { session_id: next.id });
      }
    }
  }

  /** `neural_confirm`: Allow or Deny what Neural asked before it does something. */
  confirm(id: string, allow: boolean) {
    const sim = this.sim;
    const n = this.n;
    const p = n.pending.find((x) => x.id === id);
    if (!p) return;
    sim.state.neural = { ...n, pending: n.pending.filter((x) => x.id !== id) };
    sim.emitNeural();
    const act = p.action as { kind?: string; workspace?: string; profile?: string; prompt?: string } | undefined;
    if (allow && act?.kind === "start" && act.workspace && act.profile) {
      const ws = sim.state.workspaces.find((w) => w.name === act.workspace);
      if (ws) this.startAgent(ws.id, act.profile, act.prompt ?? "Review the latest changes.");
    } else if (allow) {
      this.message("action", p.title);
      this.observe("allowed", `You allowed: ${p.title}`, { seen: true });
    } else {
      this.message("action", `Cancelled: ${p.title.replace(/^Start /, "start ")}`, { ok: false });
      this.observe("allowed", `You said no to "${p.title}"`, { seen: true });
    }
  }

  /** A minute ago: used by seeds. */
  ago(min: number) {
    return this.sim.now() - min * MIN;
  }
}
