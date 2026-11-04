// The fake computer as the landing page and the demo frames see it: `createWorld()` builds the world
// (disk, agents, Neural), speaks the protocol through `connect()` and can be steered with `play()`.

import type { Transport } from "@neuralagent/protocol";
import type { DemoScene, DemoSignal, DemoView, DemoWorld, WorldOptions } from "../api.ts";
import { makeClock } from "./clock.ts";
import { makeRng } from "./rng.ts";
import { buildScene, startDirector } from "./scenes.ts";
import { Conn } from "./server.ts";
import { HOST, Sim } from "./sim.ts";

export async function createWorld(opts: WorldOptions = {}): Promise<DemoWorld> {
  const realStart = opts.now ?? Date.now();
  const clock = makeClock({ start: realStart, auto: opts.auto ?? true });
  const sim = new Sim(clock, makeRng(opts.seed ?? 1), opts.latency ?? 6);
  let scene: DemoScene = opts.scene ?? "grid";
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;
  const handles: Record<string, string> = {};

  const rebuild = (next: DemoScene, signal: DemoSignal): Promise<void> => {
    chain = chain.then(async () => {
      if (disposed) return;
      scene = next;
      // Time passes while the page is open; the frozen browser clock of a poster keeps `now` fixed.
      const now = opts.now !== undefined ? opts.now : Date.now();
      await buildScene(sim, next, now);
      for (const k of Object.keys(handles)) delete handles[k];
      Object.assign(handles, sim.handles);
      sim.building = false;
      sim.live = true;
      for (const c of [...sim.conns]) if (c.subscribed) c.snapshot();
      if (next !== "idle") startDirector(sim);
      sim.signal(signal);
      sim.signal({ type: "scene", scene: next });
      // The snapshot is out; the frames open their start page and the moment can be looked at.
      sim.signal({ type: "scene-ready", scene: next });
    });
    return chain;
  };

  // Neural watches the agents: a line in its notes when one finishes, a word when one needs you.
  sim.listeners.add((s) => {
    if (!sim.live || !sim.state.neural) return;
    if (s.type === "agent-status" && s.status === "done") {
      const label = `${sim.profileOf(s.agent)?.name.replace(/ (Code|CLI)$/, "") ?? "Agent"} finished "${s.name}" in ${sim.workspaceOf(s.agent)?.name ?? "a project"}`;
      if (!sim.neural.tracks(s.agent)) sim.neural.observe("done", label, { session_id: s.agent });
    } else if (s.type === "prompt-opened") {
      const who = sim.profileOf(s.agent)?.name.replace(/ (Code|CLI)$/, "") ?? "Agent";
      const where = sim.workspaceOf(s.agent)?.name ?? "a project";
      if (!sim.neural.tracks(s.agent)) sim.neural.observe("waiting", `${who} in ${where} needs input: ${s.command}`, { session_id: s.agent });
      if (sim.state.neural.mode === "active") sim.neural.message("assistant", `**${who}** in ${where} is waiting (${s.command}). ${s.tool === "AskUserQuestion" || s.tool === "ExitPlanMode" ? "Open it to answer, it needs your decision." : 'Say "approve" and I will allow it, or open it to look first.'}`, { proactive: true, session_id: s.agent });
    }
  });

  await rebuild(scene, { type: "ready" });

  const resolve = (name: string): string | null => {
    if (!name) return null;
    for (const k of [`agent.${name}`, `project.${name}`, name]) if (handles[k]) return handles[k]!;
    if (sim.state.sessions[name] || sim.state.workspaces.some((w) => w.id === name) || sim.state.neural?.tasks.some((t) => t.id === name)) return name;
    const w = sim.state.workspaces.find((x) => x.name === name);
    return w?.id ?? null;
  };

  const world: DemoWorld = {
    async connect(view?: DemoView): Promise<Transport> {
      await chain;
      return new Conn(sim, view).transport;
    },
    play(next) {
      void rebuild(next, { type: "reset" });
    },
    reset() {
      void rebuild(scene, { type: "reset" });
    },
    on(cb) {
      sim.listeners.add(cb);
      return () => void sim.listeners.delete(cb);
    },
    handles,
    clock: {
      pause: () => clock.pause(),
      resume: () => clock.resume(),
      setSpeed: (x) => clock.setSpeed(x),
      get paused() {
        return clock.paused;
      },
      get speed() {
        return clock.speed;
      },
      advance: (ms) => clock.advance(ms),
    },
    focus(agent) {
      const id = resolve(agent);
      const s = id ? sim.session(id) : undefined;
      if (!s) return;
      const lay = sim.layoutOf(s.workspace_id);
      for (const tab of lay.tabs) {
        const find = (n: (typeof tab)["root"]): string | null => (n.type === "pane" ? (n.content.kind === "terminal" && n.content.session === s.id ? n.id : null) : n.children.map(find).find(Boolean) ?? null);
        const pane = find(tab.root);
        if (pane) {
          sim.emit({ e: "layout_set", workspace_id: s.workspace_id, layout: { ...lay, active_tab: tab.id, tabs: lay.tabs.map((t) => (t.id === tab.id ? { ...t, focused: pane } : t)) } });
          return;
        }
      }
    },
    resolve,
    summary() {
      const agents = Object.values(sim.state.sessions).filter((x) => x.alive && sim.profileOf(x.id)?.engine !== "shell");
      return { host: HOST.name, agents: agents.length, working: agents.filter((x) => x.status === "working" || x.status === "starting").length, waiting: agents.filter((x) => x.status === "waiting").length };
    },
    tell(text, to) {
      const msg = text.trim();
      if (!msg) return false;
      if (!to || to === "neural") {
        void sim.neural.send(msg);
        return true;
      }
      const id = resolve(to);
      const run = id ? sim.runs.get(id) : undefined;
      if (!run) return false;
      run.submit(msg);
      return true;
    },
    dispose() {
      disposed = true;
      sim.scope.cancel();
      clock.dispose();
      for (const c of [...sim.conns]) c.close("disposed");
    },
  };
  return world;
}
