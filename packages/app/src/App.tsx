import type { Workspace } from "@neuralagent/protocol";
import { AppShell, Button, Callout, Empty, Page, Sidebar, Spinner, Toaster, toast, type NavItem } from "@neuralagent/ui";
import { Folder, FolderGit2, FolderPlus, Gauge, History, LayoutDashboard, Plug, Smartphone } from "lucide-react";
import { useEffect, useMemo } from "react";
import { AgentCatalog } from "./components/AgentCatalog";
import { AgentsDashboard } from "./components/AgentsDashboard";
import { BrandMark } from "./components/BrandMark";
import { ChangesSheet } from "./components/ChangesSheet";
import { HistoryPage } from "./components/HistoryPage";
import { UsagePage } from "./components/UsagePage";
import { McpPage } from "./components/McpPage";
import { RemotePage } from "./components/RemotePage";
import { SettingsPage } from "./components/SettingsPage";
import { WorkspaceView } from "./components/WorkspaceView";
import { mostUrgent } from "./lib/status";
import { useClient, useDaemon, usePlatform, useUi } from "./lib/store";

const ADD = "__add";
const AGENTS = "__agents";
const HISTORY = "__history";
const MCP = "__mcp";
const USAGE = "__usage";
const REMOTE = "__remote";
const SETTINGS = "__settings";

export function App() {
  const client = useClient();
  const platform = usePlatform();
  const status = useDaemon((c) => c.status);
  const state = useDaemon((c) => c.state);
  const { workspace, setWorkspace, sidebarPinned, setSidebarPinned } = useUi();

  const workspaces = useMemo(() => [...(state?.workspaces ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order), [state?.workspaces]);
  const dashboard = workspace === AGENTS;
  const settingsOpen = workspace === SETTINGS;
  const history = workspace === HISTORY;
  const mcp = workspace === MCP;
  const usage = workspace === USAGE;
  const remotePage = workspace === REMOTE;
  const current = dashboard || settingsOpen || history || mcp || usage || remotePage ? undefined : (workspaces.find((w) => w.id === workspace) ?? workspaces[0]);

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

  // Menu bar / tray: how many agents run, work, and wait for you.
  const agentStatuses = useMemo(() => {
    const engine = (id: string) => state?.profiles.find((p) => p.id === id)?.engine ?? "shell";
    return Object.values(state?.sessions ?? {})
      .filter((s) => s.alive && engine(s.profile_id) !== "shell" && !s.profile_id.startsWith("install:"))
      .map((s) => s.status);
  }, [state?.sessions, state?.profiles]);
  const trayCounts = [agentStatuses.length, agentStatuses.filter((s) => s === "working").length, agentStatuses.filter((s) => s === "waiting").length].join(",");
  useEffect(() => {
    const [running, working, waiting] = trayCounts.split(",").map(Number);
    platform.trayStatus?.({ running, working, waiting });
  }, [trayCounts, platform]);

  const addWorkspace = async () => {
    const path = await platform.pickFolder?.();
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
  const items: NavItem[] = [
    { id: AGENTS, label: "Agents", Icon: LayoutDashboard, badge: waiting > 0 ? `${waiting} waiting` : undefined },
    { id: HISTORY, label: "History", Icon: History },
    { id: MCP, label: "MCP", Icon: Plug },
    { id: USAGE, label: "Usage", Icon: Gauge },
    { id: REMOTE, label: "Remote", Icon: Smartphone, badge: state?.remote.status === "pending" ? "Waiting" : undefined },
    ...workspaces.map((w) => {
      const statuses = Object.values(state?.sessions ?? {}).filter((s) => s.workspace_id === w.id).map((s) => s.status);
      const urgent = mostUrgent(statuses);
      return {
        id: w.id,
        label: w.name,
        Icon: w.git ? FolderGit2 : Folder,
        group: "Workspaces",
        badge: urgent === "waiting" ? "Needs input" : urgent === "done" ? "Done" : urgent === "error" ? "Error" : undefined,
      };
    }),
    ...(platform.pickFolder ? [{ id: ADD, label: "Add workspace", Icon: FolderPlus, groupStart: workspaces.length > 0 }] : []),
  ];

  const body = !state ? (
    <div className="grid h-full place-items-center">
      {status === "offline" ? <Callout tone="danger" title="Daemon not reachable">Trying to reconnect…</Callout> : <Spinner label="Connecting" />}
    </div>
  ) : settingsOpen ? (
    <SettingsPage />
  ) : dashboard ? (
    <AgentsDashboard />
  ) : history ? (
    <HistoryPage />
  ) : mcp ? (
    <McpPage />
  ) : usage ? (
    <UsagePage />
  ) : remotePage ? (
    <RemotePage />
  ) : current ? (
    <WorkspaceView key={current.id} workspaceId={current.id} />
  ) : (
    <Page title="Welcome" eyebrow="NeuralAgent">
      <Empty
        Icon={FolderPlus}
        title="Add a workspace"
        detail="A workspace is a project folder. Agents you start there run in panes and keep running when you close the window."
        action={
          platform.pickFolder && (
            <Button Icon={FolderPlus} onClick={addWorkspace}>
              Add workspace
            </Button>
          )
        }
      />
    </Page>
  );

  return (
    <AppShell
      sidebar={
        <Sidebar
          items={items}
          value={dashboard ? AGENTS : history ? HISTORY : mcp ? MCP : usage ? USAGE : remotePage ? REMOTE : (current?.id ?? "")}
          onChange={(id) => (id === ADD ? void addWorkspace() : setWorkspace(id))}
          brand={{ mark: <BrandMark size={20} className="text-ink" />, word: <span className="text-button text-bright">NeuralAgent</span> }}
          onSettings={() => setWorkspace(SETTINGS)}
          settingsActive={settingsOpen}
          pinned={sidebarPinned}
          onPinnedChange={setSidebarPinned}
          // macOS draws the window buttons over the top-left corner.
          className={platform.trafficLights ? "top-7" : undefined}
        />
      }
    >
      {state && status !== "open" && (
        <div className="absolute inset-x-0 top-2 z-20 flex justify-center">
          <Callout tone="warning">Reconnecting to the daemon…</Callout>
        </div>
      )}
      {body}
      {state && <AgentCatalog />}
      {state && <ChangesSheet />}
      <Toaster />
    </AppShell>
  );
}
