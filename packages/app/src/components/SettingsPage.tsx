// Settings. Phones: the computer on top, then a grouped list with quiet icon tiles; each row is a
// route of the phone router (`#/settings/<section>`), so back and Android's back walk them.
// Desktop: two columns, the same list on the left and the chosen page on the right. Pages can push
// a detail of their own (a workspace) through `useSettingsNav`. Remote access and MCP servers live
// here too (they were top-level pages before); `requestSettingsSection` opens one from anywhere.
import {
  BackButton,
  Empty,
  IconTile,
  List,
  NavBackProvider,
  Page,
  Row,
  useLayoutMode,
  type Activity,
} from "@neuralagent/ui";
import type { LucideIcon } from "lucide-react";
import { useAlerts } from "../lib/alerts";
import { ArrowDownToLine, Bell, Bot, Folder, Gamepad2, Gauge, History, Info, Mic, Monitor, Palette, Phone, Plug, SlidersHorizontal, Smartphone, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { phoneRouter, usePhoneNav } from "../lib/phoneRoute";
import { UpdateBadge } from "./UpdateBadge";
import { useCatalogSheet, useDaemon, usePlatform } from "../lib/store";
import { takeSettingsSection, useSettingsRoute } from "../lib/settingsRoute";
import { useTheme } from "../lib/theme";
import { useUpdates } from "../lib/updates";
import { HostUpdates, HostVoiceSettings, WorkspaceSettings } from "./HostSettings";
import { Glow } from "./Glow";
import { McpPanel } from "./McpPage";
import { RemotePanel } from "./RemotePage";
import {
  AboutPanel,
  AdvancedPanel,
  AppearancePanel,
  NotificationsPanel,
  alertsSummary,
  appearanceSummary,
  CallsPanel,
  DiscordPanel,
  keepAwakeLabel,
  NeuralPanel,
  presenceLabel,
  PROVIDERS,
} from "./settings/panels";
import { LocalUpdates, WebVersion } from "./UpdateSettings";
import { SettingsNavCtx, type SettingsNav } from "./settings/nav";

interface SectionDef {
  id: string;
  title: string;
  Icon: LucideIcon;
  value?: ReactNode;
  activity?: Activity;
  /** Opens something else (a sheet) instead of a page. */
  action?: () => void;
  /** A full page of its own (a remote's account page), not content inside a settings page. */
  own?: boolean;
  render?: () => ReactNode;
}

interface SectionGroup {
  label?: string;
  items: SectionDef[];
}

function useSections(): SectionGroup[] {
  const platform = usePlatform();
  const remote = platform.kind !== "desktop";
  const hostName = useDaemon((c) => c.host?.name ?? null);
  const settings = useDaemon((c) => c.state?.settings);
  const workspaces = useDaemon((c) => c.state?.workspaces.length ?? 0);
  const paired = useDaemon((c) => c.state?.remote.devices?.length ?? 0);
  const remoteStatus = useDaemon((c) => c.state?.remote.status);
  const servers = useDaemon((c) => c.state?.mcp.filter((s) => s.enabled).length ?? 0);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const u = useUpdates();
  // Re-render the summary when the theme changes.
  useTheme((t) => t.appearance);
  useTheme((t) => t.scheme);
  useAlerts((a) => a.mode);
  const host = remote ? hostName : null;

  const alerts: SectionDef = { id: "notifications", title: "Notifications", Icon: Bell, value: alertsSummary(), render: () => <NotificationsPanel /> };
  const appearance: SectionDef = { id: "appearance", title: "Appearance", Icon: Palette, value: appearanceSummary(), render: () => <AppearancePanel /> };
  const pending = remoteStatus === "pending";
  const access: SectionDef = remote
    ? platform.account
      ? { id: "remote", title: "Account and devices", Icon: Smartphone, own: true, render: () => platform.account!.render() }
      : { id: "remote", title: "Account and devices", Icon: Smartphone, render: () => <RemotePanel /> }
    : {
        id: "remote",
        title: "Remote access",
        Icon: Smartphone,
        value: pending ? "Waiting" : paired ? `${paired} paired` : undefined,
        activity: pending ? "waiting" : undefined,
        render: () => <RemotePanel />,
      };
  const updates: SectionDef = {
    id: "updates",
    title: "Updates",
    Icon: ArrowDownToLine,
    value: u.offer ? <span className="text-accent">{u.kind === "web" ? "New version" : `${u.offer.version} available`}</span> : u.current || undefined,
    render: () => (
      <div className="flex flex-col gap-7">
        <WebVersion />
        {platform.updates ? <LocalUpdates /> : remote && <HostUpdates hostName={hostName ?? "the host"} />}
      </div>
    ),
  };
  const neural: SectionDef[] = [
    { id: "neural", title: "Neural", Icon: Sparkles, value: PROVIDERS.find((p) => p.value === settings?.llm.provider)?.label, render: () => <NeuralPanel hostName={host} /> },
    { id: "voice", title: "Voice", Icon: Mic, render: () => <div className="flex flex-col gap-7"><HostVoiceSettings mac={!!platform.trafficLights} hostName={host} /></div> },
    { id: "calls", title: "Calls", Icon: Phone, render: () => <CallsPanel hostName={host} /> },
  ];
  const agents: SectionDef[] = [
    { id: "agents", title: "Agents and profiles", Icon: Bot, action: () => openCatalog(true) },
    { id: "mcp", title: "MCP servers", Icon: Plug, value: servers ? `${servers} on` : undefined, render: () => <McpPanel /> },
    { id: "workspaces", title: "Workspaces", Icon: Folder, value: workspaces ? String(workspaces) : undefined, render: () => <WorkspaceSettings hostName={host} /> },
  ];
  const discord: SectionDef = { id: "discord", title: "Discord", Icon: Gamepad2, value: presenceLabel(settings?.discord_presence), render: () => <DiscordPanel /> };
  const app: SectionDef[] = [
    { id: "advanced", title: "Advanced", Icon: SlidersHorizontal, value: keepAwakeLabel(settings?.keep_awake) && `Keep awake: ${keepAwakeLabel(settings?.keep_awake)}`, render: () => <AdvancedPanel /> },
    { id: "about", title: "About", Icon: Info, render: () => <AboutPanel /> },
  ];

  // Phones and browsers: this device first, then the computer the agents run on.
  if (remote)
    return [
      { label: "This device", items: [access, appearance, alerts] },
      { label: hostName ?? "Host computer", items: neural },
      { label: "Agents and tools", items: agents },
      { items: [updates, discord, ...app] },
    ];
  return [
    { items: [appearance, alerts] },
    { label: "Neural and voice", items: neural },
    { label: "Agents and tools", items: agents },
    { label: "Connections", items: [access, discord] },
    { items: [updates, ...app] },
  ];
}

function SectionRows({ groups, onOpen, selected }: { groups: SectionGroup[]; onOpen: (s: SectionDef) => void; selected?: string }) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <List key={g.items[0]!.id} label={g.label}>
          {g.items.map((s) => (
            <Row key={s.id} Icon={s.Icon} title={s.title} value={s.value} activity={s.activity} selected={selected === s.id} chevron onClick={() => onOpen(s)} />
          ))}
        </List>
      ))}
    </div>
  );
}

