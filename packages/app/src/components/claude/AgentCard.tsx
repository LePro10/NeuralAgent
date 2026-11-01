/**
 * Subagents in the transcript (A3 §2.7, D65): one card per Agent/Task call with its type, what it
 * was asked to do, live status, last step, time and tokens, and a short excerpt of its report.
 * The whole card is one button that opens the subagent's own transcript: at once when the daemon
 * knows the agent's id, and otherwise as soon as it does (the view waits for it).
 *
 * The parent's tool result of a background launch ("Async agent launched successfully…") is
 * internal metadata and never shown; the real outcome comes from the task (`CvTask`) or a
 * `task_note`.
 */
import type { CvTask } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { ChevronRight } from "lucide-react";
import { createContext, memo, useContext } from "react";
import { plainText } from "./Markdown";
import { inputOf, isAsyncLaunch, metaOf, str, type Res, type Use } from "./toolText";
import { useNow } from "./useWork";
import { agentIdOf, detailOf, isLive, statusOf, typeOf, type WorkStatus } from "./work";
import { WorkGlyph, WorkStatusLine } from "./WorkRow";

/** What opening a subagent needs: its id (or, before the daemon linked it, its tool call's). */
export interface AgentRef {
  id: string;
  title: string;
  /** The Agent call that started it: finds the task while `id` is still the call's id. */
  toolUseId?: string;
}

/** The conversation's background tasks and how to open a subagent (provided by the view). */
export const TasksContext = createContext<{ tasks: CvTask[]; open?: (a: AgentRef) => void }>({ tasks: [] });

function statusFor(res: Res | undefined, task: CvTask | undefined, open: boolean): WorkStatus {
  if (task) return statusOf(task);
  if (!res) return open ? "running" : "stopped";
  if (isAsyncLaunch(res)) return "background";
  return res.is_error ? "failed" : "done";
}

const excerpt = (s?: string) => {
  const t = plainText(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > 220 ? `${t.slice(0, 219)}…` : t;
};

export const AgentCard = memo(function AgentCard({ use, res, running }: { use: Use; res?: Res; running: boolean }) {
  const { tasks, open } = useContext(TasksContext);
  const task = tasks.find((t) => t.tool_use_id === use.id);
  const meta = metaOf(res);
  const input = inputOf(use);
  const desc = task?.description || str(input.description) || "Subagent";
  const status = statusFor(res, task, running);
  const live = isLive(status);
  const now = useNow(live && !!task?.started);
  // A task the daemon knows, or the parts the transcript gives (older daemon, sync result).
  const shown: CvTask = task ?? {
    id: use.id,
    kind: "agent",
    description: desc,
    status: live ? "running" : status === "failed" ? "failed" : status === "stopped" ? "stopped" : "completed",
    background: status === "background",
    has_transcript: false,
    agent_type: meta?.agent_type ?? (str(input.subagent_type) || undefined),
    tokens: meta?.tokens ?? undefined,
    tool_count: meta?.tool_count ?? undefined,
    duration_ms: meta?.duration_ms ?? undefined,
  };
  const report = task?.result ?? (res && !isAsyncLaunch(res) ? res.text : "");
  const detail = live ? detailOf(shown, now) : (task?.summary && !report ? task.summary : "") || detailOf(shown, now);
  const agentId = agentIdOf(task, meta?.agent_id);
  // Still running without an id: open anyway, the view picks the id up when it arrives.
  const canOpen = !!open && (!!agentId || live);

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <WorkGlyph kind="agent" status={status} />
        <span className="shrink-0 text-cv-meta text-cv-muted">{typeOf(shown)}</span>
        <span className="min-w-0 flex-1 truncate text-cv-ui text-cv-text">{desc}</span>
        {canOpen && <ChevronRight size={15} strokeWidth={1.8} className="shrink-0 text-cv-muted" />}
      </div>
      <WorkStatusLine status={status} detail={detail} className="mt-1.5 pl-8" />
      {!live && report && <p className="mt-1.5 line-clamp-3 pl-8 text-cv-meta text-cv-text-2 [overflow-wrap:anywhere]">{excerpt(report)}</p>}
    </>
  );

  const cls = "my-1.5 block min-h-14 w-full rounded-cv-md border border-cv-line-soft bg-cv-surface px-3 py-2.5 text-left font-cv-sans";
  return canOpen ? (
    <button
      type="button"
      // data-no-tap: the turn's tap-for-actions never takes a tap meant for the card.
      data-no-tap
      onClick={() => open!({ id: agentId ?? use.id, title: desc, toolUseId: use.id })}
      aria-label={`Open subagent: ${desc}`}
      className={cn(cls, "touch-manipulation transition-colors hover:border-cv-line active:bg-cv-press")}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
});

export function AgentCards({ uses, results, running }: { uses: Use[]; results: Map<string, Res>; running: ReadonlySet<string> }) {
  return (
    <div className="my-2">
      {uses.map((u) => (
        <AgentCard key={u.id} use={u} res={results.get(u.id)} running={running.has(u.id)} />
      ))}
    </div>
  );
}
