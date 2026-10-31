/**
 * The Claude Code UI over the real CLI, dressed like Anthropic's own apps: the conversation is
 * read from Claude's transcript by the daemon, input and commands go into the CLI's terminal.
 * Menus that only exist in the terminal UI open the live terminal on top, so every CLI function
 * stays reachable.
 */
import type { Session } from "@neuralagent/protocol";
import { cn, toast, useKeyboard, useLayoutMode } from "@neuralagent/ui";
import { Check, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClient } from "../../lib/store";
import { KeyBar } from "../KeyBar";
import { TerminalView } from "../TerminalView";
import { TasksContext } from "./AgentCard";
import { requestRewind } from "./actions";
import { ChatScroll, type ChatScrollHandle } from "./ChatScroll";
import { Composer } from "./Composer";
import { lastTurn, openTools, pendingUse } from "./entries";
import { ImageSidContext } from "./Images";
import { modelName } from "./models";
import { PromptCard } from "./PromptCard";
import { Spark } from "./Spark";
import { SubagentView, type AgentRef } from "./SubagentView";
import { TasksSheet } from "./TasksSheet";
import { CwdContext } from "./tools";
import { useEntries } from "./Transcript";
import { useConversation, useTaskList } from "./useConversation";
import { usePublishTasks, useTasksOpener } from "./useTasks";

/** Sizes the CLI draws at while the view is shown (menus stay readable, nothing wraps oddly). */
const VIEW_COLS = 110;
const VIEW_ROWS = 36;

export function ClaudeView({ session, webgl, onFocus }: { session: Session; webgl: boolean; onFocus: () => void }) {
  const sid = session.id;
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const { conv, loadOlder, loadingOlder } = useConversation(sid, session.started_at);
  const [terminal, setTerminal] = useState<string | null>(null);
  const scroll = useRef<ChatScrollHandle>(null);
  const keyboard = useKeyboard();

  const entries = useEntries(conv.messages);
  const tail = useMemo(() => lastTurn(entries), [entries]);

  // `busy` from a newer daemon (hooks + spinner); older ones: the session status or the spinner text.
  const busy = session.alive && (conv.meta.busy ?? (session.status === "working" || !!conv.meta.activity));
  const working = useHeld(busy, 400);

  // Calls without a result: running now, or waiting for the permission card.
  const open = useMemo(() => pendingUse(tail), [tail]);
  const openIds = useMemo(() => openTools(tail), [tail]);
  const running = working || conv.prompt ? openIds : NO_IDS;

  // Background work: cards in the transcript, the Tasks sheet, badges elsewhere (`useTasks`).
  const tasks = useTaskList(conv.tasks, conv.meta.tasks_running ?? undefined);
  usePublishTasks(sid, conv.tasks, conv.meta.tasks_running ?? undefined);
  const [tasksOpen, setTasksOpen] = useState(false);
  useTasksOpener(sid, useCallback(() => setTasksOpen(true), []));
  const [trail, setTrail] = useState<AgentRef[]>([]);
  useEffect(() => setTrail([]), [sid]);
  const tasksApi = useMemo(() => ({ tasks: conv.tasks, open: (a: AgentRef) => setTrail((t) => (t.some((x) => x.id === a.id) ? t : [...t, a])) }), [conv.tasks]);

  // The CLI draws at a size that reads well while this view is the one in use.
  useEffect(() => {
    if (!session.alive) return;
    const fit = () => {
      if (document.visibilityState === "visible") client.req({ m: "term_resize", p: { sid, cols: VIEW_COLS, rows: VIEW_ROWS } }).catch(() => {});
    };
    fit();
    document.addEventListener("visibilitychange", fit);
    window.addEventListener("focus", fit);
    return () => {
      document.removeEventListener("visibilitychange", fit);
      window.removeEventListener("focus", fit);
    };
  }, [client, sid, session.alive, session.started_at, terminal]);

  const onCopied = useCallback((m: string) => void toast(m, { tone: "success", Icon: Check, duration: 1600 }), []);

  const empty = conv.ready && conv.messages.length === 0;
  // Desktop, new chat: greeting and composer sit together in the middle, like claude.ai.
  const centred = empty && !phone && !conv.prompt;

  const showActivity = working && !conv.prompt;
  const bottom = (
    <>
      {showActivity && <Activity text={conv.meta.activity} />}
      {!session.alive && <div className="py-4 text-center text-cv-meta text-cv-muted">This session has ended.</div>}
    </>
  );

  return (
    <CwdContext.Provider value={session.cwd}>
      <ImageSidContext.Provider value={sid}>
      <TasksContext.Provider value={tasksApi}>
      <div className="relative flex h-full min-h-0 flex-col bg-cv-bg font-cv-sans text-cv-text" onMouseDown={onFocus}>
        <ChatScroll
          ref={scroll}
          entries={entries}
          resetKey={`${sid}|${session.started_at}`}
          more={conv.more}
          loadingOlder={loadingOlder}
          loadOlder={loadOlder}
          running={running}
          working={working}
          waiting={!!conv.prompt}
          phone={phone}
          onCopied={onCopied}
          onRewind={session.alive ? (m) => void requestRewind(sid, m.id, conv.messages) : undefined}
          island={phone}
          centred={centred}
          top={empty ? <Greeting model={conv.meta.model} cwd={session.cwd} centred={centred} /> : null}
          bottom={bottom}
        />

        {/* Composer region (I4): the composer sits in normal flow under the transcript. */}
        <div className={cn("relative mx-auto w-full max-w-3xl shrink-0 px-3 [[data-mode=desktop]_&]:px-5", centred && "flex-1")} style={{ paddingBottom: phone ? (keyboard.open ? 8 : "max(10px, var(--safe-bottom))") : 16 }}>
          {conv.prompt && session.alive && <PromptCard sid={sid} prompt={conv.prompt} pending={open} cwd={session.cwd} phone={phone} meta={conv.meta} onTerminal={() => setTerminal("menu")} />}
          <Composer
            sid={sid}
            meta={conv.meta}
            busy={working}
            phone={phone}
            empty={empty}
            disabled={!session.alive}
            hidden={phone && !!conv.prompt && session.alive}
            messages={conv.messages}
            onTasks={() => setTasksOpen(true)}
            onTerminal={(why) => setTerminal(why)}
            onSubmitted={() => requestAnimationFrame(() => scroll.current?.toBottom())}
          />
        </div>

        {trail.length > 0 && (
          <SubagentView
            key={trail[trail.length - 1]!.id}
            sid={sid}
            startedAt={session.started_at}
            trail={trail}
            phone={phone}
            onBack={() => setTrail((t) => t.slice(0, -1))}
            onCopied={onCopied}
          />
        )}
        <TasksSheet sid={sid} open={tasksOpen} tasks={tasks.list} onClose={() => setTasksOpen(false)} onAgent={tasksApi.open} />

        {terminal && (
          <div className="absolute inset-0 z-40 flex flex-col bg-cv-bg animate-cv-rise" style={{ paddingTop: "var(--island-space, 0px)" }}>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-cv-line-soft pr-2 pl-4">
              <SquareTerminal size={16} strokeWidth={1.7} className="text-cv-muted" />
              <span className="flex-1 truncate text-cv-ui text-cv-text-2">{terminal.startsWith("/") ? `${terminal} runs in the terminal` : "Terminal"}</span>
              <button type="button" onClick={() => setTerminal(null)} className="h-9 rounded-full bg-cv-primary px-4 text-cv-ui text-cv-on-primary transition-transform active:scale-97">
                Done
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <TerminalView sid={sid} focused startedAt={session.started_at} webgl={webgl} touch={phone} onFocus={onFocus} />
            </div>
            {phone && <KeyBar sid={sid} />}
          </div>
        )}
      </div>
      </TasksContext.Provider>
      </ImageSidContext.Provider>
    </CwdContext.Provider>
  );
}

