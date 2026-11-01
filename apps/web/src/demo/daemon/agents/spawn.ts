// Creating, restarting and closing sessions: the one place that knows how a session is made of a
// state entry, a terminal, a shell or a scripted run, a Claude view and a pane in a layout.

import type { Session } from "@neuralagent/protocol";
import { CvSession } from "../claude/cv.ts";
import { Shell } from "../shell.ts";
import type { Sim } from "../sim.ts";
import { Term } from "../term.ts";
import { Run, type Beat } from "./run.ts";
import { claudeReply } from "../claude/skills.ts";
import { TASKS, extraTasks, replyTo, type TaskEntry } from "./scripts.ts";

/** What a session does with a prompt typed into it: Claude has skills for it, the others a generic answer. */
function responder(sim: Sim, id: string, cwd: string, claude: boolean): (text: string) => Beat[] {
  return claude ? (text) => claudeReply(sim, id, text) : (text) => replyTo(sim, cwd, text);
}

export interface SpawnOpts {
  workspaceId: string;
  profileId: string;
  title?: string;
  cwd?: string;
  prompt?: string;
  /** Put it in a pane of the workspace (default true). */
  place?: boolean;
  paneId?: string;
  cols?: number;
  rows?: number;
  /** Fixed id (seeding). */
  id?: string;
  worktree?: Session["worktree"];
  /** Beats instead of a script guessed from the prompt. */
  beats?: Beat[];
  startedAt?: number;
}

const titleOf = (prompt: string) => {
  const t = prompt.replace(/\s+/g, " ").trim();
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return first.length > 48 ? first.slice(0, 47).replace(/\s+\S*$/, "") + "…" : first;
};

/** The task a prompt belongs to, when it is one of the authored ones (same prompt, same project and engine). */
export function taskFor(sim: Sim, workspaceName: string, engine: string, prompt: string): TaskEntry | undefined {
  const t = TASKS[workspaceName];
  const list = [...((t as Record<string, TaskEntry[]> | undefined)?.[engine] ?? []), ...extraTasks(workspaceName, engine)];
  void sim;
  return list.find((x) => x.prompt.trim() === prompt.trim());
}

/** Hand a prompt to a session that waits: the authored script when it is one, else what its engine does with any prompt. */
export function promptSession(sim: Sim, id: string, prompt: string): void {
  const s = sim.session(id);
  const run = sim.runs.get(id);
  const w = sim.workspaceOf(id);
  if (!s || !run?.onPrompt || !w) return;
  const task = taskFor(sim, w.name, sim.engineOf(id), prompt);
  const beats = task?.fn(sim, s.cwd) ?? run.onPrompt(prompt);
  sim.patch(id, { ...(task ? { title: task.title } : {}), prompt: prompt.slice(0, 160), status: "working", last_line: "Starting…" });
  void run.turn(prompt, beats).catch((e) => console.error("[demo] run failed", e));
}

export function createSession(sim: Sim, o: SpawnOpts): Session {
  const ws = sim.state.workspaces.find((w) => w.id === o.workspaceId);
  const profile = sim.state.profiles.find((p) => p.id === o.profileId);
  if (!ws || !profile) throw new Error("unknown workspace or profile");
  const id = o.id ?? sim.id("session");
  const cwd = o.cwd ?? ws.path;
  const now = o.startedAt ?? sim.now();
  const isShell = profile.engine === "shell";
  const task = o.prompt && !o.beats ? taskFor(sim, ws.name, profile.engine, o.prompt) : undefined;
  const session: Session = {
    id,
    workspace_id: ws.id,
    profile_id: profile.id,
    title: o.title ?? task?.title ?? (o.prompt ? titleOf(o.prompt) : isShell ? "Terminal" : profile.name),
    cwd,
    status: isShell ? "idle" : "starting",
    status_since: now,
    started_at: now,
    busy_ms: 0,
    cols: o.cols ?? (isShell ? 100 : 56),
    rows: o.rows ?? 30,
    alive: true,
    status_source: isShell ? "process" : profile.engine === "claude" || profile.engine === "codex" ? "hooks" : "output",
    ...(o.worktree ? { worktree: o.worktree } : {}),
  };
  sim.emit({ e: "session_upsert", session });
  const term = new Term(sim, id);
  term.cols = session.cols;
  term.rows = session.rows;
  sim.terms.set(id, term);
  if (o.place !== false) sim.placeSession(ws.id, id, o.paneId);
  if (isShell) {
    const sh = new Shell(sim, term, cwd);
    sh.start();
    sim.shells.set(id, sh);
  } else {
    const cv = profile.engine === "claude" ? new CvSession(sim, id) : undefined;
    if (cv) sim.cvs.set(id, cv);
    const run = new Run(sim, id, term, cv);
    sim.runs.set(id, run);
    run.onPrompt = responder(sim, id, cwd, cv !== undefined);
    run.open();
    if (o.prompt) {
      const beats = o.beats ?? task?.fn(sim, cwd) ?? run.onPrompt(o.prompt);
      sim.patch(id, { status: "working", prompt: o.prompt.slice(0, 160), last_line: "Starting…" });
      void run.turn(o.prompt, beats).catch((e) => console.error("[demo] run failed", e));
    } else {
      run.idle();
      sim.patch(id, { status: "idle", last_line: "" });
    }
  }
  return sim.session(id) ?? session;
}

/** Stop the process but keep the pane (the app offers Restart). */
export function stopSession(sim: Sim, id: string) {
  sim.runs.get(id)?.stop();
  sim.shells.get(id)?.dispose();
  const term = sim.terms.get(id);
  term?.write("\r\n\x1b[2m[Process stopped]\x1b[0m\r\n");
  sim.runs.delete(id);
  sim.shells.delete(id);
  sim.patch(id, { alive: false, status: "exited", exit_code: 0, last_line: "Stopped" });
}

/** Remove the session and its pane content. */
export function closeSession(sim: Sim, id: string) {
  sim.runs.get(id)?.stop();
  sim.shells.get(id)?.dispose();
  sim.runs.delete(id);
  sim.shells.delete(id);
  sim.terms.delete(id);
  sim.cvs.delete(id);
  sim.unplaceSession(id);
  sim.emit({ e: "session_removed", id });
}

/** Start the same session again in its pane (a fresh terminal, same title and folder). */
export function restartSession(sim: Sim, id: string): Session | undefined {
  const s = sim.session(id);
  if (!s) return undefined;
  sim.runs.get(id)?.stop();
  sim.shells.get(id)?.dispose();
  sim.runs.delete(id);
  sim.shells.delete(id);
  sim.cvs.delete(id);
  const profile = sim.state.profiles.find((p) => p.id === s.profile_id);
  const term = sim.terms.get(id) ?? new Term(sim, id);
  term.wipe();
  term.write("\x1b[H\x1b[2J\x1b[3J");
  sim.terms.set(id, term);
  sim.patch(id, { alive: true, status: profile?.engine === "shell" ? "idle" : "starting", exit_code: undefined, last_line: "" });
  if (profile?.engine === "shell") {
    const sh = new Shell(sim, term, s.cwd);
    sh.start();
    sim.shells.set(id, sh);
  } else {
    const cv = profile?.engine === "claude" ? new CvSession(sim, id) : undefined;
    if (cv) sim.cvs.set(id, cv);
    const run = new Run(sim, id, term, cv);
    sim.runs.set(id, run);
    run.onPrompt = responder(sim, id, s.cwd, cv !== undefined);
    run.open();
    run.idle();
    sim.patch(id, { status: "idle" });
  }
  return sim.session(id);
}
