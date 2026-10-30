// The swarm conversation: runs of messages, day labels, your bubbles, jump to the latest.
import type { SwarmMessage } from "@neuralagent/protocol";
import { IconButton, Pill, cn } from "@neuralagent/ui";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clock, dayLabel } from "../../lib/agentui";
import { feedBlocks, toLabel } from "../../lib/swarmFeed";
import { RoleMark } from "./members";

const EDGE_Y: CSSProperties = {
  maskImage: "linear-gradient(180deg, transparent, black 16px, black calc(100% - 16px), transparent)",
  WebkitMaskImage: "linear-gradient(180deg, transparent, black 16px, black calc(100% - 16px), transparent)",
};

/** Within this distance of the end the feed counts as "at the bottom" and follows new messages. */
const NEAR_END = 160;

/**
 * The team's conversation: runs of messages (name once per run), day labels, your own messages as
 * bubbles on the right, messages to you lifted in a soft accent card. It follows new messages
 * while you are at the end; scrolled up, a round button brings you back down.
 * `top` scrolls along above the messages (the goal and team on phones).
 */
export function SwarmFeed({ messages, ended, startedAt, top, className }: { messages: SwarmMessage[]; ended: boolean; startedAt: number; top?: ReactNode; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const blocks = useMemo(() => feedBlocks(messages), [messages]);

  const toEnd = (smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };
  // Open at the latest message.
  useLayoutEffect(() => toEnd(false), []);
  // Follow the conversation while at the end.
  useEffect(() => {
    if (!away) toEnd(true);
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scroller.current;
    if (el) setAway(el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_END);
  };

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div ref={scroller} onScroll={onScroll} data-swarm-feed="" className="scroller h-full overflow-y-auto" style={EDGE_Y}>
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-4 pb-6 @2xl:px-8">
          {top}
          <Divider>
            {dayLabel(startedAt) === "Today" ? "" : `${dayLabel(startedAt)} · `}Started {clock(startedAt)}
          </Divider>
          {messages.length === 0 ? (
            <p className="py-10 text-center text-subhead text-dim">{ended ? "No messages were sent." : "The team is reading the goal. Their messages to each other appear here."}</p>
          ) : (
            blocks.map((b) =>
              b.kind === "run" ? <Run key={b.key} from={b.from} to={b.to} items={b.items} /> : dayLabel(b.at) === dayLabel(startedAt) ? null : <Divider key={b.key}>{dayLabel(b.at)}</Divider>,
            )
          )}
          {ended && messages.length > 0 && <Divider>Swarm ended</Divider>}
        </div>
      </div>
      {away && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 fade-in">
          <IconButton label="Jump to the latest message" variant="fill" size="sm" onClick={() => toEnd(true)} className="glass">
            <ArrowDown />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-3 flex items-center gap-3 text-caption text-faint first:mt-0" role="separator">
      <span className="h-px flex-1 bg-line" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Queued() {
  return (
    <Pill size="sm" tone="neutral" className="ml-1.5 align-middle">
      Queued
    </Pill>
  );
}

/** A run of messages from one sender to one recipient. */
function Run({ from, to, items }: { from: string; to: string; items: SwarmMessage[] }) {
  if (from === "You") {
    return (
      <div className="mt-4 flex flex-col items-end gap-1">
        <span className="flex items-center gap-1 px-1 text-caption text-dim">
          You <ArrowRight className="size-3 text-faint" /> {toLabel(to)} · <span className="tabular">{clock(items[0]!.at)}</span>
        </span>
        {items.map((m) => (
          <div key={m.id} style={{ maxWidth: "80%" }} className="rounded-card rounded-br-chip bg-accent-deep px-3.5 py-2 text-body break-words whitespace-pre-wrap text-on-color">
            {m.text}
          </div>
        ))}
      </div>
    );
  }
  const forYou = to.toLowerCase() === "you";
  return (
    <div className={cn("mt-4 flex gap-3", forYou && "-mx-3 rounded-list bg-accent/10 px-3 py-2.5")}>
      <span className="pt-0.5">
        <RoleMark role={from} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-headline text-bright">{from}</span>
          <ArrowRight className="size-3 shrink-0 self-center text-faint" aria-label="to" />
          <span className={cn("min-w-0 truncate text-footnote", forYou ? "text-accent" : "text-dim")}>{toLabel(to)}</span>
          <span className="ml-auto shrink-0 pl-2 text-caption text-faint tabular">{clock(items[0]!.at)}</span>
        </div>
        <div className="mt-0.5 flex flex-col gap-1.5">
          {items.map((m) => (
            <p key={m.id} className="text-body break-words whitespace-pre-wrap text-ink">
              {m.text}
              {!m.delivered && <Queued />}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
