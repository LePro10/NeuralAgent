// Teams: Neural's race and build + review teams, plus the old swarms below them.
// Desktop: the list (teams, then classic swarms) beside the open item. Phones: the list as a page,
// a team opens in a sheet and a classic swarm is the next page of the phone router.
import type { NeuralTask } from "@neuralagent/protocol";
import { Button, Empty, IconButton, List, Page, Row, Sheet, useLayoutMode } from "@neuralagent/ui";
import { Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { neuralOf, taskActivity, taskWord } from "../../lib/neural";
import { phoneRouter } from "../../lib/phoneRoute";
import { useDaemon } from "../../lib/store";
import { Glow } from "../Glow";
import { NewTeamSheet } from "./NewTeam";
import { SwarmDetail } from "./SwarmDetail";
import { SwarmGroups } from "./SwarmList";
import { PATTERN_WORD, TeamDetail } from "./TeamDetail";

const EMPTY_DETAIL =
  "Give one goal to several agents. Race: 2 to 4 agents try it in separate worktrees, Neural compares, you pick. Build + review: a builder and a reviewer loop until the reviewer approves.";

type Pick = { k: "team" | "swarm"; id: string };

export function TeamsPage() {
  const phone = useLayoutMode() === "phone";
  const tasks = useDaemon((c) => neuralOf(c.state).tasks);
  const swarms = useDaemon((c) => c.state?.swarms ?? []);
  const teams = useMemo(() => tasks.filter((t) => t.team).sort((a, b) => b.created_at - a.created_at), [tasks]);
  const classic = useMemo(() => [...swarms].sort((a, b) => Number(a.ended) - Number(b.ended) || b.started_at - a.started_at), [swarms]);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<Pick | null>(null);

  const openTeam = (id: string) => setPicked({ k: "team", id });
  const openSwarm = (id: string) => {
    if (phone) phoneRouter().push({ k: "swarm", id });
    else setPicked({ k: "swarm", id });
  };
  const sheet = (
    <NewTeamSheet
      open={creating}
      onClose={() => setCreating(false)}
      onDone={(id) => {
        setCreating(false);
        openTeam(id);
      }}
    />
  );
  const newTeam = () => setCreating(true);
  const emptyAction = (
    <Button variant="accent" Icon={Plus} onClick={newTeam} className="rounded-full">
      New team
    </Button>
  );
  const list = (selected?: Pick) => (
    <div className="flex flex-col gap-6">
      {teams.length > 0 && (
        <List label="Teams">
          {teams.map((t) => (
            <TeamRow key={t.id} task={t} selected={selected?.k === "team" && selected.id === t.id} onClick={() => openTeam(t.id)} />
          ))}
        </List>
      )}
      {classic.length > 0 && (
        <div>
          <h2 className="mb-2 px-4 text-footnote text-dim uppercase tracking-wide">Classic swarms</h2>
          <SwarmGroups swarms={classic} selected={selected?.k === "swarm" ? selected.id : undefined} onOpen={openSwarm} />
        </div>
      )}
    </div>
  );
  const nothing = teams.length === 0 && classic.length === 0;

  if (phone) {
    const open = picked?.k === "team" ? teams.find((t) => t.id === picked.id) : undefined;
    return (
      <div className="relative h-full">
        <Page
          title="Teams"
          eyebrow="Agent teams"
          actions={
            <IconButton label="New team" variant="glass" onClick={newTeam}>
              <Plus />
            </IconButton>
          }
        >
          {nothing ? <Empty Icon={Users} title="No teams yet" detail={EMPTY_DETAIL} action={emptyAction} /> : teams.length === 0 ? <><Empty Icon={Users} title="No teams yet" detail={EMPTY_DETAIL} action={emptyAction} className="mb-6" />{list()}</> : list()}
        </Page>
        <Sheet open={!!open} onClose={() => setPicked(null)} title="Team" size="md">
          {open && <TeamDetail task={open} />}
        </Sheet>
        {sheet}
      </div>
    );
  }

  const shown: Pick | undefined = picked && (picked.k === "team" ? teams.some((t) => t.id === picked.id) : classic.some((w) => w.id === picked.id)) ? picked : teams[0] ? { k: "team", id: teams[0].id } : classic[0] ? { k: "swarm", id: classic[0].id } : undefined;
  const shownTeam = shown?.k === "team" ? teams.find((t) => t.id === shown.id) : undefined;
  return (
    <div className="relative h-full">
      <Glow tint="swarm" />
      <div className="relative flex h-full min-h-0 flex-col" style={{ paddingLeft: "var(--sidebar-space, 0px)" }}>
        <header data-tauri-drag-region className="mx-auto flex w-full shrink-0 items-end justify-between gap-6 px-8 pt-6 pb-6" style={{ maxWidth: 1200, paddingTop: "calc(var(--safe-top) + var(--spacing-navbar) + 24px)" }}>
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">Agent teams</div>
            <h1 className="display text-display-lg">Teams</h1>
          </div>
          {!nothing && (
            <Button size="sm" variant="accent" Icon={Plus} onClick={newTeam} className="mb-1 rounded-full">
              New team
            </Button>
          )}
        </header>
        <div className="mx-auto flex min-h-0 w-full flex-1 gap-5 px-8 pb-6" style={{ maxWidth: 1200 }}>
          {nothing ? (
            <div className="card grid flex-1 place-items-center">
              <Empty Icon={Users} title="No teams yet" detail={EMPTY_DETAIL} action={emptyAction} bare className="max-w-md" />
            </div>
          ) : (
            <>
              <aside className="scroller -mx-1 w-80 shrink-0 overflow-y-auto px-1 pb-2">{list(shown)}</aside>
              {shownTeam ? (
                <div className="scroller card min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
                  <TeamDetail key={shownTeam.id} task={shownTeam} />
                </div>
              ) : shown?.k === "swarm" ? (
                <SwarmDetail key={shown.id} id={shown.id} />
              ) : (
                <div className="card grid min-w-0 flex-1 place-items-center">
                  <Empty Icon={Users} title="No teams yet" detail={EMPTY_DETAIL} action={emptyAction} bare className="max-w-md" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {sheet}
    </div>
  );
}

/** A team: title, "pattern · workspace", Neural's status word and the activity mark. */
function TeamRow({ task, selected, onClick }: { task: NeuralTask; selected: boolean; onClick: () => void }) {
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === task.workspace_id)?.name);
  const pattern = task.team ? PATTERN_WORD[task.team.pattern] : "Team";
  return <Row Icon={Users} title={task.title} detail={[pattern, ws].filter(Boolean).join(" · ")} value={taskWord(task)} activity={taskActivity(task)} selected={selected} onClick={onClick} />;
}
