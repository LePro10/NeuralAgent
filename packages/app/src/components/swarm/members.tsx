import type { Swarm } from "@neuralagent/protocol";
import { cn, type Activity } from "@neuralagent/ui";
import { useMemo } from "react";
import { STATUS, activityOf } from "../../lib/status";
import { useDaemon } from "../../lib/store";
import { EngineTile } from "../EngineTile";

/** A swarm member as the page shows it: role, its agent, and what it is doing now. */
export interface MemberView {
  role: string;
  sid: string;
  engine: string;
  agent: string;
  alive: boolean;
  activity?: Activity;
  label: string;
  tone: "dim" | "accent" | "danger";
}

export function useMembers(swarm: Swarm | undefined): MemberView[] {
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  return useMemo(
    () =>
      (swarm?.members ?? []).map((m) => {
        const s = sessions?.[m.session_id];
        const p = profiles?.find((x) => x.id === s?.profile_id);
        const alive = !!s?.alive && !swarm?.ended;
        const status = alive ? s!.status : "exited";
        return {
          role: m.role,
          sid: m.session_id,
          engine: p?.engine ?? "custom",
          agent: p?.name ?? s?.profile_id ?? "Agent",
          alive,
          activity: alive ? activityOf([status]) : undefined,
          label: alive ? STATUS[status].label : "Stopped",
          tone: status === "waiting" ? "accent" : status === "error" ? "danger" : "dim",
        } satisfies MemberView;
      }),
    [swarm, sessions, profiles],
  );
}

const TONE = { dim: "text-dim", accent: "text-accent", danger: "text-danger" } as const;

/**
 * One member: its agent's quiet tile with the live activity mark, the role, and "status · agent".
 * Clicking it opens that agent's terminal. `rail` is the full-width row of the desktop rail.
 */
export function MemberButton({ m, onOpen, rail }: { m: MemberView; onOpen: (sid: string) => void; rail?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(m.sid)}
      title={`Open ${m.role}'s terminal`}
      aria-label={`${m.role}, ${m.agent}: ${m.label}. Open its terminal`}
      className={cn(
        "group flex min-w-0 items-center gap-3 text-left",
        rail ? "press-row w-full rounded-field px-2.5 py-2 hover:bg-fill-2" : "pressable surface shrink-0 rounded-list py-2 pr-4 pl-2.5",
      )}
    >
      <EngineTile engine={m.engine} activity={m.activity} edge="ring-card" className={cn(!m.alive && "opacity-55")} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-subhead text-bright">{m.role}</span>
        <span className="truncate text-caption text-dim">
          <span className={TONE[m.tone]}>{m.label}</span> · {m.agent}
        </span>
      </span>
    </button>
  );
}

/** A quiet initials disc for a sender in the feed (no colour per member, D46). */
export function RoleMark({ role, size = 28, you }: { role: string; size?: number; you?: boolean }) {
  const initials = role
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-full text-caption shadow-lip", you ? "bg-accent/15 text-accent" : "bg-fill-3 text-ink")}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}
