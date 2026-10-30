import { compact, money, totalTokens } from "../lib/format";
import type { AgentStatus, Session } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Empty, IconButton, List, Menu, Page, SwipeRow, cn, toast, useLayoutMode, type MenuEntry, type SwipeAction } from "@neuralagent/ui";
import { Bot, ChevronRight, Download, Ellipsis, ExternalLink, RotateCw, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { frontTabFor } from "../lib/layout";
import { agentSays, shortAgo, useNow } from "../lib/agentui";
import { STATUS, activityOf } from "../lib/status";
import { useCatalogSheet, useClient, useDaemon, useUi } from "../lib/store";
import { EngineTile } from "./EngineTile";
import { Glow } from "./Glow";

const FIRST: Record<string, number> = { waiting: 0, error: 1, done: 2, working: 3, starting: 4, idle: 5, exited: 6 };

/** Status word colours: the activity vocabulary (waiting = accent, done = ember, error = red). */
const WORD: Record<AgentStatus, string> = {
  waiting: "text-accent",
  working: "text-ink",
  starting: "text-ink",
  done: "text-ember",
  error: "text-danger",
  idle: "text-dim",
  exited: "text-dim",
};

/** Every agent across all workspaces: what it is doing, its last words; tap opens it, swipe for more. */
export function AgentsDashboard() {
  const client = useClient();
  const state = useDaemon((c) => c.state);
  const setWorkspace = useUi((u) => u.setWorkspace);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const phone = useLayoutMode() === "phone";
  const now = useNow(5000);
  const [closing, setClosing] = useState<Session | null>(null);

  const engineOf = (s: Session) => state?.profiles.find((p) => p.id === s.profile_id)?.engine ?? "shell";
  const { groups, counts } = useMemo(() => {
    // Agents only: plain terminals and installers live in their panes.
    const engine = (s: Session) => state?.profiles.find((p) => p.id === s.profile_id)?.engine ?? "shell";
    const all = Object.values(state?.sessions ?? {}).filter((s) => engine(s) !== "shell" && !s.profile_id.startsWith("install:"));
    const groups = (state?.workspaces ?? [])
      .map((w) => ({
        w,
        sessions: all.filter((s) => s.workspace_id === w.id).sort((a, b) => FIRST[a.status]! - FIRST[b.status]! || b.status_since - a.status_since),
      }))
      .filter((g) => g.sessions.length > 0);
    const n = (k: AgentStatus[]) => all.filter((s) => s.alive && k.includes(s.status)).length;
    return { groups, counts: { waiting: n(["waiting"]), working: n(["working", "starting"]), done: n(["done"]), error: n(["error"]) } };
  }, [state?.sessions, state?.workspaces, state?.profiles]);

  /** Switch to the session's workspace and bring its tab to the front. */
  const open = (s: Session) => {
    const layout = frontTabFor(state?.layouts[s.workspace_id], s.id);
    if (layout) client.req({ m: "layout_set", p: { workspace_id: s.workspace_id, layout } }).catch(() => {});
    setWorkspace(s.workspace_id);
  };
  const act = (r: Parameters<typeof client.req>[0]) => client.req(r).then(() => {}, (e) => void toast((e as Error).message, { tone: "danger" }));
  const stop = (s: Session) => act({ m: "session_stop", p: { id: s.id } });
  const restart = (s: Session) => act({ m: "session_restart", p: { id: s.id } });

  const install = phone ? (
    <IconButton label="Install agents" variant="ghost" onClick={() => openCatalog(true)}>
      <Download />
    </IconButton>
  ) : (
    <Button size="sm" variant="ghost" Icon={Download} onClick={() => openCatalog(true)}>
      Install agents
    </Button>
  );

  return (
    <div className="relative h-full">
    <Glow tint="agents" />
    <Page title="Agents" eyebrow="Overview" actions={install} wide>
      {groups.length === 0 ? (
        <Empty
          Icon={Bot}
          title="No agents running"
          detail="Start one from an empty pane or with New agent in a workspace."
          action={
            <Button variant="ghost" Icon={Download} onClick={() => openCatalog(true)}>
              Install agents
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-7">
          <Summary counts={counts} />
          <div className="grid gap-7 @5xl:grid-cols-2 @5xl:items-start">
            {groups.map(({ w, sessions }) => (
              <List key={w.id} label={w.name}>
                {sessions.map((s) => {
                  const trailing: SwipeAction[] = [
                    s.alive ? { label: "Stop", Icon: Square, tone: "warning", onAction: () => void stop(s) } : { label: "Restart", Icon: RotateCw, tone: "accent", onAction: () => void restart(s) },
                    { label: "Close", Icon: Trash2, tone: "danger", onAction: () => setClosing(s) },
                  ];
                  const menu: MenuEntry[] = [
                    { label: "Open", Icon: ExternalLink, onSelect: () => open(s) },
                    s.alive ? { label: "Stop", Icon: Square, onSelect: () => void stop(s) } : { label: "Restart", Icon: RotateCw, onSelect: () => void restart(s) },
                    { label: "Close", Icon: Trash2, destructive: true, divider: true, onSelect: () => setClosing(s) },
                  ];
                  return (
                    <SwipeRow key={s.id} trailing={trailing}>
                      <AgentRow s={s} engine={engineOf(s)} now={now} onOpen={() => open(s)} menu={phone ? undefined : menu} />
                    </SwipeRow>
                  );
                })}
              </List>
            ))}
          </div>
        </div>
      )}
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={`Close “${closing?.title ?? ""}”?`}
        message="The agent stops and its pane closes. Its conversation stays in History."
        confirmLabel="Close agent"
        destructive
        Icon={Trash2}
        onConfirm={() => (closing ? act({ m: "session_close", p: { id: closing.id } }) : undefined)}
      />
    </Page>
    </div>
  );
}

/** Three figures at the top: who needs you, who works, who finished. */
function Summary({ counts }: { counts: { waiting: number; working: number; done: number; error: number } }) {
  const cells = [
    { n: counts.waiting + counts.error, label: "Need you", tone: counts.error && !counts.waiting ? "text-danger" : "text-accent", dot: counts.error && !counts.waiting ? "bg-danger" : "bg-accent" },
    { n: counts.working, label: "Working", tone: "text-bright", dot: "bg-success" },
    { n: counts.done, label: "Done", tone: "text-ember", dot: "bg-ember" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {cells.map((c) => (
        <div key={c.label} className="surface rounded-list px-3.5 py-3">
          <div className={cn("tabular text-title-1 font-light", c.n ? c.tone : "text-faint")}>{c.n}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-footnote text-dim">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", c.n ? c.dot : "bg-fill-4")} />
            <span className="truncate">{c.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentRow({ s, engine, now, onOpen, menu }: { s: Session; engine: string; now: number; onOpen: () => void; menu?: MenuEntry[] }) {
  const st = STATUS[s.status];
  const notices = useDaemon((c) => c.state?.orchestrator?.messages);
  const said = agentSays(s, notices);
  const usage = s.usage
    ? [s.usage.cost_usd != null ? money(s.usage.cost_usd) : null, `${compact(totalTokens(s.usage.tokens))} tokens`].filter(Boolean).join(" · ")
    : "";
  return (
    <div data-lead="" className="flex w-full items-stretch">
      <button type="button" onClick={onOpen} className="press-row flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left hover:bg-fill-1">
        <EngineTile engine={engine} activity={s.alive ? activityOf([s.status]) : undefined} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-headline text-bright">{s.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-footnote">
            <span className={cn("shrink-0", WORD[s.status])}>{s.alive ? st.label : "Stopped"}</span>
            <span className="truncate text-dim">· {shortAgo(s.status_since, now)}</span>
          </span>
          {said && <span className="mt-1 line-clamp-2 block text-subhead text-ink">{said}</span>}
          {usage && <span className="mt-1 block truncate text-footnote text-faint">{usage}</span>}
        </span>
        {!menu && <ChevronRight strokeWidth={2.2} className="mt-1 mr-3 size-icon-sm shrink-0 text-faint" />}
      </button>
      {menu && (
        <div className="flex items-start pt-2.5 pr-2">
          <Menu
            title={s.title}
            items={menu}
            trigger={(show) => (
              <IconButton label={`Actions for ${s.title}`} variant="ghost" size="sm" onClick={show}>
                <Ellipsis />
              </IconButton>
            )}
          />
        </div>
      )}
    </div>
  );
}
