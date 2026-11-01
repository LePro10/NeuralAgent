// Settings. Phones: the computer on top, then a grouped list with quiet icon tiles; each row is a
// route of the phone router (`#/settings/<section>`), so back and Android's back walk them.
// Desktop: two columns, the same list on the left and the chosen page on the right. Pages can push
// a detail of their own (a workspace, a profile, an MCP server) through `useSettingsNav`; nothing
// in Settings opens as a side sheet (D71). Remote access and MCP servers live here too (they were
// top-level pages before); `requestSettingsSection` opens one from anywhere. A search field
// filters the sections by name and keywords.
import {
  BackButton,
  Empty,
  IconTile,
  List,
  NavBackProvider,
  Page,
  Row,
  SearchField,
  useLayoutMode,
  type Activity,
} from "@neuralagent/ui";
import type { LucideIcon } from "lucide-react";
import { useAlerts } from "../lib/alerts";
import { ArrowDownToLine, Bell, Bot, Folder, Gamepad2, Gauge, History, Info, Mic, Monitor, Palette, Phone, Plug, Search, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, UserCog } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { presenceLabel } from "../lib/discord";
import { phoneRouter, usePhoneNav } from "../lib/phoneRoute";
import { UpdateBadge } from "./UpdateBadge";
import { useDaemon, usePlatform } from "../lib/store";
import { matchesQuery, takeSettingsSection, useSettingsRoute } from "../lib/settingsRoute";
import { useTheme } from "../lib/theme";
import { useUpdates } from "../lib/updates";
import { HostUpdates, HostVoiceSettings, WorkspaceDetail, WorkspaceSettings } from "./HostSettings";
import { Glow } from "./Glow";
import { mcpDetail, McpPanel } from "./McpPage";
import { RemotePanel } from "./RemotePage";
import { AgentsPanel, profileDetail, ProfilesPanel } from "./settings/AgentsPanel";
import { DiscordPanel } from "./settings/DiscordPanel";
import { PrivacyIcon, PrivacyPanel, privacySummary } from "./settings/PrivacyPanel";
import { SystemPanel } from "./settings/SystemPanel";
import {
  AboutPanel,
  AdvancedPanel,
  AppearancePanel,
  NotificationsPanel,
  alertsSummary,
  appearanceSummary,
  CallsPanel,
  keepAwakeLabel,
  NeuralPanel,
  PROVIDERS,
} from "./settings/panels";
import { LocalUpdates, WebVersion } from "./UpdateSettings";
import { SettingsNavCtx, type SettingsNav } from "./settings/nav";

interface SectionDef {
  id: string;
  title: string;
  Icon: LucideIcon;
  /** More words the search finds it by. */
  keywords?: string;
  value?: ReactNode;
  activity?: Activity;
  /** A full page of its own (a remote's account page), not content inside a settings page. */
  own?: boolean;
  render?: () => ReactNode;
  /** A detail page by its key, for links and reloads (phones keep the key in the URL). */
  detail?: (key: string, back: () => void) => { title: string; node: ReactNode } | undefined;
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
  const paired = useDaemon((c) => c.state?.remote.devices?.length ?? 0);
  const remoteStatus = useDaemon((c) => c.state?.remote.status);
  const mcp = useDaemon((c) => c.state?.mcp);
  const servers = (mcp ?? []).filter((s) => s.enabled).length;
  const wsList = useDaemon((c) => c.state?.workspaces);
  const installed = useDaemon((c) => c.state?.catalog.filter((a) => a.installed).length ?? 0);
  const profiles = useDaemon((c) => c.state?.profiles);
  const custom = (profiles ?? []).filter((p) => !p.builtin);
  const u = useUpdates();
  // Re-render the summary when the theme changes.
  useTheme((t) => t.appearance);
  useTheme((t) => t.scheme);
  useAlerts((a) => a.mode);
  const host = remote ? hostName : null;

