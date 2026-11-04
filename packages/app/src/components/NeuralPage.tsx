import type { OrchMessage, Session } from "@neuralagent/protocol";
import {
  AssistantMessage,
  AssistantOrb,
  Button,
  Composer,
  ConfirmSheet,
  Sheet,
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
  useLayoutMode,
  usePortalTarget,
  type Activity,
  type ComposerHandle,
  type Suggestion,
} from "@neuralagent/ui";
import { Activity as ActivityIcon, Bell, Check, ChevronRight, Ellipsis, Eraser, KeyRound, ListChecks, Phone, Play, Settings2, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { startCall, useCallWarm } from "../lib/call";
import { useOpenAgent } from "../lib/openAgent";
import { humanError } from "../lib/agentReason";
import { NOTICE, byDay, clock, plainText, shortAgo, useNow } from "../lib/agentui";
import { activityOf } from "../lib/status";
import { useClient, useDaemon } from "../lib/store";
import { awayOf, neuralOf } from "../lib/neural";
import type { State } from "@neuralagent/protocol";
import { AwayCard, PendingCards, ProactiveHeader } from "./neural/NeuralBits";
import { NeuralPanel } from "./neural/NeuralPanel";
import { EngineTile, QuietTile, tileGlyph } from "./EngineTile";
import { Glow } from "./Glow";

/** Content fades under the header and above the composer instead of being cut. */
const EDGE_Y: CSSProperties = { maskImage: "linear-gradient(180deg, transparent, black 14px, black calc(100% - 14px), transparent)", WebkitMaskImage: "linear-gradient(180deg, transparent, black 14px, black calc(100% - 14px), transparent)" };

const SUGGESTIONS: Suggestion[] = [
  { title: "What are my agents doing?", Icon: ActivityIcon, prompt: "What are my agents doing right now?" },
  { title: "Start an agent", detail: "in one of your workspaces", Icon: Play, prompt: "Start an agent in " },
  { title: "Catch me up", detail: "what happened while I was away", Icon: ListChecks, prompt: "Catch me up: what happened while I was away, and what needs me?" },
];

const KIND: Record<string, { activity: Activity; word: string; tone: string }> = {
  finished: { activity: "done", word: "Finished", tone: "text-ember" },
  "needs input": { activity: "waiting", word: "Needs input", tone: "text-accent" },
  "stopped with an error": { activity: "error", word: "Error", tone: "text-danger" },
};

/**
 * Neural, the orchestrator: one conversation shared by the desktop, the browser and the phone.
 * The conversation is only you and Neural (plus what it said on its own, marked as such); what it
 * knows and owns (tasks, what it noticed, memory, how proactive it is) is the panel beside it on
 * wide desktops, a sheet elsewhere (D61–D63).
 */
export function NeuralPage({ onSettings }: { onSettings?: () => void }) {
  const client = useClient();
  // A call is likely from here: the computer loads its speech models now (D69).
  useCallWarm(client);
  const orch = useDaemon((c) => c.state?.orchestrator);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [clearing, setClearing] = useState(false);
  // Phones: Neural is a tab of its own, the conversation and the call only (the agents live in
  // the Agents tab). No orb, no page light; the call screen is mounted once by the app.
  const phone = useLayoutMode() === "phone";
  const messages = orch?.messages ?? [];
  const last = messages.at(-1);
  // Keyboard: Android resizes the page (the tab bar hides); iOS overlays it (lift by its height).
  const kbOpen = useKeyboardOpen();
  const kb = useKeyboardInset(usePortalTarget());
  const neural = useDaemon((c) => c.state?.neural);
  // Tasks and memory need a Neural v2 daemon (`neural`); older daemons (0.3.x) answer it with an error.
  const v2 = useDaemon((c) => c.status === "open" && c.has("neural"));
  const onPlan = v2 ? () => setPlan(true) : undefined;
  const [plan, setPlan] = useState(false);
  const now = useNow();
  const away = useMemo(() => (orch ? awayOf({ orchestrator: orch, neural } as State, now) : null), [orch, neural, now]);
  const openTasks = neuralOf({ neural } as State).tasks.filter((t) => t.status !== "done" && t.status !== "failed").length;

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
      {!phone && <Glow />}
      {phone ? (
        <PhoneHeader ready={orch.ready} busy={orch.busy} empty={empty} onSettings={onSettings} onClear={() => setClearing(true)} onPlan={onPlan} tasks={openTasks} />
      ) : (
        <Header ready={orch.ready} busy={orch.busy} empty={empty} onSettings={onSettings} onClear={() => setClearing(true)} onPlan={onPlan} tasks={openTasks} />
      )}

      <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={scroller} className="scroller relative min-h-0 flex-1 overflow-y-auto px-4" style={EDGE_Y}>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-2 pb-6">
          {!orch.ready && <ModelCallout onSettings={onSettings} />}
          {empty && phone ? (
            <div className="flex flex-col gap-3 pt-6">
              <p className="text-subhead text-dim">Ask about your agents, or tell Neural what to start. It talks to every agent on this computer.</p>
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
          ) : empty ? (
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
          {away && !orch.busy && <AwayCard away={away} busy={orch.busy} onCatchUp={() => send("Catch me up: what happened while I was away, and what needs me?")} />}
          <PendingCards />
          {waitingForWords && <ThinkingIndicator variant="dots" label="Neural is thinking" />}
        </div>
      </div>

      {!phone && !kbOpen && !kb && <LiveAgents />}

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
      </div>
      {!phone && v2 && (
        <aside aria-label="What Neural knows" className="scroller hidden w-80 shrink-0 overflow-y-auto border-l border-line px-4 pt-2 pb-6 xl:block">
          <NeuralPanel />
        </aside>
      )}
      </div>

      <Sheet open={plan} onClose={() => setPlan(false)} title="Neural" eyebrow="Tasks and memory" size="md">
        <NeuralPanel className="pb-4" />
      </Sheet>

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

function Header({ ready, busy, empty, onSettings, onClear, onPlan, tasks }: HeaderProps) {
  const client = useClient();
  const sessions = useDaemon((c) => c.state?.sessions);
  const live = Object.values(sessions ?? {}).filter((s) => s?.alive && !s.profile_id.startsWith("install:") && s.profile_id !== "shell").length;
  const status = statusLine(ready, busy, live, tasks);
  const items = [
    ...(onPlan ? [{ label: "Tasks and memory", Icon: ListChecks, onSelect: onPlan }] : []),
    ...(onSettings ? [{ label: "Neural settings", Icon: Settings2, onSelect: onSettings }] : []),
    ...(!empty ? [{ label: "Clear conversation", Icon: Eraser, destructive: true, divider: true, onSelect: onClear }] : []),
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
        {onPlan && (
          <span className="xl:hidden">
            <Button variant="glass" size="sm" Icon={ListChecks} onClick={onPlan} className="rounded-full">
              {tasks > 0 ? `Tasks · ${tasks}` : "Tasks"}
            </Button>
          </span>
        )}
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

/** Phones: the tab's large light title, what Neural is doing, Call and the options. */
function PhoneHeader({ ready, busy, empty, onSettings, onClear, onPlan, tasks }: HeaderProps) {
  const client = useClient();
  const sessions = useDaemon((c) => c.state?.sessions);
  const live = Object.values(sessions ?? {}).filter((s) => s?.alive && !s.profile_id.startsWith("install:") && s.profile_id !== "shell").length;
  const status = statusLine(ready, busy, live, tasks);
  const items = [
    ...(onPlan ? [{ label: "Tasks and memory", Icon: ListChecks, onSelect: onPlan }] : []),
    ...(onSettings ? [{ label: "Neural settings", Icon: Settings2, onSelect: onSettings }] : []),
    ...(!empty ? [{ label: "Clear conversation", Icon: Eraser, destructive: true, divider: true, onSelect: onClear }] : []),
  ];
  return (
    <header className="flex shrink-0 items-end gap-2 px-4 pt-3 pb-2">
      <div className="min-w-0 flex-1">
        <div className="eyebrow mb-1 truncate">{busy ? <Shimmer>{status}</Shimmer> : status}</div>
        <h1 className="text-large-title font-light text-bright">Neural</h1>
      </div>
      {onPlan && (
        <IconButton label={tasks > 0 ? `Tasks and memory, ${tasks} open` : "Tasks and memory"} variant="glass" onClick={onPlan}>
          <ListChecks />
        </IconButton>
      )}
      {ready && (
        <IconButton label="Call Neural" variant="glass" onClick={() => void startCall(client)}>
          <Phone />
        </IconButton>
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
    </header>
  );
}

type HeaderProps = { ready: boolean; busy: boolean; empty: boolean; onSettings?: () => void; onClear: () => void; onPlan?: () => void; tasks: number };

function statusLine(ready: boolean, busy: boolean, live: number, tasks: number): string {
  if (!ready) return "Needs a model";
  if (busy) return "Working…";
  const parts = [live > 0 ? `Watching ${live} ${live === 1 ? "agent" : "agents"}` : "", tasks > 0 ? `${tasks} ${tasks === 1 ? "task" : "tasks"}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Your agents’ orchestrator";
}

function ModelCallout({ onSettings }: { onSettings?: () => void }) {
  const phone = useLayoutMode() === "phone";
  return (
    <div className={cn("flex items-start gap-3", phone ? "border-b-hair border-line pb-4" : "surface rounded-list p-4")}>
      {!phone && <IconTile Icon={KeyRound} color="orange" />}
      <div className="min-w-0 flex-1">
        <div className="text-headline text-bright">Neural needs a model</div>
        <p className="mt-0.5 text-subhead text-dim">Add your NeuralHub, Anthropic or OpenAI key, or use a local Ollama model.</p>
        {onSettings && (
          <Button size="sm" variant={phone ? "glass" : "accent"} onClick={onSettings} className="mt-3 rounded-full">
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
  // A failure in plain words (a hook line or an API error body is not a reason); the agent has the rest.
  const text = what === "stopped with an error" ? humanError(plainText(said)).text : plainText(said);
  const can = !!session;
  return (
    <button
      type="button"
      data-lead=""
      disabled={!can}
      onClick={() => m.session_id && open(m.session_id)}
      className={cn("flex w-full items-start gap-3 px-4 py-3 text-left", can && "press-row hover:bg-fill-1")}
    >
      {engine ? <EngineTile engine={engine} activity={still ? k.activity : undefined} className="mt-0.5" /> : <QuietTile className="mt-0.5"><Bell size={tileGlyph("md")} strokeWidth={1.6} /></QuietTile>}
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
      if (m.proactive)
        return (
          <AssistantMessage header={<ProactiveHeader at={m.at} />} className="border-l-2 border-accent pl-3">
            <StreamingText text={m.text} live={false} />
          </AssistantMessage>
        );
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

/** Opens an agent (phones: its screen; desktop: its pane). Kept under the old name for callers. */
export const useOpenSession = useOpenAgent;

type Chip = { key: string; title: string; sub: string; engine?: string; activity?: Activity; onOpen: () => void };

/** The live agents, one chip each what Neural talks about, one tap away. */
function LiveAgents() {
  const sessions = useDaemon((c) => c.state?.sessions);
  const profiles = useDaemon((c) => c.state?.profiles);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const open = useOpenSession();
  const chips = useMemo(() => {
    const engine = (id: string) => profiles?.find((p) => p.id === id)?.engine ?? "shell";
    const wsName = (id: string) => workspaces?.find((w) => w.id === id)?.name ?? "";
    const live = Object.values(sessions ?? {}).filter(
      (s): s is Session => !!s && s.alive && engine(s.profile_id) !== "shell" && !s.profile_id.startsWith("install:"),
    );
    const out: Chip[] = [];
    for (const s of live.sort((a, b) => b.started_at - a.started_at)) {
      out.push({ key: s.id, title: s.title, sub: wsName(s.workspace_id), engine: engine(s.profile_id), activity: activityOf([s.status]), onOpen: () => open(s.id) });
    }
    return out;
  }, [sessions, profiles, workspaces, open]);
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
            {c.engine ? <EngineTile engine={c.engine} activity={c.activity} round /> : <QuietTile round activity={c.activity}><Users size={tileGlyph("md")} strokeWidth={1.6} /></QuietTile>}
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
