// Phones: one agent at a time, full screen. A calm header (back · workspace and branch · "…" · "+")
// sits under the status bar; below it a strip of big agent chips switches between the agents of
// every tab (long-press a chip to close or restart it). Claude panes share the Claude view's own
// background, so the chat reaches the header with no frame around it.
import type { PaneContent } from "@neuralagent/protocol";
import { ActionSheet, ContextMenu, IconButton, IconTile, cn, useNavBack, type MenuEntry } from "@neuralagent/ui";
import { ChevronLeft, Download, Ellipsis, GitBranch, GitCompare, Globe, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { activityOf } from "../../lib/status";
import { useCatalogSheet, useChanges, useDaemon, useUi } from "../../lib/store";
import { EngineTile } from "../EngineTile";
import type { PaneActions } from "../Pane";
import type { PaneRef } from "../WorkspaceView";
import { NewAgentSheet } from "./NewAgentSheet";
import { paneTitle, usePaneMenu, usePaneSession } from "./paneMenu";

export function PhoneWorkspace({ workspaceId, panes, current, actionsIn, children }: {
  workspaceId: string;
  panes: PaneRef[];
  current: PaneRef | undefined;
  actionsIn: (tab: PaneRef["tab"], paneId: string) => PaneActions;
  children: ReactNode;
}) {
  const back = useNavBack();
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === workspaceId));
  const showChanges = useChanges((c) => c.show);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const { worktrees, setWorktrees } = useUi();
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const actions = current ? actionsIn(current.tab, current.id) : null;
  const pane = usePaneMenu({ workspaceId, content: current?.content, actions, phone: true });
  const { session, claudeView } = usePaneSession(current?.content, true);
  const git = ws?.git;

  const items: MenuEntry[] = [
    ...pane.items.filter((i) => !i.destructive),
    ...(git
      ? [
          {
            label: "Changes",
            detail: `${git.branch} · ${git.changed === 1 ? "1 file" : `${git.changed} files`}`,
            Icon: GitCompare,
            divider: pane.items.length > 1,
            onSelect: () => showChanges(workspaceId),
          },
          { label: "Own worktree per agent", Icon: GitBranch, kind: "check" as const, checked: worktrees, onSelect: () => setWorktrees(!worktrees) },
        ]
      : []),
    { label: "Install agents…", Icon: Download, divider: !git, onSelect: () => openCatalog(true) },
    ...pane.items.filter((i) => i.destructive),
  ];

  const showStrip = panes.length > 1 || (panes.length === 1 && current?.content.kind === "empty");
  const cv = claudeView;

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col transition-colors duration-300", cv ? "bg-cv-bg" : "bg-bg")}
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--tabbar-space)" }}
    >
      <header className="relative z-10 flex h-14 shrink-0 items-center gap-2 px-3">
        <div className="flex w-24 shrink-0">
          {back && (
            <IconButton variant="glass" label={`Back to ${back.label}`} onClick={back.onBack}>
              <ChevronLeft />
            </IconButton>
          )}
        </div>
        <button
          type="button"
          disabled={!git}
          onClick={() => git && showChanges(workspaceId)}
          aria-label={git ? `${ws?.name}: ${git.branch}, ${git.changed} changed. Show changes` : ws?.name}
          className="pressable flex min-w-0 flex-1 flex-col items-center rounded-field px-1 py-1 disabled:opacity-100"
        >
          <span className={cn("max-w-full truncate text-headline", cv ? "text-cv-text" : "text-bright")}>{ws?.name ?? "Workspace"}</span>
          {git ? (
            <span className={cn("flex max-w-full items-center gap-1 text-footnote", cv ? "text-cv-muted" : "text-dim")}>
              <GitBranch className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="truncate">{git.branch}</span>
              {git.changed > 0 && <span className="shrink-0 text-warning tabular-nums">· {git.changed} changed</span>}
            </span>
          ) : (
            session && <span className={cn("max-w-full truncate text-footnote", cv ? "text-cv-muted" : "text-dim")}>{session.title}</span>
          )}
        </button>
        <div className="flex w-24 shrink-0 justify-end gap-2">
          <IconButton variant="glass" label="Actions" onClick={() => setMenu(true)}>
            <Ellipsis />
          </IconButton>
          <IconButton variant="solid" label="New agent" onClick={() => setAdding(true)}>
            <Plus />
          </IconButton>
        </div>
        {/* Content passing under the header fades out instead of meeting a hard edge. */}
        <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-full h-3 bg-linear-to-b to-transparent", cv ? "from-cv-bg" : "from-bg")} />
      </header>
      {showStrip && <AgentStrip workspaceId={workspaceId} panes={panes} current={current} actionsIn={actionsIn} claude={cv} />}
      <div className={cn("relative min-h-0 flex-1", !cv && "px-2 pb-2")}>
        <div className="relative h-full w-full">{children}</div>
      </div>
      <ActionSheet open={menu} onClose={() => setMenu(false)} title={current && current.content.kind !== "empty" ? paneTitle(current.content, session) : ws?.name} items={items} />
      <NewAgentSheet open={adding} onClose={() => setAdding(false)} workspaceId={workspaceId} />
      {pane.confirm}
    </div>
  );
}

/** Big, readable chips for every agent; the shown one is lit and scrolled into view. */
function AgentStrip({ workspaceId, panes, current, actionsIn, claude }: {
  workspaceId: string;
  panes: PaneRef[];
  current: PaneRef | undefined;
  actionsIn: (tab: PaneRef["tab"], paneId: string) => PaneActions;
  claude: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [current?.id]);
  return (
    <div ref={box} role="tablist" aria-label="Agents" className="scroll-x flex shrink-0 gap-2 px-3 pt-0.5 pb-2.5" data-no-swipe>
      {panes.map((p) => (
        <AgentChip key={p.id} workspaceId={workspaceId} pane={p} active={p.id === current?.id} actions={actionsIn(p.tab, p.id)} claude={claude} />
      ))}
    </div>
  );
}

function AgentChip({ workspaceId, pane, active, actions, claude }: { workspaceId: string; pane: PaneRef; active: boolean; actions: PaneActions; claude: boolean }) {
  const { session, profile } = usePaneSession(pane.content, true);
  const menu = usePaneMenu({ workspaceId, content: pane.content, actions, phone: true });
  const title = paneTitle(pane.content as PaneContent, session);
  // The agent you are looking at never shows "finished, not seen".
  const act = session ? activityOf([session.status].filter((s) => !(active && s === "done"))) : undefined;
  const engine = profile?.engine ?? "shell";
  return (
    <>
      <ContextMenu items={menu.items} onTap={actions.focus} radius={999} className="shrink-0">
        <button
          type="button"
          role="tab"
          aria-selected={active}
          className={cn(
            "pressable flex h-11 max-w-56 items-center gap-2 rounded-full pr-4 pl-1.5 transition-colors",
            active
              ? claude
                ? "bg-cv-surface text-cv-text shadow-cv-pill"
                : "bg-fill-4 text-bright shadow-edge"
              : claude
                ? "text-cv-muted"
                : "bg-fill-1 text-dim",
          )}
        >
          {pane.content.kind === "browser" ? (
            <IconTile color="blue" className="!size-8 !rounded-full">
              <Globe />
            </IconTile>
          ) : (
            <EngineTile engine={engine} activity={act} className="!size-8 !rounded-full" />
          )}
          <span className="truncate text-subhead">{title}</span>
        </button>
      </ContextMenu>
      {menu.confirm}
    </>
  );
}
