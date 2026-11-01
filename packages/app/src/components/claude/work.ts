/**
 * Background work of a conversation in one shape for every surface (pure, no React; tested in
 * `lib/cvWork.test.ts`): the subagent card in the transcript, the "running work" strip above the
 * composer, the Tasks sheet and the subagent view all read their words, numbers and grouping
 * from here, so they always agree (D65).
 *
 * - Status: one vocabulary (`running`, `background`, `done`, `failed`, `stopped`).
 * - Openable: a subagent opens its own transcript as soon as its real id is known (an id that
 *   is not the tool call's); shells and monitors show their output.
 * - Tree: nested subagents (`CvTask.parent`) sit under their parent; four or more agents started
 *   together (a fan-out, a workflow) fold into one group row.
 * - Fade: finished items stay in the strip for `KEEP_MS`, then leave.
 */
import type { CvTask } from "@neuralagent/protocol";
import { agentTypeName, duration } from "./toolText.ts";

export type WorkStatus = "running" | "background" | "done" | "failed" | "stopped";
export type WorkKind = "agent" | "bash" | "monitor" | "workflow";

/** How long a finished item stays in the strip. */
export const KEEP_MS = 45_000;
/** Agents started within this window (same parent) count as one fan-out. */
export const BATCH_MS = 2_500;
/** A fan-out this big becomes a group row. */
export const GROUP_MIN = 4;
/** No transcript write for this long: the row says how long it has been quiet. */
export const QUIET_MS = 60_000;

export const isLive = (s: WorkStatus) => s === "running" || s === "background";

export function statusOf(t: Pick<CvTask, "status" | "background">): WorkStatus {
  if (t.status === "running") return t.background ? "background" : "running";
  if (t.status === "failed") return "failed";
  if (t.status === "killed" || t.status === "stopped") return "stopped";
  return "done";
}

