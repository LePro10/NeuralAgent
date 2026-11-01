// One Neural team: the goal, its status, and every attempt (race contestants, or builder + reviewer).
// No page chrome, so it fits a desktop card as well as a phone sheet.
import type { AttemptState, NeuralAttempt, NeuralTask } from "@neuralagent/protocol";
import { Button, ConfirmSheet, List, Pill, Row, cn, toast, type Activity } from "@neuralagent/ui";
import { Check, Trash2, Trophy } from "lucide-react";
import { useState } from "react";
import { useOpenAgent } from "../../lib/openAgent";
import { taskWord } from "../../lib/neural";
import { activityOf } from "../../lib/status";
import { useClient, useDaemon } from "../../lib/store";
import { EngineTile } from "../EngineTile";

export const ATTEMPT_WORD: Record<AttemptState, string> = {
  working: "Working",
  done: "Finished",
  checking: "Checking",
  ready: "Ready",
  failed: "Failed",
  dropped: "Dropped",
  merged: "Kept",
};

export const PATTERN_WORD = { race: "Race", review: "Build + review" } as const;

/** The role as the user reads it: "Attempt 2", "Builder", "Reviewer". */
export function roleLabel(a: NeuralAttempt, index: number): string {
  if (a.role === "builder") return "Builder";
  if (a.role === "reviewer") return "Reviewer";
  return `Attempt ${index + 1}`;
}

/** "+12 −3 in 2 files" (nothing while nothing changed). */
function changes(a: NeuralAttempt): string | undefined {
  if (a.files === 0 && a.additions === 0 && a.deletions === 0) return undefined;
  return `+${a.additions} −${a.deletions} in ${a.files} ${a.files === 1 ? "file" : "files"}`;
}

export function TeamDetail({ task }: { task: NeuralTask }) {
  const team = task.team;
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === task.workspace_id)?.name);
  const [picking, setPicking] = useState<NeuralAttempt | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const client = useClient();
  // Worktrees a race left behind (dropped, failed or cut off without a pick): never the kept one.
  const leftovers = useDaemon((c) =>
    team?.pattern === "race" && (task.status === "done" || task.status === "failed" || task.status === "blocked")
      ? team.attempts.filter((a) => a.state !== "merged" && c.state?.sessions[a.session_id]?.worktree).length
      : 0,
  );
  if (!team) return null;
  // A finished race (every attempt in) waits for the user's pick.
  const choosing = team.pattern === "race" && task.status === "review" && !team.winner;
  const pick = async () => {
    if (!picking) return;
    try {
      await client.req({ m: "neural_team_pick", p: { task_id: task.id, session_id: picking.session_id } });
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };
  const cleanUp = async () => {
    try {
      await client.req({ m: "neural_team_cleanup", p: { task_id: task.id } });
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };
  const meta = [PATTERN_WORD[team.pattern], team.pattern === "review" && team.round > 0 ? `round ${team.round}` : undefined, ws].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <header className="px-1">
        <h2 className="text-title-3 text-bright">{task.title}</h2>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-dim">
          <Pill tone={task.status === "failed" ? "danger" : task.status === "done" ? "success" : task.status === "blocked" ? "accent" : "neutral"} size="sm">
            {taskWord(task)}
          </Pill>
          <span>{meta}</span>
        </p>
        {task.note && <p className="mt-2 text-callout text-ink">{task.note}</p>}
        {task.check && (
          <p className="mt-2 text-footnote text-dim">
            Check: <code className="font-mono text-ink">{task.check}</code>
          </p>
        )}
      </header>

      <List label="Attempts" footer={choosing ? "All attempts are in. Pick the one to keep." : undefined}>
        {team.attempts.map((a, i) => (
          <AttemptRow key={a.session_id} attempt={a} index={i} onUse={choosing && a.state === "ready" ? () => setPicking(a) : undefined} />
        ))}
      </List>

      {leftovers > 0 && client.has("neural_cleanup") && (
        <div className="flex flex-col gap-2">
          <Button size="lg" variant="danger" Icon={Trash2} onClick={() => setCleaning(true)} className="w-full">
            {leftovers === 1 ? "Clean up 1 worktree" : `Clean up ${leftovers} worktrees`}
          </Button>
          <p className="px-1 text-footnote text-dim">This race ended without a pick. Its attempts' worktrees are still on the computer.</p>
        </div>
      )}

      <ConfirmSheet
        open={cleaning}
        onClose={() => setCleaning(false)}
        title="Throw away this race's worktrees?"
        message="The attempts' changes are deleted and their agents stop. Your project folder is not touched."
        confirmLabel="Clean up"
        destructive
        Icon={Trash2}
        onConfirm={cleanUp}
      />

      <ConfirmSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title="Keep this version?"
        message="The other attempts' worktrees are deleted."
        confirmLabel="Use this"
        Icon={Check}
        onConfirm={pick}
      />
    </div>
  );
}

function attemptActivity(a: NeuralAttempt, status: Parameters<typeof activityOf>[0][number] | undefined): Activity | undefined {
  if (a.state === "failed") return "error";
  if (a.state === "checking") return "working";
  if (a.state === "working") return status ? activityOf([status]) : "working";
  return undefined;
}

function AttemptRow({ attempt: a, index, onUse }: { attempt: NeuralAttempt; index: number; onUse?: () => void }) {
  const open = useOpenAgent();
  const session = useDaemon((c) => c.state?.sessions[a.session_id]);
  const engine = useDaemon((c) => c.state?.profiles.find((p) => p.id === a.profile_id)?.engine) ?? "custom";
  const [showOut, setShowOut] = useState(false);
  const merged = a.state === "merged";
  const diff = changes(a);
  const detail = [ATTEMPT_WORD[a.state], diff].filter(Boolean).join(" · ");
  const checked = a.check_ok !== undefined;
  const extras = checked || a.verdict || onUse || merged;
  return (
    <div className={cn(a.state === "dropped" && "opacity-60")}>
      <Row
        leading={<EngineTile engine={engine} activity={attemptActivity(a, session?.alive ? session.status : undefined)} edge="ring-card" />}
        title={roleLabel(a, index)}
        detail={detail}
        onClick={session ? () => open(a.session_id) : undefined}
        trailing={
          merged ? (
            <Pill tone="success" Icon={Trophy} size="sm">
              Winner
            </Pill>
          ) : undefined
        }
      />
      {extras && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-16">
          {checked && (
            <button type="button" onClick={() => setShowOut((s) => !s)} aria-expanded={showOut} className="pressable rounded-full">
              <Pill tone={a.check_ok ? "success" : "danger"} dot>
                {a.check_ok ? "Check passed" : "Check failed"}
              </Pill>
            </button>
          )}
          {a.verdict && (
            <Pill tone={a.verdict === "approved" ? "success" : "warning"}>{a.verdict === "approved" ? "Approved" : "Changes asked"}</Pill>
          )}
          {onUse && (
            <Button size="sm" variant="accent" Icon={Check} onClick={onUse} className="ml-auto rounded-full">
              Use this
            </Button>
          )}
        </div>
      )}
      {showOut && a.check_out && <pre className="mx-4 mb-3 max-h-48 overflow-auto rounded-field bg-fill-2 p-3 font-mono text-caption whitespace-pre-wrap text-ink">{a.check_out}</pre>}
    </div>
  );
}
