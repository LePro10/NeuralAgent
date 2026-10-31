/**
 * The conversation, laid out like Claude's apps (A3): the owner's messages in a soft bubble on the
 * right, Claude's turns without a bubble in the reading serif. Between two texts the machinery is
 * one quiet steps line; file changes, pictures, subagents, the task list and plans stay visible as
 * their own cards. Time separators sit before a prompt after a pause or on a new day.
 *
 * Text is selectable everywhere (native selection). Desktop: Copy under a turn on hover. Phones: a
 * tap on a turn shows its action row for a few seconds; "⋯" opens Copy / Copy as Markdown /
 * Select text.
 *
 * Grouping lives in `entries.ts` (pure, tested). Entries keep their identity while their messages
 * do, and every entry is `memo`, so a live update re-renders only the turn it touches.
 */
import type { CvBlock, CvMessage } from "@neuralagent/protocol";
import { cn, Sheet } from "@neuralagent/ui";
import { ChevronRight, ClipboardList, Copy, Ellipsis, FileText, History, Layers, OctagonAlert, TextSelect, Users } from "lucide-react";
import { canRewind } from "./actions";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AgentCards } from "./AgentCard";
import { entryCache, gallery, lastTurn, latestTodo, sepLabel, textOf, toEntries, type Entry, type Piece, type Turn } from "./entries";
import { GalleryContext, NoImage, Pictures, Viewer, type Pic } from "./Images";
import { copyText, CopyButton, Markdown, plainText } from "./Markdown";
import { StepLabel, StepRun } from "./Steps";
import { Answered, EditCards, Output, picName, picsOf, PlanCard, TodoCard } from "./tools";
import { duration, inputOf, toolArg, type Res, type Use } from "./toolText";

export const time = (ts: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/** Entries with stable identity across updates (one cache per view). */
export function useEntries(messages: CvMessage[]): Entry[] {
  const cache = useRef(entryCache()).current;
  return useMemo(() => toEntries(messages, cache), [messages, cache]);
}

const NONE: ReadonlySet<string> = new Set();
const LatestTodoContext = createContext<string | null>(null);
type Menu = (text: string, m?: CvMessage) => void;
const MenuContext = createContext<Menu>(() => {});
/** Rewind the conversation (and code) to before a prompt (main chat only; I4's Rewind sheet). */
const RewindContext = createContext<((m: CvMessage) => void) | null>(null);

// ───────────── tap actions (phones) ─────────────

const ACTIONS_MS = 4000;
const INTERACTIVE = "button,a,input,textarea,select,summary,pre,img,[role=button],[data-no-tap]";

/** Phones: a tap (not on a control, not ending a selection) shows the action row for a while. */
function useTapActions(enabled: boolean) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = useCallback(
    (ev: React.MouseEvent) => {
      if (!enabled) return;
      if ((ev.target as Element).closest(INTERACTIVE)) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      setShown(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(false), ACTIONS_MS);
    },
    [enabled],
  );
  return { shown, onClick };
}

/** Copy / Copy as Markdown / Select text, as a sheet (phones). */
function ActionSheet({ text, onClose, onCopied, onRewind }: { text: string | null; onClose: () => void; onCopied: (what: string) => void; onRewind?: () => void }) {
  const [select, setSelect] = useState(false);
  useEffect(() => {
    if (text === null) setSelect(false);
  }, [text]);
  const row = (label: string, icon: ReactNode, act: () => void) => (
    <button type="button" role="menuitem" onClick={act} className="flex min-h-14 w-full items-center gap-3.5 rounded-cv-sm px-3 text-left text-cv-ui text-cv-text active:bg-cv-press">
      <span className="text-cv-text-2">{icon}</span>
      {label}
    </button>
  );
  const copy = (value: string, what: string) => () => {
    void copyText(value).then((ok) => ok && onCopied(what));
    onClose();
  };
  return (
    <Sheet open={text !== null} onClose={onClose} title={select ? "Select text" : "Message"} bodyClassName="pb-3">
      <div className="-mx-1 font-cv-sans" role={select ? undefined : "menu"} aria-label="Message">
        {text !== null &&
          (select ? (
            <div className="mx-3 mb-2 rounded-cv-md bg-cv-chip px-3.5 py-3 font-cv-serif text-cv-prose whitespace-pre-wrap text-cv-text select-text [overflow-wrap:anywhere]">{plainText(text)}</div>
          ) : (
            <>
              <div className="mx-3 mb-2 line-clamp-3 rounded-cv-md bg-cv-chip px-3.5 py-2.5 font-cv-serif text-cv-ui text-cv-text-2">{plainText(text)}</div>
              {row("Copy", <Copy size={20} strokeWidth={1.7} />, copy(plainText(text), "Copied"))}
              {row("Copy as Markdown", <FileText size={20} strokeWidth={1.7} />, copy(text, "Copied as Markdown"))}
              {row("Select text", <TextSelect size={20} strokeWidth={1.7} />, () => setSelect(true))}
              {onRewind &&
                row("Rewind to here", <History size={20} strokeWidth={1.7} />, () => {
                  onClose();
                  onRewind();
                })}
            </>
          ))}
      </div>
    </Sheet>
  );
}

