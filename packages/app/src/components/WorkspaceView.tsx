import type { LayoutNode, PaneContent, Tab, WorkspaceLayout } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Menu, StatusDot, cn, toast, useLayoutMode, type MenuEntry } from "@neuralagent/ui";
import { Download, GitBranch, LayoutGrid, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeTab, gridOf, newTab, order, panes, removePane, setContent, setSizes, splitPane, swapPanes, updateTab } from "../lib/layout";
import { STATUS, mostUrgent } from "../lib/status";
import { launchable } from "../lib/profiles";
import { useCatalogSheet, useChanges, useClient, useDaemon, useUi } from "../lib/store";
import { useWorktreeStart } from "../lib/worktree";
import { AgentGlyph } from "./AgentGlyph";
import type { PaneActions } from "./Pane";
import { PaneTree, type TreeCtx } from "./PaneTree";
import { isAppShortcut } from "./TerminalView";
import { ClaudeViewSwitch } from "./workspace/ClaudeViewSwitch";
import { PhoneWorkspace } from "./workspace/PhoneWorkspace";

/** WebGL contexts are limited per page; above this many visible panes we fall back to the DOM renderer. */
const WEBGL_MAX = 12;
const PRESETS = [1, 2, 4, 6, 9, 12, 16];

function sessionsOf(n: LayoutNode): string[] {
  return panes(n).flatMap((p) => (p.content.kind === "terminal" ? [p.content.session] : []));
}

/** One pane of a workspace with the tab it lives in (phones list every agent of every tab). */
export interface PaneRef {
  tab: Tab;
  id: string;
  content: PaneContent;
}

