/**
 * Stop one background agent or shell from its row (D65): a small square button behind the row
 * and a confirm sheet; the daemon opens `/tasks`, selects the task by its name and presses `x`
 * (`cv_action stop_task`). Only offered when the daemon can (`cv_stop_task`) and plays actions.
 */
import type { CvTask } from "@neuralagent/protocol";
import { ConfirmSheet, toast } from "@neuralagent/ui";
import { Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useClient } from "../../lib/store";
import { kindOf, titleOf } from "./work";

/** Whether a row gets a stop button (nested agents are their parent's business: not in `/tasks`). */
export const canStop = (t: CvTask) => t.status === "running" && t.background && !t.parent && kindOf(t) !== "workflow";

export function useStopTask(sid: string, actions: boolean, alive: boolean): { trailing?: (t: CvTask) => ReactNode; sheet: ReactNode } {
  const client = useClient();
  const [ask, setAsk] = useState<CvTask | null>(null);
  const ok = actions && alive && client.has("cv_stop_task");
  const trailing = ok
    ? (t: CvTask) =>
        canStop(t) ? (
          <button
            type="button"
            onClick={() => setAsk(t)}
            aria-label={`Stop ${titleOf(t)}`}
            className="mr-1 grid size-10 shrink-0 [[data-mode=phone]_&]:size-tap touch-manipulation place-items-center rounded-full text-cv-muted hover:bg-cv-danger-soft hover:text-cv-danger active:bg-cv-press"
          >
            <Square size={13} strokeWidth={2} />
          </button>
        ) : null
    : undefined;
  const what = ask ? (kindOf(ask) === "agent" ? "agent" : kindOf(ask) === "monitor" ? "monitor" : "shell") : "";
  const sheet = (
    <ConfirmSheet
      open={!!ask}
      onClose={() => setAsk(null)}
      onConfirm={() => {
        const t = ask;
        if (!t) return;
        client.cvAction(sid, { k: "stop_task", id: t.id }).then(
          () => void toast(`Stopping “${titleOf(t)}”`, { duration: 1800 }),
          (e: Error) => void toast(e.message, { tone: "danger" }),
        );
      }}
      destructive
      title={`Stop this ${what}?`}
      message={ask ? `“${titleOf(ask)}” stops now. What it did so far stays in its transcript.` : ""}
      confirmLabel="Stop"
    />
  );
  return { trailing, sheet };
}