function Actions({ text, ts, show, phone }: { text: string; ts: number; show: boolean; phone: boolean }) {
  const menu = useContext(MenuContext);
  if (phone) {
    if (!show) return null;
    return (
      <div className="-ml-1.5 flex h-9 items-center gap-1 font-cv-sans animate-cv-pop">
        <CopyButton text={plainText(text)} label="Copy" />
        <button type="button" onClick={() => menu(text)} aria-label="More" className="grid size-9 place-items-center rounded-cv-sm text-cv-muted active:bg-cv-press">
          <Ellipsis size={17} strokeWidth={1.8} />
        </button>
        {ts > 0 && <span className="ml-1 text-cv-meta text-cv-muted">{time(ts)}</span>}
      </div>
    );
  }
  return (
    <div className={cn("-ml-1.5 flex h-8 items-center gap-1 font-cv-sans transition-opacity duration-150", show ? "opacity-100" : "opacity-0 group-hover/turn:opacity-100 focus-within:opacity-100")}>
      <CopyButton text={plainText(text)} label="Copy" />
      <CopyButton text={text} label="Copy as Markdown" withLabel={false} />
      {ts > 0 && <span className="ml-1.5 text-cv-meta text-cv-muted">{time(ts)}</span>}
    </div>
  );
}

// ───────────── notes: errors, hooks, notifications, compaction ─────────────

const Rule = ({ children }: { children: ReactNode }) => (
  <div className="my-5 flex items-center gap-3 font-cv-sans text-cv-meta text-cv-muted">
    <span className="h-px flex-1 bg-cv-line-soft" />
    <span className="flex max-w-4/5 min-w-0 items-center gap-1.5 truncate">{children}</span>
    <span className="h-px flex-1 bg-cv-line-soft" />
  </div>
);

function Fold({ icon, title, tone, children }: { icon: ReactNode; title: ReactNode; tone?: "danger"; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("my-2 rounded-cv-md border font-cv-sans", tone === "danger" ? "border-cv-danger-soft bg-cv-danger-soft" : "border-cv-line-soft")}>
      <button type="button" disabled={!children} onClick={() => setOpen(!open)} aria-expanded={children ? open : undefined} className="flex min-h-cv-row w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-cv-step">
        <span className={cn("shrink-0", tone === "danger" ? "text-cv-danger" : "text-cv-muted")}>{icon}</span>
        <span className={cn("min-w-0 flex-1", tone === "danger" ? "text-cv-danger" : "text-cv-text-2", !open && "line-clamp-2")}>{title}</span>
        {children && <ChevronRight size={14} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform", open && "rotate-90")} />}
      </button>
      {open && children && <div className="px-3 pb-2.5 animate-cv-pop">{children}</div>}
    </div>
  );
}

const ERROR_TITLE: Record<string, string> = {
  rate_limit: "Usage limit reached",
  overloaded: "Claude is overloaded",
  server_error: "Server error",
  invalid_request: "Request was rejected",
  refusal: "Claude declined",
};

