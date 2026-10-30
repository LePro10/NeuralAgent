import type { Workspace } from "@neuralagent/protocol";
import { AppShell, Button, CommandPalette, ConnectionPill, Empty, NavPage, Page, Sidebar, Toaster, toast, topActivity, ACTIVITY_LABEL, type CommandGroup, type NavBack, type NavItem } from "@neuralagent/ui";
import { ArrowUpCircle, Ellipsis, Folder, FolderGit2, FolderPlus, Folders, Gauge, History, LayoutDashboard, Palette, Plug, Settings, Smartphone, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountRow } from "./components/AccountRow";
import { LaunchScreen } from "./components/LaunchScreen";
import { MorePage, type MoreItem } from "./components/MorePage";
import { WorkspacesPage } from "./components/WorkspacesPage";
import { UpdateBadge } from "./components/UpdateBadge";
import { UpdateDialog } from "./components/UpdateDialog";
import { AgentCatalog } from "./components/AgentCatalog";
import { AgentsDashboard } from "./components/AgentsDashboard";
import { BrandMark } from "./components/BrandMark";
import { ChangesSheet } from "./components/ChangesSheet";
import { HistoryPage } from "./components/HistoryPage";
import { UsagePage } from "./components/UsagePage";
import { SettingsPage } from "./components/SettingsPage";
import { FolderBrowserSheet, pickHostFolder } from "./components/FolderBrowser";
import { NeuralPage } from "./components/NeuralPage";
import { SwarmPage } from "./components/SwarmPage";
import { WorkspaceView } from "./components/WorkspaceView";
import { ZoomControl } from "./components/ZoomControl";
import { frontTabFor } from "./lib/layout";
import { endCall, startCall, useCall } from "./lib/call";
import { activityOf } from "./lib/status";
import { useClient, useDaemon, usePlatform, useUi } from "./lib/store";
import { useUpdateWatch } from "./lib/updates";
import { MOVED_TO_SETTINGS, SETTINGS_PAGE, requestSettingsSection } from "./lib/settingsRoute";
import { startTheme } from "./lib/theme";

startTheme();

const ADD = "__add";
const NEURAL = "__neural";
const AGENTS = "__agents";
const SWARM = "__swarm";
const HISTORY = "__history";
const USAGE = "__usage";
const SETTINGS = SETTINGS_PAGE;
// Phone tabs that are pages of their own: the workspace list and everything else ("More").
const WORKSPACES = "__workspaces";
const MORE = "__more";
/** Pages that live under the More tab on phones. Remote access and MCP servers are Settings sections. */
const UNDER_MORE = [HISTORY, USAGE, SETTINGS];

/** Settings sections the command palette reaches directly (⌘K). */
const SETTINGS_SHORTCUTS = [
  { id: "set-remote", section: "remote", label: "Remote access", Icon: Smartphone, keywords: "phone devices pair pairing account sign in" },
  { id: "set-mcp", section: "mcp", label: "MCP servers", Icon: Plug, keywords: "tools servers mcp" },
  { id: "set-appearance", section: "appearance", label: "Appearance", Icon: Palette, keywords: "theme dark light colour color" },
  { id: "set-updates", section: "updates", label: "Updates", Icon: ArrowUpCircle, keywords: "version update changelog" },
];

/** Height of the strip along the window's top edge that drags the window (macOS: the title bar's place). */
const DRAG_STRIP = 40;
const NO_DRAG = "a,button,input,textarea,select,summary,label,[role=button],[role=tab],[role=menuitem],[contenteditable=true],[data-no-drag],.xterm";

/**
 * The whole top strip drags the window, not just the few elements that carry `data-tauri-drag-region`:
 * a press on empty space within DRAG_STRIP px of the top starts the drag, a double click zooms like a native
 * title bar. Controls (buttons, fields, terminals) keep their clicks. Elements that already carry
 * `data-tauri-drag-region` are left to Tauri, which handles both gestures for them.
 */
function useWindowDrag() {
  const platform = usePlatform();
  const startDrag = platform.startDrag;
  useEffect(() => {
    if (!startDrag) return;
    const inStrip = (e: MouseEvent) => {
      const t = e.target;
      return e.clientY <= DRAG_STRIP && t instanceof Element && !t.closest(NO_DRAG) && !t.hasAttribute("data-tauri-drag-region");
    };
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || e.detail > 1 || !inStrip(e)) return;
      startDrag();
    };
    const dbl = (e: MouseEvent) => {
      if (!inStrip(e)) return;
      // The same command Tauri sends for a double click on a drag region.
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      void tauri?.invoke("plugin:window|internal_toggle_maximize")?.catch?.(() => {});
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("dblclick", dbl);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("dblclick", dbl);
    };
  }, [startDrag]);
}

