// Swarms: teams of agents on one goal that hand work to each other, and their conversation.
// Desktop: the page header of every top-level page, then the list beside the open swarm.
// Phones: the list as an iOS page; a swarm pushes in as the next level of the Stack.
import type { Swarm } from "@neuralagent/protocol";
import { Button, Empty, IconButton, Page, Stack, useLayoutMode, useStack } from "@neuralagent/ui";
import { Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useDaemon } from "../lib/store";
import { Glow } from "./Glow";
import { NewSwarmSheet } from "./swarm/NewSwarm";
import { SwarmDetail } from "./swarm/SwarmDetail";
import { SwarmGroups } from "./swarm/SwarmList";

const EMPTY_DETAIL = "One goal, a team of agents: a coordinator plans, a scout looks things up, a builder writes the code, a reviewer checks it.";

export function SwarmPage() {
  const phone = useLayoutMode() === "phone";
  const swarms = useDaemon((c) => c.state?.swarms ?? []);
  const sorted = useMemo(() => [...swarms].sort((a, b) => Number(a.ended) - Number(b.ended) || b.started_at - a.started_at), [swarms]);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const stack = useStack();

  const open = (id: string) => {
    if (phone) stack.push(id, <SwarmDetail id={id} />);
    else setPicked(id);
  };
  const created = (id: string) => {
    setCreating(false);
    open(id);
  };
  const sheet = <NewSwarmSheet open={creating} onClose={() => setCreating(false)} onDone={created} />;
  const newSwarm = () => setCreating(true);
  const emptyAction = (
    <Button variant="accent" Icon={Plus} onClick={newSwarm} className="rounded-full">
      New swarm
    </Button>
  );

  if (phone) {
    return (
      <div className="relative h-full">
        <Stack
          stack={stack}
          root={
            <div className="relative h-full">
              <Glow tint="swarm" />
              <Page
                title="Swarm"
                eyebrow="Agent teams"
                actions={
                  <IconButton label="New swarm" variant="ghost" onClick={newSwarm}>
                    <Plus />
                  </IconButton>
                }
              >
                {sorted.length === 0 ? <Empty Icon={Users} title="No swarms yet" detail={EMPTY_DETAIL} action={emptyAction} /> : <SwarmGroups swarms={sorted} onOpen={open} />}
              </Page>
            </div>
          }
          className="h-full"
        />
        {sheet}
      </div>
    );
  }

  const shown: Swarm | undefined = sorted.find((w) => w.id === picked) ?? sorted[0];
  return (
    <div className="relative h-full">
      <Glow tint="swarm" />
      <div className="relative flex h-full min-h-0 flex-col" style={{ paddingLeft: "var(--sidebar-space, 0px)" }}>
        {/* The same header as Agents and History: eyebrow, light display title, the action at the right. */}
        <header data-tauri-drag-region className="mx-auto flex w-full shrink-0 items-end justify-between gap-6 px-8 pt-6 pb-6" style={{ maxWidth: 1200, paddingTop: "calc(var(--safe-top) + var(--spacing-navbar) + 24px)" }}>
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">Agent teams</div>
            <h1 className="display text-display-lg">Swarm</h1>
          </div>
          {sorted.length > 0 && (
            <Button size="sm" variant="accent" Icon={Plus} onClick={newSwarm} className="mb-1 rounded-full">
              New swarm
            </Button>
          )}
        </header>
        <div className="mx-auto flex min-h-0 w-full flex-1 gap-5 px-8 pb-6" style={{ maxWidth: 1200 }}>
          {sorted.length === 0 ? (
            <div className="card grid flex-1 place-items-center">
              <Empty Icon={Users} title="No swarms yet" detail={EMPTY_DETAIL} action={emptyAction} bare className="max-w-md" />
            </div>
          ) : (
            <>
              <aside className="scroller -mx-1 w-80 shrink-0 overflow-y-auto px-1 pb-2">
                <SwarmGroups swarms={sorted} selected={shown?.id} onOpen={open} />
              </aside>
              {shown && <SwarmDetail key={shown.id} id={shown.id} />}
            </>
          )}
        </div>
      </div>
      {sheet}
    </div>
  );
}