export function BlockNote({ block }: { block: CvBlock }) {
  switch (block.k) {
    case "error":
      return (
        <Fold icon={<OctagonAlert size={15} strokeWidth={1.8} />} title={(block.code && ERROR_TITLE[block.code]) || "Something went wrong"} tone="danger">
          <div className="text-cv-meta whitespace-pre-wrap text-cv-text-2 [overflow-wrap:anywhere]">{block.text}</div>
        </Fold>
      );
    case "hook":
      return (
        <Fold icon={<Layers size={15} strokeWidth={1.8} />} title={`${block.event} hook${block.error ? " failed" : ""}`} tone={block.error ? "danger" : undefined}>
          {block.text.trim() ? <div className="font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2 [overflow-wrap:anywhere]">{block.text}</div> : undefined}
        </Fold>
      );
    case "duration":
      return <div className="my-3 font-cv-sans text-cv-meta text-cv-muted">Worked for {duration(block.ms)}</div>;
    case "compact":
      return (
        <Rule>
          Conversation compacted{block.trigger === "auto" ? " automatically" : ""}
          {block.pre_tokens ? ` · ${Math.round(block.pre_tokens / 1000)}k tokens before` : ""}
        </Rule>
      );
    case "task_note": {
      const bad = block.status === "failed" || block.status === "killed";
      return (
        <Fold icon={<ClipboardList size={15} strokeWidth={1.8} />} title={block.summary || "A background task finished"} tone={bad ? "danger" : undefined}>
          {block.result?.trim() ? <Markdown text={block.result} compact /> : undefined}
        </Fold>
      );
    }
    case "shell":
      return <Output text={block.stdout ?? ""} stderr={block.stderr} cmd={block.command} label="Shell" />;
    default:
      return null;
  }
}

/** A notice line: command output, the carried-over summary, notifications, other agents. */
const Notice = memo(function Notice({ m }: { m: CvMessage }) {
  const text = textOf(m);
  const special = m.blocks.find((b) => b.k !== "text" && b.k !== "image");
  if (m.kind === "output") return <Output text={text} label="Output" />;
  if (m.kind === "summary") {
    return (
      <Fold icon={<FileText size={15} strokeWidth={1.8} />} title="Summary of the earlier conversation">
        <Markdown text={text} compact />
      </Fold>
    );
  }
  if (m.kind === "peer") {
    return (
      <div className="my-4 rounded-cv-md border border-cv-line-soft px-3.5 py-2.5 font-cv-sans">
        <div className="mb-1 flex items-center gap-1.5 text-cv-meta text-cv-muted">
          <Users size={13} strokeWidth={1.8} /> From {m.from_name || m.from || "another agent"}
        </div>
        <Markdown text={text} compact />
      </div>
    );
  }
  if (special) {
    return (
      <>
        {m.blocks.map((b, i) => (b.k === "text" ? null : <BlockNote key={i} block={b} />))}
        {m.kind === "compact" && special.k !== "compact" && text && <Rule>{text}</Rule>}
      </>
    );
  }
  return text ? <Rule>{text}</Rule> : null;
});

// ───────────── Claude's turn ─────────────

function PieceView({ p, e, running, live, waiting }: { p: Piece; e: Turn; running: ReadonlySet<string>; live: boolean; waiting: boolean }) {
  const latest = useContext(LatestTodoContext);
  switch (p.t) {
    case "text":
      return (
        <div className="my-3">
          <Markdown text={p.text} />
        </div>
      );
    case "steps":
      return <StepRun steps={p.steps} res={e.res} running={running} live={live} waiting={waiting} />;
    case "edits":
      return <EditCards uses={p.uses} results={e.res} running={running} />;
    case "agents":
      return <AgentCards uses={p.uses} results={e.res} running={running} />;
    case "media": {
      const r = e.res.get(p.use.id);
      return <Media use={p.use} res={r} />;
    }
    case "todos":
      return <TodoCard use={p.use} latest={p.use.id === latest} />;
    case "plan":
      return <PlanCard use={p.use} res={e.res.get(p.use.id)} />;
    case "ask":
      return e.res.has(p.use.id) ? <Answered use={p.use} res={e.res.get(p.use.id)} /> : null;
    case "note":
      return <BlockNote block={p.block} />;
  }
}

const Media = memo(function Media({ use, res }: { use: Use; res?: Res }) {
  const pics = useMemo(() => picsOf(use, res), [use, res]);
  return (
    <div className="my-2 font-cv-sans">
      <div className="flex min-h-cv-row min-w-0 items-center gap-2 text-cv-step">
        <StepLabel step={{ t: "tool", key: use.id, use }} res={res} />
      </div>
      <Pictures pics={pics} size="full" />
    </div>
  );
});

const TurnView = memo(function TurnView({ e, running, live, waiting, last, phone }: {
  e: Turn;
  /** Open calls (only for the newest turn; NONE otherwise). */
  running: ReadonlySet<string>;
  /** Claude is working on this turn. */
  live: boolean;
  waiting: boolean;
  /** The newest finished turn: its actions stay visible on desktop. */
  last: boolean;
  phone: boolean;
}) {
  const tap = useTapActions(phone && !!e.text);
  const end = e.pieces.length - 1;
  return (
    <div className="group/turn my-3" onClick={tap.onClick}>
      {e.pieces.map((p, i) => (
        <PieceView key={p.key} p={p} e={e} running={running} live={live && i === end} waiting={waiting} />
      ))}
      {e.text && !live && <Actions text={e.text} ts={e.ts} show={phone ? tap.shown : last} phone={phone} />}
    </div>
  );
});

