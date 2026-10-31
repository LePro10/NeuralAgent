/**
 * Background work of a session in one sheet (A3 §2.7): subagents, background shells and
 * monitors, running first. A subagent opens its own transcript; a shell or monitor shows the
 * end of its output (`cv_task_output`).
 */
import type { CvTask } from "@neuralagent/protocol";
import { cn, Sheet } from "@neuralagent/ui";
import { Activity, Bot, Check, ChevronRight, LoaderCircle, OctagonX, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { useClient } from "../../lib/store";
import { counts } from "./AgentCard";
import { agentTypeName } from "./toolText";

const KIND_ICON = { agent: Bot, bash: SquareTerminal, monitor: Activity } as const;

function TaskOutput({ sid, task }: { sid: string; task: CvTask }) {
  const client = useClient();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      client.cvTaskOutput(sid, task.id, 16_000).then(
        (r) => live && setText(r.text),
        () => live && setFailed(true),
      );
    void load();
    if (task.status !== "running") return () => void (live = false);
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [client, sid, task.id, task.status]);
  if (failed) return <div className="px-1 py-2 text-cv-meta text-cv-muted">The output is not available.</div>;
  if (text === null) return <div className="px-1 py-2 text-cv-meta text-cv-muted">Loading…</div>;
  return <pre className="cv-thin mt-1 max-h-72 overflow-auto rounded-cv-sm bg-cv-sunken px-3 py-2 font-cv-mono text-cv-code whitespace-pre-wrap text-cv-text-2 [overflow-wrap:anywhere]">{text.trim() || "No output yet."}</pre>;
}

function Row({ sid, task, onAgent }: { sid: string; task: CvTask; onAgent: (t: { id: string; title: string }) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[task.kind as keyof typeof KIND_ICON] ?? SquareTerminal;
  const running = task.status === "running";
  const bad = task.status === "failed" || task.status === "killed";
  const title = task.description || task.command || task.id;
  const sub = running ? task.label : task.summary || counts(task);
  const agent = task.kind === "agent";
  const canOpen = agent ? task.has_transcript : !!task.output_file || !!task.command;
  return (
    <li>
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => (agent ? onAgent({ id: task.id, title }) : setOpen(!open))}
        aria-expanded={agent ? undefined : open}
        className="flex min-h-14 w-full items-center gap-3 rounded-cv-sm px-3 py-2 text-left active:bg-cv-press disabled:active:bg-transparent"
      >
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-cv-sm", running ? "bg-cv-clay-soft text-cv-clay" : "bg-cv-chip text-cv-text-2")}>
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {agent && <span className="shrink-0 text-cv-meta text-cv-muted">{agentTypeName(task.agent_type)}</span>}
            <span className={cn("min-w-0 truncate text-cv-ui text-cv-text", !agent && "font-cv-mono text-cv-code")}>{title}</span>
          </span>
          {sub && <span className="mt-0.5 block truncate text-cv-meta text-cv-muted">{sub}</span>}
        </span>
        {running ? (
          <LoaderCircle size={15} className="shrink-0 animate-spin text-cv-clay [animation-duration:1.2s]" aria-label="Running" />
        ) : bad ? (
          <OctagonX size={15} className="shrink-0 text-cv-danger" aria-label={task.status} />
        ) : (
          <Check size={15} strokeWidth={2.2} className="shrink-0 text-cv-success" aria-label={task.status} />
        )}
        {canOpen && <ChevronRight size={15} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform", open && "rotate-90")} />}
      </button>
      {open && !agent && (
        <div className="px-3 pb-2">
          <TaskOutput sid={sid} task={task} />
        </div>
      )}
    </li>
  );
}

/** The sheet. `tasks` comes sorted from `useTasks` / `useTaskList`. */
export function TasksSheet({ sid, open, tasks, onClose, onAgent }: {
  sid: string;
  open: boolean;
  tasks: CvTask[];
  onClose: () => void;
  /** Open a subagent's transcript (the sheet closes first). */
  onAgent: (t: { id: string; title: string }) => void;
}) {
  const running = tasks.filter((t) => t.status === "running").length;
  return (
    <Sheet open={open} onClose={onClose} title={running ? `Tasks · ${running} running` : "Tasks"} bodyClassName="pb-3">
      <div className="-mx-1 font-cv-sans">
        {tasks.length === 0 ? (
          <p className="px-3 py-6 text-center text-cv-ui text-cv-muted">No background work in this session.</p>
        ) : (
          <ul>
            {tasks.map((t) => (
              <Row
                key={t.id}
                sid={sid}
                task={t}
                onAgent={(a) => {
                  onClose();
                  // after the sheet's own history entry is gone
                  setTimeout(() => onAgent(a), 0);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
