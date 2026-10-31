/**
 * Subagents in the transcript (A3 §2.7): one card per Agent/Task call with its type, what it was
 * asked to do, live status and last step, a short excerpt of its report and its counts. Tapping
 * a card opens the subagent's own transcript (`onOpen`) when the daemon has one.
 *
 * The parent's tool result of a background launch ("Async agent launched successfully…") is
 * internal metadata and never shown; the real outcome comes from the task (`CvTask`) or a
 * `task_note`.
 */
import type { CvTask } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { Bot, Check, ChevronRight, LoaderCircle, OctagonX } from "lucide-react";
import { createContext, memo, useContext } from "react";
import { plainText } from "./Markdown";
import { agentTypeName, duration, inputOf, isAsyncLaunch, metaOf, str, type Res, type Use } from "./toolText";

/** The conversation's background tasks and how to open one (provided by the view). */
export const TasksContext = createContext<{ tasks: CvTask[]; open?: (task: { id: string; title: string }) => void }>({ tasks: [] });

type Status = "running" | "background" | "done" | "failed" | "stopped";

export function tokens(n?: number): string {
  if (!n) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k tokens` : `${n} tokens`;
}

/** "3 tools · 12.4k tokens · 1m 20s" */
export function counts(t: { tool_count?: number; tokens?: number; duration_ms?: number }): string {
  return [t.tool_count ? `${t.tool_count} ${t.tool_count === 1 ? "tool" : "tools"}` : "", tokens(t.tokens), t.duration_ms ? duration(t.duration_ms) : ""].filter(Boolean).join(" · ");
}

function statusOf(res: Res | undefined, task: CvTask | undefined, open: boolean): Status {
  if (task) {
    if (task.status === "running") return task.background ? "background" : "running";
    if (task.status === "failed") return "failed";
    if (task.status === "killed" || task.status === "stopped") return "stopped";
    return "done";
  }
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
  const type = agentTypeName(task?.agent_type ?? meta?.agent_type ?? (str(input.subagent_type) || null));
  const desc = task?.description || str(input.description) || "Subagent";
  const status = statusOf(res, task, running);
  const live = status === "running" || status === "background";
  const report = task?.result ?? (res && !isAsyncLaunch(res) ? res.text : "");
  const line = live ? task?.label : task?.summary && !report ? task.summary : "";
  const info = counts({ tool_count: task?.tool_count ?? meta?.tool_count, tokens: task?.tokens ?? meta?.tokens, duration_ms: task?.duration_ms ?? meta?.duration_ms });
  const agentId = task?.has_transcript ? task.id : meta?.agent_id;
  const canOpen = !!agentId && !!open;

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-cv-sm", live ? "bg-cv-clay-soft text-cv-clay" : "bg-cv-chip text-cv-text-2")}>
          <Bot size={14} strokeWidth={1.8} />
        </span>
        <span className="shrink-0 text-cv-meta text-cv-muted">{type}</span>
        <span className="min-w-0 flex-1 truncate text-cv-ui text-cv-text">{desc}</span>
        {canOpen && <ChevronRight size={15} strokeWidth={1.8} className="shrink-0 text-cv-muted" />}
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 pl-8 text-cv-meta">
        {live ? (
          <LoaderCircle size={13} className="shrink-0 animate-spin text-cv-clay [animation-duration:1.2s]" />
        ) : status === "failed" || status === "stopped" ? (
          <OctagonX size={13} className="shrink-0 text-cv-danger" />
        ) : (
          <Check size={13} strokeWidth={2.2} className="shrink-0 text-cv-success" />
        )}
        <span className={cn("shrink-0", status === "failed" ? "text-cv-danger" : live ? "text-cv-clay" : "text-cv-text-2")}>
          {status === "running" ? "Working" : status === "background" ? "In the background" : status === "failed" ? "Failed" : status === "stopped" ? "Stopped" : "Done"}
        </span>
        {line && <span className="min-w-0 truncate text-cv-muted">· {line}</span>}
        {!line && info && <span className="min-w-0 truncate text-cv-muted tabular-nums">· {info}</span>}
      </div>
      {!live && report && <p className="mt-1.5 line-clamp-3 pl-8 text-cv-meta text-cv-text-2 [overflow-wrap:anywhere]">{excerpt(report)}</p>}
    </>
  );

  const cls = "my-1.5 block w-full rounded-cv-md border border-cv-line-soft bg-cv-surface px-3 py-2.5 text-left font-cv-sans";
  return canOpen ? (
    <button type="button" onClick={() => open!({ id: agentId!, title: desc })} className={cn(cls, "transition-colors hover:border-cv-line active:bg-cv-press")}>
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
