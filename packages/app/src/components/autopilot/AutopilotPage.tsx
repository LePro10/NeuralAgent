// Autopilot (D87): one project agent per workspace. Empty state with a project picker, then the
// pilot: project switcher, status line, on/off, Run now, and the tabs Inbox / Chat / Instructions.
// Desktop keeps connectors in a local view; phones push them as pages of the phone router.
import type { Pilot, Workspace } from "@neuralagent/protocol";
import { Button, Empty, IconButton, Menu, Page, Segmented, Shimmer, Switch, useLayoutMode, ConfirmSheet, Sheet, Input, Field } from "@neuralagent/ui";
import { ChevronDown, Ellipsis, Folder, Pencil, Play, Plane, Plug, Plus, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pilotAttention, statusLine, workspacesWithoutPilot } from "../../lib/autopilot";
import { useNow } from "../../lib/agentui";
import { phoneRouter } from "../../lib/phoneRoute";
import { useDaemon } from "../../lib/store";
import { Glow } from "../Glow";
import { ErrorNotice } from "./ErrorNotice";
import { Chat, ChatComposer } from "./Chat";
import { ConnectorDetail } from "./ConnectorDetail";
import { ConnectorsPage } from "./ConnectorsPage";
import { Inbox } from "./Inbox";
import { Instructions } from "./Instructions";
import { useApDo, useAutopilot, usePilotUi, useShownPilot, type PilotTab } from "./hooks";

/** Desktop view inside the Autopilot page. */
type View = { k: "pilot" } | { k: "connectors" } | { k: "connector"; id: string };

export function AutopilotPage() {
  const phone = useLayoutMode() === "phone";
  const [view, setView] = useState<View>({ k: "pilot" });
  const want = usePilotUi((s) => s.wantConnectors);
  useEffect(() => {
    if (!want) return;
    usePilotUi.getState().askConnectors(false);
    if (phone) phoneRouter().push({ k: "connectors" });
    else setView({ k: "connectors" });
  }, [want, phone]);
  const openConnectors = () => (phone ? phoneRouter().push({ k: "connectors" }) : setView({ k: "connectors" }));
  const openConnector = (id: string) => (phone ? phoneRouter().push({ k: "connector", id }) : setView({ k: "connector", id }));
  if (!phone && view.k === "connectors") return <ConnectorsPage onOpen={openConnector} back={{ label: "Autopilot", onBack: () => setView({ k: "pilot" }) }} />;
  if (!phone && view.k === "connector") return <ConnectorDetail id={view.id} onGone={() => setView({ k: "connectors" })} back={{ label: "Connectors", onBack: () => setView({ k: "connectors" }) }} />;
  return <PilotScreen onConnectors={openConnectors} onOpenConnector={openConnector} />;
}

export function PhoneConnectors() {
  return <ConnectorsPage onOpen={(id) => phoneRouter().push({ k: "connector", id })} />;
}
export function PhoneConnector({ id }: { id: string }) {
  return <ConnectorDetail id={id} onGone={() => phoneRouter().back()} />;
}

function PilotScreen({ onConnectors, onOpenConnector }: { onConnectors: () => void; onOpenConnector: (id: string) => void }) {
  const state = useAutopilot();
  const loaded = useDaemon((c) => !!c.state);
  const pilot = useShownPilot();
  const phone = useLayoutMode() === "phone";
  const connectorsButton = phone ? (
    <IconButton label="Connectors" variant="glass" onClick={onConnectors}>
      <Plug />
    </IconButton>
  ) : (
    <Button size="sm" variant="ghost" Icon={Plug} onClick={onConnectors} className="rounded-full">
      Connectors
    </Button>
  );
  if (!loaded) return null;
  return (
    <div className="relative h-full">
      <Glow tint="autopilot" />
      {pilot ? (
        <PilotView pilot={pilot} actions={connectorsButton} onConnectors={onConnectors} onOpenConnector={onOpenConnector} />
      ) : (
        <Page title="Autopilot" eyebrow="Project agent" actions={connectorsButton}>
          <Start pilots={state.pilots.length} />
        </Page>
      )}
    </div>
  );
}