/** Opens a section asked for with `requestSettingsSection`, now and whenever a new request comes. */
function useSectionRequests(all: SectionDef[], open: (s: SectionDef) => void) {
  const want = useSettingsRoute((r) => r.section);
  useEffect(() => {
    if (!want) return;
    const s = all.find((x) => x.id === takeSettingsSection());
    if (s) open(s);
  }, [want]);
}

/** Settings of this device and of the computer the agents run on (also from a remote). */
export function SettingsPage() {
  return useLayoutMode() === "phone" ? <PhoneSettingsRoot /> : <DesktopSettings />;
}

/** Like every top-level page: the app's ground, a soft light at the top, eyebrow and large title. */
const EYEBROW = "Preferences";

/** Detail pages a section pushed (`useSettingsNav().push`), by "<section>/<key>"; kept for this run. */
const details = new Map<string, { title: string; node: ReactNode }>();

/** The phone's Settings tab: this computer on top, then every section, then History and Usage. */
export function PhoneSettingsRoot() {
  const groups = useSections();
  const retap = usePhoneNav((s) => (s.tab === "settings" ? s.retap : 0));
  const open = (s: SectionDef) => (s.action ? s.action() : phoneRouter().push({ k: "section", id: s.id }));
  const activity: SectionGroup = {
    label: "Activity",
    items: [
      { id: "history", title: "History", Icon: History },
      { id: "usage", title: "Usage", Icon: Gauge },
    ],
  };
  return (
    <Page title="Settings" eyebrow={EYEBROW} scrollTopKey={retap}>
      <div className="flex flex-col gap-6 pb-8">
        <ComputerCard />
        <SectionRows groups={[...groups, activity]} onOpen={(s) => (s.id === "history" || s.id === "usage" ? phoneRouter().push({ k: s.id }) : open(s))} />
      </div>
    </Page>
  );
}

