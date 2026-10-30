/**
 * The Claude Code UI over the real CLI: the conversation is read from Claude's transcript by
 * the daemon, input and commands go into the CLI's terminal. Menus that only exist in the
 * terminal UI open the live terminal in a sheet, so every CLI function stays reachable.
 */
import type { CvBlock, CvMessage, CvPrompt, Session } from "@neuralagent/protocol";
import { cn, useLayoutMode } from "@neuralagent/ui";
import { Asterisk, ArrowDown, ChevronRight, SquareTerminal, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useClient } from "../../lib/store";
import { KeyBar } from "../KeyBar";
import { TerminalView } from "../TerminalView";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { modelName } from "./models";
import { ToolCall } from "./tools";
import { useConversation } from "./useConversation";

type Use = Extract<CvBlock, { k: "tool_use" }>;
type Res = Extract<CvBlock, { k: "tool_result" }>;

/** Sizes the CLI draws at while the view is shown (menus stay readable, nothing wraps oddly). */
const VIEW_COLS = 110;
const VIEW_ROWS = 36;

export function ClaudeView({ session, webgl, onFocus }: { session: Session; webgl: boolean; onFocus: () => void }) {
  const sid = session.id;
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const { conv, loadOlder, loadingOlder } = useConversation(sid, session.started_at);
  const [terminal, setTerminal] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  // Results by tool call, so a call shows its output under it.
  const results = useMemo(() => {
    const m = new Map<string, Res>();
    for (const msg of conv.messages) for (const b of msg.blocks) if (b.k === "tool_result") m.set(b.tool_use_id, b);
    return m;
  }, [conv.messages]);

  const working = session.status === "working" || !!conv.meta.activity;

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

  // Stay at the bottom while new things arrive, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [conv.messages, conv.prompt, conv.meta.activity, working]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAway(!near);
    if (el.scrollTop < 200 && conv.more) void loadOlder();
  };
  // Keep the reading position when older messages are added on top.
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (loadingOlder) prevHeight.current = el.scrollHeight;
    else if (prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
    }
  }, [loadingOlder, conv.messages.length]);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stick.current = true;
  }, []);

  const visible = conv.messages;
  const lastToolUse = useMemo(() => {
    for (let i = visible.length - 1; i >= 0; i--) {
      const b = [...visible[i]!.blocks].reverse().find((x): x is Use => x.k === "tool_use");
      if (b) return b.id;
    }
    return null;
  }, [visible]);

  return (
    <div className="@container relative flex h-full min-h-0 flex-col bg-chrome" onMouseDown={onFocus}>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-4 pb-2">
          {conv.more && <div className="py-2 text-center text-meta text-faint">{loadingOlder ? "Loading earlier messages…" : "Scroll up for earlier messages"}</div>}
          {conv.ready && visible.length === 0 && <EmptyState session={session} model={conv.meta.model} />}
          {visible.map((m) => (
            <Message key={m.id || m.i} m={m} results={results} running={working && !session.alive ? false : working} lastToolUse={lastToolUse} />
          ))}
          {working && <Activity text={conv.meta.activity} />}
          {conv.prompt && <PromptCard sid={sid} prompt={conv.prompt} onTerminal={() => setTerminal("menu")} />}
          {!session.alive && <div className="py-3 text-center text-small text-faint">This session has ended.</div>}
        </div>
      </div>
      {away && (
        <button type="button" onClick={toBottom} aria-label="Scroll to latest" className="glass absolute right-4 bottom-36 z-10 grid size-9 place-items-center rounded-full text-ink shadow-float">
          <ArrowDown size={16} />
        </button>
      )}
      <div className="mx-auto w-full max-w-3xl">
        <ContextMeter tokens={conv.meta.context_tokens} model={conv.meta.model} />
        <Composer
          sid={sid}
          meta={conv.meta}
          busy={working}
          phone={phone}
          disabled={!session.alive}
          onTerminal={(why) => setTerminal(why)}
          onSubmitted={() => {
            stick.current = true;
            requestAnimationFrame(toBottom);
          }}
        />
      </div>
      {terminal && (
        <div className="absolute inset-0 z-40 flex flex-col bg-chrome">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
            <SquareTerminal size={14} className="text-dim" />
            <span className="flex-1 truncate text-detail text-dim">{terminal.startsWith("/") ? `${terminal} runs in the terminal` : "Terminal"}</span>
            <button type="button" onClick={() => setTerminal(null)} className="hoverable flex h-7 items-center gap-1.5 rounded-full px-3 text-chip text-bright">
              <X size={14} /> Done
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <TerminalView sid={sid} focused startedAt={session.started_at} webgl={webgl} touch={phone} onFocus={onFocus} />
          </div>
          {phone && <KeyBar sid={sid} />}
        </div>
      )}
    </div>
  );
}

function EmptyState({ session, model }: { session: Session; model?: string | null }) {
  return (
    <div className="m-auto flex flex-col items-center gap-3 py-16 text-center">
      <Asterisk size={34} className="text-ember" strokeWidth={1.6} />
      <div className="text-title font-light text-bright">What can I help with?</div>
      <div className="max-w-sm text-small text-dim">
        {modelName(model)} in <span className="font-mono">{session.cwd.split(/[\\/]/).slice(-2).join("/")}</span>. Type <span className="font-mono text-ink">/</span> for commands, <span className="font-mono text-ink">@</span> for files.
      </div>
    </div>
  );
}

