/**
 * The conversation, laid out like Claude: user messages in a soft bubble on the right, Claude's
 * turns without a bubble in the reading serif, tool calls as quiet rows (reads and searches folded
 * into one), thinking folded away, and Copy under every message (hover on desktop, long-press on
 * phones opens an action sheet).
 */
import type { CvBlock, CvMessage } from "@neuralagent/protocol";
import { cn, Sheet } from "@neuralagent/ui";
import { ChevronRight, Copy, FileText, Image as ImageIcon } from "lucide-react";
import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { copyText, CopyButton, Markdown, plainText } from "./Markdown";
import { Spark } from "./Spark";
import { isExplore, ToolCall, ToolGroup, type Res, type Use } from "./tools";

type Text = Extract<CvBlock, { k: "text" }>;

type Piece =
  | { t: "text"; key: string; text: string }
  | { t: "thinking"; key: string; text: string; ms: number | null }
  | { t: "tool"; key: string; use: Use }
  | { t: "group"; key: string; uses: Use[] };

export type Entry =
  | { t: "user"; key: string; m: CvMessage }
  | { t: "system"; key: string; m: CvMessage }
  | { t: "turn"; key: string; pieces: Piece[]; ts: number; text: string };

const textOf = (m: CvMessage) => m.blocks.filter((b): b is Text => b.k === "text").map((b) => b.text).join("\n\n");

/** Messages → user bubbles, notices and Claude turns (consecutive assistant output). */
export function toEntries(messages: CvMessage[]): Entry[] {
  const out: Entry[] = [];
  let turn: Extract<Entry, { t: "turn" }> | null = null;
  let prevTs = 0;
  const close = () => {
    if (turn) {
      turn.text = turn.pieces.filter((p): p is Extract<Piece, { t: "text" }> => p.t === "text").map((p) => p.text).join("\n\n");
      out.push(turn);
    }
    turn = null;
  };
  for (const m of messages) {
    const key = m.id || String(m.i);
    if (m.role === "user") {
      const text = textOf(m);
      const images = m.blocks.some((b) => b.k === "image");
      // Tool results ride along with their calls.
      if (!text.trim() && !images) {
        prevTs = m.ts || prevTs;
        continue;
      }
      close();
      out.push({ t: "user", key, m });
      prevTs = m.ts || prevTs;
      continue;
    }
    if (m.role === "system") {
      close();
      out.push({ t: "system", key, m });
      continue;
    }
    if (!turn) turn = { t: "turn", key, pieces: [], ts: m.ts, text: "" };
    turn.ts = m.ts || turn.ts;
    m.blocks.forEach((b, i) => {
      const k = `${key}-${i}`;
      const t = turn!;
      if (b.k === "text") {
        if (b.text.trim()) t.pieces.push({ t: "text", key: k, text: b.text });
      } else if (b.k === "thinking") {
        const ms = m.ts && prevTs && m.ts > prevTs && m.ts - prevTs < 30 * 60_000 ? m.ts - prevTs : null;
        t.pieces.push({ t: "thinking", key: k, text: b.text, ms });
      } else if (b.k === "tool_use") {
        const last = t.pieces[t.pieces.length - 1];
        if (isExplore(b.name)) {
          if (last?.t === "group") last.uses.push(b);
          else if (last?.t === "tool" && isExplore(last.use.name)) t.pieces[t.pieces.length - 1] = { t: "group", key: last.key, uses: [last.use, b] };
          else t.pieces.push({ t: "tool", key: b.id || k, use: b });
        } else t.pieces.push({ t: "tool", key: b.id || k, use: b });
      }
    });
    prevTs = m.ts || prevTs;
  }
  close();
  return out;
}

export const time = (ts: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/** Long-press (touch only): opens the action sheet without firing a tap; moving cancels it. */
function useLongPress(on: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  if (!enabled) return {};
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        navigator.vibrate?.(8);
        on();
      }, 480);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

