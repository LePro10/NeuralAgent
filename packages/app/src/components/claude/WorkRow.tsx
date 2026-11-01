/**
 * The look of background work, shared by the subagent card in the transcript, the running-work
 * strip above the composer, the Tasks sheet and the subagent view (D65): one tile per kind, one
 * status icon and word, one detail line ("Read main.rs · 1m 20s · 12k tokens"), one row.
 * Words and numbers come from `work.ts`.
 */
import type { CvTask } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { Activity, Bot, Check, ChevronRight, LoaderCircle, OctagonX, Square, SquareTerminal, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useClient } from "../../lib/store";
import { canOpen, detailOf, isLive, kindOf, statusOf, STATUS_WORD, titleOf, typeOf, type WorkKind, type WorkNode, type WorkStatus } from "./work";

const KIND_ICON: Record<WorkKind, typeof Bot> = { agent: Bot, bash: SquareTerminal, monitor: Activity, workflow: Workflow };

/** The tile in front of a row: the kind's icon, tinted while it runs. */
export function WorkGlyph({ kind, status, big }: { kind: WorkKind; status: WorkStatus; big?: boolean }) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-cv-sm transition-colors",
        big ? "size-8" : "size-6",
        isLive(status) ? "bg-cv-clay-soft text-cv-clay" : status === "failed" ? "bg-cv-danger-soft text-cv-danger" : "bg-cv-chip text-cv-text-2",
      )}
    >
      <Icon size={big ? 16 : 14} strokeWidth={1.8} />
    </span>
  );
}

export function StatusIcon({ status, size = 13 }: { status: WorkStatus; size?: number }) {
  if (isLive(status)) return <LoaderCircle size={size} className="shrink-0 animate-spin text-cv-clay [animation-duration:1.2s]" aria-hidden />;
  if (status === "failed") return <OctagonX size={size} className="shrink-0 text-cv-danger" aria-hidden />;
  if (status === "stopped") return <Square size={size - 2} strokeWidth={2.2} className="shrink-0 text-cv-muted" aria-hidden />;
  return <Check size={size} strokeWidth={2.2} className="shrink-0 text-cv-success" aria-hidden />;
}

/** "⟳ Working · Read main.rs · 1m 20s" */
export function WorkStatusLine({ status, detail, className }: { status: WorkStatus; detail?: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-cv-meta", className)}>
      <StatusIcon status={status} />
      <span className={cn("shrink-0", status === "failed" ? "text-cv-danger" : isLive(status) ? "text-cv-clay" : "text-cv-text-2")}>{STATUS_WORD[status]}</span>
      {detail && <span className="min-w-0 truncate text-cv-muted tabular-nums">· {detail}</span>}
    </span>
  );
}

/** The two lines every surface shows for a task: type + title, status + detail. */
export function WorkLines({ task, now, title }: { task: CvTask; now: number; title?: string }) {
  const status = statusOf(task);
  const agent = kindOf(task) === "agent";
  return (
    <span className="block min-w-0 flex-1">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-cv-meta text-cv-muted">{typeOf(task)}</span>
        <span className={cn("min-w-0 truncate text-cv-ui text-cv-text", !agent && !task.description && "font-cv-mono text-cv-code")}>{title ?? titleOf(task)}</span>
      </span>
      <WorkStatusLine status={status} detail={detailOf(task, now) || (!isLive(status) ? task.summary : "") || ""} className="mt-0.5" />
    </span>
  );
}

const ROW = "flex min-h-14 w-full items-center gap-3 rounded-cv-sm py-2 pr-2 text-left transition-colors hover:bg-cv-hover active:bg-cv-press";
const indent = (depth: number) => ({ paddingLeft: `calc(0.75rem + ${depth} * var(--cv-indent, 1.25rem))` });

/** The end of a shell's or monitor's output, refreshed while it runs (`cv_task_output`). */
export function TaskOutput({ sid, task }: { sid: string; task: CvTask }) {
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

/** One task: a subagent opens its transcript, a shell or monitor folds its output out. */
export function WorkRow({ sid, task, now, depth = 0, onAgent, trailing }: {
  sid: string;
  task: CvTask;
  now: number;
  depth?: number;
  onAgent: (t: CvTask) => void;
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const agent = kindOf(task) === "agent";
  const can = canOpen(task);
  const status = statusOf(task);
  return (
    <li className={cn(!isLive(status) && "opacity-90")}>
      <div className="flex items-center">
        <button
          type="button"
          disabled={!can}
          onClick={() => (agent ? onAgent(task) : setOpen(!open))}
          aria-expanded={agent ? undefined : open}
          className={cn(ROW, "min-w-0 flex-1 disabled:hover:bg-transparent disabled:active:bg-transparent")}
          style={indent(depth)}
        >
          <WorkGlyph kind={kindOf(task)} status={status} big />
          <WorkLines task={task} now={now} />
          {can && <ChevronRight size={15} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform", open && "rotate-90")} />}
        </button>
        {trailing}
      </div>
      {open && !agent && (
        <div className="pr-3 pb-2" style={indent(depth)}>
          <TaskOutput sid={sid} task={task} />
        </div>
      )}
    </li>
  );
}

/** Many agents started together: one row with their count, folding out into theirs. */
function GroupRow({ node, open, onToggle }: { node: Extract<WorkNode, { k: "group" }>; open: boolean; onToggle: () => void }) {
  const status: WorkStatus = node.running ? "running" : node.tasks.some((t) => statusOf(t) === "failed") ? "failed" : "done";
  const done = node.tasks.length - node.running;
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className={ROW} style={indent(node.depth)}>
        <WorkGlyph kind="workflow" status={status} big />
        <span className="block min-w-0 flex-1">
          <span className="block truncate text-cv-ui text-cv-text">{node.label}</span>
          <WorkStatusLine status={status} detail={[node.running ? `${node.running} running` : "", done ? `${done} done` : ""].filter(Boolean).join(" · ")} className="mt-0.5" />
        </span>
        <ChevronRight size={15} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform", open && "rotate-90")} />
      </button>
    </li>
  );
}

/** A work tree as a list (the strip's panel and the Tasks sheet). Groups start folded. */
export function WorkList({ sid, nodes, now, onAgent, trailing }: {
  sid: string;
  nodes: WorkNode[];
  now: number;
  onAgent: (t: CvTask) => void;
  trailing?: (t: CvTask) => ReactNode;
}) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (k: string) => setUnfolded((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const draw = (list: WorkNode[]): ReactNode[] =>
    list.flatMap((n) => {
      if (n.k === "group") {
        const open = unfolded.has(n.key);
        return [<GroupRow key={n.key} node={n} open={open} onToggle={() => toggle(n.key)} />, ...(open ? draw(n.children) : [])];
      }
      return [<WorkRow key={n.task.id} sid={sid} task={n.task} now={now} depth={n.depth} onAgent={onAgent} trailing={trailing?.(n.task)} />, ...draw(n.children)];
    });
  return <ul className="font-cv-sans">{draw(nodes)}</ul>;
}
