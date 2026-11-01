import type { Workspace } from "@neuralagent/protocol";
import { AppShell, Button, CommandPalette, ConfirmSheet, ConnectionPill, Empty, NavPage, Page, Sidebar, Toaster, toast, useLayoutMode, ACTIVITY_LABEL, type CommandGroup, type NavItem } from "@neuralagent/ui";
import { ArrowDownToLine, Copy, Folder, FolderGit2, FolderPlus, Gauge, History, LayoutDashboard, Palette, Pencil, Pin, PinOff, Plug, Settings, Smartphone, Sparkles, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountRow } from "./components/AccountRow";
import { LaunchScreen } from "./components/LaunchScreen";
import { UpdateBadge } from "./components/UpdateBadge";
import { UpdateDialog } from "./components/UpdateDialog";
import { AgentCatalog } from "./components/AgentCatalog";
import { AgentsDashboard } from "./components/AgentsDashboard";
import { CallScreen } from "./components/CallScreen";
import { PhoneApp } from "./components/phone/PhoneApp";
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
import { endCall, holdCall, startCall, useCall } from "./lib/call";
import { activityOf } from "./lib/status";
import { openAgentOnDesktop } from "./lib/openAgent";
import { phoneRouter, usePhoneNav } from "./lib/phoneRoute";
import { ALERT_TEXT, chime, useAlerts, wantsNotify, wantsSound } from "./lib/alerts";
import { writeClipboard } from "./lib/clipboard";
import { useClient, useDaemon, usePlatform, useUi } from "./lib/store";
import { useUpdateWatch } from "./lib/updates";
import { useUsageNotice } from "./lib/usageNotice";
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
// Former phone tabs (before the phone router), possibly still remembered as the shown page.
const WORKSPACES = "__workspaces";
const MORE = "__more";

