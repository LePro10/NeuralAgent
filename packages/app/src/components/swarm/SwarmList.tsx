import type { Swarm } from "@neuralagent/protocol";
import { List, cn } from "@neuralagent/ui";
import { Users } from "lucide-react";
import { shortAgo, useNow } from "../../lib/agentui";
import { activityOf } from "../../lib/status";
import { useDaemon } from "../../lib/store";
import { QuietTile, tileGlyph } from "../EngineTile";

/** The swarms in two groups, running first. */
export function SwarmGroups({ swarms, selected, onOpen }: { swarms: Swarm[]; selected?: string; onOpen: (id: string) => void }) {
  const running = swarms.filter((w) => !w.ended);
  const ended = swarms.filter((w) => w.ended);
  return (
    <div className="flex flex-col gap-6">
      {running.length > 0 && (
        <List label="Running">
          {running.map((w) => (
            <SwarmRow key={w.id} swarm={w} selected={w.id === selected} onClick={() => onOpen(w.id)} />
          ))}
        </List>
      )}
      {ended.length > 0 && (
        <List label="Ended">
          {ended.map((w) => (
            <SwarmRow key={w.id} swarm={w} selected={w.id === selected} onClick={() => onOpen(w.id)} />
          ))}
        </List>
      )}
    </div>
  );
}

/** A swarm: its quiet tile with the team's activity, the goal, and "workspace · agents · age". */
function SwarmRow({ swarm, selected, onClick }: { swarm: Swarm; selected: boolean; onClick: () => void }) {
  const sessions = useDaemon((c) => c.state?.sessions);
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === swarm.workspace_id)?.name ?? "");
  const now = useNow();
  const team = swarm.members.map((m) => sessions?.[m.session_id]).filter((s) => !!s?.alive);
  const activity = swarm.ended ? undefined : activityOf(team.map((s) => s!.status));
  const working = swarm.ended ? 0 : team.filter((s) => s!.status === "working" || s!.status === "starting").length;
  return (
    <button
      type="button"
      data-lead=""
      onClick={onClick}
      aria-current={selected || undefined}
      className={cn("press-row flex w-full items-start gap-3 px-4 py-3 text-left", selected ? "bg-fill-3" : "hover:bg-fill-1")}
    >
      <QuietTile activity={activity} selected={selected} edge="ring-card" className={cn("mt-0.5", swarm.ended && "opacity-60")}>
        <Users size={tileGlyph("md")} strokeWidth={1.6} />
      </QuietTile>
      <span className="min-w-0 flex-1">
        <span className={cn("line-clamp-2 text-subhead", swarm.ended ? "text-ink" : "text-bright")}>{swarm.goal}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-footnote text-dim">
          <span className="min-w-0 truncate">{ws}</span>
          <span className="shrink-0">· {swarm.ended ? `${swarm.members.length} agents` : working > 0 ? `${working} of ${swarm.members.length} working` : `${swarm.members.length} agents`}</span>
          <span className="ml-auto shrink-0 pl-1 text-faint tabular">{shortAgo(swarm.started_at, now)}</span>
        </span>
      </span>
    </button>
  );
}