export function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const client = useClient();
  const layout = useDaemon((c) => c.state?.layouts[workspaceId]);
  const sessions = useDaemon((c) => c.state?.sessions);
  const tab = layout ? activeTab(layout) : undefined;
  const phone = useLayoutMode() === "phone";
  const [closing, setClosing] = useState<{ tab: Tab; live: number } | null>(null);

  const save = useCallback(
    (l: WorkspaceLayout) => client.req({ m: "layout_set", p: { workspace_id: workspaceId, layout: l } }).catch(() => {}),
    [client, workspaceId],
  );
  const editTab = useCallback(
    (f: (t: Tab) => Tab) => {
      if (layout && tab) save(updateTab(layout, tab.id, f));
    },
    [layout, tab, save],
  );

  const addTab = () => {
    if (!layout) return;
    const t = newTab(`Tab ${layout.tabs.length + 1}`);
    save({ tabs: [...layout.tabs, t], active_tab: t.id });
  };

  /** Pane actions for a pane in any tab (phones act on agents outside the shown tab too). */
  const actionsIn = useCallback(
    (t: Tab, paneId: string): PaneActions => {
      const edit = (f: (x: Tab) => Tab) => layout && save(updateTab(layout, t.id, f));
      return {
        focus: () => {
          if (!layout) return;
          if (layout.active_tab === t.id && t.focused === paneId) return;
          save({ ...updateTab(layout, t.id, (x) => ({ ...x, focused: paneId })), active_tab: t.id });
        },
        split: (dir) => edit((x) => splitPane(x, paneId, dir)),
        zoom: () => edit((x) => ({ ...x, zoomed: x.zoomed === paneId ? undefined : paneId, focused: paneId })),
        swapWith: (other) => edit((x) => swapPanes(x, other, paneId)),
        setContent: (content) => edit((x) => setContent(x, paneId, content)),
        preview: (url) =>
          edit((x) => {
            const browser = panes(x.root).find((p) => p.content.kind === "browser");
            if (browser) return { ...setContent(x, browser.id, { kind: "browser", url }), zoomed: undefined, focused: phone ? browser.id : x.focused };
            const next = splitPane(x, paneId, "row", { kind: "browser", url });
            return phone ? { ...next, focused: panes(next.root).find((p) => p.content.kind === "browser")?.id ?? next.focused } : next;
          }),
        close: async () => {
          if (!layout) return;
          const pane = panes(t.root).find((p) => p.id === paneId);
          await save(updateTab(layout, t.id, (x) => removePane(x, paneId)));
          if (pane?.content.kind === "terminal") await client.req({ m: "session_close", p: { id: pane.content.session } }).catch(() => {});
        },
      };
    },
    [layout, save, client, phone],
  );

  const ctx = useMemo<TreeCtx | null>(() => {
    if (!layout || !tab) return null;
    const visible = tab.zoomed ? 1 : sessionsOf(tab.root).length;
    return {
      workspaceId,
      focused: tab.focused,
      // Phones show one pane at a time, the focused one; the agent strip above switches.
      zoomed: phone ? (panes(tab.root).find((p) => p.id === tab.focused) ?? panes(tab.root)[0])?.id : tab.zoomed,
      webgl: phone || visible <= WEBGL_MAX,
      actions: (paneId) => actionsIn(tab, paneId),
      onSizes: (splitId, sizes) => editTab((t) => setSizes(t, splitId, sizes)),
    };
  }, [layout, tab, editTab, actionsIn, workspaceId, phone]);

  // Keyboard: ⌘T tab, ⌘W close pane, ⌘D split right, ⌘\ split down, ⌘↩ zoom, ⌘1–9 pane, ⌘[ ⌘] tabs.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (!layout || !tab || !ctx || !isAppShortcut(e)) return;
    const a = ctx.actions(tab.focused);
    const ids = order(tab);
    const tabAt = (d: number) => {
      const i = layout.tabs.findIndex((t) => t.id === tab.id);
      const next = layout.tabs[(i + d + layout.tabs.length) % layout.tabs.length]!;
      if (next.id !== tab.id) save({ ...layout, active_tab: next.id });
    };
    const run: Record<string, () => void> = {
      KeyT: addTab,
      KeyW: a.close,
      KeyD: () => a.split("row"),
      Backslash: () => a.split("column"),
      Enter: a.zoom,
      BracketLeft: () => tabAt(-1),
      BracketRight: () => tabAt(1),
    };
    const digit = /^Digit([1-9])$/.exec(e.code);
    const f = digit ? () => ids[Number(digit[1]) - 1] && ctx.actions(ids[Number(digit[1]) - 1]!).focus() : run[e.code];
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    f();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  if (!layout || !tab || !ctx) return null;

  const closeTab = (t: Tab) => {
    const live = sessionsOf(t.root).filter((s) => sessions?.[s]?.alive).length;
    if (live > 0) setClosing({ tab: t, live });
    else void reallyCloseTab(t);
  };
  const reallyCloseTab = async (t: Tab) => {
    const sids = sessionsOf(t.root);
    const rest = layout.tabs.filter((x) => x.id !== t.id);
    const tabs = rest.length ? rest : [newTab("Tab 1")];
    const active = layout.active_tab === t.id ? tabs[Math.max(0, layout.tabs.indexOf(t) - 1)]!.id : layout.active_tab;
    await save({ tabs, active_tab: active });
    for (const s of sids) await client.req({ m: "session_close", p: { id: s } }).catch(() => {});
  };

  const tree = <PaneTree key={tab.id} node={tab.root} ctx={ctx} />;

  if (phone) {
    // Every agent of every tab, in tab order then reading order: phones show one at a time.
    const all: PaneRef[] = layout.tabs.flatMap((t) =>
      order(t).flatMap((id) => {
        const content = panes(t.root).find((p) => p.id === id)?.content;
        return content && content.kind !== "empty" ? [{ tab: t, id, content }] : [];
      }),
    );
    const focused = panes(tab.root).find((p) => p.id === ctx.zoomed);
    return (
      <PhoneWorkspace
        workspaceId={workspaceId}
        panes={all}
        current={focused ? { tab, id: focused.id, content: focused.content } : undefined}
        actionsIn={actionsIn}
      >
        {tree}
      </PhoneWorkspace>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ paddingTop: "var(--safe-top)", paddingLeft: "var(--sidebar-space)", paddingBottom: "var(--tabbar-space)" }}>
      <DesktopBar workspaceId={workspaceId} layout={layout} tab={tab} save={save} addTab={addTab} closeTab={closeTab} editTab={editTab} />
      <div className="relative min-h-0 flex-1 px-2 pb-2">
        <div className="relative h-full w-full">{tree}</div>
      </div>
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        onConfirm={async () => {
          if (closing) await reallyCloseTab(closing.tab);
          setClosing(null);
        }}
        title={`Close ${closing?.tab.title ?? "tab"}?`}
        message={closing ? `${closing.live} running ${closing.live === 1 ? "agent stops" : "agents stop"}.` : undefined}
        confirmLabel="Stop and close"
        destructive
      />
    </div>
  );
}

