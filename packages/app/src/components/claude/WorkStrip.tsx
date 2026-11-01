/**
 * The running-work strip, docked above the composer (D65): a compact pill
 * ("3 agents running · 1 shell", with the newest step) that unfolds upward into the list of
 * subagents, shells and monitors that run now or just finished (same rows and tree as the Tasks
 * sheet: nested agents under their parent, fan-outs grouped). A row opens the subagent's
 * transcript; finished items leave after `KEEP_MS`. The open list is a layer: Back, Escape or a
 * tap beside it closes it. Same component on phones and the desktop Claude view.
 */
import type { CvTask } from "@neuralagent/protocol";
import { cn, ConfirmSheet, toast, useLayer } from "@neuralagent/ui";
import { ChevronDown, ChevronUp, ListTree, OctagonX } from "lucide-react";
import { useMemo, useState } from "react";
import { useClient } from "../../lib/store";
import { act } from "./actions";
import { useNow, useStripItems } from "./useWork";
import { kindOf, statusOf, stepOf, summaryOf, workTree } from "./work";
import { useStopTask } from "./StopTask";
import { StatusIcon, WorkList } from "./WorkRow";

/** Ctrl+X Ctrl+K twice: what the CLI binds to "stop all background agents". */
const STOP_KEYS = [{ write: "\x18" }, { wait: 60 }, { write: "\x0b" }, { wait: 200 }, { write: "\x18" }, { wait: 60 }, { write: "\x0b" }];

export function WorkStrip({ sid, tasks, actions, alive, onAgent, onAll }: {
  sid: string;
  /** All tasks of the conversation (sorted, `useTaskList`). */
  tasks: CvTask[];
  /** The daemon plays `cv_action`s (`meta.actions`). */
  actions: boolean;
  /** The session still runs (Stop is offered). */
  alive: boolean;
  onAgent: (t: CvTask) => void;
  /** Opens the Tasks sheet with everything the conversation had. */
  onAll: () => void;
}) {
  const client = useClient();
  const items = useStripItems(sid, tasks);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const shown = open && items.length > 0;
  useLayer(shown, () => setOpen(false));
  const runningAgents = items.filter((t) => t.status === "running" && kindOf(t) === "agent" && t.background).length;
  const anyLive = items.some((t) => t.status === "running");
  const now = useNow(shown && anyLive);
  const nodes = useMemo(() => workTree(items, tasks, true), [items, tasks]);
  const stop = useStopTask(sid, actions, alive);
  if (!items.length) return null;

  const summary = summaryOf(items);
  const newest = items.map(stepOf).find(Boolean);
  const status = anyLive ? "running" : items.some((t) => statusOf(t) === "failed") ? "failed" : "done";
  const more = tasks.length - items.length;

  const pick = (t: CvTask) => {
    // Same step as closing: the strip's layer hands its history entry to the subagent view.
    setOpen(false);
    onAgent(t);
  };

  const stopAll = () =>
    act(client, sid, actions, { k: "stop_agents" }, STOP_KEYS).then(
      () => void toast("Stopping the background agents", { duration: 1800 }),
      (e: Error) => void toast(e.message, { tone: "danger" }),
    );

  return (
    <div className="relative mb-2 font-cv-sans">
      {shown && <div className="fixed inset-0 z-20" aria-hidden onClick={() => setOpen(false)} />}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={shown}
        aria-label={`${summary}. ${shown ? "Hide" : "Show"} the list`}
        className={cn(
          "flex h-9 max-w-full touch-manipulation items-center gap-2 rounded-full border border-cv-line-soft bg-cv-surface pr-2.5 pl-3 text-cv-meta shadow-cv-pill transition-colors hover:border-cv-line active:bg-cv-press [[data-mode=phone]_&]:h-tap",
          !anyLive && "text-cv-text-2",
        )}
      >
        <StatusIcon status={status} size={14} />
        <span className={cn("shrink-0", anyLive ? "text-cv-text" : "text-cv-text-2")}>{summary}</span>
        {newest && <span className="min-w-0 truncate text-cv-muted">· {newest}</span>}
        {shown ? <ChevronDown size={15} strokeWidth={1.8} className="shrink-0 text-cv-muted" /> : <ChevronUp size={15} strokeWidth={1.8} className="shrink-0 text-cv-muted" />}
      </button>

      {shown && (
        <div
          role="dialog"
          aria-label="Background work"
          className="absolute inset-x-0 bottom-full z-30 mb-2 flex flex-col overflow-hidden rounded-cv-card border border-cv-line-soft bg-cv-surface shadow-cv-pop animate-cv-pop"
          style={{ maxHeight: "min(55dvh, 30rem)" }}
        >
          <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-cv-line-soft pr-1.5 pl-4">
            <span className="min-w-0 flex-1 truncate text-cv-ui text-cv-text">{summary}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Hide the list" className="grid size-10 shrink-0 [[data-mode=phone]_&]:size-tap place-items-center rounded-full text-cv-muted hover:bg-cv-hover active:bg-cv-press">
              <ChevronDown size={18} strokeWidth={1.8} />
            </button>
          </div>
          <div className="cv-scroll min-h-0 flex-1 overflow-y-auto px-1 py-1">
            <WorkList sid={sid} nodes={nodes} now={now} onAgent={pick} trailing={stop.trailing} />
          </div>
          <div className="flex shrink-0 items-center gap-1 border-t border-cv-line-soft px-1.5 py-1">
            <button type="button" onClick={() => (setOpen(false), onAll())} className="flex h-10 items-center gap-1.5 rounded-full px-3 text-cv-meta text-cv-text-2 [[data-mode=phone]_&]:h-tap hover:bg-cv-hover active:bg-cv-press">
              <ListTree size={15} strokeWidth={1.8} />
              {more > 0 ? `All tasks (${tasks.length})` : "All tasks"}
            </button>
            <span className="flex-1" />
            {alive && runningAgents > 0 && (
              <button type="button" onClick={() => setConfirm(true)} className="flex h-10 items-center gap-1.5 rounded-full px-3 text-cv-meta text-cv-danger [[data-mode=phone]_&]:h-tap hover:bg-cv-danger-soft active:bg-cv-press">
                <OctagonX size={15} strokeWidth={1.8} />
                Stop background agents
              </button>
            )}
          </div>
        </div>
      )}
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={stopAll}
        destructive
        title={`Stop ${runningAgents === 1 ? "the background agent" : `${runningAgents} background agents`}?`}
        message="Claude Code stops every agent that runs in the background. Their work so far stays in their transcripts."
        confirmLabel="Stop"
      />
      {stop.sheet}
    </div>
  );
}