/** Copy / Copy as Markdown, as an action sheet (phones). */
function ActionSheet({ text, onClose, onCopied }: { text: string | null; onClose: () => void; onCopied: (what: string) => void }) {
  const row = (label: string, value: string, icon: ReactNode) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        void copyText(value).then((ok) => ok && onCopied(label === "Copy" ? "Copied" : "Copied as Markdown"));
        onClose();
      }}
      className="flex min-h-14 w-full items-center gap-3.5 rounded-cv-sm px-3 text-left text-cv-ui text-cv-text active:bg-cv-press"
    >
      <span className="text-cv-text-2">{icon}</span>
      {label}
    </button>
  );
  return (
    <Sheet open={text !== null} onClose={onClose} title="Message" bodyClassName="pb-3">
      <div className="cv-sheet -mx-1 font-cv-sans" role="menu" aria-label="Message">
        {text !== null && (
          <>
            <div className="mx-3 mb-2 line-clamp-3 rounded-cv-md bg-cv-chip px-3.5 py-2.5 font-cv-serif text-cv-ui text-cv-text-2">{plainText(text)}</div>
            {row("Copy", plainText(text), <Copy size={20} strokeWidth={1.7} />)}
            {row("Copy as Markdown", text, <FileText size={20} strokeWidth={1.7} />)}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Thinking({ text, ms }: { text: string; ms: number | null }) {
  const [open, setOpen] = useState(false);
  const label = ms && ms >= 1000 ? `Thought for ${Math.round(ms / 1000)}s` : "Thought process";
  if (!text.trim()) {
    return (
      <div className="my-2 flex min-h-9 items-center gap-2 font-cv-sans text-cv-ui text-cv-muted">
        <Spark size={14} className="text-cv-muted" />
        {label}
      </div>
    );
  }
  return (
    <div className="my-2 font-cv-sans">
      <div className="-mx-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-9 w-full items-center gap-2 rounded-cv-sm px-2 text-left text-cv-ui text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text-2 [[data-mode=phone]_&]:min-h-11">
          <Spark size={14} className="text-cv-muted" />
          <span className="flex-1">{label}</span>
          <ChevronRight size={15} strokeWidth={1.8} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />
        </button>
      </div>
      <div className="cv-fold" data-open={open}>
        <div>
          <div className="mt-1 mb-2 ml-1 border-l-2 border-cv-line pl-4 text-cv-meta whitespace-pre-wrap text-cv-text-2">{text}</div>
        </div>
      </div>
    </div>
  );
}

function Actions({ text, ts, show }: { text: string; ts: number; show: boolean }) {
  return (
    <div className={cn("-ml-1.5 flex h-8 items-center gap-1 font-cv-sans transition-opacity duration-150", show ? "opacity-100" : "opacity-0 group-hover/turn:opacity-100 focus-within:opacity-100 [[data-mode=phone]_&]:hidden")}>
      <CopyButton text={plainText(text)} label="Copy" />
      <CopyButton text={text} label="Copy as Markdown" className="[[data-mode=phone]_&]:hidden" withLabel={false} />
      {ts > 0 && <span className="ml-1.5 text-cv-meta text-cv-muted">{time(ts)}</span>}
    </div>
  );
}

const Turn = memo(function Turn({ e, results, running, last, phone, onHold }: {
  e: Extract<Entry, { t: "turn" }>;
  results: Map<string, Res>;
  running: string | null;
  last: boolean;
  phone: boolean;
  onHold: (text: string) => void;
}) {
  const hold = useLongPress(() => onHold(e.text), phone && !!e.text);
  return (
    <div className="group/turn my-3 animate-cv-rise">
      {e.pieces.map((p) => {
        switch (p.t) {
          case "text":
            return (
              <div key={p.key} className={cn("my-3", phone && "select-none [-webkit-touch-callout:none]")} {...hold}>
                <Markdown text={p.text} />
              </div>
            );
          case "thinking":
            return <Thinking key={p.key} text={p.text} ms={p.ms} />;
          case "tool":
            return <ToolCall key={p.key} use={p.use} res={results.get(p.use.id)} running={p.use.id === running} />;
          case "group":
            return <ToolGroup key={p.key} uses={p.uses} results={results} running={running} />;
        }
      })}
      {e.text && <Actions text={e.text} ts={e.ts} show={last} />}
    </div>
  );
});

function UserBubble({ m, phone, onHold }: { m: CvMessage; phone: boolean; onHold: (text: string) => void }) {
  const text = textOf(m);
  const images = m.blocks.filter((b) => b.k === "image").length;
  const hold = useLongPress(() => onHold(text), phone && !!text);
  if (m.kind === "output") {
    return <pre className="cv-scroll my-2 overflow-x-auto rounded-cv-md bg-cv-sunken px-3.5 py-2.5 font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2">{text}</pre>;
  }
  if (m.kind === "summary") {
    return (
      <details className="group/sum my-4 rounded-cv-md border border-cv-line-soft px-4 py-2.5 font-cv-sans text-cv-ui text-cv-muted">
        <summary className="flex cursor-pointer list-none items-center gap-2">
          <span className="flex-1">Summary of the earlier conversation</span>
          <ChevronRight size={15} className="transition-transform group-open/sum:rotate-90" />
        </summary>
        <div className="mt-3"><Markdown text={text} compact /></div>
      </details>
    );
  }
  return (
    <div className="group/user my-5 flex flex-col items-end gap-1.5 animate-cv-rise">
      {images > 0 && (
        <div className="flex gap-1.5">
          {Array.from({ length: Math.min(images, 4) }, (_, i) => (
            <div key={i} className="grid size-14 place-items-center rounded-cv-md border border-cv-line-soft bg-cv-surface text-cv-muted">
              <ImageIcon size={20} strokeWidth={1.6} />
            </div>
          ))}
          {images > 4 && <div className="grid size-14 place-items-center rounded-cv-md bg-cv-chip font-cv-sans text-cv-meta text-cv-muted">+{images - 4}</div>}
        </div>
      )}
      {text && (
        <div className="flex w-full items-end justify-end gap-1.5">
          <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100 [[data-mode=phone]_&]:hidden">
            {m.ts > 0 && <span className="mr-1 font-cv-sans text-cv-meta text-cv-muted">{time(m.ts)}</span>}
            <CopyButton text={text} label="Copy" />
          </div>
          <div
            {...hold}
            className={cn(
              "max-w-4/5 rounded-cv-bubble bg-cv-bubble px-4 py-2.5 font-cv-sans text-cv-ui whitespace-pre-wrap text-cv-text [overflow-wrap:anywhere]",
              m.kind === "command" && "font-cv-mono text-cv-code",
              phone && "select-none [-webkit-touch-callout:none]",
            )}
          >
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ m }: { m: CvMessage }) {
  const text = textOf(m);
  if (m.kind === "output") return <pre className="cv-scroll my-2 overflow-x-auto rounded-cv-md bg-cv-sunken px-3.5 py-2.5 font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2">{text}</pre>;
  return (
    <div className="my-5 flex items-center gap-3 font-cv-sans text-cv-meta text-cv-muted">
      <span className="h-px flex-1 bg-cv-line-soft" />
      <span className="max-w-4/5 truncate">{text}</span>
      <span className="h-px flex-1 bg-cv-line-soft" />
    </div>
  );
}

export function Transcript({ messages, results, running, working, phone, onCopied }: {
  messages: CvMessage[];
  results: Map<string, Res>;
  /** The tool call that is running now, if any. */
  running: string | null;
  working: boolean;
  phone: boolean;
  onCopied: (what: string) => void;
}) {
  const entries = useMemo(() => toEntries(messages), [messages]);
  const [held, setHeld] = useState<string | null>(null);
  const lastTurn = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.t === "turn") return entries[i]!.key;
    return null;
  }, [entries]);
  return (
    <>
      {entries.map((e) =>
        e.t === "user" ? (
          <UserBubble key={e.key} m={e.m} phone={phone} onHold={setHeld} />
        ) : e.t === "system" ? (
          <Notice key={e.key} m={e.m} />
        ) : (
          <Turn key={e.key} e={e} results={results} running={running} last={e.key === lastTurn && !working} phone={phone} onHold={setHeld} />
        ),
      )}
      {phone && <ActionSheet text={held} onClose={() => setHeld(null)} onCopied={onCopied} />}
    </>
  );
}