  const appearance: SectionDef = {
    id: "appearance",
    title: "Appearance",
    Icon: Palette,
    keywords: "theme dark light mode colour color accent scheme interface size zoom",
    value: appearanceSummary(),
    render: () => <AppearancePanel />,
  };
  const alerts: SectionDef = { id: "notifications", title: "Notifications", Icon: Bell, keywords: "alerts sound push chime", value: alertsSummary(), render: () => <NotificationsPanel /> };
  const pending = remoteStatus === "pending";
  const accessWords = "phone devices pair pairing account sign in relay remote";
  const access: SectionDef = remote
    ? platform.account
      ? { id: "remote", title: "Account and devices", Icon: Smartphone, keywords: accessWords, own: true, render: () => platform.account!.render() }
      : { id: "remote", title: "Account and devices", Icon: Smartphone, keywords: accessWords, render: () => <RemotePanel /> }
    : {
        id: "remote",
        title: "Remote access",
        Icon: Smartphone,
        keywords: accessWords,
        value: pending ? "Waiting" : paired ? `${paired} paired` : undefined,
        activity: pending ? "waiting" : undefined,
        render: () => <RemotePanel />,
      };
  const updates: SectionDef = {
    id: "updates",
    title: "Updates",
    Icon: ArrowDownToLine,
    keywords: "version changelog release new",
    value: u.offer ? <span className="text-accent">{u.kind === "web" ? "New version" : `${u.offer.version} available`}</span> : u.current || undefined,
    render: () => (
      <div className="flex flex-col gap-7">
        <WebVersion />
        {platform.updates ? <LocalUpdates /> : remote && <HostUpdates hostName={hostName ?? "the host"} />}
      </div>
    ),
  };
  const neural: SectionDef[] = [
    {
      id: "neural",
      title: "Neural",
      Icon: Sparkles,
      keywords: "orchestrator model llm api key provider",
      value: PROVIDERS.find((p) => p.value === settings?.llm.provider)?.label,
      render: () => <NeuralPanel hostName={host} />,
    },
    {
      id: "voice",
      title: "Voice",
      Icon: Mic,
      keywords: "dictation wake word hey neural speech microphone",
      render: () => (
        <div className="flex flex-col gap-7">
          <HostVoiceSettings mac={!!platform.trafficLights} hostName={host} />
        </div>
      ),
    },
    { id: "calls", title: "Calls", Icon: Phone, keywords: "call voice speed speaker audio", render: () => <CallsPanel hostName={host} /> },
  ];
  const agents: SectionDef[] = [
    {
      id: "agents",
      title: "Agents",
      Icon: Bot,
      keywords: "install cli claude codex gemini opencode catalog",
      value: installed ? `${installed} installed` : undefined,
      render: () => <AgentsPanel />,
    },
    {
      id: "profiles",
      title: "Profiles",
      Icon: UserCog,
      keywords: "launch arguments model custom command",
      value: custom.length ? String(custom.length) : undefined,
      render: () => <ProfilesPanel />,
      detail: (key, back) => {
        if (key === "new") return profileDetail(null, back);
        const p = custom.find((x) => `p-${x.id}` === key);
        return p ? profileDetail(p, back) : undefined;
      },
    },
    {
      id: "mcp",
      title: "MCP servers",
      Icon: Plug,
      keywords: "tools servers mcp",
      value: servers ? `${servers} on` : undefined,
      render: () => <McpPanel />,
      detail: (key, back) => mcpDetail(mcp, key, back),
    },
    {
      id: "workspaces",
      title: "Workspaces",
      Icon: Folder,
      keywords: "folders projects approve approved",
      value: wsList?.length ? String(wsList.length) : undefined,
      render: () => <WorkspaceSettings hostName={host} />,
      detail: (key) => {
        const w = wsList?.find((x) => `ws-${x.id}` === key);
        return w ? { title: w.name, node: <WorkspaceDetail id={w.id} /> } : undefined;
      },
    },
  ];
  const discord: SectionDef = {
    id: "discord",
    title: "Discord",
    Icon: Gamepad2,
    keywords: "rich presence status profile game tokens streak subagents",
    value: presenceLabel(settings?.discord_presence),
    render: () => <DiscordPanel hostName={host} />,
  };
  const advanced: SectionDef = {
    id: "advanced",
    title: "Advanced",
    Icon: SlidersHorizontal,
    keywords: "keep awake sleep resume restart",
    value: keepAwakeLabel(settings?.keep_awake) && `Keep awake: ${keepAwakeLabel(settings?.keep_awake)}`,
    render: () => <AdvancedPanel />,
  };
  const privacy: SectionDef = {
    id: "privacy",
    title: "Privacy and support",
    Icon: PrivacyIcon,
    keywords: "privacy usage statistics telemetry analytics report problem bug support help diagnostics logs feedback",
    value: privacySummary(settings?.usage_stats),
    render: () => <PrivacyPanel />,
  };
  const about: SectionDef = { id: "about", title: "About", Icon: Info, keywords: "privacy terms imprint website version", render: () => <AboutPanel /> };
  // Permissions, autostart and the background service of the computer (D58-D60).
  const system: SectionDef = {
    id: "system",
    title: "System",
    Icon: ShieldCheck,
    keywords: "permissions privacy full disk access accessibility microphone autostart login boot startup service restart launchd",
    render: () => <SystemPanel hostName={host ?? undefined} />,
  };
  // The computer the agents run on: how it is reached and how it behaves.
  const computer: SectionDef[] = [system, discord, advanced];

