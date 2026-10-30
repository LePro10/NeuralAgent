import type { LayoutNode, PaneContent, Tab, WorkspaceLayout } from "@neuralagent/protocol";
import { ConfirmSheet, Menu, StatusDot, cn, toast, useLayoutMode, type MenuEntry } from "@neuralagent/ui";
import { Download, GitBranch, GitCompare, LayoutGrid, Plus, X } from "lucide-react";
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

/** WebGL contexts are limited per page; above this many visible panes we fall back to the DOM renderer. */
const WEBGL_MAX = 12;
const PRESETS = [1, 2, 4, 6, 9, 12, 16];

function sessionsOf(n: LayoutNode): string[] {
  return panes(n).flatMap((p) => (p.content.kind === "terminal" ? [p.content.session] : []));
}

export function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const client = useClient();
  const layout = useDaemon((c) => c.state?.layouts[workspaceId]);
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  const catalog = useDaemon((c) => c.state?.catalog);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const git = useDaemon((c) => c.state?.workspaces.find((w) => w.id === workspaceId)?.git);
  const showChanges = useChanges((c) => c.show);
  const { worktrees, setWorktrees } = useUi();
  const worktree = useWorktreeStart(workspaceId);
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

  const ctx = useMemo<TreeCtx | null>(() => {
    if (!layout || !tab) return null;
    const visible = tab.zoomed ? 1 : sessionsOf(tab.root).length;
    const actions = (paneId: string): PaneActions => ({
      focus: () => tab.focused !== paneId && editTab((t) => ({ ...t, focused: paneId })),
      split: (dir) => editTab((t) => splitPane(t, paneId, dir)),
      zoom: () => editTab((t) => ({ ...t, zoomed: t.zoomed === paneId ? undefined : paneId, focused: paneId })),
      swapWith: (other) => editTab((t) => swapPanes(t, other, paneId)),
      setContent: (content) => editTab((t) => setContent(t, paneId, content)),
      preview: (url) =>
        editTab((t) => {
          const browser = panes(t.root).find((p) => p.content.kind === "browser");
          if (browser) return { ...setContent(t, browser.id, { kind: "browser", url }), zoomed: undefined };
          return splitPane(t, paneId, "row", { kind: "browser", url });
        }),
      close: async () => {
        const pane = panes(tab.root).find((p) => p.id === paneId);
        await save(updateTab(layout, tab.id, (t) => removePane(t, paneId)));
        if (pane?.content.kind === "terminal") await client.req({ m: "session_close", p: { id: pane.content.session } }).catch(() => {});
      },
    });
    return {
      workspaceId,
      focused: tab.focused,
      // Phones show one pane at a time, the focused one; chips above switch.
      zoomed: phone ? (panes(tab.root).find((p) => p.id === tab.focused) ?? panes(tab.root)[0])?.id : tab.zoomed,
      webgl: phone || visible <= WEBGL_MAX,
      actions,
      onSizes: (splitId, sizes) => editTab((t) => setSizes(t, splitId, sizes)),
    };
  }, [layout, tab, editTab, save, client, workspaceId, phone]);

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
    ...(git ? [{ label: "Own worktree per agent", Icon: GitBranch, checked: worktrees, divider: true, onSelect: () => setWorktrees(!worktrees) }] : []),
    { label: "Install agents…", Icon: Download, divider: !git, onSelect: () => openCatalog(true) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ paddingLeft: "var(--sidebar-space)", paddingBottom: "var(--tabbar-space)" }}>
      <div data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-1 pr-2 pl-1">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" data-tauri-drag-region>
          {layout.tabs.map((t) => {
            const urgent = mostUrgent(sessionsOf(t.root).flatMap((s) => (sessions?.[s] ? [sessions[s].status] : [])));
            const active = t.id === tab.id;
            return (
              <div
                key={t.id}
                className={cn(
                  "group flex h-7 max-w-48 shrink-0 items-center gap-2 rounded-item pr-1 pl-3 text-chip transition-colors",
                  active ? "bg-fill-2 text-bright" : "text-dim hover:bg-fill-1 hover:text-ink",
                )}
              >
                <button type="button" className="flex min-w-0 items-center gap-2" onClick={() => !active && save({ ...layout, active_tab: t.id })}>
                  {urgent && <StatusDot tone={STATUS[urgent].tone} pulse={STATUS[urgent].pulse} size={6} label={STATUS[urgent].label} />}
                  <span className="truncate">{t.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close ${t.title}`}
                  onClick={() => closeTab(t)}
                  className="grid size-5 place-items-center rounded-xs text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
                >
                  <X size={12} strokeWidth={1.6} />
                </button>
              </div>
            );
          })}
          <button type="button" aria-label="New tab" title="New tab" onClick={addTab} className="hoverable grid size-7 shrink-0 place-items-center rounded-item text-dim hover:text-ink">
            <Plus size={14} strokeWidth={1.6} />
          </button>
        </div>
        <div className="h-full min-w-4 flex-1" data-tauri-drag-region />
        {git && (
          <button
            type="button"
            title={`${git.branch}: ${git.changed === 1 ? "1 changed file" : `${git.changed} changed files`}`}
            onClick={() => showChanges(workspaceId)}
            className="hoverable flex h-7 max-w-56 items-center gap-1.5 rounded-item px-2.5 text-chip text-dim hover:text-ink"
          >
            <GitCompare size={14} strokeWidth={1.6} aria-hidden />
            <span className="truncate">{git.branch}</span>
            {git.changed > 0 && <span className="text-warning tabular-nums">{git.changed}</span>}
          </button>
        )}
        <Menu
          title="Layout"
          items={presetItems}
          width={180}
          trigger={(open) => (
            <button type="button" aria-label="Layout" title="Layout" onClick={open} className="hoverable grid size-7 place-items-center rounded-item text-dim hover:text-ink">
              <LayoutGrid size={14} strokeWidth={1.6} />
            </button>
          )}
        />
        <Menu
          title="New agent"
          items={agentItems}
          trigger={(open) => (
            <button type="button" onClick={open} className="hoverable flex h-7 items-center gap-1.5 rounded-item px-2.5 text-chip text-ink">
              <Plus size={14} strokeWidth={1.6} />
              New agent
            </button>
          )}
        />
      </div>
      {phone && ctx && tab && panes(tab.root).length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto px-2 pb-1.5">
          {order(tab).map((id, i) => {
            const c = panes(tab.root).find((p) => p.id === id)?.content;
            const s = c?.kind === "terminal" ? sessions?.[c.session] : undefined;
            const label = s?.title ?? (c?.kind === "browser" ? "Browser" : `Pane ${i + 1}`);
            return (
              <button
                key={id}
                type="button"
                onClick={() => ctx.actions(id).focus()}
                className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-item px-2.5 text-chip", ctx.zoomed === id ? "bg-fill-3 text-bright" : "text-dim")}
              >
                {s && <StatusDot tone={STATUS[s.status].tone} pulse={STATUS[s.status].pulse} size={6} label={STATUS[s.status].label} />}
                <span className="max-w-32 truncate">{label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="relative min-h-0 flex-1 px-2 pb-2">
        <div className="relative h-full w-full">
          <PaneTree key={tab.id} node={tab.root} ctx={ctx} />
        </div>
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
        confirmLabel="Stop & close"
        destructive
      />
    </div>
  );
}
