// The phone's Agents inbox: every agent across all projects, sorted by what it needs from you.
// "Needs you" (waiting for an answer, or failed), "Working", "Done" (finished, idle or stopped).
// Pure, so it is unit-tested; the screen only renders it.
import type { Profile, Session } from "@neuralagent/protocol";

export type InboxItem = { kind: "agent"; id: string; s: Session; since: number };

export interface Inbox {
  needs: InboxItem[];
  working: InboxItem[];
  done: InboxItem[];
  /** Agents (not rows): what the tab badge and the eyebrow count. */
  counts: { all: number; needs: number; working: number; done: number };
}

/** Plain terminals and installers are not agents. */
export function isAgent(s: Session, profiles: Profile[] | undefined): boolean {
  if (s.profile_id.startsWith("install:")) return false;
  const engine = profiles?.find((p) => p.id === s.profile_id)?.engine ?? "shell";
  return engine !== "shell";
}

type Section = "needs" | "working" | "done";
export function sectionOf(s: Session): Section {
  if (s.status === "error" || (s.alive && s.status === "waiting")) return "needs";
  if (s.alive && (s.status === "working" || s.status === "starting")) return "working";
  return "done";
}

export function buildInbox(
  sessions: Record<string, Session> | undefined,
  profiles: Profile[] | undefined,
  opts: { project?: string } = {},
): Inbox {
  const agents = Object.values(sessions ?? {}).filter((s) => isAgent(s, profiles) && (!opts.project || s.workspace_id === opts.project));
  const out: Inbox = { needs: [], working: [], done: [], counts: { all: agents.length, needs: 0, working: 0, done: 0 } };
  for (const s of agents) {
    const section = sectionOf(s);
    out.counts[section]++;
    out[section].push({ kind: "agent", id: s.id, s, since: s.status_since });
  }
  // Who waits longest comes first; everything else newest first.
  out.needs.sort((a, b) => a.since - b.since);
  out.working.sort((a, b) => b.since - a.since);
  out.done.sort((a, b) => b.since - a.since);
  return out;
}
