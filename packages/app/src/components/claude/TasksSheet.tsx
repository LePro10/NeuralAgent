/**
 * All background work of a session in one sheet (A3 §2.7, D65): the same rows and tree as the
 * running-work strip (nested agents under their parent, fan-outs grouped), but every task the
 * conversation had, not only the current ones. A subagent opens its own transcript; a shell or
 * monitor folds out the end of its output (`cv_task_output`).
 */
import type { CvTask } from "@neuralagent/protocol";
import { Sheet } from "@neuralagent/ui";
import { useMemo } from "react";
import { useStopTask } from "./StopTask";
import { useNow } from "./useWork";
import { summaryOf, workTree } from "./work";
import { WorkList } from "./WorkRow";

/** The sheet. `tasks` comes sorted from `useTasks` / `useTaskList`. */
export function TasksSheet({ sid, open, tasks, actions = false, alive = false, onClose, onAgent }: {
  sid: string;
  open: boolean;
  tasks: CvTask[];
  /** The daemon plays `cv_action`s and the session runs: rows get a stop button. */
  actions?: boolean;
  alive?: boolean;
  onClose: () => void;
  /** Open a subagent's transcript (the sheet closes in the same step and hands its history entry over). */
  onAgent: (t: CvTask) => void;
}) {
  const running = tasks.some((t) => t.status === "running");
  const now = useNow(open && running);
  const nodes = useMemo(() => workTree(tasks), [tasks]);
  const summary = summaryOf(tasks.filter((t) => t.status === "running"));
  const stop = useStopTask(sid, actions, alive);
  return (
    <Sheet open={open} onClose={onClose} title="Tasks" bodyClassName="pb-3">
      <div className="-mx-1">
        {summary && <p className="px-3 pb-1 font-cv-sans text-cv-meta text-cv-muted">{summary}</p>}
        {tasks.length === 0 ? (
          <p className="px-3 py-6 text-center font-cv-sans text-cv-ui text-cv-muted">No background work in this session.</p>
        ) : (
          <WorkList
            sid={sid}
            nodes={nodes}
            now={now}
            trailing={stop.trailing}
            onAgent={(t) => {
              // One step: the sheet's layer closes and the subagent view's layer takes its entry
              // (useLayer hand-over), so Back from the subagent lands on the conversation.
              onClose();
              onAgent(t);
            }}
          />
        )}
      </div>
      {stop.sheet}
    </Sheet>
  );
}
