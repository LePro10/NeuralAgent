import type { OrchMessage, Session, Swarm } from "@neuralagent/protocol";
import {
  AssistantMessage,
  AssistantOrb,
  Button,
  Composer,
  ConfirmSheet,
  EmptyChatHero,
  IconButton,
  IconTile,
  Menu,
  Shimmer,
  StreamingText,
  SuggestionGrid,
  ThinkingIndicator,
  UserBubble,
  cn,
  toast,
  useKeyboardInset,
  useKeyboardOpen,
  usePortalTarget,
  type Activity,
  type ComposerHandle,
  type Suggestion,
} from "@neuralagent/ui";
import { Activity as ActivityIcon, Bell, Check, ChevronRight, Ellipsis, Eraser, KeyRound, Phone, Play, Settings2, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { startCall } from "../lib/call";
import { frontTabFor } from "../lib/layout";
import { NOTICE, byDay, clock, plainText, shortAgo, useNow } from "../lib/agentui";
import { activityOf } from "../lib/status";
import { useClient, useDaemon, useUi } from "../lib/store";
import { CallScreen } from "./CallScreen";
import { EngineTile } from "./EngineTile";
import { Glow } from "./Glow";

/** Content fades under the header and above the composer instead of being cut. */
const EDGE_Y: CSSProperties = { maskImage: "linear-gradient(180deg, transparent, black 14px, black calc(100% - 14px), transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 14px, black calc(100% - 14px), transparent)" };

const SUGGESTIONS: Suggestion[] = [
  { title: "What are my agents doing?", Icon: ActivityIcon, prompt: "What are my agents doing right now?" },
  { title: "Start an agent", detail: "in one of your workspaces", Icon: Play, prompt: "Start an agent in " },
];

const KIND: Record<string, { activity: Activity; word: string; tone: string }> = {
  finished: { activity: "done", word: "Finished", tone: "text-ember" },
  "needs input": { activity: "waiting", word: "Needs input", tone: "text-accent" },
  "stopped with an error": { activity: "error", word: "Error", tone: "text-danger" },
};

/**
 * Neural, the orchestrator: one conversation shared by the desktop, the browser and the phone.
 * On phones this is the home screen: who Neural is, what your agents told it (grouped by day,
 * one tap opens the agent), the live agents, and the composer.
 */
export function NeuralPage({ onSettings }: { onSettings?: () => void }) {
  const client = useClient();
  const orch = useDaemon((c) => c.state?.orchestrator);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [clearing, setClearing] = useState(false);
  const messages = orch?.messages ?? [];
  const last = messages.at(-1);
  // Keyboard: Android resizes the page (the tab bar hides); iOS overlays it (lift by its height).
  const kbOpen = useKeyboardOpen();
  const kb = useKeyboardInset(usePortalTarget());

  // Follow the conversation while it grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, last?.text.length]);

  if (!orch) return null;
  const send = (text: string) => {
    client.req({ m: "orch_send", p: { text } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
  };
  const empty = messages.length === 0;
  const waitingForWords = orch.busy && (!last || last.role !== "assistant" || last.text === "");
  const bottom = kb ? `${kb.bottom + 8}px` : kbOpen ? "calc(var(--safe-bottom) + 8px)" : "calc(var(--tabbar-space) + 4px)";

  return (
    <div className="relative flex h-full min-h-0 flex-col" style={{ paddingLeft: "var(--sidebar-space)", paddingTop: "var(--safe-top)", paddingBottom: bottom }}>
      <Glow />
      <Header ready={orch.ready} busy={orch.busy} empty={empty} onSettings={onSettings} onClear={() => setClearing(true)} />

      <div ref={scroller} className="scroller relative min-h-0 flex-1 overflow-y-auto px-4" style={EDGE_Y}>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-2 pb-6">
          {!orch.ready && <ModelCallout onSettings={onSettings} />}
          {empty ? (
            <div className="flex flex-col items-center gap-6 pt-8">
              <EmptyChatHero greeting="What should your agents do" visual="orb" />
              <SuggestionGrid
                items={SUGGESTIONS}
                layout="rail"
                onPick={(s) => {
                  if (s.prompt?.endsWith(" ")) {
                    composer.current?.setText(s.prompt);
                    composer.current?.focus();
                  } else if (s.prompt) send(s.prompt);
                }}
              />
            </div>
          ) : (
            <Feed messages={messages} busy={orch.busy} />
          )}
          {waitingForWords && <ThinkingIndicator variant="dots" label="Neural is thinking" />}
        </div>
      </div>

      {!kbOpen && !kb && <LiveAgents />}

      <div className="relative shrink-0 px-4 pt-2">
        <div className="mx-auto w-full max-w-2xl">
          <Composer
            ref={composer}
            onSend={(t) => {
              if (!t.trim()) return false;
              send(t);
            }}
            placeholder={orch.ready ? "Ask Neural…" : "Neural needs a model first"}
            busy={orch.busy}
            onStop={() => client.req({ m: "orch_stop" }).catch(() => {})}
            onVoice={orch.ready ? () => void startCall(client) : undefined}
            disabled={!orch.ready}
            attachments={false}
            dictation={false}
            compact
          />
        </div>
      </div>

      <CallScreen />
      <ConfirmSheet
        open={clearing}
        onClose={() => setClearing(false)}
        title="Clear the conversation?"
        message="Neural forgets what was said here. Your agents keep running."
        confirmLabel="Clear"
        destructive
        Icon={Eraser}
        onConfirm={() => client.req({ m: "orch_clear" }).then(() => {}, () => {})}
      />
    </div>
  );
}

function Header({ ready, busy, empty, onSettings, onClear }: { ready: boolean; busy: boolean; empty: boolean; onSettings?: () => void; onClear: () => void }) {
  const client = useClient();
  const sessions = useDaemon((c) => c.state?.sessions);
  const live = Object.values(sessions ?? {}).filter((s) => s?.alive && !s.profile_id.startsWith("install:") && s.profile_id !== "shell").length;
  const status = !ready ? "Needs a model" : busy ? "Working…" : live > 0 ? `Watching ${live} ${live === 1 ? "agent" : "agents"}` : "Your agents’ orchestrator";
  const items = [
    ...(onSettings ? [{ label: "Neural settings", Icon: Settings2, onSelect: onSettings }] : []),
    ...(!empty ? [{ label: "Clear conversation", Icon: Eraser, destructive: true, divider: !!onSettings, onSelect: onClear }] : []),
  ];
  return (
    <header className="relative flex shrink-0 items-center gap-3 px-4 pt-2 pb-3" data-tauri-drag-region>
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
        <span className="relative grid shrink-0 place-items-center">
          <span aria-hidden="true" className="absolute size-16 rounded-full bg-accent/20 blur-xl" />
          <AssistantOrb size={44} state={busy ? "busy" : "idle"} label="Neural" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-title-2 text-bright">Neural</h1>
          <div className="flex items-center gap-1.5 text-footnote text-dim">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", !ready ? "bg-warning" : busy ? "activity-pulse bg-accent" : "bg-success")} />
            {busy ? <Shimmer className="truncate">{status}</Shimmer> : <span className="truncate">{status}</span>}
          </div>
        </div>
        {ready && (
          <Button variant="accent" size="sm" Icon={Phone} onClick={() => void startCall(client)} className="rounded-full">
            Call
          </Button>
        )}
        {items.length > 0 && (
          <Menu
            title="Neural"
            items={items}
            trigger={(show) => (
              <IconButton label="Neural options" variant="ghost" onClick={show}>
                <Ellipsis />
              </IconButton>
            )}
          />
        )}
      </div>
    </header>
  );
}

function ModelCallout({ onSettings }: { onSettings?: () => void }) {
  return (
    <div className="surface flex items-start gap-3 rounded-list p-4">
      <IconTile Icon={KeyRound} color="orange" />
      <div className="min-w-0 flex-1">
        <div className="text-headline text-bright">Neural needs a model</div>
        <p className="mt-0.5 text-subhead text-dim">Add your NeuralHub, Anthropic or OpenAI key, or use a local Ollama model.</p>
        {onSettings && (
          <Button size="sm" variant="accent" onClick={onSettings} className="mt-3 rounded-full">
            Set up Neural
          </Button>
        )}
      </div>
    </div>
  );
}

type Item = { kind: "notice"; list: OrchMessage[] } | { kind: "one"; m: OrchMessage };

/** The conversation, by day; runs of agent notices become one card of rows. */
function Feed({ messages, busy }: { messages: OrchMessage[]; busy: boolean }) {
  const now = useNow();
  const last = messages.at(-1);
  const days = useMemo(() => byDay(messages, (m) => m.at, now), [messages, now]);
  return (
    <>
      {days.map((d) => {
        const items: Item[] = [];
        for (const m of d.items) {
          const prev = items.at(-1);
          if (m.role === "notice" && NOTICE.test(m.text)) {
            if (prev?.kind === "notice") prev.list.push(m);
            else items.push({ kind: "notice", list: [m] });
          } else items.push({ kind: "one", m });
        }
        return (
          <section key={d.label} className="flex flex-col gap-4">
            <h2 className="pt-2 text-center text-footnote text-dim">{d.label}</h2>
            {items.map((it) =>
              it.kind === "notice" ? (
                <div key={it.list[0]!.id} className="surface list-rows overflow-hidden rounded-list">
                  {it.list.map((m) => (
                    <NoticeRow key={m.id} m={m} now={now} />
                  ))}
                </div>
              ) : (
                <Line key={it.m.id} m={it.m} live={busy && it.m === last} />
              ),
            )}
          </section>
        );
      })}
    </>
  );
}

/** One agent event: who (tile, name, workspace), what happened (coloured word), what it said. Tap opens it. */
function NoticeRow({ m, now }: { m: OrchMessage; now: number }) {
  const open = useOpenSession();
  const session = useDaemon((c) => (m.session_id ? c.state?.sessions[m.session_id] : undefined));
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === session?.workspace_id)?.name);
  const engine = useDaemon((c) => c.state?.profiles.find((p) => p.id === session?.profile_id)?.engine);
  const [, label = "", what = "finished", said = ""] = NOTICE.exec(m.text) ?? [];
  const k = KIND[what]!;
  // The feed is history: only an event that is still true keeps its mark ("needs input" after
  // the agent finished would send you to an agent that no longer waits).
  const still = session?.alive && activityOf([session.status]) === k.activity;
  const [lws, ltitle] = label.includes(" — ") ? label.split(" — ", 2) : ["", label];
  const title = session?.title ?? ltitle ?? label;
  const where = ws ?? lws;
  const text = plainText(said);
  const can = !!session;
  return (
    <button
      type="button"
      data-lead=""
      disabled={!can}
      onClick={() => m.session_id && open(m.session_id)}
      className={cn("flex w-full items-start gap-3 px-4 py-3 text-left", can && "press-row hover:bg-fill-1")}
    >
      {engine ? <EngineTile engine={engine} activity={still ? k.activity : undefined} className="mt-0.5" /> : <IconTile Icon={Bell} color="gray" className="mt-0.5" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-headline text-bright">{title}</span>
          <span className="shrink-0 text-footnote text-dim tabular">{shortAgo(m.at, now)}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-footnote">
          <span className={cn("shrink-0", k.tone)}>{k.word}</span>
          {where && <span className="truncate text-dim">· {where}</span>}
        </span>
        {text && <span className="mt-1 line-clamp-2 block text-subhead text-ink">{text}</span>}
      </span>
      {can && <ChevronRight strokeWidth={2.2} className="mt-1 -mr-1 size-icon-sm shrink-0 text-faint" />}
    </button>
  );
}

function Line({ m, live }: { m: OrchMessage; live: boolean }) {
  const open = useOpenSession();
  switch (m.role) {
    case "user":
      return <UserBubble animate={false} time={clock(m.at)}>{m.text}</UserBubble>;
    case "assistant":
      if (!m.text) return null;
      return (
        <AssistantMessage>
          <StreamingText text={m.text} live={live} />
        </AssistantMessage>
      );
    case "action":
    case "notice": {
      const failed = m.ok === false;
      const Icon = m.role === "notice" ? Bell : failed ? X : Check;
      return (
        <button
          type="button"
          disabled={!m.session_id}
          onClick={() => m.session_id && open(m.session_id)}
          className={cn(
            "flex min-h-9 items-center gap-2 self-start rounded-full px-3 py-1.5 text-left text-footnote",
            failed ? "bg-danger/10 text-danger" : "bg-fill-2 text-ink",
            m.session_id && "pressable hover:bg-fill-3",
          )}
        >
          <Icon className={cn("size-icon-sm shrink-0", !failed && m.role === "action" && "text-success")} strokeWidth={2} />
          <span className="min-w-0">{plainText(m.text)}</span>
        </button>
      );
    }
  }
}

/** Opens an agent's pane: its workspace, with its tab in front. */
export function useOpenSession() {
  const client = useClient();
  const setWorkspace = useUi((u) => u.setWorkspace);
  return (sid: string) => {
    const st = client.state;
    const s = st?.sessions[sid];
    if (!s || !st) return;
    const layout = frontTabFor(st.layouts[s.workspace_id], s.id);
    if (layout) client.req({ m: "layout_set", p: { workspace_id: s.workspace_id, layout } }).catch(() => {});
    setWorkspace(s.workspace_id);
  };
}

type Chip = { key: string; title: string; sub: string; engine?: string; activity?: Activity; onOpen: () => void };

/** The live agents, one chip each (a swarm is one chip): what Neural talks about, one tap away. */
function LiveAgents() {
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const swarms = useDaemon((c) => c.state?.swarms);
  const setWorkspace = useUi((u) => u.setWorkspace);
  const open = useOpenSession();
  const chips = useMemo(() => {
    const engine = (id: string) => profiles?.find((p) => p.id === id)?.engine ?? "shell";
    const wsName = (id: string) => workspaces?.find((w) => w.id === id)?.name ?? "";
    const live = Object.values(sessions ?? {}).filter(
      (s): s is Session => !!s && s.alive && engine(s.profile_id) !== "shell" && !s.profile_id.startsWith("install:"),
    );
    const inSwarm = new Map<string, Swarm>();
    for (const w of swarms ?? []) if (!w.ended) for (const m of w.members) inSwarm.set(m.session_id, w);
    const out: Chip[] = [];
    const seen = new Set<string>();
    for (const s of live.sort((a, b) => b.started_at - a.started_at)) {
      const w = inSwarm.get(s.id);
      if (w) {
        if (seen.has(w.id)) continue;
        seen.add(w.id);
        const team = w.members.map((m) => sessions?.[m.session_id]).filter((x): x is Session => !!x?.alive);
        out.push({
          key: w.id,
          title: "Swarm",
          sub: `${wsName(w.workspace_id)} · ${team.length}`,
          activity: activityOf(team.map((x) => x.status)),
          onOpen: () => setWorkspace("__swarm"),
        });
      } else {
        out.push({ key: s.id, title: s.title, sub: wsName(s.workspace_id), engine: engine(s.profile_id), activity: activityOf([s.status]), onOpen: () => open(s.id) });
      }
    }
    return out;
  }, [sessions, profiles, workspaces, swarms, setWorkspace, open]);
  const ref = useRef<HTMLDivElement>(null);
  const fade = useEdgeFade(ref, chips.length);
  if (chips.length === 0) return null;
  return (
    <div ref={ref} data-no-swipe className="scroll-x relative mx-auto w-full max-w-2xl shrink-0 overflow-x-auto pt-1" style={fade} aria-label="Live agents">
      {/* Same column as the feed and the composer; on desktop the chips line up with their edges. */}
      <div className="flex w-max min-w-full gap-2 px-4 [[data-mode=desktop]_&]:px-0">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.onOpen}
            className="pressable surface flex h-12 max-w-56 shrink-0 items-center gap-2.5 rounded-full py-1 pr-4 pl-2 text-left"
            aria-label={`${c.title}, ${c.sub}`}
          >
            {c.engine ? <EngineTile engine={c.engine} activity={c.activity} className="rounded-full" /> : <IconTile Icon={Users} color="purple" activity={c.activity} className="rounded-full" />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-subhead text-bright">{c.title}</span>
              {c.sub && <span className="truncate text-caption text-dim">{c.sub}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Masks the edges of a horizontal scroller only where there is more to see. */
function useEdgeFade(ref: React.RefObject<HTMLDivElement | null>, dep: unknown): CSSProperties {
  const [edge, setEdge] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [ref, dep]);
  const mask = `linear-gradient(90deg, ${edge.l ? "transparent" : "black"}, black 28px, black calc(100% - 28px), ${edge.r ? "transparent" : "black"})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}