const NO_IDS: ReadonlySet<string> = new Set();

/** `value`, but a `true` lasts at least `ms` (the activity line does not blink between steps). */
function useHeld(value: boolean, ms: number): boolean {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (value) return setHeld(true);
    const t = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value || held;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late?";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Greeting({ model, cwd, centred }: { model?: string | null; cwd: string; centred: boolean }) {
  const folder = cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
  return (
    <div className={cn("flex flex-col items-center gap-3 text-center animate-cv-rise", centred ? "pt-10 pb-8" : "m-auto py-16")}>
      <div className="flex items-center gap-3">
        <Spark size={32} />
        <h1 className="font-cv-serif text-cv-display font-cv-body text-cv-text">{greeting()}</h1>
      </div>
      <div className="max-w-sm text-cv-meta text-cv-muted">
        {model && modelName(model)}
        {model && folder && " · "}
        {folder && <span className="font-cv-mono">{folder}</span>}
      </div>
    </div>
  );
}

/** "✻ Pondering… (3s · ↓ 1.2k tokens · esc to interrupt)" → spark, clay verb, muted details. */
export function splitActivity(text?: string | null): { verb: string; meta: string } {
  const t = (text ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(t);
  const verb = (m ? m[1]! : t).trim();
  const meta = (m ? m[2]! : "")
    .split("·")
    .map((s) => s.trim())
    .filter((s) => s && !/esc to interrupt/i.test(s))
    .join(" · ");
  return { verb: verb || "Working…", meta };
}

function Activity({ text }: { text?: string | null }) {
  const { verb, meta } = splitActivity(text);
  return (
    <div className="mt-3 mb-1 flex min-w-0 items-center gap-2.5" role="status" aria-live="polite">
      <Spark size={20} spinning />
      <span className="shrink-0 text-cv-ui text-cv-clay">{verb}</span>
      {meta && <span className="min-w-0 truncate text-cv-meta text-cv-muted">{meta}</span>}
    </div>
  );
}
