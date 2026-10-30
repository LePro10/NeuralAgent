/**
 * The Claude Code UI over the real CLI, dressed like Anthropic's own apps: the conversation is
 * read from Claude's transcript by the daemon, input and commands go into the CLI's terminal.
 * Menus that only exist in the terminal UI open the live terminal on top, so every CLI function
 * stays reachable.
 */
import type { Session } from "@neuralagent/protocol";
import { cn, useLayoutMode } from "@neuralagent/ui";
import { ArrowDown, Check, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useClient } from "../../lib/store";
import { KeyBar } from "../KeyBar";
import { TerminalView } from "../TerminalView";
import { Composer } from "./Composer";
import { modelName } from "./models";
import { PromptCard } from "./PromptCard";
import { Spark } from "./Spark";
import { CwdContext, type Res, type Use } from "./tools";
import { Transcript } from "./Transcript";
import { useConversation } from "./useConversation";

/** Sizes the CLI draws at while the view is shown (menus stay readable, nothing wraps oddly). */
const VIEW_COLS = 110;
const VIEW_ROWS = 36;

export function ClaudeView({ session, webgl, onFocus }: { session: Session; webgl: boolean; onFocus: () => void }) {
  const sid = session.id;
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const { conv, loadOlder, loadingOlder } = useConversation(sid, session.started_at);
  const [terminal, setTerminal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  // Results by tool call, so a call shows its output under it.
  const results = useMemo(() => {
    const m = new Map<string, Res>();
    for (const msg of conv.messages) for (const b of msg.blocks) if (b.k === "tool_result") m.set(b.tool_use_id, b);
    return m;
  }, [conv.messages]);

  const working = session.alive && (session.status === "working" || !!conv.meta.activity);

  // The newest tool call without a result: running now, or waiting for the permission card.
  const open = useMemo((): Use | null => {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const blocks = conv.messages[i]!.blocks;
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j]!;
        if (b.k === "tool_use") return results.has(b.id) ? null : b;
      }
      if (conv.messages[i]!.role === "user" && !conv.messages[i]!.blocks.some((b) => b.k === "tool_result")) return null;
    }
    return null;
  }, [conv.messages, results]);
  const running = working || conv.prompt ? (open?.id ?? null) : null;

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
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    setAway(farFromEnd(el));
  }, [conv.messages, conv.prompt, conv.meta.activity, working]);

  // The keyboard or a growing composer shrinks the scroller: keep the newest line in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // No scroll event fires when the content stops overflowing (the permission card closed):
    // measure again, or "Scroll to latest" stays up at the bottom.
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      setAway(farFromEnd(el));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = !farFromEnd(el);
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

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const empty = conv.ready && conv.messages.length === 0;
  // Desktop, new chat: greeting and composer sit together in the middle, like claude.ai.
  const centred = empty && !phone && !conv.prompt;

  return (
    <CwdContext.Provider value={session.cwd}>
      <div className="relative flex h-full min-h-0 flex-col bg-cv-bg font-cv-sans text-cv-text" onMouseDown={onFocus}>
        <div ref={scroller} onScroll={onScroll} className={cn("cv-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain", centred && "flex flex-col justify-end")}>
          <div className={cn("mx-auto flex w-full max-w-3xl flex-col px-4 pt-4 pb-6 [[data-mode=desktop]_&]:px-6", !centred && "min-h-full")}>
            {conv.more && <div className="py-2 text-center text-cv-meta text-cv-muted">{loadingOlder ? "Loading earlier messages…" : "Scroll up for earlier messages"}</div>}
            {empty && <Greeting model={conv.meta.model} cwd={session.cwd} centred={centred} />}
            <Transcript messages={conv.messages} results={results} running={running} working={working} phone={phone} onCopied={showToast} />
            {working && !conv.prompt && <Activity text={conv.meta.activity} />}
            {!session.alive && <div className="py-4 text-center text-cv-meta text-cv-muted">This session has ended.</div>}
          </div>
        </div>

        <div className={cn("relative mx-auto w-full max-w-3xl shrink-0 px-3 [[data-mode=desktop]_&]:px-5", centred && "flex-1")} style={{ paddingBottom: phone ? "max(10px, calc(var(--safe-bottom) - var(--tabbar-space, 0px)))" : 16 }}>
          {/* Text fades out under the dock instead of being cut off. */}
          {!centred && <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-b from-transparent to-cv-bg" />}
          <div className="pointer-events-none absolute inset-x-0 -top-12 z-10 flex justify-center">
            {toast ? (
              <div role="status" className="flex items-center gap-1.5 rounded-full bg-cv-primary px-3.5 py-1.5 text-cv-meta text-cv-on-primary shadow-cv-pill animate-cv-pop">
                <Check size={14} strokeWidth={2.4} /> {toast}
              </div>
            ) : (
              away && (
                <button type="button" onClick={toBottom} aria-label="Scroll to latest" className="pointer-events-auto grid size-9 place-items-center rounded-full border border-cv-line bg-cv-surface text-cv-text-2 shadow-cv-pill transition-colors animate-cv-pop hover:text-cv-text">
                  <ArrowDown size={17} strokeWidth={2} />
                </button>
              )
            )}
          </div>
          {conv.prompt && session.alive && <PromptCard sid={sid} prompt={conv.prompt} pending={open} cwd={session.cwd} phone={phone} onTerminal={() => setTerminal("menu")} />}
          <Composer
            sid={sid}
            meta={conv.meta}
            busy={working}
            phone={phone}
            empty={empty}
            disabled={!session.alive}
            onTerminal={(why) => setTerminal(why)}
            onSubmitted={() => {
              stick.current = true;
              requestAnimationFrame(toBottom);
            }}
          />
        </div>

        {terminal && (
          <div className="absolute inset-0 z-40 flex flex-col bg-cv-bg animate-cv-rise">
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
    </CwdContext.Provider>
  );
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

/** More than a few lines below the visible part. */
const farFromEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