function Activity({ text }: { text?: string | null }) {
  const label = text ? text.replace(/\(\s*esc to interrupt\s*\)/i, "").replace(/·?\s*esc to interrupt/i, "").replace(/\(\s*\)/, "").replace(/^\S\s+/, "").trim() : "";
  return (
    <div className="my-3 flex items-center gap-2 text-body text-ember" role="status" aria-live="polite">
      <Asterisk size={16} className="animate-spin [animation-duration:2.4s]" strokeWidth={1.8} />
      <span className="truncate">{label || "Working…"}</span>
    </div>
  );
}

function ContextMeter({ tokens, model }: { tokens?: number | null; model?: string | null }) {
  if (!tokens) return null;
  const limit = /\[1m\]|1m/i.test(model ?? "") ? 1_000_000 : 200_000;
  const pct = Math.min(100, Math.round((tokens / limit) * 100));
  return (
    <div className="flex items-center gap-2 px-5 pb-1 text-tiny text-faint" title={`${tokens.toLocaleString()} tokens in the context`}>
      <div className="h-0.5 w-16 overflow-hidden rounded-full bg-fill-3">
        <div className={cn("h-full rounded-full", pct > 85 ? "bg-warning" : "bg-dim")} style={{ width: `${pct}%` }} />
      </div>
      {pct}% of context
    </div>
  );
}

function PromptCard({ sid, prompt, onTerminal }: { sid: string; prompt: CvPrompt; onTerminal: () => void }) {
  const client = useClient();
  return (
    <div className="my-3 rounded-list bg-card p-4 shadow-edge" role="group" aria-label="Claude is asking">
      {prompt.title && <div className="mb-3 text-body whitespace-pre-wrap text-bright [overflow-wrap:anywhere]">{prompt.title}</div>}
      <div className="flex flex-col gap-1.5">
        {prompt.options.map((o) => (
          <button
            key={o.n}
            type="button"
            onClick={() => client.write(sid, o.n)}
            className={cn("hoverable flex items-start gap-3 rounded-item px-3 py-2 text-left text-body text-ink", o.selected ? "bg-fill-3" : "bg-fill-1")}
          >
            <span className="mt-px w-4 shrink-0 text-dim">{o.n}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-meta text-faint">
        <button type="button" className="hoverable rounded-full px-2.5 py-1" onClick={() => client.write(sid, "\x1b")}>Cancel (Esc)</button>
        <button type="button" className="hoverable flex items-center gap-1 rounded-full px-2.5 py-1" onClick={onTerminal}>
          Open terminal <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

function Message({ m, results, running, lastToolUse }: { m: CvMessage; results: Map<string, Res>; running: boolean; lastToolUse: string | null }) {
  const text = m.blocks.filter((b): b is Extract<CvBlock, { k: "text" }> => b.k === "text").map((b) => b.text).join("\n\n");
  if (m.role === "system") {
    if (m.kind === "output") return <pre className="my-2 overflow-x-auto rounded-item bg-fill-1 px-3 py-2 font-mono text-small whitespace-pre-wrap text-dim shadow-well">{text}</pre>;
    return (
      <div className="my-3 flex items-center gap-3 text-meta text-faint">
        <span className="h-px flex-1 bg-line" />
        <span className="max-w-4/5 truncate">{text}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  if (m.role === "user") {
    const images = m.blocks.filter((b) => b.k === "image").length;
    if (!text && !images) return null; // tool results are shown under their calls
    if (m.kind === "command") return <div className="my-3 self-end rounded-list bg-fill-3 px-4 py-2 font-mono text-body text-bright">{text}</div>;
    if (m.kind === "output") return <pre className="my-2 overflow-x-auto rounded-item bg-fill-1 px-3 py-2 font-mono text-small whitespace-pre-wrap text-dim shadow-well">{text}</pre>;
    if (m.kind === "summary") {
      return (
        <details className="my-3 rounded-item bg-fill-1 px-3 py-2 text-small text-dim">
          <summary className="cursor-pointer">Summary of the earlier conversation</summary>
          <div className="mt-2"><Markdown text={text} /></div>
        </details>
      );
    }
    return (
      <div className="my-3 flex flex-col items-end gap-1.5">
        {images > 0 && <div className="rounded-item bg-fill-2 px-3 py-1.5 text-small text-dim">{images === 1 ? "Image attached" : `${images} images attached`}</div>}
        {text && <div className="max-w-11/12 rounded-list bg-fill-3 px-4 py-2.5 text-body whitespace-pre-wrap text-bright [overflow-wrap:anywhere]">{text}</div>}
      </div>
    );
  }
  return (
    <div className="my-2">
      {m.blocks.map((b, i) => {
        switch (b.k) {
          case "text":
            return <div key={i} className="my-2"><Markdown text={b.text} /></div>;
          case "thinking":
            return <Thinking key={i} text={b.text} />;
          case "tool_use":
            return <ToolCall key={b.id || i} use={b} res={results.get(b.id)} running={running && b.id === lastToolUse} />;
          default:
            return <Fragment key={i} />;
        }
      })}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return <div className="my-1.5 flex items-center gap-2 text-small text-faint"><Asterisk size={13} strokeWidth={1.6} /> Thought</div>;
  return (
    <div className="my-1.5">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 text-small text-faint hover:text-dim" aria-expanded={open}>
        <Asterisk size={13} strokeWidth={1.6} /> Thinking <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
      </button>
      {open && <div className="mt-1 ml-5 border-l border-line pl-3 text-small whitespace-pre-wrap text-dim">{text}</div>}
    </div>
  );
}