export const STATUS_WORD: Record<WorkStatus, string> = {
  running: "Working",
  background: "In the background",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

export function kindOf(t: Pick<CvTask, "kind">): WorkKind {
  return t.kind === "bash" || t.kind === "monitor" || t.kind === "workflow" ? t.kind : "agent";
}

/** A tool call id (`toolu_…`) is not an agent id yet: the agent's transcript cannot be opened by it. */
export const isToolId = (id: string) => /^(toolu|call|tool)_/.test(id);

/** The id to open a subagent's transcript with, when there is one. */
export function agentIdOf(t: CvTask | undefined, fromResult?: string | null): string | undefined {
  if (t && kindOf(t) === "agent" && !isToolId(t.id)) return t.id;
  return fromResult || undefined;
}

export function canOpen(t: CvTask): boolean {
  return kindOf(t) === "agent" ? !!agentIdOf(t) : !!t.output_file || !!t.command;
}

export const titleOf = (t: CvTask) => t.description || t.command || (kindOf(t) === "agent" ? "Subagent" : t.id);

/** "Explore", "Agent", "Shell", "Monitor". */
export function typeOf(t: CvTask): string {
  switch (kindOf(t)) {
    case "bash":
      return "Shell";
    case "monitor":
      return "Monitor";
    case "workflow":
      return "Workflow";
    default:
      return agentTypeName(t.agent_type);
  }
}

export function tokenText(n?: number | null): string {
  if (!n) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k tokens` : `${n} tokens`;
}

/** How long it ran (or runs, measured to `now`). */
export function elapsedOf(t: CvTask, now: number): number | undefined {
  if (t.duration_ms) return t.duration_ms;
  if (!t.started) return undefined;
  const end = t.status === "running" ? now : t.ended;
  return end && end >= t.started ? end - t.started : undefined;
}

/** "Read main.rs · 1m 20s · 12k tokens" for a running item; "3 tools · 12k tokens · 1m 20s" after. */
/** The live step ("Read clock.ts"); none while it only repeats the title. */
export function stepOf(t: CvTask): string {
  return t.status === "running" && t.label && t.label !== titleOf(t) ? t.label : "";
}

export function detailOf(t: CvTask, now: number): string {
  const live = t.status === "running";
  const el = elapsedOf(t, now);
  const quiet = live && t.active && now - t.active > QUIET_MS ? `quiet for ${duration(now - t.active)}` : "";
  if (live) return [stepOf(t), quiet, el !== undefined ? duration(el) : "", tokenText(t.tokens)].filter(Boolean).join(" · ");
  return [t.tool_count ? `${t.tool_count} ${t.tool_count === 1 ? "tool" : "tools"}` : "", tokenText(t.tokens), el !== undefined ? duration(el) : ""].filter(Boolean).join(" · ");
}

/** "3 agents running · 1 shell", or what just finished ("2 agents done"). Empty: nothing to show. */
export function summaryOf(items: CvTask[]): string {
  const live = items.filter((t) => t.status === "running");
  const n = (k: WorkKind) => live.filter((t) => kindOf(t) === k || (k === "agent" && kindOf(t) === "workflow")).length;
  const agents = n("agent");
  const shells = n("bash");
  const monitors = n("monitor");
  const parts: string[] = [];
  if (agents) parts.push(`${agents} ${agents === 1 ? "agent" : "agents"}`);
  if (shells) parts.push(`${shells} ${shells === 1 ? "shell" : "shells"}`);
  if (monitors) parts.push(`${monitors} ${monitors === 1 ? "monitor" : "monitors"}`);
  if (parts.length) {
    parts[0] = `${parts[0]} running`;
    return parts.join(" · ");
  }
  const failed = items.filter((t) => statusOf(t) === "failed").length;
  const done = items.length - failed;
  const words: string[] = [];
  if (done) words.push(`${done} ${done === 1 ? "task" : "tasks"} done`);
  if (failed) words.push(`${failed} failed`);
  return words.join(" · ");
}

/**
 * The items the strip shows at `now`: everything running, and finished items for `KEEP_MS` after
 * they ended. `endedAt` is when this client saw it end (the computer's clock may differ from the
 * phone's); without it the task's own `ended` is used.
 */
export function stripItems(tasks: CvTask[], now: number, endedAt: (t: CvTask) => number | undefined): CvTask[] {
  return tasks.filter((t) => {
    if (t.status === "running") return true;
    const end = endedAt(t) ?? t.ended;
    return end !== undefined && now - end < KEEP_MS;
  });
}

/** When the next finished item leaves the strip (for one timer instead of a ticking clock). */
export function nextFade(tasks: CvTask[], now: number, endedAt: (t: CvTask) => number | undefined): number | undefined {
  let next: number | undefined;
  for (const t of tasks) {
    if (t.status === "running") continue;
    const end = endedAt(t) ?? t.ended;
    if (end === undefined) continue;
    const left = end + KEEP_MS - now;
    if (left > 0 && (next === undefined || left < next)) next = left;
  }
  return next;
}

/** A row of the work list: one task, or a group of agents started together. */
export type WorkNode =
  | { k: "task"; task: CvTask; depth: number; children: WorkNode[] }
  | { k: "group"; key: string; label: string; tasks: CvTask[]; running: number; depth: number; children: WorkNode[] };

const byStart = (a: CvTask, b: CvTask) => (b.started ?? 0) - (a.started ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const order = (a: CvTask, b: CvTask) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || byStart(a, b);

/** Agents of one parent that were started together (`GROUP_MIN` or more), oldest first. */
function batches(tasks: CvTask[], byParent = false): CvTask[][] {
  const agents = tasks.filter((t) => kindOf(t) === "agent" && t.started).sort((a, b) => a.started! - b.started!);
  const out: CvTask[][] = [];
  const last = new Map<string, CvTask[]>();
  for (const t of agents) {
    const key = byParent ? (t.parent ?? "") : "";
    const b = last.get(key);
    if (b && t.started! - b.at(-1)!.started! <= BATCH_MS) b.push(t);
    else {
      const n = [t];
      out.push(n);
      last.set(key, n);
    }
  }
  return out.filter((b) => b.length >= GROUP_MIN);
}

/** "8 Explore agents" / "12 agents". */
export function groupLabel(tasks: CvTask[]): string {
  const types = new Set(tasks.map((t) => typeOf(t)));
  const type = types.size === 1 ? [...types][0]! : "Agent";
  return `${tasks.length} ${type === "Agent" ? "agents" : `${type} agents`}`;
}

/**
 * The tree the strip and the sheet draw: nested agents under their parent (a parent that is not in
 * the list puts them at the top), fan-outs folded into groups, running first, newest first.
 * `all` (every task of the session) decides what a fan-out is, so the strip, which shows only
 * a part of it, groups the same agents as the sheet (from 2 shown members on).
 */
export function workTree(tasks: CvTask[], all: CvTask[] = tasks, stable = false): WorkNode[] {
  // `stable`: newest first only, so a row does not jump while it is being tapped (the open strip).
  const by = stable ? byStart : order;
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string, CvTask[]>();
  for (const t of tasks) {
    const p = t.parent && ids.has(t.parent) && t.parent !== t.id ? t.parent : "";
    kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  const fanOuts = batches(all === tasks ? tasks : [...all.filter((t) => !ids.has(t.id)), ...tasks], true);
  const seen = new Set<string>();
  const level = (parent: string, depth: number): WorkNode[] => {
    const list = (kids.get(parent) ?? []).filter((t) => !seen.has(t.id));
    for (const t of list) seen.add(t.id);
    const here = new Set(list.map((t) => t.id));
    const grouped = new Map<string, CvTask[]>();
    for (const b of fanOuts) {
      const shown = b.filter((t) => here.has(t.id));
      if (shown.length >= (all === tasks ? GROUP_MIN : 2)) grouped.set(b[0]!.id, shown);
    }
    const inGroup = new Set([...grouped.values()].flat().map((t) => t.id));
    const nodes: { node: WorkNode; sort: CvTask }[] = [];
    for (const [key, b] of grouped) {
      const sorted = [...b].sort(by);
      nodes.push({
        node: { k: "group", key: `group:${key}`, label: groupLabel(b), tasks: sorted, running: b.filter((t) => t.status === "running").length, depth, children: sorted.map((t) => ({ k: "task", task: t, depth: depth + 1, children: level(t.id, depth + 2) })) },
        // A group sorts like its newest running member (or its newest one).
        sort: sorted[0]!,
      });
    }
    for (const t of list) if (!inGroup.has(t.id)) nodes.push({ node: { k: "task", task: t, depth, children: level(t.id, depth + 1) }, sort: t });
    return nodes.sort((a, b) => by(a.sort, b.sort)).map((n) => n.node);
  };
  return level("", 0);
}

/** Every task in a tree, in drawing order (for counts and keyboard order). */
export function flatten(nodes: WorkNode[]): CvTask[] {
  return nodes.flatMap((n) => (n.k === "task" ? [n.task, ...flatten(n.children)] : flatten(n.children)));
}

/** The chain of agents from the outermost to `id` (for the breadcrumb of a nested subagent). */
export function trailOf(tasks: CvTask[], id: string): CvTask[] {
  const by = new Map(tasks.map((t) => [t.id, t]));
  const out: CvTask[] = [];
  let cur = by.get(id);
  while (cur && !out.includes(cur)) {
    out.unshift(cur);
    cur = cur.parent ? by.get(cur.parent) : undefined;
  }
  return out;
}