/** Settings sections the command palette reaches directly (⌘K). */
const SETTINGS_SHORTCUTS = [
  { id: "set-remote", section: "remote", label: "Remote access", Icon: Smartphone, keywords: "phone devices pair pairing account sign in" },
  { id: "set-mcp", section: "mcp", label: "MCP servers", Icon: Plug, keywords: "tools servers mcp" },
  { id: "set-appearance", section: "appearance", label: "Appearance", Icon: Palette, keywords: "theme dark light colour color" },
  { id: "set-updates", section: "updates", label: "Updates", Icon: ArrowDownToLine, keywords: "version update changelog" },
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
  useUsageNotice(); // once: anonymous usage stats are on (lib/usageNotice.ts)
  useWindowDrag();
  // Phones get their own shell and router (components/phone/PhoneApp.tsx); the effects below serve both.
  const phone = useLayoutMode() === "phone";
  const phoneRef = useRef(phone);
  phoneRef.current = phone;

  const workspaces = useMemo(() => [...(state?.workspaces ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order), [state?.workspaces]);
  // Neural is the home screen until something else is picked.
  // The old phone tabs (Workspaces, More) are not desktop pages: Neural stands in.
  const neural = workspace === NEURAL || workspace === null || workspace === WORKSPACES || workspace === MORE;
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
  const current = neural || dashboard || swarmPage || settingsOpen || history || usage ? undefined : (workspaces.find((w) => w.id === workspace) ?? workspaces[0]);

  // "Hey Neural, …": hand what was heard to Neural and show the conversation.
  useEffect(
    () =>
      platform.voice?.onCommand((text) => {
        if (!text.trim()) return;
        if (phoneRef.current) phoneRouter().go({ tab: "neural", stack: [] });
        else setWorkspace(NEURAL);
        client.req({ m: "orch_send", p: { text } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
      }),
    [platform.voice, client, setWorkspace],
  );


  // Phones: the quick tile starts a call (on the Neural page); the native side keeps it alive.
  const live = useCall((c) => c.live);
  const on = useCall((c) => c.on);
  // Told the native side about this call (at the tap: audio mode, ducking, route; again once the
  // microphone is open: the foreground service needs the permission); or it was dialled from
  // there and waits for the end.
  const told = useRef<"" | "on" | "live">("");
  const dialled = useRef(false);
  useEffect(() => {
    const want = !on ? "" : live ? "live" : "on";
    if (want && want !== told.current) {
      told.current = want;
      platform.call?.active(true);
    } else if (!want && (told.current || dialled.current)) {
      told.current = "";
      dialled.current = false;
      platform.call?.active(false);
    }
  }, [platform, live, on]);
  useEffect(
    () =>
      platform.call?.onDial((start) => {
        if (!start) return endCall();
        dialled.current = true;
        // The call screen is global (it stays over any page): no need to move.
        void startCall(client);
      }),
    [platform, client],
  );
  // Android: a phone call took the sound; the call holds until it comes back.
  useEffect(() => platform.call?.onHold?.(holdCall), [platform]);

  // A tapped notification (web push, Android) opens its agent. Phones: at once, over the Agents
  // inbox (the screen shows the remembered name until the state arrives). Desktop: once the state
  // knows the session (its workspace, with its tab in front).
  const [opening, setOpening] = useState<string | null>(null);
  const open = (sid: string) => (phoneRef.current ? phoneRouter().openAgentFresh(sid) : setOpening(sid));
  useEffect(() => platform.onOpenSession?.(open), [platform]);
  useEffect(() => {
    if (!opening || !state?.sessions[opening]) return;
    setOpening(null);
    openAgentOnDesktop(client, setWorkspace, opening);
  }, [opening, state, client, setWorkspace]);

  // An agent finished, needs input or failed: sound and/or notification as this device chose
  // (lib/alerts.ts). Silent while you look at its workspace; in front but elsewhere, a small note
  // with "Open"; in the background a system notification (phones and browsers: the relay's push).
  // Phones: silent on that agent's screen and on the Agents inbox (it shows there); "finished"
  // is never a note (the inbox has it); another agent that needs you is one quiet note.
  const shownWs = useRef<string | undefined>(undefined);
  shownWs.current = current?.id;
  useEffect(() => {
    const off = client.onEvent((ev) => {
      if (ev.e !== "attention") return;
      const mode = useAlerts.getState().mode;
      const s = client.state?.sessions[ev.session_id];
      const looking = platform.focused ? platform.focused() : document.visibilityState === "visible";
      if (mode === "off") return;
      if (phoneRef.current && looking) {
        const nav = usePhoneNav.getState();
        const top = nav.stack.at(-1);
        if ((top?.k === "agent" && top.sid === ev.session_id) || (nav.tab === "agents" && !top)) return;
      } else if (looking && s && s.workspace_id === shownWs.current) return;
      const title = s?.title ?? "Agent";
      if (wantsSound(mode)) chime(ev.kind);
      if (looking) {
        toast(`${title}: ${ALERT_TEXT[ev.kind]}`, {
          actionLabel: "Open",
          undo: () => (phoneRef.current ? phoneRouter().openAgent(ev.session_id) : setOpening(ev.session_id)),
          tone: ev.kind === "error" ? "danger" : undefined,
          desktopOnly: ev.kind === "done",
        });
      } else if (wantsNotify(mode) && !platform.push) platform.notify?.(title, ALERT_TEXT[ev.kind]);
    });
    return () => void off();
  }, [client, platform]);

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
  // With a Neural daemon the swarm page is "Teams" (D64) and also counts working teams.
  const teams = status === "open" && client.has("neural");
  const running = (state?.swarms ?? []).filter((w) => !w.ended).length + (state?.neural?.tasks ?? []).filter((t) => t.team && t.status === "working").length;
  // Remote sign-in waits for approval: shown on Settings → Remote access, the account and the More tab.
  const remoteWaiting = platform.kind === "desktop" && state?.remote.status === "pending" ? ("waiting" as const) : undefined;
  // Workspaces in the sidebar: right-click to rename (the folder stays), pin, copy the path or
  // remove; drag to reorder. Dropped next to pinned ones, a workspace becomes pinned (and back).
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Workspace | null>(null);
  const updateWs = (id: string, p: { name?: string; pinned?: boolean; order?: number }) =>
    client.req({ m: "workspace_update", p: { id, ...p } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
  const reorderWs = (ids: string[], moved: string) => {
    const byId = new Map(workspaces.map((w) => [w.id, w]));
    const at = ids.indexOf(moved);
    const above = byId.get(ids[at - 1] ?? "");
    const pinned = above ? above.pinned : !!byId.get(ids[at + 1] ?? "")?.pinned;
    ids.forEach((id, order) => {
      const w = byId.get(id);
      if (!w) return;
      const p = { ...(w.order !== order && { order }), ...(id === moved && w.pinned !== pinned && { pinned }) };
      if (Object.keys(p).length) void updateWs(id, p);
    });
  };
  const wsMenu = (w: Workspace) => [
    { label: "Rename", Icon: Pencil, onSelect: () => setRenaming(w.id) },
    { label: w.pinned ? "Unpin" : "Pin to top", Icon: w.pinned ? PinOff : Pin, onSelect: () => void updateWs(w.id, { pinned: !w.pinned }) },
    { label: "Copy folder path", Icon: Copy, onSelect: () => void writeClipboard(w.path, platform).then((ok) => toast(ok ? "Path copied" : "Could not copy the path", ok ? undefined : { tone: "danger" })) },
    { label: "Remove…", Icon: Trash2, destructive: true, divider: true, onSelect: () => setRemoving(w) },
  ];

  const items: NavItem[] = [
    { id: NEURAL, label: "Neural", Icon: Sparkles, activity: state?.orchestrator.busy ? "working" : undefined },
    { id: AGENTS, label: "Agents", Icon: LayoutDashboard, activity: waiting > 0 ? "waiting" : undefined },
    { id: SWARM, label: teams ? "Teams" : "Swarm", Icon: Users, activity: running > 0 ? "working" : undefined },
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
        menu: wsMenu(w),
        reorder: true,
        title: w.path,
      };
    }),
    { id: ADD, label: "Add workspace", Icon: FolderPlus, groupStart: workspaces.length > 0 },
  ];

  const selected = neural ? NEURAL : dashboard ? AGENTS : swarmPage ? SWARM : history ? HISTORY : usage ? USAGE : settingsOpen ? SETTINGS : (current?.id ?? "");
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
        { id: "new-swarm", label: teams ? "New team…" : "New swarm…", Icon: Users, keywords: "team agents", onSelect: () => setWorkspace(SWARM) },
      ],
    },
  ];

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

  // Sheets, dialogs and screens both layouts share (inside the shell: it is their surface).
  const shared = (
    <>
      <LaunchScreen ready={!!state} offline={status === "offline"} />
      {state && <AgentCatalog />}
      {state && <ChangesSheet />}
      {state && <FolderBrowserSheet />}
      <UpdateDialog />
      <ConfirmSheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await client.req({ m: "workspace_remove", p: { id: removing.id } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
        }}
        title={`Remove ${removing?.name ?? "workspace"}?`}
        message="It leaves NeuralAgent and its agents stop; the folder and its files stay on the computer."
        confirmLabel="Remove"
        destructive
        Icon={Trash2}
      />
      {/* A call stays on screen wherever you go meanwhile. */}
      <CallScreen />
      <Toaster />
    </>
  );

  if (phone) return <PhoneApp disconnected={!!state && disconnected}>{shared}</PhoneApp>;

  return (
    <AppShell
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
          onReorder={reorderWs}
          renaming={renaming}
          onRename={(id, name) => {
            setRenaming(null);
            if (name) void updateWs(id, { name });
          }}
          // macOS draws the window buttons over the top-left corner.
          className={platform.trafficLights ? "top-7" : undefined}
        />
      }
    >
      <NavPage id={selected || "welcome"} depth={0}>
        {body}
      </NavPage>
      <ConnectionPill show={!!state && disconnected} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} groups={paletteGroups} placeholder="Jump to a workspace or page…" />
      {shared}
      <ZoomControl />
    </AppShell>
  );
}
