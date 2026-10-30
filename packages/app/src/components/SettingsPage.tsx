// Settings. Phones: an iOS Settings list with coloured tiles; each row pushes its page (swipe
// back). Desktop: two columns, the same list on the left and the chosen page on the right. Pages
// can push a detail of their own (a workspace) through `useSettingsNav`.
import {
  List,
  NavBackProvider,
  Page,
  Row,
  Stack,
  cn,
  useLayoutMode,
  useStack,
  type SysColor,
} from "@neuralagent/ui";
import type { LucideIcon } from "lucide-react";
import { ArrowUpCircle, Bot, Folder, Gamepad2, Info, Mic, Palette, Phone, SlidersHorizontal, Smartphone, Sparkles } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useCatalogSheet, useDaemon, usePlatform } from "../lib/store";
import { useTheme } from "../lib/theme";
import { useUpdates } from "../lib/updates";
import { HostUpdates, HostVoiceSettings, WorkspaceSettings } from "./HostSettings";
import { RemotePage } from "./RemotePage";
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
  tile: SysColor;
  value?: string;
  badge?: boolean;
  /** Opens something else (a sheet) instead of a page. */
  action?: () => void;
  /** A full page of its own (Remote), not content inside a settings page. */
  own?: boolean;
  render?: () => ReactNode;
}

function useSections(): SectionDef[][] {
  const platform = usePlatform();
  const remote = platform.kind !== "desktop";
  const hostName = useDaemon((c) => c.host?.name ?? null);
  const settings = useDaemon((c) => c.state?.settings);
  const workspaces = useDaemon((c) => c.state?.workspaces.length ?? 0);
  const paired = useDaemon((c) => c.state?.remote.devices?.length ?? 0);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const u = useUpdates();
  // Re-render the summary when the theme changes.
  useTheme((t) => t.appearance);
  useTheme((t) => t.scheme);
  const host = remote ? hostName : null;
  return [
    [{ id: "appearance", title: "Appearance", Icon: Palette, tile: "indigo", value: appearanceSummary(), render: () => <AppearancePanel /> }],
    [
      { id: "neural", title: "Neural", Icon: Sparkles, tile: "purple", value: PROVIDERS.find((p) => p.value === settings?.llm.provider)?.label, render: () => <NeuralPanel hostName={host} /> },
      { id: "calls", title: "Calls", Icon: Phone, tile: "green", render: () => <CallsPanel hostName={host} /> },
      { id: "voice", title: "Voice", Icon: Mic, tile: "orange", render: () => <div className="flex flex-col gap-7"><HostVoiceSettings mac={!!platform.trafficLights} hostName={host} /></div> },
      { id: "agents", title: "Agents and profiles", Icon: Bot, tile: "blue", action: () => openCatalog(true) },
      { id: "workspaces", title: "Workspaces", Icon: Folder, tile: "teal", value: workspaces ? String(workspaces) : undefined, render: () => <WorkspaceSettings hostName={host} /> },
    ],
    [
      { id: "remote", title: remote ? "Account and devices" : "Remote access", Icon: Smartphone, tile: "blue", value: paired ? `${paired} paired` : undefined, own: true, render: () => (platform.account ? platform.account.render() : <RemotePage />) },
      {
        id: "updates",
        title: "Updates",
        Icon: ArrowUpCircle,
        tile: "green",
        value: u.offer ? undefined : u.current || undefined,
        badge: !!u.offer,
        render: () => (
          <div className="flex flex-col gap-7">
            <WebVersion />
            {platform.updates ? <LocalUpdates /> : remote && <HostUpdates hostName={hostName ?? "the host"} />}
          </div>
        ),
      },
      { id: "discord", title: "Discord", Icon: Gamepad2, tile: "indigo", value: presenceLabel(settings?.discord_presence), render: () => <DiscordPanel /> },
    ],
    [
      { id: "advanced", title: "Advanced", Icon: SlidersHorizontal, tile: "gray", value: keepAwakeLabel(settings?.keep_awake) && `Keep awake: ${keepAwakeLabel(settings?.keep_awake)}`, render: () => <AdvancedPanel /> },
      { id: "about", title: "About", Icon: Info, tile: "gray", render: () => <AboutPanel /> },
    ],
  ];
}

function SectionRows({ groups, onOpen, selected }: { groups: SectionDef[][]; onOpen: (s: SectionDef) => void; selected?: string }) {
  const remote = usePlatform().kind !== "desktop";
  const hostName = useDaemon((c) => c.host?.name ?? null);
  return (
    <div className="flex flex-col gap-7">
      {groups.map((g, i) => (
        <List key={g[0]!.id} label={remote ? (i === 0 ? "This device" : i === 1 ? (hostName ?? "Host computer") : undefined) : undefined}>
          {g.map((s) => (
            <Row
              key={s.id}
              Icon={s.Icon}
              tile={s.tile}
              title={s.title}
              value={s.value}
              selected={selected === s.id}
              trailing={s.badge ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-caption-2 text-on-color">1</span> : undefined}
              chevron
              onClick={() => onOpen(s)}
            />
          ))}
        </List>
      ))}
    </div>
  );
}

/** Settings of this device and of the computer the agents run on (also from a remote). */
export function SettingsPage() {
  return useLayoutMode() === "phone" ? <PhoneSettings /> : <DesktopSettings />;
}

function PhoneSettings() {
  const groups = useSections();
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
  return (
    <SettingsNavCtx.Provider value={nav}>
      <Stack
        stack={stack}
        root={
          <Page title="Settings">
            <div className="pb-8">
              <SectionRows groups={groups} onOpen={open} />
            </div>
          </Page>
        }
      />
    </SettingsNavCtx.Provider>
  );
}

function DesktopSettings() {
  const groups = useSections();
  const all = groups.flat();
  const [id, setId] = useState("appearance");
  const [detail, setDetail] = useState<{ key: string; title: string; node: ReactNode } | null>(null);
  const section = all.find((s) => s.id === id) ?? all[0]!;
  const nav: SettingsNav = { push: (key, title, node) => setDetail({ key, title, node }) };
  const open = (s: SectionDef) => {
    if (s.action) return s.action();
    setId(s.id);
    setDetail(null);
  };
  return (
    <SettingsNavCtx.Provider value={nav}>
      <div className="flex h-full min-h-0" style={{ paddingLeft: "var(--sidebar-space, 0px)" }}>
        <aside className="scroller h-full w-80 shrink-0 border-r-hair border-line px-4 pb-8" style={{ paddingTop: "calc(var(--safe-top) + 64px)" }}>
          <h1 className="mb-6 px-2 text-large-title text-bright">Settings</h1>
          <SectionRows groups={groups} onOpen={open} selected={id} />
        </aside>
        {/* Pages here lay out as if there were no sidebar: the column already clears it. */}
        <div className={cn("relative min-w-0 flex-1")} style={{ ["--sidebar-space" as string]: "0px" }}>
          {section.own ? (
            <NavBackProvider value={null}>{section.render!()}</NavBackProvider>
          ) : detail ? (
            <Page key={detail.key} title={detail.title} backLabel={section.title} onBack={() => setDetail(null)}>
              <div className="max-w-2xl pb-8">{detail.node}</div>
            </Page>
          ) : (
            <Page key={section.id} title={section.title}>
              <div className="max-w-2xl pb-8">{section.render!()}</div>
            </Page>
          )}
        </div>
      </div>
    </SettingsNavCtx.Provider>
  );
}