/** No pilot yet: one calm explanation, a project to look after, one button. */
function Start({ pilots }: { pilots: number }) {
  const workspaces = useDaemon((c) => c.state?.workspaces ?? []);
  const free = workspacesWithoutPilot(workspaces, useAutopilot().pilots);
  return (
    <div className="pt-4">
      <Empty
        Icon={Plane}
        title="An autopilot looks after a project"
        detail="It reads your sources, sorts what comes in, lets agents fix things and drafts answers. You decide what it may do."
        action={<Picker workspaces={free} all={workspaces.length} existing={pilots} />}
      />
    </div>
  );
}

function Picker({ workspaces, all, existing }: { workspaces: Workspace[]; all: number; existing: number }) {
  const run = useApDo();
  const setPilot = usePilotUi((s) => s.setPilot);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = workspaces.find((w) => w.id === pick) ?? workspaces[0];
  if (all === 0) return <p className="max-w-xs text-footnote text-dim">Add a project first (a workspace in the sidebar), then come back.</p>;
  if (!chosen) return <p className="max-w-xs text-footnote text-dim">{existing > 0 ? "Every project already has an autopilot." : "No project to look after yet."}</p>;
  const create = async () => {
    setBusy(true);
    const p = await run<Pilot | undefined>({ op: "pilot_create", workspace_id: chosen.id });
    setBusy(false);
    // The setup interview starts in Chat.
    if (p !== undefined) setPilot(p && typeof p === "object" && "id" in p ? p.id : null, "chat");
  };
  return (
    <div className="flex flex-col items-center gap-3">
      {workspaces.length > 1 ? (
        <Menu
          title="Which project?"
          align="start"
          items={workspaces.map((w) => ({ label: w.name, checked: w.id === chosen.id, kind: "radio" as const, onSelect: () => setPick(w.id) }))}
          trigger={(show) => (
            <Button variant="ghost" Icon={Folder} IconEnd={ChevronDown} onClick={show} className="rounded-full">
              {chosen.name}
            </Button>
          )}
        />
      ) : (
        <div className="flex items-center gap-2 text-subhead text-ink">
          <Folder className="size-icon-sm text-dim" /> {chosen.name}
        </div>
      )}
      <Button variant="accent" Icon={Plane} busy={busy} onClick={() => void create()} className="rounded-full">
        Set up autopilot
      </Button>
    </div>
  );
}

const TABS: { value: PilotTab; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "chat", label: "Chat" },
  { value: "instructions", label: "Instructions" },
];