// ───────────── the owner's messages ─────────────

const CLAMP_LINES = 12;

function Pasted({ block }: { block: Extract<CvBlock, { k: "pasted" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-4/5 min-w-0 rounded-cv-md border border-cv-line-soft bg-cv-surface font-cv-sans">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-cv-meta text-cv-text-2">
        <ClipboardList size={14} strokeWidth={1.8} className="shrink-0 text-cv-muted" />
        <span className="min-w-0 flex-1 truncate">Pasted text · {block.lines} {block.lines === 1 ? "line" : "lines"}</span>
        <ChevronRight size={14} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform", open && "rotate-90")} />
      </button>
      {open && <pre className="cv-thin max-h-80 overflow-auto border-t border-cv-line-soft px-3 py-2 font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2 [overflow-wrap:anywhere]">{block.text}</pre>}
    </div>
  );
}

const UserBubble = memo(function UserBubble({ m, sep, phone }: { m: CvMessage; sep: number | null; phone: boolean }) {
  const text = textOf(m);
  const imageBlocks = m.blocks.filter((b): b is Extract<CvBlock, { k: "image" }> => b.k === "image");
  const pics = useMemo((): Pic[] => imageBlocks.flatMap((b, i) => (b.image ? [{ img: b.image, caption: `Image ${i + 1}` }] : [])), [m]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = imageBlocks.length - pics.length;
  const pasted = m.blocks.filter((b): b is Extract<CvBlock, { k: "pasted" }> => b.k === "pasted");
  const shell = m.blocks.find((b): b is Extract<CvBlock, { k: "shell" }> => b.k === "shell");
  const long = text.split("\n").length > CLAMP_LINES || text.length > 1200;
  const [all, setAll] = useState(false);
  const tap = useTapActions(phone && !!text);
  const rewind = useContext(RewindContext);
  const cmd = m.kind === "command";
  return (
    <>
      {sep !== null && <div className="mt-6 mb-1 text-center font-cv-sans text-cv-meta text-cv-muted tabular-nums">{sepLabel(sep)}</div>}
      <div className="group/user my-5 flex flex-col items-end gap-1.5" onClick={tap.onClick}>
        {pics.length > 0 && <Pictures pics={pics} size="tile" className="max-w-4/5 justify-end" />}
        {missing > 0 && (
          <div className="flex gap-1.5">
            {Array.from({ length: Math.min(missing, 4) }, (_, i) => <NoImage key={i} />)}
            {missing > 4 && <div className="grid size-14 place-items-center rounded-cv-md bg-cv-chip font-cv-sans text-cv-meta text-cv-muted">+{missing - 4}</div>}
          </div>
        )}
        {pasted.map((b, i) => <Pasted key={i} block={b} />)}
        {shell && (
          <div className="w-full">
            <Output text={shell.stdout ?? ""} stderr={shell.stderr} cmd={shell.command} label="Shell" />
          </div>
        )}
        {text && !shell && (
          <div className="flex w-full items-end justify-end gap-1.5">
            {!phone && (
              <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
                {m.ts > 0 && <span className="mr-1 font-cv-sans text-cv-meta text-cv-muted">{time(m.ts)}</span>}
                <CopyButton text={text} label="Copy" />
                {rewind && canRewind(m) && (
                  <button type="button" onClick={() => rewind(m)} aria-label="Rewind to here" title="Rewind to here" className="grid size-8 place-items-center rounded-cv-sm text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text">
                    <History size={15} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            )}
            <div
              className={cn(
                "max-w-4/5 min-w-0 font-cv-sans whitespace-pre-wrap text-cv-text [overflow-wrap:anywhere]",
                cmd ? "rounded-full bg-cv-chip px-3.5 py-1.5 font-cv-mono text-cv-code" : "rounded-cv-bubble bg-cv-bubble px-4 py-2.5 text-cv-ui",
              )}
            >
              <div className={cn(long && !all && "line-clamp-12")}>{text}</div>
              {long && (
                <button type="button" onClick={() => setAll(!all)} className="mt-1 text-cv-meta text-cv-muted underline-offset-2 hover:underline">
                  {all ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          </div>
        )}
        {phone && text && tap.shown && <UserActions text={text} m={m} />}
      </div>
    </>
  );
});

function UserActions({ text, m }: { text: string; m: CvMessage }) {
  const menu = useContext(MenuContext);
  const ts = m.ts;
  return (
    <div className="-mr-1.5 flex h-9 items-center gap-1 font-cv-sans animate-cv-pop">
      {ts > 0 && <span className="mr-1 text-cv-meta text-cv-muted">{time(ts)}</span>}
      <CopyButton text={text} label="Copy" />
      <button type="button" onClick={() => menu(text, m)} aria-label="More" className="grid size-9 place-items-center rounded-cv-sm text-cv-muted active:bg-cv-press">
        <Ellipsis size={17} strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ───────────── the list ─────────────

/**
 * Remembers which entries arrived live (after the first paint, at the end), so only those rise
 * in; history and prepended pages appear without motion.
 */
function useBorn(entries: Entry[]) {
  const known = useRef<Set<string> | null>(null);
  const born = useRef(new Set<string>());
  const lastKey = useRef<string | null>(null);
  return useMemo(() => {
    if (!entries.length) return born.current;
    if (!known.current) {
      known.current = new Set(entries.map((e) => e.key));
    } else {
      const from = lastKey.current ? entries.findIndex((e) => e.key === lastKey.current) + 1 : 0;
      for (let i = Math.max(from, 0); i < entries.length; i++) {
        const k = entries[i]!.key;
        if (!known.current.has(k)) born.current.add(k);
      }
      for (const e of entries) known.current.add(e.key);
    }
    lastKey.current = entries[entries.length - 1]!.key;
    return born.current;
  }, [entries]);
}

export function Transcript({ entries, running, working, waiting, phone, onCopied, onRewind }: {
  entries: Entry[];
  /** Calls of the newest turn without a result (running, or waiting for the permission card). */
  running: ReadonlySet<string>;
  working: boolean;
  /** A prompt card waits for the owner. */
  waiting: boolean;
  phone: boolean;
  onCopied: (what: string) => void;
  /** Main chat: "Rewind to here" on the owner's prompts. */
  onRewind?: (m: CvMessage) => void;
}) {
  const [held, setHeldState] = useState<{ text: string; m?: CvMessage } | null>(null);
  const setHeld = useCallback<Menu>((text, m) => setHeldState({ text, m }), []);
  const tail = useMemo(() => lastTurn(entries), [entries]);
  const latest = useMemo(() => latestTodo(entries), [entries]);
  const born = useBorn(entries);

  // One viewer that swipes across every picture of the conversation.
  const items = useMemo(() => gallery(entries, (u, r) => picName(u, r) || toolArg(u.name, inputOf(u)) || undefined), [entries]);
  const [at, setAt] = useState<string | null>(null);
  const galleryApi = useMemo(() => ({ open: (id: string) => setAt(id) }), []);
  const viewerPics = useMemo((): Pic[] => items.map((g) => ({ img: g.img, caption: g.caption })), [items]);
  const start = at ? items.findIndex((g) => g.key === at) : -1;

  return (
    <GalleryContext.Provider value={galleryApi}>
      <LatestTodoContext.Provider value={latest}>
        <MenuContext.Provider value={setHeld}>
        <RewindContext.Provider value={onRewind ?? null}>
          {entries.map((e) => {
            const own = e === tail;
            return (
              <div key={e.key} data-entry={e.key} className={born.has(e.key) ? "animate-cv-rise" : undefined}>
                {e.t === "user" ? (
                  <UserBubble m={e.m} sep={e.sep} phone={phone} />
                ) : e.t === "system" ? (
                  <Notice m={e.m} />
                ) : (
                  <TurnView e={e} running={own ? running : NONE} live={own && working} waiting={own && waiting} last={own && !working} phone={phone} />
                )}
              </div>
            );
          })}
          {phone && <ActionSheet text={held?.text ?? null} onClose={() => setHeldState(null)} onCopied={onCopied} onRewind={held?.m && onRewind && canRewind(held.m) ? () => onRewind(held.m!) : undefined} />}
          {start >= 0 && <Viewer pics={viewerPics} start={start} onClose={() => setAt(null)} />}
        </RewindContext.Provider>
        </MenuContext.Provider>
      </LatestTodoContext.Provider>
    </GalleryContext.Provider>
  );
}