  // Phones and browsers: this device first, then the computer the agents run on.
  if (remote)
    return [
      { label: "This device", items: [access, appearance, alerts] },
      { label: hostName ?? "Host computer", items: neural },
      { label: "Agents and tools", items: agents },
      { label: "Computer", items: computer },
      { items: [updates, privacy, about] },
    ];
  return [
    { items: [appearance, alerts] },
    { label: "Neural and voice", items: neural },
    { label: "Agents and tools", items: agents },
    { label: "Computer", items: [access, ...computer] },
    { items: [updates, privacy, about] },
  ];
}

/** The groups narrowed to the sections a search finds (one "Results" group), or all of them. */
function filterGroups(groups: SectionGroup[], query: string): SectionGroup[] {
  if (!query.trim()) return groups;
  const items = groups.flatMap((g) => g.items).filter((s) => matchesQuery(query, `${s.title} ${s.keywords ?? ""} ${g(groups, s)}`));
  return items.length ? [{ label: "Results", items }] : [];
}
/** The group label also counts ("host" finds the host's sections on a phone). */
const g = (groups: SectionGroup[], s: SectionDef) => groups.find((x) => x.items.includes(s))?.label ?? "";

function SectionRows({ groups, onOpen, selected }: { groups: SectionGroup[]; onOpen: (s: SectionDef) => void; selected?: string }) {
  if (!groups.length) return <Empty Icon={Search} title="No settings found" detail="Try another word." />;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((grp) => (
        <List key={grp.items[0]!.id} label={grp.label}>
          {grp.items.map((s) => (
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

/** The phone's Settings tab: search, this computer on top, then every section, then History and Usage. */
export function PhoneSettingsRoot() {
  const groups = useSections();
  const [query, setQuery] = useState("");
  const retap = usePhoneNav((s) => (s.tab === "settings" ? s.retap : 0));
  const activity: SectionGroup = {
    label: "Activity",
    items: [
      { id: "history", title: "History", Icon: History, keywords: "past conversations transcripts resume" },
      { id: "usage", title: "Usage", Icon: Gauge, keywords: "tokens cost limits" },
    ],
  };
  const shown = filterGroups([...groups, activity], query);
  const searching = query.trim() !== "";
  return (
    <Page title="Settings" eyebrow={EYEBROW} scrollTopKey={retap}>
      <div className="flex flex-col gap-6 pb-8">
        <SearchField value={query} onChange={setQuery} placeholder="Search settings" />
        {!searching && <ComputerCard />}
        <SectionRows groups={shown} onOpen={(s) => phoneRouter().push(s.id === "history" ? { k: "history" } : s.id === "usage" ? { k: "usage" } : { k: "section", id: s.id })} />
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
  const back = () => void phoneRouter().back();
  const nav: SettingsNav = {
    push: (key, title, node) => {
      details.set(`${id}/${key}`, { title, node });
      phoneRouter().push({ k: "section", id, detail: key });
    },
    back,
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
  // A detail from an earlier run (reload) is rebuilt from its key where the section can; else the section stands in.
  const d = detail ? (details.get(`${id}/${detail}`) ?? s.detail?.(detail, back)) : undefined;
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
 * search and section list on the left (it stays in view while the right side scrolls) and the
 * chosen section on the right, with its title and, for a detail, a back button to the section.
 */
function DesktopSettings() {
  const groups = useSections();
  const all = groups.flatMap((g) => g.items);
  const [query, setQuery] = useState("");
  // A section asked for before Settings opened shows right away, without a flash of Appearance.
  const [id, setId] = useState(() => takeSettingsSection() ?? "appearance");
  const [detail, setDetail] = useState<{ key: string; title: string; node: ReactNode } | null>(null);
  const section = all.find((s) => s.id === id) ?? all[0]!;
  const nav: SettingsNav = { push: (key, title, node) => setDetail({ key, title, node }), back: () => setDetail(null) };
  const open = (s: SectionDef) => {
    setId(s.id);
    setDetail(null);
  };
  useSectionRequests(all, open);
  // Escape leaves a detail page (unless a field or an overlay takes it first).
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented || t?.closest("input,textarea,select,[contenteditable=true]")) return;
      setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);
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
              className="scroller sticky flex w-72 shrink-0 flex-col gap-4 pb-2"
              style={{ top: "calc(var(--safe-top) + 72px)", maxHeight: "calc(100dvh - var(--safe-top) - 96px)" }}
            >
              <SearchField value={query} onChange={setQuery} placeholder="Search settings" />
              <SectionRows groups={filterGroups(groups, query)} onOpen={open} selected={id} />
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
