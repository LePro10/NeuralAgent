// Phones: four tabs (Agents · Neural · Projects · Settings) in the Dock and the pages the phone
// router pushes over them (lib/phoneRoute.ts): an agent's screen, a project, a swarm, History,
// Usage, a settings section. Back (button, iOS edge swipe, Android back, the browser's back)
// walks the browser history; the phone never changes the computer's pane layout.
import { AppShell, NavPage, openLayerCount, type NavBack, type NavItem } from "@neuralagent/ui";
import { Folders, LayoutDashboard, Settings, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cachedAgent, rememberAgents, useOpenAgent } from "../../lib/openAgent";
import { navKey, phoneRouter, usePhoneNav, type Route, type Tab } from "../../lib/phoneRoute";
import { takeSettingsSection, useSettingsRoute } from "../../lib/settingsRoute";
import { useClient, useDaemon, usePlatform } from "../../lib/store";
import { HistoryPage } from "../HistoryPage";
import { NeuralPage } from "../NeuralPage";
import { PhoneSettingsRoot, PhoneSettingsSection } from "../SettingsPage";
import { SwarmPage } from "../SwarmPage";
import { SwarmDetail } from "../swarm/SwarmDetail";
import { UsagePage } from "../UsagePage";
import { PhoneAgentScreen } from "../workspace/PhoneWorkspace";
import { AgentsInbox, useInbox } from "./AgentsInbox";
import { ConnectionBanner } from "./ConnectionBanner";
import { NewSheet } from "./NewSheet";
import { ProjectPage, ProjectsPage } from "./ProjectsPage";

const LABEL: Record<Tab, string> = { agents: "Agents", neural: "Neural", projects: "Projects", settings: "Settings" };

/** Starts the router for as long as the phone layout is shown. */
function useRouter() {
  useEffect(() => {
    const r = phoneRouter(openLayerCount);
    r.start();
    return () => r.stop();
  }, []);
}

/** Keeps the agent names this device knows (a notification opens before the state is there). */
function useNameCache() {
  const client = useClient();
  useEffect(() => {
    rememberAgents(client);
    const off = client.subscribe(() => rememberAgents(client));
    return () => void off();
  }, [client]);
}

/** Settings sections asked for from anywhere (`requestSettingsSection`) open as Settings pages. */
function useSectionRequests() {
  const want = useSettingsRoute((r) => r.section);
  useEffect(() => {
    if (!want) return;
    const id = takeSettingsSection();
    if (id) phoneRouter().go({ tab: "settings", stack: [{ k: "section", id }] });
  }, [want]);
}

export function PhoneApp({ disconnected, children }: { disconnected: boolean; children: ReactNode }) {
  useRouter();
  useNameCache();
  useSectionRequests();
  const tab = usePhoneNav((s) => s.tab);
  const stack = usePhoneNav((s) => s.stack);
  const inbox = useInbox();
  const orchBusy = useDaemon((c) => !!c.state?.orchestrator.busy);
  const remoteWaiting = useDaemon((c) => c.state?.remote.status === "pending");
  const platform = usePlatform();
  const top = stack.at(-1);
  const full = top?.k === "agent";

  const items: NavItem<Tab>[] = [
    { id: "agents", label: "Agents", Icon: LayoutDashboard, count: inbox.counts.needs, activity: inbox.counts.needs ? undefined : inbox.counts.working ? "working" : undefined },
    { id: "neural", label: "Neural", Icon: Sparkles, activity: orchBusy ? "working" : undefined },
    { id: "projects", label: "Projects", Icon: Folders },
    { id: "settings", label: "Settings", Icon: Settings, activity: platform.kind === "desktop" && remoteWaiting ? "waiting" : undefined },
  ];

  // The page under the top one names the back button.
  const under = useDaemon((c) => {
    const r = stack.at(-2);
    if (!r) return LABEL[tab];
    if (r.k === "project") return c.state?.workspaces.find((w) => w.id === r.id)?.name ?? "Project";
    if (r.k === "swarm") return c.state?.swarms.find((w) => w.id === r.id)?.goal || "Swarm";
    if (r.k === "agent") return c.state?.sessions[r.sid]?.title ?? titleOf(r);
    return titleOf(r);
  });
  const back: NavBack | null = stack.length ? { label: under, onBack: () => phoneRouter().back() } : null;

  return (
    <AppShell nav={{ items, value: tab, onChange: (t) => phoneRouter().tab(t) }} dock={full ? "hidden" : "auto"}>
      <NavPage id={navKey({ tab, stack })} depth={stack.length} back={back}>
        {top ? <RoutePage route={top} backLabel={under} /> : <TabRoot tab={tab} />}
      </NavPage>
      <ConnectionBanner show={disconnected} />
      {children}
    </AppShell>
  );
}

/** The back button's words for a page under the shown one. */
function titleOf(r: Route): string {
  switch (r.k) {
    case "agent":
      return cachedAgent(r.sid)?.title ?? "Agent";
    case "project":
      return "Project";
    case "swarms":
      return "Swarms";
    case "swarm":
      return "Swarm";
    case "history":
      return r.project ? "Past conversations" : "History";
    case "usage":
      return "Usage";
    case "section":
      return "Settings";
  }
}

function TabRoot({ tab }: { tab: Tab }) {
  switch (tab) {
    case "agents":
      return <AgentsInbox />;
    case "neural":
      return <NeuralPage onSettings={() => phoneRouter().go({ tab: "settings", stack: [{ k: "section", id: "neural" }] })} />;
    case "projects":
      return <ProjectsPage />;
    case "settings":
      return <PhoneSettingsRoot />;
  }
}

function RoutePage({ route, backLabel }: { route: Route; backLabel: string }) {
  switch (route.k) {
    case "agent":
      return <AgentRoute sid={route.sid} backLabel={backLabel} />;
    case "project":
      return <ProjectPage id={route.id} />;
    case "swarms":
      return <SwarmPage />;
    case "swarm":
      return <SwarmDetail id={route.id} />;
    case "history":
      return <HistoryPage project={route.project} />;
    case "usage":
      return <UsagePage />;
    case "section":
      return <PhoneSettingsSection id={route.id} detail={route.detail} />;
  }
}

/**
 * An agent's screen. Opened from a notification it shows at once with the name this device
 * remembers, and the conversation (with its question) as soon as the computer answers.
 */
function AgentRoute({ sid, backLabel }: { sid: string; backLabel: string }) {
  const openAgent = useOpenAgent();
  const [adding, setAdding] = useState<string | null>(null);
  const onBack = () => phoneRouter().back();
  // Until the state knows the session, the screen shows the remembered name and "Connecting…".
  return (
    <>
      <PhoneAgentScreen sessionId={sid} onBack={onBack} onOpenAgent={openAgent} backLabel={backLabel} onNewAgent={setAdding} fallback={cachedAgent(sid)} />
      <NewSheet open={adding !== null} onClose={() => setAdding(null)} workspaceId={adding ?? undefined} />
    </>
  );
}