/** The computer the agents run on: its name, whether it is reachable, and (remote) switching. */
function ComputerCard() {
  const platform = usePlatform();
  const host = useDaemon((c) => c.host?.name);
  const status = useDaemon((c) => c.status);
  const remote = platform.kind !== "desktop";
  const state = status === "open" ? "Connected" : status === "connecting" ? "Connecting…" : "Not reachable";
  return (
    <div className="flex flex-col gap-2">
      <List>
        <Row
          leading={<IconTile Icon={Monitor} color="gray" activity={status === "open" ? undefined : "waiting"} />}
          title={<span className="text-headline">{remote ? (host ?? "Your computer") : "This computer"}</span>}
          detail={remote ? `${state} · Account, devices, switch computer` : state}
          chevron
          onClick={() => phoneRouter().push({ k: "section", id: "remote" })}
        />
      </List>
      <UpdateBadge phone />
    </div>
  );
}

/** One section (or a detail a section pushed) as its own page. */
export function PhoneSettingsSection({ id, detail }: { id: string; detail?: string }) {
  const groups = useSections();
  const s = groups.flatMap((g) => g.items).find((x) => x.id === id);
  const nav: SettingsNav = {
    push: (key, title, node) => {
      details.set(`${id}/${key}`, { title, node });
      phoneRouter().push({ k: "section", id, detail: key });
    },
  };
  if (!s?.render) {
    return (
      <Page title="Settings">
        <Empty Icon={SlidersHorizontal} title="Nothing here" detail="This setting is not available on this device." />
      </Page>
    );
  }
  // A section that is a whole page of its own (a remote's account) brings its own Page.
  if (s.own && !detail) return <SettingsNavCtx.Provider value={nav}>{s.render()}</SettingsNavCtx.Provider>;
  const d = detail ? details.get(`${id}/${detail}`) : undefined;
  // A detail from an earlier run (reload): its content is gone, the section stands in.
  const shown = d ?? { title: s.title, node: s.render() };
  return (
    <SettingsNavCtx.Provider value={nav}>
      <Page title={shown.title} reveal={false}>
        <div className="pb-8">{shown.node}</div>
      </Page>
    </SettingsNavCtx.Provider>
  );
}

/**
 * Desktop: one page like the others (eyebrow, large title, same width and light); below it the
 * section list on the left (it stays in view while the right side scrolls) and the chosen section
 * on the right, with its title and, for a detail, a back button to the section.
 */
function DesktopSettings() {
  const groups = useSections();
  const all = groups.flatMap((g) => g.items);
  // A section asked for before Settings opened shows right away, without a flash of Appearance.
  const [id, setId] = useState(() => takeSettingsSection() ?? "appearance");
  const [detail, setDetail] = useState<{ key: string; title: string; node: ReactNode } | null>(null);
  const section = all.find((s) => s.id === id) ?? all[0]!;
  const nav: SettingsNav = { push: (key, title, node) => setDetail({ key, title, node }) };
  const open = (s: SectionDef) => {
    if (s.action) return s.action();
    setId(s.id);
    setDetail(null);
  };
  useSectionRequests(all, open);
  // A section that is a whole page of its own (a remote's account) replaces Settings, with a way back.
  if (section.own) {
    return <NavBackProvider value={{ label: "Settings", onBack: () => setId("appearance") }}>{section.render!()}</NavBackProvider>;
  }
  const shown = detail ?? { key: section.id, title: section.title, node: section.render!() };
  return (
    <SettingsNavCtx.Provider value={nav}>
      <div className="relative h-full">
        <Glow tint="agents" />
        <Page title="Settings" eyebrow={EYEBROW} wide scrollTopKey={shown.key}>
          <div className="flex items-start gap-10 pb-8">
            <nav
              aria-label="Settings sections"
              className="scroller sticky w-72 shrink-0 pb-2"
              style={{ top: "calc(var(--safe-top) + 72px)", maxHeight: "calc(100dvh - var(--safe-top) - 96px)" }}
            >
              <SectionRows groups={groups} onOpen={open} selected={id} />
            </nav>
            <section aria-label={shown.title} className="min-w-0 max-w-2xl flex-1">
              {detail && (
                <div className="-mt-2 mb-1">
                  <BackButton label={section.title} onBack={() => setDetail(null)} />
                </div>
              )}
              <h2 className="mb-5 flex min-h-6 items-center text-title-2 text-bright">{shown.title}</h2>
              <div key={shown.key} className="page-in">
                {shown.node}
              </div>
            </section>
          </div>
        </Page>
      </div>
    </SettingsNavCtx.Provider>
  );
}
