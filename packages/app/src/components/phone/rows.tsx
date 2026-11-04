// Phones: the rows of the Agents inbox and a project's page. One row per agent (quiet engine tile,
// title, "project · 3m", one status word), and for an agent that waits for you the question with
// an answer right in the row: Allow / Deny for a permission, a reply field when it waits for the
// next prompt.
import type { AgentStatus, CvPrompt, Session } from "@neuralagent/protocol";
import { SwipeRow, cn, haptic, toast, type SwipeAction } from "@neuralagent/ui";
import { ArrowUp, ChevronDown, ChevronRight, RotateCw, Square, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { humanError } from "../../lib/agentReason";
import { agentSays, shortAgo } from "../../lib/agentui";
import { activityOf } from "../../lib/status";
import { useClient, useDaemon } from "../../lib/store";
import { asPermission, parseTitle } from "../claude/PromptCard";
import { EngineTile } from "../EngineTile";

/** One status word per row; colour only where it says something (waiting, finished, failed). */
const WORD: Record<AgentStatus, { label: string; tone: string }> = {
  waiting: { label: "Needs you", tone: "text-accent" },
  error: { label: "Error", tone: "text-danger" },
  working: { label: "Working", tone: "text-dim" },
  starting: { label: "Starting", tone: "text-dim" },
  done: { label: "Done", tone: "text-ember" },
  idle: { label: "Idle", tone: "text-faint" },
  exited: { label: "Stopped", tone: "text-faint" },
};
export const wordOf = (s: Session) => (s.alive || s.status === "error" ? WORD[s.status] : WORD.exited);

/** How many waiting rows may follow their CLI's menu live (each is a conversation subscription). */
export const LIVE_ANSWERS = 4;

function Line({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("block truncate text-footnote text-dim", className)}>{children}</span>;
}

export function AgentInboxRow({ s, engine, project, now, live, onOpen, onClose }: {
  s: Session;
  engine: string;
  project?: string;
  now: number;
  /** May subscribe to the agent's menu to answer it here. */
  live?: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const client = useClient();
  const notices = useDaemon((c) => c.state?.orchestrator?.messages);
  const w = wordOf(s);
  const waiting = s.alive && s.status === "waiting";
  const said = agentSays(s, notices);
  const act = (r: Parameters<typeof client.req>[0]) => client.req(r).then(() => {}, (e) => void toast((e as Error).message, { tone: "danger" }));
  const trailing: SwipeAction[] = [
    s.alive ? { label: "Stop", Icon: Square, tone: "warning", onAction: () => void act({ m: "session_stop", p: { id: s.id } }) } : { label: "Restart", Icon: RotateCw, tone: "accent", onAction: () => void act({ m: "session_restart", p: { id: s.id } }) },
    { label: "Close", Icon: Trash2, tone: "danger", onAction: onClose },
  ];
  return (
    <SwipeRow trailing={trailing}>
      <div data-lead="" className="flex w-full flex-col">
        <button type="button" onClick={onOpen} className="press-row flex min-h-row-2 w-full min-w-0 items-center gap-3 py-2.5 pl-4 text-left">
          <EngineTile engine={engine} round activity={s.alive ? activityOf([s.status]) : undefined} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body text-bright">{s.title}</span>
            <Line>{[project, shortAgo(s.status_since, now)].filter(Boolean).join(" · ")}</Line>
          </span>
          <span className={cn("shrink-0 text-footnote", w.tone)}>{w.label}</span>
          <ChevronRight strokeWidth={2.2} className="mr-3 size-icon-sm shrink-0 text-faint" />
        </button>
        {waiting && <Answer s={s} engine={engine} said={said} live={!!live} onOpen={onOpen} />}
        {s.status === "error" && <ErrorLine raw={said || s.last_line} />}
      </div>
    </SwipeRow>
  );
}

/** Why an agent failed, in plain words; tap shows the raw text it came from. */
export function ErrorLine({ raw, className }: { raw?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const { text, detail } = humanError(raw);
  const pad = className ?? "-mt-1 pr-4 pb-3 ml-7 pl-icon-tile";
  if (!detail) return <p className={cn(pad, "line-clamp-2 text-footnote text-dim")}>{text}</p>;
  return (
    <div className={pad}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-tap w-full items-center gap-1 text-left text-footnote text-dim">
        <span className="line-clamp-2 min-w-0">{text}</span>
        <ChevronDown strokeWidth={2.2} className={cn("size-icon-sm shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && <p className="mt-1 rounded-tile bg-fill-1 px-3 py-2 font-mono text-caption break-all whitespace-pre-wrap text-dim select-text">{detail}</p>}
    </div>
  );
}

/** The CLI's menu of one agent, live (only the menu; the transcript is not kept). */
function usePrompt(sid: string, on: boolean): CvPrompt | null | undefined {
  const client = useClient();
  const [prompt, setPrompt] = useState<CvPrompt | null | undefined>(undefined);
  useEffect(() => {
    if (!on) return setPrompt(undefined);
    return client.attachCv(sid, {
      reset: (r) => setPrompt(r.prompt ?? null),
      event: (ev) => {
        if (ev.k === "prompt") setPrompt(ev.prompt ?? null);
      },
    });
  }, [client, sid, on]);
  return prompt;
}

/** Under a waiting agent: its question, and the answer when it is a tap (or a line of text). */
function Answer({ s, engine, said, live, onOpen }: { s: Session; engine: string; said: string; live: boolean; onOpen: () => void }) {
  const client = useClient();
  const prompt = usePrompt(s.id, live && engine === "claude");
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const perm = prompt ? asPermission(prompt) : null;
  const parsed = prompt ? parseTitle(prompt.title) : null;
  const question = parsed ? parsed.question || parsed.header : said;
  const choose = (n: string) => {
    haptic("select");
    setSent(true);
    client.write(s.id, n);
  };
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSent(true);
    try {
      await client.req({ m: "session_prompt", p: { id: s.id, text: t } });
      setText("");
      setReplying(false);
    } catch (e) {
      setSent(false);
      toast((e as Error).message, { tone: "danger" });
    }
  };
  if (sent) return <p className="-mt-1 pr-4 pb-3 ml-7 pl-icon-tile text-footnote text-dim">Sent</p>;
  return (
    <div className="-mt-1 flex flex-col gap-2.5 pr-4 pb-3 ml-7 pl-icon-tile">
      {question && <p className="line-clamp-3 text-subhead text-ink">{question}</p>}
      {perm ? (
        <div className="flex flex-wrap gap-2">
          <Chip primary onClick={() => choose(perm.allow)}>Allow</Chip>
          {perm.deny && <Chip onClick={() => choose(perm.deny!)}>Deny</Chip>}
          <Chip quiet onClick={onOpen}>Details</Chip>
        </div>
      ) : prompt ? (
        <div className="flex flex-wrap gap-2">
          <Chip primary onClick={onOpen}>Answer</Chip>
        </div>
      ) : replying ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Reply to ${s.title}`}
            enterKeyHint="send"
            className="min-h-tap min-w-0 flex-1 rounded-full bg-fill-2 px-4 text-body text-bright placeholder:text-faint focus:outline-none"
          />
          <button type="submit" aria-label="Send" disabled={!text.trim()} className="grid size-tap shrink-0 place-items-center rounded-full bg-accent-deep text-on-color disabled:opacity-40">
            <ArrowUp className="size-icon-sm" strokeWidth={2.4} />
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Chip primary onClick={() => setReplying(true)}>Reply</Chip>
          <Chip quiet onClick={onOpen}>Open</Chip>
        </div>
      )}
    </div>
  );
}

function Chip({ children, onClick, primary, quiet }: { children: ReactNode; onClick: () => void; primary?: boolean; quiet?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pressable min-h-control rounded-full px-4 text-subhead",
        primary ? "bg-accent-deep text-on-color" : quiet ? "text-dim" : "bg-fill-2 text-bright",
      )}
    >
      {children}
    </button>
  );
}
