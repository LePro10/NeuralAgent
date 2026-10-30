// Settings. Phones: a grouped list with quiet icon tiles; each row pushes its page (swipe back).
// Desktop: two columns, the same list on the left and the chosen page on the right. Pages can push
// a detail of their own (a workspace) through `useSettingsNav`. Remote access and MCP servers live
// here too (they were top-level pages before); `requestSettingsSection` opens one from anywhere.
import {
  BackButton,
  List,
  NavBackProvider,
  Page,
  Row,
  Stack,
  useLayoutMode,
  useStack,
  type Activity,
} from "@neuralagent/ui";
import type { LucideIcon } from "lucide-react";
import { ArrowUpCircle, Bot, Folder, Gamepad2, Info, Mic, Palette, Phone, Plug, SlidersHorizontal, Smartphone, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const host = remote ? hostName : null;

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
    Icon: ArrowUpCircle,
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
      { label: "This device", items: [access, appearance] },
      { label: hostName ?? "Host computer", items: neural },
      { label: "Agents and tools", items: agents },
      { items: [updates, discord, ...app] },
    ];
  return [
    { items: [appearance] },
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
  return useLayoutMode() === "phone" ? <PhoneSettings /> : <DesktopSettings />;
}

/** Like every top-level page: the app's ground, a soft light at the top, eyebrow and large title. */
const EYEBROW = "Preferences";

function PhoneSettings() {
  const groups = useSections();
  const all = groups.flatMap((g) => g.items);
  const stack = useStack();
  // Titles of pushed pages by key, so a detail's back button names the page under it.
  const titles = useRef(new Map<string, string>());
  const nav: SettingsNav = {
    push: (key, title, node) => {
      const under = stack.levels.at(-1);
      titles.current.set(key, title);
      stack.push(
        key,
        <Page title={title} backLabel={(under && titles.current.get(under.key)) ?? "Settings"} onBack={stack.pop} reveal={false}>
          <div className="pb-8">{node}</div>
        </Page>,
      );
    },
  };
  const open = (s: SectionDef) => {
    if (s.action) return s.action();
    if (s.own) {
      return stack.push(s.id, <NavBackProvider value={{ label: "Settings", onBack: stack.pop }}>{s.render!()}</NavBackProvider>);
    }
    nav.push(s.id, s.title, s.render!());
  };
  useSectionRequests(all, (s) => {
    stack.popTo(0);
    open(s);
  });
  return (
    <SettingsNavCtx.Provider value={nav}>
      <Stack
        stack={stack}
        root={
          <div className="relative h-full">
            <Glow tint="agents" />
            <Page title="Settings" eyebrow={EYEBROW}>
              <div className="pb-8">
                <SectionRows groups={groups} onOpen={open} />
              </div>
            </Page>
          </div>
        }
      />
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
