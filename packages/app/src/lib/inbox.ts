// The phone's Agents inbox: every agent across all projects, sorted by what it needs from you.
// "Needs you" (waiting for an answer, or failed), "Working", "Done" (finished, idle or stopped).
// A running swarm is one row (its members are not listed one by one) and sits in the section of
// its most urgent member. Pure, so it is unit-tested; the screen only renders it.
import type { Profile, Session, Swarm } from "@neuralagent/protocol";

export type InboxItem =
  | { kind: "agent"; id: string; s: Session; since: number }
  | { kind: "swarm"; id: string; swarm: Swarm; members: Session[]; since: number; waiting: Session[] };

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

const RANK: Record<Section, number> = { needs: 0, working: 1, done: 2 };

export function buildInbox(
  sessions: Record<string, Session> | undefined,
  profiles: Profile[] | undefined,
  swarms: Swarm[] | undefined,
  opts: { project?: string } = {},
): Inbox {
  const agents = Object.values(sessions ?? {}).filter((s) => isAgent(s, profiles) && (!opts.project || s.workspace_id === opts.project));
  const inSwarm = new Map<string, Swarm>();
  for (const w of swarms ?? []) for (const m of w.members) inSwarm.set(m.session_id, w);
  const out: Inbox = { needs: [], working: [], done: [], counts: { all: agents.length, needs: 0, working: 0, done: 0 } };
  const teams = new Map<string, Session[]>();
  for (const s of agents) {
    out.counts[sectionOf(s)]++;
    const w = inSwarm.get(s.id);
    if (w) {
      // Ended swarms leave the inbox (their list lives under "Swarms").
      if (!w.ended) teams.set(w.id, [...(teams.get(w.id) ?? []), s]);
      continue;
    }
    out[sectionOf(s)].push({ kind: "agent", id: s.id, s, since: s.status_since });
  }
  for (const [id, members] of teams) {
    const swarm = (swarms ?? []).find((w) => w.id === id)!;
    const section = members.map(sectionOf).sort((a, b) => RANK[a] - RANK[b])[0]!;
    const waiting = members.filter((m) => sectionOf(m) === "needs");
    const since = Math.max(...members.map((m) => m.status_since));
    out[section].push({ kind: "swarm", id, swarm, members, since, waiting });
  }
  // Who waits longest comes first; everything else newest first.
  out.needs.sort((a, b) => a.since - b.since);
  out.working.sort((a, b) => b.since - a.since);
  out.done.sort((a, b) => b.since - a.since);
  return out;
}
