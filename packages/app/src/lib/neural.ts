import type { NeuralObs, NeuralState, NeuralTask, NeuralTaskStatus, ObsKind, OrchMessage, State } from "@neuralagent/protocol";
import type { Activity } from "@neuralagent/ui";

/** What an older daemon (no Neural v2) sends: nothing. */
export const EMPTY_NEURAL: NeuralState = { mode: "active", tasks: [], notes: [], observations: [], pending: [], summary_upto: 0 };

export function neuralOf(s: State | undefined | null): NeuralState {
  return s?.neural ?? EMPTY_NEURAL;
}

type Notice = { id: string; role: "notice"; text: string; session_id?: string; at: number };

/** Kinds whose text keeps the old notice shape ("<label> finished|needs input|stopped with an error: …"). */
const NOTICE_KINDS: ObsKind[] = ["done", "waiting", "error"];

/**
 * Agent notices for rows (`agentSays`): Neural's observations, and on older daemons the notices
 * that still sit in the conversation. Oldest first.
 */
export function neuralNotices(s: State | undefined | null): Notice[] {
  if (!s) return [];
  const out: Notice[] = [];
  for (const m of s.orchestrator.messages) if (m.role === "notice" && m.session_id) out.push({ id: m.id, role: "notice", text: m.text, session_id: m.session_id, at: m.at });
  for (const o of neuralOf(s).observations)
    if (NOTICE_KINDS.includes(o.kind) && o.session_id) out.push({ id: o.id, role: "notice", text: o.text, session_id: o.session_id, at: o.at });
  return out.sort((a, b) => a.at - b.at);
}

/** Stable empty list so selectors do not re-render for nothing. */
const NONE: Notice[] = [];
/** Memo for `neuralNotices` keyed on the two lists it reads (for `useDaemon` selectors). */
let memo: { a: unknown; b: unknown; out: Notice[] } | undefined;
export function neuralNoticesMemo(s: State | undefined | null): Notice[] {
  if (!s) return NONE;
  const a = s.orchestrator.messages;
  const b = s.neural?.observations;
  if (memo && memo.a === a && memo.b === b) return memo.out;
  memo = { a, b, out: neuralNotices(s) };
  return memo.out;
}

export const TASK_WORD: Record<NeuralTaskStatus, string> = {
  open: "Open",
  working: "Working",
  review: "Checking",
  blocked: "Needs you",
  done: "Done",
  failed: "Dropped",
};

/** A race whose attempts are all in: the user picks one (not "checking" any more). */
export function racePick(t: NeuralTask): boolean {
  return t.status === "review" && t.team?.pattern === "race" && !t.team.winner && t.team.attempts.some((a) => a.state === "ready");
}

/** The word for a task's status. */
export function taskWord(t: NeuralTask): string {
  return racePick(t) ? "Pick one" : TASK_WORD[t.status];
}

/** The activity mark of a task (same vocabulary as agents). */
export function taskActivity(t: NeuralTask): Activity | undefined {
  if (racePick(t)) return "waiting";
  switch (t.status) {
    case "working":
    case "review":
      return "working";
    case "blocked":
      return "waiting";
    case "failed":
      return "error";
    default:
      return undefined;
  }
}

export const OBS_WORD: Record<ObsKind, string> = {
  started: "Started",
  done: "Finished",
  waiting: "Needs input",
  error: "Error",
  exited: "Exited",
  stuck: "Seems stuck",
  check_passed: "Check passed",
  check_failed: "Check failed",
  allowed: "Allowed",
  team: "Team",
};

export function obsActivity(k: ObsKind): Activity | undefined {
  switch (k) {
    case "done":
    case "check_passed":
      return "done";
    case "waiting":
    case "stuck":
      return "waiting";
    case "error":
    case "check_failed":
      return "error";
    default:
      return undefined;
  }
}

/** "Japan Map — Claude finished: Tests pass." → "Tests pass." (the row shows who and what already). */
export function obsDetail(o: NeuralObs): string {
  const m = /^[\s\S]*? (?:finished|needs input|stopped with an error|exited|seems stuck)(?:: ([\s\S]*))?$/.exec(o.text);
  return (m ? (m[1] ?? "") : o.text).trim();
}

export type Away = {
  /** When the user last looked (wrote to Neural). */
  since: number;
  done: number;
  failed: number;
  waiting: number;
  stuck: number;
  /** What Neural reported on its own since. */
  reports: number;
  /** Tasks finished since. */
  finished: number;
};

/** What to call out after a break: no model call, just the state (shown when there is news). */
export function awayOf(s: State | undefined | null, now: number, minGap = 20 * 60_000): Away | null {
  if (!s) return null;
  const msgs = s.orchestrator.messages;
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.at ?? 0;
  if (!lastUser || now - lastUser < minGap) return null;
  const n = neuralOf(s);
  const after = n.observations.filter((o) => o.at > lastUser);
  const count = (k: ObsKind[]) => new Set(after.filter((o) => k.includes(o.kind)).map((o) => o.session_id ?? o.id)).size;
  const a: Away = {
    since: lastUser,
    done: count(["done"]),
    failed: count(["error", "check_failed"]),
    waiting: count(["waiting"]),
    stuck: count(["stuck"]),
    reports: msgs.filter((m) => m.role === "assistant" && m.proactive && m.at > lastUser && m.text).length,
    finished: n.tasks.filter((t) => t.status === "done" && t.updated_at > lastUser).length,
  };
  return a.done + a.failed + a.waiting + a.stuck + a.reports + a.finished > 0 ? a : null;
}

/** "3 finished · 1 failed · 1 needs you" */
export function awayLine(a: Away): string {
  const parts: string[] = [];
  if (a.finished) parts.push(`${a.finished} ${a.finished === 1 ? "task" : "tasks"} done`);
  if (a.done) parts.push(`${a.done} ${a.done === 1 ? "agent" : "agents"} finished`);
  if (a.failed) parts.push(`${a.failed} failed`);
  if (a.waiting) parts.push(`${a.waiting} ${a.waiting === 1 ? "needs" : "need"} input`);
  if (a.stuck) parts.push(`${a.stuck} seem stuck`);
  if (a.reports && parts.length === 0) parts.push(`${a.reports} ${a.reports === 1 ? "report" : "reports"} from Neural`);
  return parts.join(" · ");
}

/** Messages of the conversation (agent notices of older daemons excluded: they are rows elsewhere). */
export function talkOf(messages: OrchMessage[]): OrchMessage[] {
  return messages.filter((m) => m.role !== "assistant" || m.text);
}