/** True once the daemon has been out of reach for `ms`: short reconnects (a phone waking up) stay invisible. */
function useLongDisconnect(ms = 2500) {
  const status = useDaemon((c) => c.status);
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (status === "open") return setLong(false);
    const t = setTimeout(() => setLong(true), ms);
    return () => clearTimeout(t);
  }, [status === "open", ms]);
  return long && status !== "open";
}

export function App() {
  const client = useClient();
  const platform = usePlatform();
  const status = useDaemon((c) => c.status);
  const state = useDaemon((c) => c.state);
  const disconnected = useLongDisconnect();
  const { workspace, setWorkspace, sidebarPinned, setSidebarPinned } = useUi();
  useUpdateWatch(); // version label, Update button and dialog (lib/updates.ts)
  useWindowDrag();

  const workspaces = useMemo(() => [...(state?.workspaces ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order), [state?.workspaces]);
  // Neural is the home screen until something else is picked.
  const neural = workspace === NEURAL || workspace === null;
  const dashboard = workspace === AGENTS;
  const swarmPage = workspace === SWARM;
  // Old routes of pages that moved into Settings (remembered from an earlier run, links) open their section.
  const moved = workspace ? MOVED_TO_SETTINGS[workspace] : undefined;
  useEffect(() => {
    if (!moved) return;
    requestSettingsSection(moved);
    setWorkspace(SETTINGS);
  }, [moved, setWorkspace]);
  const settingsOpen = workspace === SETTINGS || !!moved;
  const history = workspace === HISTORY;
  const usage = workspace === USAGE;
  const wsList = workspace === WORKSPACES;
  const more = workspace === MORE;
  const current = neural || dashboard || swarmPage || settingsOpen || history || usage || wsList || more ? undefined : (workspaces.find((w) => w.id === workspace) ?? workspaces[0]);

  // "Hey Neural, …": until the orchestrator exists, show what was heard.
  useEffect(() => platform.voice?.onCommand((text) => toast(`Heard: ${text}`)), [platform.voice]);

  // Notify when an agent finishes or needs input while the window is in the background.
  useEffect(() => {
    const off = client.onEvent((ev) => {
      if (ev.e !== "attention" || platform.focused?.()) return;
      const s = client.state?.sessions[ev.session_id];
      platform.notify?.(s?.title ?? "Agent", ev.kind === "waiting" ? "Needs your input" : ev.kind === "error" ? "Stopped with an error" : "Finished");
    });
    return () => void off();
  }, [client, platform]);

  // Phones: the quick tile starts a call (on the Neural page); the native side keeps it alive.
  const live = useCall((c) => c.live);
  const on = useCall((c) => c.on);
  // Told the native side about this call; or it was dialled from there and waits for the end.
  const told = useRef(false);
  const dialled = useRef(false);
  useEffect(() => {
    if (live && !told.current) {
      told.current = true;
      platform.call?.active(true);
    } else if (!on && (told.current || dialled.current)) {
      told.current = dialled.current = false;
      platform.call?.active(false);
    }
  }, [platform, live, on]);
  useEffect(
    () =>
      platform.call?.onDial((start) => {
        if (!start) return endCall();
        dialled.current = true;
        setWorkspace(null);
        void startCall(client);
      }),
    [platform, client, setWorkspace],
  );

  // A tapped notification (web push, Android) opens its agent once the state knows it.
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => platform.onOpenSession?.(setOpening), [platform]);
  useEffect(() => {
    const s = opening ? state?.sessions[opening] : undefined;
    if (!s) return;
    setOpening(null);
    const layout = frontTabFor(state?.layouts[s.workspace_id], s.id);
    if (layout) client.req({ m: "layout_set", p: { workspace_id: s.workspace_id, layout } }).catch(() => {});
    setWorkspace(s.workspace_id);
  }, [opening, state, client, setWorkspace]);

  // Menu bar / tray: how many agents run, work, and wait for you.
  const agentStatuses = useMemo(() => {
    const engine = (id: string) => state?.profiles.find((p) => p.id === id)?.engine ?? "shell";
    return Object.values(state?.sessions ?? {})
      .filter((s) => s.alive && engine(s.profile_id) !== "shell" && !s.profile_id.startsWith("install:"))
      .map((s) => s.status);
  }, [state?.sessions, state?.profiles]);
  const trayCounts = [agentStatuses.length, agentStatuses.filter((s) => s === "working").length, agentStatuses.filter((s) => s === "waiting").length].join(",");
  const remoteStatus = state?.remote.status;
  const remoteOn = !remoteStatus || ["signed_out", "pending", "denied", "blocked"].includes(remoteStatus) ? null : !state?.remote.paused;
  useEffect(() => {
    const [running, working, waiting] = trayCounts.split(",").map(Number);
    platform.trayStatus?.({ running, working, waiting, remote: remoteOn });
  }, [trayCounts, remoteOn, platform]);
  // The tray's emergency switch for remote access.
  useEffect(
    () =>
      platform.onTrayRemote?.(() => {
        const paused = client.state?.remote.paused ?? false;
        client.req({ m: "remote_enable", p: { enabled: paused } }).then(
          () => toast(paused ? "Remote access reconnected" : "Remote access disconnected"),
          (e) => toast((e as Error).message, { tone: "danger" }),
        );
      }),
    [client, platform],
  );

  const addWorkspace = async () => {
    // Computers use the system dialog; phones and browsers browse the host's folders.
    const path = await (platform.pickFolder ?? pickHostFolder)();
    if (!path) return;
    try {
      const w = (await client.req({ m: "workspace_add", p: { path } })) as Workspace;
      setWorkspace(w.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  const allStatuses = Object.values(state?.sessions ?? {}).map((s) => s.status);
  const waiting = allStatuses.filter((s) => s === "waiting").length;
  const running = (state?.swarms ?? []).filter((w) => !w.ended).length;
  // Remote sign-in waits for approval: shown on Settings → Remote access, the account and the More tab.
  const remoteWaiting = platform.kind === "desktop" && state?.remote.status === "pending" ? ("waiting" as const) : undefined;
  const items: NavItem[] = [
    { id: NEURAL, label: "Neural", Icon: Sparkles, activity: state?.orchestrator.busy ? "working" : undefined },
    { id: AGENTS, label: "Agents", Icon: LayoutDashboard, activity: waiting > 0 ? "waiting" : undefined },
    { id: SWARM, label: "Swarm", Icon: Users, activity: running > 0 ? "working" : undefined },
    { id: HISTORY, label: "History", Icon: History },
    { id: USAGE, label: "Usage", Icon: Gauge },
    ...workspaces.map((w) => {
      const statuses = Object.values(state?.sessions ?? {}).filter((s) => s.workspace_id === w.id).map((s) => s.status);
      // "Done" means finished and not looked at yet: the open workspace never shows it.
      const act = activityOf(statuses.filter((s) => s !== "done" || w.id !== current?.id));
      return {
        id: w.id,
        label: w.name,
        Icon: w.git ? FolderGit2 : Folder,
        group: "Workspaces",
        activity: act,
      };
    }),
    { id: ADD, label: "Add workspace", Icon: FolderPlus, groupStart: workspaces.length > 0 },
  ];

  const selected = neural ? NEURAL : dashboard ? AGENTS : swarmPage ? SWARM : history ? HISTORY : usage ? USAGE : settingsOpen ? SETTINGS : wsList ? WORKSPACES : more ? MORE : (current?.id ?? "");
  // Phones: five tabs — Neural · Agents · Workspaces · Swarm · More. A workspace is pushed from the
  // Workspaces list, History/Usage/Settings from More; back returns to the list.
  const byId = new Map(items.map((i) => [i.id, i]));
  const tabOf = (id: string) => (UNDER_MORE.includes(id) || id === MORE ? MORE : [NEURAL, AGENTS, SWARM].includes(id) ? id : WORKSPACES);
  const tab = tabOf(selected);
  const wsActivity = topActivity(items.filter((i) => i.group === "Workspaces").map((i) => i.activity));
  const phoneItems: NavItem[] = [
    byId.get(NEURAL)!,
    byId.get(AGENTS)!,
    { id: WORKSPACES, label: "Workspaces", Icon: Folders, activity: wsActivity },
    byId.get(SWARM)!,
    { id: MORE, label: "More", Icon: Ellipsis, activity: remoteWaiting },
  ];
  const moreItems: MoreItem[] = [
    { id: HISTORY, label: "History", Icon: History },
    { id: USAGE, label: "Usage", Icon: Gauge },
    { id: SETTINGS, label: "Settings", Icon: Settings, group: " ", activity: remoteWaiting, value: remoteWaiting ? "Waiting" : undefined },
  ];
  // Each tab remembers where you were in it (iOS): tapping it again from elsewhere returns there,
  // tapping the active tab pops to its root.
  const lastIn = useRef<Record<string, string>>({});
  if (selected) lastIn.current[tab] = selected;
  const goTab = (id: string) => {
    setWorkspace(id === tab ? id : (lastIn.current[id] ?? id));
  };
  const go = (id: string) => (id === ADD ? void addWorkspace() : setWorkspace(id));
  const openSettings = (section: string) => {
    requestSettingsSection(section);
    setWorkspace(SETTINGS);
  };
  // ⌘K (desktop sidebar): jump to any page or workspace, or start something.
  const [palette, setPalette] = useState(false);
  const paletteGroups: CommandGroup[] = [
    {
      label: "Workspaces",
      items: items.filter((i) => i.group === "Workspaces").map((i) => ({ id: i.id, label: i.label, Icon: i.Icon, detail: i.activity ? ACTIVITY_LABEL[i.activity] : undefined, onSelect: () => setWorkspace(i.id) })),
    },
    {
      label: "Go to",
      items: [
        ...items.filter((i) => !i.group && i.id !== ADD).map((i) => ({ id: i.id, label: i.label, Icon: i.Icon, onSelect: () => setWorkspace(i.id) })),
        { id: SETTINGS, label: "Settings", Icon: Settings, keywords: "preferences account", onSelect: () => setWorkspace(SETTINGS) },
        ...SETTINGS_SHORTCUTS.map((s) => ({ ...s, onSelect: () => openSettings(s.section) })),
      ],
    },
    {
      label: "Actions",
      items: [
        { id: "add-workspace", label: "Add workspace…", Icon: FolderPlus, keywords: "folder project open", onSelect: () => void addWorkspace() },
        { id: "new-swarm", label: "New swarm…", Icon: Users, keywords: "team agents", onSelect: () => setWorkspace(SWARM) },
      ],
    },
  ];
  // Back target and depth of the shown page (phones; desktop ignores both).
  const back: NavBack | null = UNDER_MORE.includes(selected)
    ? { label: "More", onBack: () => setWorkspace(MORE) }
    : current
      ? { label: "Workspaces", onBack: () => setWorkspace(WORKSPACES) }
      : null;

  const body = !state ? (
    <div className="h-full" />
  ) : swarmPage ? (
    <SwarmPage />
  ) : neural ? (
    <NeuralPage onSettings={() => setWorkspace(SETTINGS)} />
  ) : settingsOpen ? (
    <SettingsPage />
  ) : dashboard ? (
    <AgentsDashboard />
  ) : history ? (
    <HistoryPage />
  ) : usage ? (
    <UsagePage />
  ) : wsList ? (
    <WorkspacesPage workspaces={workspaces} onOpen={setWorkspace} onAdd={addWorkspace} />
  ) : more ? (
    <MorePage items={moreItems} onGo={setWorkspace} onAccount={() => setWorkspace(SETTINGS)} />
  ) : current ? (
    <WorkspaceView key={current.id} workspaceId={current.id} />
  ) : (
    <Page title="Welcome" eyebrow="NeuralAgent">
      <Empty
        Icon={FolderPlus}
        title="Add a workspace"
        detail="A workspace is a project folder. Agents you start there run in panes and keep running when you close the window."
        action={
          <Button Icon={FolderPlus} onClick={addWorkspace}>
            Add workspace
          </Button>
        }
      />
    </Page>
  );

  return (
    <AppShell
      nav={{
        items: phoneItems,
        value: tab,
        onChange: goTab,
        tabs: 5,
      }}
      sidebar={
        <Sidebar
          items={items}
          value={settingsOpen ? "" : selected}
          onChange={go}
          search={() => setPalette((v) => !v)}
          brand={{ mark: <BrandMark size={20} className="text-ink" />, word: <span className="text-button text-bright">NeuralAgent</span> }}
          above={(open) => <UpdateBadge open={open} />}
          footer={(open) => <AccountRow open={open} active={settingsOpen} activity={remoteWaiting} onSettings={() => setWorkspace(SETTINGS)} />}
          pinned={sidebarPinned}
          onPinnedChange={setSidebarPinned}
          // macOS draws the window buttons over the top-left corner.
          className={platform.trafficLights ? "top-7" : undefined}
        />
      }
    >
      <NavPage id={selected || "welcome"} depth={back ? 1 : 0} back={back}>
        {body}
      </NavPage>
      <ConnectionPill show={!!state && disconnected} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} groups={paletteGroups} placeholder="Jump to a workspace or page…" />
      <LaunchScreen ready={!!state} offline={status === "offline"} />
      {state && <AgentCatalog />}
      {state && <ChangesSheet />}
      {state && <FolderBrowserSheet />}
      <UpdateDialog />
      <Toaster />
      <ZoomControl />
    </AppShell>
  );
}