function PilotView({ pilot, actions, onConnectors, onOpenConnector }: { pilot: Pilot; actions: React.ReactNode; onConnectors: () => void; onOpenConnector: (id: string) => void }) {
  const state = useAutopilot();
  const run = useApDo();
  const tab = usePilotUi((s) => s.tab);
  const setTab = usePilotUi((s) => s.setTab);
  const now = useNow(30000);
  const workspaces = useDaemon((c) => c.state?.workspaces ?? []);
  const project = workspaces.find((w) => w.id === pilot.workspace_id);
  const attention = pilotAttention(state, pilot.id);
  const scroll = useRef<HTMLDivElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const working = pilot.status === "working";
  const line = statusLine(pilot, now);

  const free = workspacesWithoutPilot(workspaces, state.pilots);
  const switcher = (
    <Menu
      title="Projects"
      align="start"
      width={260}
      items={[
        ...state.pilots.map((p) => ({
          label: workspaces.find((w) => w.id === p.workspace_id)?.name ?? p.name,
          checked: p.id === pilot.id,
          kind: "radio" as const,
          detail: pilotAttention(state, p.id) ? `${pilotAttention(state, p.id)} need you` : undefined,
          onSelect: () => usePilotUi.getState().setPilot(p.id),
        })),
        ...free.map((w, i) => ({
          label: `Add ${w.name}`,
          Icon: Plus,
          divider: i === 0,
          onSelect: () => void run<Pilot | undefined>({ op: "pilot_create", workspace_id: w.id }).then((p) => p !== undefined && usePilotUi.getState().setPilot(p && typeof p === "object" && "id" in p ? p.id : null, "chat")),
        })),
      ]}
      trigger={(show) => (
        <button type="button" onClick={show} className="pressable flex min-w-0 items-center gap-1.5 rounded-full bg-fill-2 py-1 pr-2 pl-3 text-subhead text-bright shadow-edge" aria-label="Switch project">
          <Folder className="size-icon-sm shrink-0 text-dim" />
          <span className="truncate">{project?.name ?? pilot.name}</span>
          {(state.pilots.length > 1 || free.length > 0) && <ChevronDown className="size-icon-sm shrink-0 text-dim" />}
        </button>
      )}
    />
  );

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {switcher}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-footnote text-dim">
          <span aria-hidden className={"size-1.5 shrink-0 rounded-full " + (pilot.status === "error" ? "bg-danger" : pilot.status === "needs_you" ? "bg-accent" : working ? "activity-pulse bg-accent" : pilot.enabled ? "bg-success" : "bg-faint")} />
          {working ? <Shimmer className="truncate">{line}</Shimmer> : <span className="line-clamp-2">{line}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch checked={pilot.enabled} onChange={(v) => void run({ op: "pilot_update", id: pilot.id, enabled: v })} label={pilot.enabled ? "Autopilot on" : "Autopilot off"} />
          {working ? (
            <Button size="sm" variant="ghost" Icon={Square} onClick={() => void run({ op: "pilot_stop", id: pilot.id })} className="rounded-full">
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="ghost" Icon={Play} disabled={!pilot.enabled} onClick={() => void run({ op: "pilot_run", id: pilot.id }, "Looking now")} className="rounded-full">
              Run now
            </Button>
          )}
          <Menu
            title="Autopilot"
            items={[
              { label: "Rename", Icon: Pencil, onSelect: () => setRenaming(true) },
              { label: "Remove autopilot…", Icon: Trash2, destructive: true, divider: true, onSelect: () => setRemoving(true) },
            ]}
            trigger={(show) => (
              <IconButton label="Autopilot options" variant="ghost" onClick={show}>
                <Ellipsis />
              </IconButton>
            )}
          />
        </div>
      </div>
      {pilot.status === "error" && <ErrorNotice pilot={pilot} onOpenConnector={onOpenConnector} />}
      <Segmented
        className="w-full"
        label="Autopilot sections"
        value={tab}
        onChange={setTab}
        options={TABS.map((t) => ({ value: t.value, label: t.value === "inbox" && attention > 0 ? `Inbox · ${attention}` : t.label }))}
      />
    </div>
  );

  return (
    <>
      <Page title="Autopilot" eyebrow={project ? undefined : "Project agent"} actions={actions} header={header} scrollRef={scroll}>
        <div className="pt-3">
          {tab === "inbox" && <Inbox pilot={pilot} onChat={() => setTab("chat")} onConnectors={onConnectors} />}
          {tab === "chat" && <Chat pilot={pilot} scroller={scroll} onOpenConnector={onOpenConnector} />}
          {tab === "instructions" && <Instructions pilot={pilot} onConnectors={onConnectors} />}
        </div>
      </Page>
      {tab === "chat" && <ChatComposer pilot={pilot} />}
      <RenameSheet open={renaming} onClose={() => setRenaming(false)} pilot={pilot} />
      <ConfirmSheet
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove this autopilot?"
        message="Its inbox, chat and instructions are deleted. The project, its agents and your connectors stay."
        confirmLabel="Remove"
        destructive
        Icon={Trash2}
        onConfirm={async () => {
          await run({ op: "pilot_remove", id: pilot.id });
          usePilotUi.getState().setPilot(null);
        }}
      />
    </>
  );
}

function RenameSheet({ open, onClose, pilot }: { open: boolean; onClose: () => void; pilot: Pilot }) {
  const run = useApDo();
  const [name, setName] = useState(pilot.name);
  useEffect(() => {
    if (open) setName(pilot.name);
  }, [open, pilot.name]);
  const done = async () => {
    if (name.trim() && name.trim() !== pilot.name) await run({ op: "pilot_update", id: pilot.id, name: name.trim() });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Rename" size="sm">
      <div className="flex flex-col gap-4 pb-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void done()} />
        </Field>
        <Button variant="accent" size="lg" block disabled={!name.trim()} onClick={() => void done()}>
          Done
        </Button>
      </div>
    </Sheet>
  );
}

