// Phones: one agent at a time, full screen, under the Island ("Two Drops", PLAN C1).
//
// The Island (packages/ui layout/Island) is the only chrome: back (with a dot when another agent
// needs you), the agent's live mark, its title and "project · status". Tap it for the panel
// (project + branch, the project's agents with the ones that need you first, Chat/Terminal per
// agent, stop / restart / rename / changes / copy id / close); swipe it sideways for the
// previous / next agent. It shrinks while you scroll down and hides while the keyboard is open.
// The body is the Claude chat (ClaudeView) or the terminal with its key bar.
//
// `PhoneAgentScreen` (C1): one session, for the phone router (I5). Never writes `layout_set`.
// (Phones never show the workspace layout; the desktop keeps its panes.)
import type { AgentStatus, Session } from "@neuralagent/protocol";
import {
  ConfirmSheet,
  cn,
  Input,
  Island,
  IslandPanel,
  Row,
  neighbour,
  Spinner,
  toast,
  useHideOnScroll,
  useKeyboard,
  type MenuEntry,
} from "@neuralagent/ui";
import { Copy, Download, GitBranch, GitCompare, Globe, Pencil, Plus, RotateCw, Square, TextSelect, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { copyWithToast } from "../../lib/clipboard";
import { activityOf, STATUS } from "../../lib/status";
import { useCatalogSheet, useChanges, useClient, useDaemon, useUi } from "../../lib/store";
import { ClaudeView } from "../claude/ClaudeView";
import { EngineTile, QuietTile, tileGlyph } from "../EngineTile";
import { KeyBar } from "../KeyBar";
import { showTerminalText } from "../TerminalText";
import { TerminalView } from "../TerminalView";
import { ClaudeViewSwitch, useAgentChat } from "./ClaudeViewSwitch";
import { IslandOverrideContext, type IslandOverride } from "./islandOverride";
import { NewAgentSheet } from "./NewAgentSheet";

/** Statuses that need you: listed first, and they light the back dot. */
const NEEDS_YOU: AgentStatus[] = ["waiting", "error"];
const needsYou = (s: Session | undefined) => !!s && s.alive && NEEDS_YOU.includes(s.status);

/** One agent in the panel / swipe order. */
interface AgentEntry {
  key: string;
  sid: string | null;
  title: string;
  engine: string;
  status?: AgentStatus;
  claude: boolean;
  browser?: boolean;
  open: () => void;
}

// ───────────────────────────── PhoneAgentScreen (C1) ─────────────────────────────

export function PhoneAgentScreen({ sessionId, onBack, onOpenAgent, backLabel = "Agents", onNewAgent, fallback }: {
  sessionId: string;
  onBack: () => void;
  onOpenAgent: (sid: string) => void;
  /** Where back goes (screen readers): "Agents", a project's name. */
  backLabel?: string;
  /** "New agent" in the panel; without it the panel opens the new-agent sheet itself. */
  onNewAgent?: (workspaceId: string) => void;
  /** What this device remembers of the agent (a notification opens it before the state is in):
   *  shown with "Connecting…" until the session is known, instead of "gone". */
  fallback?: { title: string; project?: string };
}) {
  const session = useDaemon((c) => c.state?.sessions[sessionId]);
  const ready = useDaemon((c) => !!c.state && c.status === "open");
  // A just-started agent can be a moment ahead of the state: wait briefly before "gone".
  const [patient, setPatient] = useState(true);
  useEffect(() => {
    if (session || !ready) return;
    const t = setTimeout(() => setPatient(false), 2500);
    return () => clearTimeout(t);
  }, [session, ready]);
  const waiting = !session && (!ready || patient);
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  const workspaceId = session?.workspace_id ?? "";
  const engineOf = (s: Session) => profiles?.find((p) => p.id === s.profile_id)?.engine ?? "shell";
  const isClaude = !!session && engineOf(session) === "claude";
  const chat = useAgentChat(sessionId, true) && isClaude;
  const [adding, setAdding] = useState(false);

  // The project's agents, oldest first: a stable order to swipe through.
  const agents: AgentEntry[] = useMemo(
    () =>
      Object.values(sessions ?? {})
        .filter((s) => s.workspace_id === workspaceId)
        .sort((a, b) => a.started_at - b.started_at)
        .map((s) => ({ key: s.id, sid: s.id, title: s.title, engine: engineOf(s), status: s.status, claude: engineOf(s) === "claude", open: () => onOpenAgent(s.id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, profiles, workspaceId, onOpenAgent],
  );
  const otherNeedsYou = Object.values(sessions ?? {}).some((s) => s.id !== sessionId && needsYou(s));
  const actions = useSessionActions(session, workspaceId, { chat, onClosed: onBack });

  return (
    <AgentFrame
      chat={chat}
      title={session?.title ?? fallback?.title ?? "Agent"}
      engine={session ? engineOf(session) : "shell"}
      status={session?.status}
      workspaceId={workspaceId}
      project={fallback?.project}
      backLabel={backLabel}
      onBack={onBack}
      backDot={otherNeedsYou}
      agents={agents}
      currentKey={sessionId}
      actions={actions.items}
      renaming={actions.renaming}
      onNewAgent={() => (onNewAgent ? onNewAgent(workspaceId) : setAdding(true))}
      after={
        <>
          {actions.confirm}
          {!onNewAgent && workspaceId && <NewAgentSheet open={adding} onClose={() => setAdding(false)} workspaceId={workspaceId} />}
        </>
      }
    >
      {!session ? (
        waiting ? <Connecting /> : <Gone onBack={onBack} />
      ) : chat ? (
        <ClaudeView session={session} webgl onFocus={noop} />
      ) : (
        <TerminalBody session={session} />
      )}
    </AgentFrame>
  );
}

const noop = () => {};

function TerminalBody({ session }: { session: Session }) {
  const client = useClient();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 px-1">
        <TerminalView sid={session.id} focused startedAt={session.started_at} webgl touch onFocus={noop} />
        {!session.alive && <Stopped session={session} onRestart={() => void restart(client, session.id)} />}
      </div>
      {session.alive && <KeyBar sid={session.id} />}
    </div>
  );
}

function Stopped({ session, onRestart }: { session: Session; onRestart: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
      <button type="button" onClick={onRestart} className="material pressable pointer-events-auto flex h-11 items-center gap-2 rounded-full pr-4 pl-4 text-subhead text-ink shadow-float">
        <span>{session.exit_code ? `Exited with code ${session.exit_code}` : "The agent has stopped"}</span>
        <span className="flex items-center gap-1 text-accent">
          <RotateCw size={15} strokeWidth={2} /> Restart
        </span>
      </button>
    </div>
  );
}

function Connecting() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-footnote text-dim" role="status">
      <Spinner size={14} />
      Connecting…
    </div>
  );
}

function Gone({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-headline text-bright">This agent is gone</p>
        <p className="text-subhead text-dim">It was closed on the computer.</p>
        <button type="button" onClick={onBack} className="pressable mt-2 h-11 rounded-full bg-fill-2 px-5 text-subhead text-ink">
          Back
        </button>
      </div>
    </div>
  );
}

const restart = (client: ReturnType<typeof useClient>, id: string) =>
  client.req({ m: "session_restart", p: { id } }).catch((e) => toast((e as Error).message, { tone: "danger" }));

/** What you can do with one session from its Island panel. Rename is inline (`renaming`). */
function useSessionActions(session: Session | undefined, workspaceId: string, { chat, onClosed, close, preview }: {
  chat: boolean;
  /** Open the preview in the app (a layout pane); default: the browser. */
  preview?: (url: string) => void;
  /** After "Close" closed the session (the agent screen goes back). */
  onClosed?: () => void;
  /** Close in another way (the workspace layout closes the pane, which closes the session). */
  close?: () => void;
}) {
  const client = useClient();
  const showChanges = useChanges((c) => c.show);
  const [asking, setAsking] = useState(false);
  const [rename, setRename] = useState(false);
  const fail = (e: unknown) => toast((e as Error).message, { tone: "danger" });
  const doClose = async () => {
    if (!session) return;
    if (close) return close();
    await client.req({ m: "session_close", p: { id: session.id } }).catch(fail);
    onClosed?.();
  };
  const items: MenuEntry[] = [];
  if (session) {
    if (session.alive) items.push({ label: "Stop", detail: "Ends the agent, keeps its screen", Icon: Square, onSelect: () => void client.req({ m: "session_stop", p: { id: session.id } }).catch(fail) });
    items.push({ label: "Restart", Icon: RotateCw, onSelect: () => void restart(client, session.id) });
    items.push({ label: "Rename", Icon: Pencil, onSelect: () => setRename(true) });
    if (session.worktree) items.push({ label: "Review worktree changes", detail: session.worktree.branch, Icon: GitBranch, onSelect: () => showChanges(workspaceId, session.id) });
    if (session.preview_url) items.push({ label: "Open the preview", detail: session.preview_url.replace(/^https?:\/\//, ""), Icon: Globe, onSelect: () => (preview ? preview(session.preview_url!) : void window.open(session.preview_url!, "_blank")) });
    if (!chat) items.push({ label: "Select and copy text", Icon: TextSelect, onSelect: () => showTerminalText(session.id) });
    const id = session.engine_session ?? session.id;
    items.push({
      label: "Copy session id",
      detail: id,
      Icon: Copy,
      onSelect: () => void copyWithToast(id, undefined, "Session id copied"),
    });
    items.push({ label: session.alive ? "Stop and close" : "Close", Icon: X, destructive: true, divider: true, onSelect: () => (session.alive ? setAsking(true) : void doClose()) });
  }
  const renaming = session && rename ? { value: session.title, done: (title?: string) => {
    setRename(false);
    const t = title?.trim();
    if (t && t !== session.title) void client.req({ m: "session_rename", p: { id: session.id, title: t } }).catch(fail);
  } } : null;
  const confirm = (
    <ConfirmSheet
      open={asking}
      onClose={() => setAsking(false)}
      onConfirm={doClose}
      title={`Stop ${session?.title ?? "this agent"}?`}
      message="The agent stops and closes."
      confirmLabel="Stop and close"
      destructive
    />
  );
  return { items, renaming, confirm };
}

// ───────────────────────────── Frame + Island + panel ─────────────────────────────

function AgentFrame({ chat, title, engine, browser, status, workspaceId, project, backLabel, onBack, backDot, agents, currentKey, actions, renaming, onNewAgent, after, children }: {
  /** The body is the Claude chat: it scrolls under the Island (`.cv-scroll` padding); anything else starts below it. */
  chat: boolean;
  title: string;
  engine: string;
  browser?: boolean;
  status?: AgentStatus;
  workspaceId: string;
  /** Project name before the state knows the workspace. */
  project?: string;
  backLabel?: string;
  onBack?: () => void;
  backDot: boolean;
  agents: AgentEntry[];
  currentKey?: string;
  actions: MenuEntry[];
  renaming: { value: string; done: (title?: string) => void } | null;
  onNewAgent: () => void;
  after: ReactNode;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const kb = useKeyboard();
  const minimised = useHideOnScroll(frame, { disabled: kb.open });
  const [open, setOpen] = useState(false);
  // A layer in the body (the subagent view) can take over the Island: its title, breadcrumb, back.
  const [layer, setLayer] = useState<IslandOverride | null>(null);
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === workspaceId));
  const act = status ? activityOf([status].filter((s) => s !== "done")) : undefined;
  const keys = agents.map((a) => a.key);
  const swipe = (dir: -1 | 1) => {
    const next = currentKey ? neighbour(keys, currentKey, dir) : null;
    if (next) agents.find((a) => a.key === next)?.open();
  };
  const subtitle = [ws?.name ?? project, status ? STATUS[status].label : browser ? "Preview" : undefined].filter(Boolean).join(" · ");
  const style = {
    paddingTop: "var(--safe-top)",
    // Above an overlaid keyboard (iOS), and clear of the Dock wherever the router still shows it.
    paddingBottom: "max(var(--kb-inset, 0px), var(--dock-h, 0px))",
    // Room the Island takes over the body; the keyboard hides it and gives the room back.
    "--island-space": kb.open ? "0px" : "calc(var(--spacing-island) + 12px)",
  } as CSSProperties;
  return (
    <div ref={frame} data-island-frame className={cn("relative flex h-full min-h-0 flex-col transition-colors duration-300", chat ? "bg-cv-bg" : "bg-bg")} style={style}>
      {/* The Island stays put while a layer is pushed; only its words and its back change. */}
      <Island
        tone={chat ? "cv" : "app"}
        title={layer?.title ?? title}
        subtitle={layer ? layer.subtitle : subtitle || undefined}
        mark={
          browser ? (
            <QuietTile size="chip" round>
              <Globe size={tileGlyph("chip")} strokeWidth={1.6} />
            </QuietTile>
          ) : (
            <EngineTile engine={engine} size="chip" round activity={act} edge={chat ? "ring-cv-surface" : "ring-popover"} />
          )
        }
        onBack={layer ? layer.onBack : onBack}
        backLabel={layer ? layer.backLabel : backLabel}
        backDot={backDot}
        open={open}
        onOpen={() => setOpen(true)}
        onSwipe={agents.length > 1 && !layer ? swipe : undefined}
        minimised={minimised}
        hidden={kb.open}
      />
      <div className="relative min-h-0 flex-1" style={chat ? undefined : { paddingTop: "var(--island-space)" }}>
        <IslandOverrideContext.Provider value={setLayer}>{children}</IslandOverrideContext.Provider>
      </div>
      <IslandPanel open={open} onClose={() => setOpen(false)} label={`${title}: agents and actions`}>
        <AgentPanel
          workspaceId={workspaceId}
          agents={agents}
          currentKey={currentKey}
          actions={actions}
          renaming={renaming}
          onClose={() => setOpen(false)}
          onNewAgent={onNewAgent}
        />
      </IslandPanel>
      {after}
    </div>
  );
}

function AgentPanel({ workspaceId, agents, currentKey, actions, renaming, onClose, onNewAgent }: {
  workspaceId: string;
  agents: AgentEntry[];
  currentKey?: string;
  actions: MenuEntry[];
  renaming: { value: string; done: (title?: string) => void } | null;
  onClose: () => void;
  onNewAgent: () => void;
}) {
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === workspaceId));
  const showChanges = useChanges((c) => c.show);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const { worktrees, setWorktrees } = useUi();
  const git = ws?.git;
  // The ones that need you first; otherwise the swipe order.
  const listed = [...agents].sort((a, b) => Number(NEEDS_YOU.includes(b.status!)) - Number(NEEDS_YOU.includes(a.status!)));
  const pick = (f: () => void) => () => {
    onClose();
    f();
  };
  return (
    <div className="flex flex-col gap-1 pt-2">
      <Row
        Icon={git ? GitCompare : undefined}
        title={ws?.name ?? "Project"}
        detail={git ? `${git.branch}${git.changed ? ` · ${git.changed === 1 ? "1 file" : `${git.changed} files`} changed` : ""}` : undefined}
        onClick={git ? pick(() => showChanges(workspaceId)) : undefined}
      />
      <Section label="Agents">
        {listed.map((a) => (
          <AgentRow key={a.key} entry={a} current={a.key === currentKey} onPick={pick(a.open)} />
        ))}
        <Row Icon={Plus} title="New agent" onClick={pick(onNewAgent)} chevron={false} />
      </Section>
      {(actions.length > 0 || renaming) && (
        <Section label="This agent">
          {renaming ? <RenameRow value={renaming.value} done={renaming.done} /> : null}
          {actions
            .filter((i) => !renaming || i.label !== "Rename")
            .map((i) => (
              <Row
                key={i.label}
                Icon={i.Icon}
                title={i.label}
                detail={i.detail}
                danger={i.destructive}
                chevron={false}
                onClick={i.label === "Rename" ? i.onSelect : pick(i.onSelect!)}
              />
            ))}
        </Section>
      )}
      <Section label="Project">
        {git && <Row Icon={GitBranch} title="Own worktree per agent" value={worktrees ? "On" : "Off"} chevron={false} onClick={() => setWorktrees(!worktrees)} />}
        <Row Icon={Download} title="Install agents…" onClick={pick(() => openCatalog(true))} />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pt-2">
      <h3 className="px-4 pb-1 text-footnote text-dim">{label}</h3>
      <div className="list-rows">{children}</div>
    </section>
  );
}

function AgentRow({ entry, current, onPick }: { entry: AgentEntry; current: boolean; onPick: () => void }) {
  const act = entry.status ? activityOf([entry.status].filter((s) => !(current && s === "done"))) : undefined;
  return (
    <div className={cn("flex items-center pr-3", current && "bg-fill-2")} aria-current={current || undefined}>
      <button type="button" onClick={onPick} className="press-row flex min-h-row-2 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left">
        {entry.browser ? (
          <QuietTile size="md" round>
            <Globe size={tileGlyph("md")} strokeWidth={1.6} />
          </QuietTile>
        ) : (
          <EngineTile engine={entry.engine} size="md" round activity={act} edge="ring-popover" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body text-bright">{entry.title}</span>
          <span className={cn("truncate text-footnote", entry.status && NEEDS_YOU.includes(entry.status) ? "text-warning" : "text-dim")}>
            {entry.status ? STATUS[entry.status].label : entry.browser ? "Preview" : "New agent"}
          </span>
        </span>
      </button>
      {entry.claude && entry.sid && <ClaudeViewSwitch sid={entry.sid} />}
    </div>
  );
}

function RenameRow({ value, done }: { value: string; done: (title?: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <form
      className="flex items-center gap-2 px-4 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        done(text);
      }}
    >
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), done())}
        aria-label="Agent name"
        enterKeyHint="done"
        className="min-w-0 flex-1"
      />
      <button type="submit" className="pressable h-10 rounded-full bg-accent px-4 text-subhead text-bg">
        Save
      </button>
    </form>
  );
}
