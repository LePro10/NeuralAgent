import type { AgentStatus } from "@neuralagent/protocol";
import { topActivity, type Activity } from "@neuralagent/ui";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "live" | "ember";

export const STATUS: Record<AgentStatus, { label: string; tone: Tone; pulse?: boolean }> = {
  starting: { label: "Starting", tone: "neutral", pulse: true },
  working: { label: "Working", tone: "live", pulse: true },
  waiting: { label: "Needs input", tone: "warning", pulse: true },
  done: { label: "Done", tone: "success" },
  error: { label: "Error", tone: "danger" },
  idle: { label: "Idle", tone: "neutral" },
  exited: { label: "Exited", tone: "neutral" },
};

/** The most urgent status wins (for tab and workspace badges). */
const RANK: AgentStatus[] = ["waiting", "error", "done", "working", "starting", "idle", "exited"];
export function mostUrgent(list: AgentStatus[]): AgentStatus | null {
  for (const s of RANK) if (list.includes(s)) return s;
  return null;
}

export function since(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Agent statuses → the one activity mark for a nav item (ring = working; dots = waiting / done / error). */
const ACTIVITY: Partial<Record<AgentStatus, Activity>> = { starting: "working", working: "working", waiting: "waiting", done: "done", error: "error" };
export function activityOf(list: AgentStatus[]): Activity | undefined {
  return topActivity(list.map((s) => ACTIVITY[s]));
}