/** Desktop: tabs on the left; Claude Chat/Terminal, branch, layout and New agent on the right. The empty strip drags the window. */
function DesktopBar({ workspaceId, layout, tab, save, addTab, closeTab, editTab }: {
  workspaceId: string;
  layout: WorkspaceLayout;
  tab: Tab;
  save: (l: WorkspaceLayout) => void;
  addTab: () => void;
  closeTab: (t: Tab) => void;
  editTab: (f: (t: Tab) => Tab) => void;
}) {
  const client = useClient();
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  const catalog = useDaemon((c) => c.state?.catalog);
  const git = useDaemon((c) => c.state?.workspaces.find((w) => w.id === workspaceId)?.git);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const showChanges = useChanges((c) => c.show);
  const { worktrees, setWorktrees } = useUi();
  const worktree = useWorktreeStart(workspaceId);

  const arrange = (n: number) => {
    const byId = new Map(panes(tab.root).map((p) => [p.id, p.content]));
    const contents: PaneContent[] = order(tab).map((id) => byId.get(id)!);
    while (contents.length < n) contents.push({ kind: "empty" });
    const root = gridOf(contents);
    const first = panes(root)[0]!.id;
    editTab((t) => ({ ...t, root, focused: first, zoomed: undefined }));
  };
  const start = (profileId: string, engine: string) =>
    client.req({ m: "session_start", p: { workspace_id: workspaceId, profile_id: profileId, ...worktree(engine) } }).catch((e) => toast((e as Error).message, { tone: "danger" }));

  const count = panes(tab.root).length;
  // The Chat/Terminal switch only means something while a Claude agent is in this tab.
  const claudeShown = sessionsOf(tab.root).some((sid) => profiles?.find((p) => p.id === sessions?.[sid]?.profile_id)?.engine === "claude");
  const presetItems: MenuEntry[] = PRESETS.map((n) => ({
    label: n === 1 ? "1 pane" : `${n} panes`,
    checked: n === count,
    disabled: n < count,
    onSelect: () => arrange(n),
  }));
  const agentItems: MenuEntry[] = [
    ...launchable(profiles, catalog).map((p) => ({
      id: p.id,
      label: p.name,
      glyph: <AgentGlyph engine={p.engine} className="text-dim" />,
      onSelect: () => start(p.id, p.engine),
    })),
    ...(git ? [{ label: "Own worktree per agent", Icon: GitBranch, kind: "check" as const, checked: worktrees, divider: true, onSelect: () => setWorktrees(!worktrees) }] : []),
    { label: "Install agents…", Icon: Download, divider: !git, onSelect: () => openCatalog(true) },
  ];

  return (
    <div data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-1 pr-2.5 pl-2">
      <div role="tablist" aria-label="Tabs" className="scroll-x flex min-w-0 items-center gap-1" data-tauri-drag-region>
        {layout.tabs.map((t) => {
          const urgent = mostUrgent(sessionsOf(t.root).flatMap((s) => (sessions?.[s] ? [sessions[s].status] : [])));
          const active = t.id === tab.id;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              className={cn(
                "group relative flex h-8 max-w-52 shrink-0 items-center gap-2 rounded-full pr-1 pl-3.5 text-chip transition-colors",
                active ? "bg-fill-3 text-bright shadow-edge" : "text-dim hover:bg-fill-2 hover:text-ink",
              )}
            >
              <button type="button" className="flex min-w-0 items-center gap-2 after:absolute after:inset-0" onClick={() => !active && save({ ...layout, active_tab: t.id })}>
                {urgent && urgent !== "idle" && urgent !== "exited" && <StatusDot tone={STATUS[urgent].tone} pulse={STATUS[urgent].pulse} size={7} label={STATUS[urgent].label} />}
                <span className="truncate">{t.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${t.title}`}
                title={`Close ${t.title}`}
                onClick={() => closeTab(t)}
                className={cn(
                  "relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-faint transition-opacity hover:bg-fill-3 hover:text-ink",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X size={13} strokeWidth={1.8} />
              </button>
            </div>
          );
        })}
        <button type="button" aria-label="New tab" title="New tab (⌘T)" onClick={addTab} className="hoverable grid size-8 shrink-0 place-items-center rounded-full text-dim hover:text-ink">
          <Plus size={16} strokeWidth={1.7} />
        </button>
      </div>
      <div className="h-full min-w-4 flex-1" data-tauri-drag-region />
      {claudeShown && <ClaudeViewSwitch className="mr-1.5" />}
      {git && (
        <button
          type="button"
          title={`${git.branch}: ${git.changed === 1 ? "1 changed file" : `${git.changed} changed files`}. Show changes`}
          onClick={() => showChanges(workspaceId)}
          className="pressable flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-full bg-fill-2 pr-1.5 pl-3 text-chip text-ink shadow-edge hover:bg-fill-3"
        >
          <GitBranch size={14} strokeWidth={1.7} className="shrink-0 text-dim" aria-hidden />
          <span className="truncate">{git.branch}</span>
          {git.changed > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-warning/15 px-1.5 text-meta text-warning tabular-nums">{git.changed}</span>
          ) : (
            <span className="pr-1.5" />
          )}
        </button>
      )}
      <Menu
        title="Layout"
        items={presetItems}
        width={180}
        trigger={(open) => (
          <button type="button" aria-label="Layout" title="Layout" onClick={open} className="hoverable grid size-8 shrink-0 place-items-center rounded-full text-dim hover:text-ink">
            <LayoutGrid size={16} strokeWidth={1.7} />
          </button>
        )}
      />
      <Menu title="New agent" items={agentItems} trigger={(open) => <Button size="sm" variant="primary" Icon={Plus} onClick={open}>New agent</Button>} />
    </div>
  );
}
