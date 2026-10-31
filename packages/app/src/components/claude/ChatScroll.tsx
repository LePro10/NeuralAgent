/**
 * The scrolling transcript of a conversation (main or subagent): `useStickToBottom` wired to the
 * entries, older history on scroll up, and the "↓" pill. The pill sits in its own band between
 * the transcript and the composer, shown only while the reader is away from the end, so it never
 * covers text and there is no fade.
 */
import { cn } from "@neuralagent/ui";
import { ArrowDown } from "lucide-react";
import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import type { CvMessage } from "@neuralagent/protocol";
import type { Entry } from "./entries";
import { Transcript } from "./Transcript";
import { useStickToBottom } from "./useStickToBottom";

export interface ChatScrollHandle {
  toBottom: (o?: { smooth?: boolean }) => void;
}

export interface ChatScrollProps {
  entries: Entry[];
  /** Another conversation (or after a reconnect reset): start at its end. */
  resetKey: string;
  more: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  running: ReadonlySet<string>;
  working: boolean;
  waiting: boolean;
  phone: boolean;
  onCopied: (what: string) => void;
  onRewind?: (m: CvMessage) => void;
  /** The main chat on a phone: content starts below the floating Island (`.cv-transcript`). */
  island?: boolean;
  /** Desktop new chat: greeting and composer sit together in the middle. */
  centred?: boolean;
  /** Above the first entry (greeting). */
  top?: ReactNode;
  /** After the last entry (activity, "session ended"). */
  bottom?: ReactNode;
}

export const ChatScroll = forwardRef<ChatScrollHandle, ChatScrollProps>(function ChatScroll(p, ref) {
  const stick = useStickToBottom({
    count: p.entries.length,
    firstKey: p.entries[0]?.key ?? null,
    resetKey: p.resetKey,
    more: p.more,
    loadingOlder: p.loadingOlder,
    onNearTop: p.loadOlder,
  });
  useImperativeHandle(ref, () => ({ toBottom: stick.toBottom }), [stick.toBottom]);
  const away = !stick.pinned && !p.centred;
  const label = stick.unseen > 0 ? `${stick.unseen} new` : p.working ? "Claude is working" : "";
  return (
    <>
      <div ref={stick.scrollerRef} className={cn("cv-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain", p.island && "cv-transcript", p.centred && "flex flex-col justify-end")}>
        <div ref={stick.contentRef} className={cn("mx-auto flex w-full max-w-3xl flex-col px-4 pt-4 pb-6 [[data-mode=desktop]_&]:px-6", !p.centred && "min-h-full")}>
          <div ref={stick.sentinelRef} aria-hidden className="h-px shrink-0" />
          {p.more && <div className="py-2 text-center text-cv-meta text-cv-muted">{p.loadingOlder ? "Loading earlier messages…" : "Earlier messages"}</div>}
          {p.top}
          <Transcript entries={p.entries} running={p.running} working={p.working} waiting={p.waiting} phone={p.phone} onCopied={p.onCopied} onRewind={p.onRewind} />
          {p.bottom}
        </div>
      </div>
      {away && (
        <div className="flex h-11 shrink-0 items-center justify-center">
          <button
            type="button"
            onClick={() => stick.toBottom({ smooth: true })}
            aria-label={label ? `${label}, scroll to latest` : "Scroll to latest"}
            className={cn(
              "flex h-8 items-center justify-center gap-1.5 rounded-full border border-cv-line bg-cv-surface text-cv-meta text-cv-text-2 shadow-cv-pill transition-colors animate-cv-pop hover:text-cv-text",
              label ? "pr-3.5 pl-2.5" : "w-8",
            )}
          >
            <ArrowDown size={15} strokeWidth={2} />
            {label && <span className={cn(stick.unseen === 0 && "text-cv-clay")}>{label}</span>}
          </button>
        </div>
      )}
    </>
  );
});
