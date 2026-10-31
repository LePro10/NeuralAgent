/**
 * The machinery between two texts as one quiet line (A3 §2.5 "Steps line"):
 * "Ran 6 commands, read 3 files ›". While Claude works the line shows the current step with the
 * two before it underneath (a short live tail). Tap opens the list of steps in place; each step
 * opens its body (command and output, results, thinking).
 *
 * Light Thread: an open or live run hangs on a hairline with a small node per step, and while
 * Claude works one clay light runs down it (transform only; static with reduced motion).
 */
import { cn } from "@neuralagent/ui";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { memo, useState } from "react";
import type { Step } from "./entries";
import { StepBody, useRel } from "./tools";
import { duration, inputOf, isAsyncLaunch, isCodeArg, isPathTool, problem, rowText, stepSummary, toolArg, toolTitle, verbOf, type Res } from "./toolText";

const LIVE_TAIL = 2;

function Thread({ live }: { live: boolean }) {
  return (
    <span aria-hidden className="cv-thread pointer-events-none absolute top-3 bottom-3 left-1.5 w-px overflow-hidden bg-cv-line">
      {live && <span className="cv-thread-light" />}
    </span>
  );
}

function Node({ state }: { state: "idle" | "run" | "error" }) {
  return (
    <span className="relative z-1 grid w-3 shrink-0 place-items-center">
      {state === "run" ? (
        <LoaderCircle size={13} className="animate-spin bg-cv-bg text-cv-clay [animation-duration:1.2s]" />
      ) : (
        <span className={cn("size-1.5 rounded-full ring-3 ring-cv-bg", state === "error" ? "bg-cv-danger" : "bg-cv-line-strong")} />
      )}
    </span>
  );
}

export function StepLabel({ step, res }: { step: Step; res?: Res }) {
  const rel = useRel();
  if (step.t === "think") return <span className="min-w-0 truncate text-cv-text-2">{step.ms && step.ms >= 1000 ? `Thought for ${duration(step.ms)}` : "Thought"}</span>;
  const { use } = step;
  const text = rowText(use);
  if (text) return <span className="min-w-0 truncate text-cv-text-2">{text}</span>;
  const { mcp } = toolTitle(use.name);
  const arg = toolArg(use.name, inputOf(use));
  return (
    <>
      <span className="shrink-0 text-cv-text">{verbOf(use.name)}</span>
      {mcp && <span className="shrink-0 text-cv-meta text-cv-muted">{mcp}</span>}
      {arg && <span className={cn("min-w-0 truncate text-cv-text-2", isCodeArg(use.name) && "font-cv-mono text-cv-code")}>{isPathTool(use.name) ? rel(arg) : arg}</span>}
      {res && isAsyncLaunch(res) && <span className="shrink-0 text-cv-meta text-cv-muted">background</span>}
    </>
  );
}

const StepRow = memo(function StepRow({ step, res, running, waiting }: { step: Step; res?: Res; running: boolean; waiting: boolean }) {
  const [open, setOpen] = useState(false);
  const issue = step.t === "tool" ? problem(res) : null;
  const state = running ? "run" : issue?.error ? "error" : "idle";
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group flex min-h-cv-row w-full min-w-0 items-center gap-2.5 text-left text-cv-step">
        <Node state={state} />
        <span className="flex min-w-0 flex-1 items-center gap-2 group-hover:[&>*:first-child]:text-cv-text">
          <StepLabel step={step} res={res} />
        </span>
        {waiting && running && <span className="shrink-0 text-cv-meta text-cv-clay">Waiting for you</span>}
        {issue && !issue.error && <span className="shrink-0 text-cv-meta text-cv-muted">{issue.text}</span>}
        <ChevronRight size={14} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform duration-200", open && "rotate-90")} />
      </button>
      {issue?.error && !open && <div className="-mt-1 mb-1 ml-5.5 line-clamp-2 text-cv-meta text-cv-danger [overflow-wrap:anywhere]">{issue.text}</div>}
      {open && (
        <div className="mt-0.5 mb-2 ml-5.5 animate-cv-pop">
          {step.t === "think" ? <div className="border-l-2 border-cv-line pl-3 text-cv-meta whitespace-pre-wrap text-cv-text-2">{step.text}</div> : <StepBody use={step.use} res={res} />}
        </div>
      )}
    </li>
  );
});

const resOf = (s: Step, res: Map<string, Res>) => (s.t === "tool" ? res.get(s.use.id) : undefined);

/** One run of steps. `live` = this is the end of the turn Claude is working on. */
export const StepRun = memo(
  function StepRun({ steps, res, running, live, waiting }: { steps: Step[]; res: Map<string, Res>; running: ReadonlySet<string>; live: boolean; waiting: boolean }) {
    const [open, setOpen] = useState(false);
    const tools = steps.flatMap((s) => (s.t === "tool" ? [s.use] : []));
    const failed = tools.filter((u) => problem(res.get(u.id))?.error);
    const firstError = failed.length ? problem(res.get(failed[0]!.id))?.text : null;
    const thinkMs = steps.reduce((n, s) => n + (s.t === "think" ? (s.ms ?? 0) : 0), 0);
    const isRunning = (s: Step) => s.t === "tool" && running.has(s.use.id);
    const anyRunning = steps.some(isRunning);

    if (live && !open) {
      // The current step on top of the two before it.
      const tail = steps.slice(-(LIVE_TAIL + 1));
      const cur = tail[tail.length - 1]!;
      return (
        <div className="relative my-1 font-cv-sans" role="status" aria-live="polite">
          {tail.length > 1 && <Thread live />}
          <button type="button" onClick={() => setOpen(true)} aria-expanded={false} aria-label={`${stepSummary(tools.map((u) => u.name), thinkMs)}, show steps`} className="block w-full text-left">
            <ul>
              {tail.map((s) => {
                const isCur = s === cur;
                return (
                  <li key={s.key} className={cn("flex min-w-0 items-center gap-2.5", isCur ? "min-h-cv-row text-cv-step" : "min-h-6 text-cv-meta opacity-70")}>
                    <Node state={isCur && (isRunning(s) || !anyRunning) ? "run" : "idle"} />
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <StepLabel step={s} res={resOf(s, res)} />
                    </span>
                    {isCur && waiting && isRunning(s) && <span className="shrink-0 text-cv-meta text-cv-clay">Waiting for you</span>}
                    {isCur && steps.length > tail.length && <span className="shrink-0 text-cv-meta text-cv-muted tabular-nums">+{steps.length - tail.length}</span>}
                  </li>
                );
              })}
            </ul>
          </button>
        </div>
      );
    }

    return (
      <div className="relative my-1 font-cv-sans">
        {open && steps.length > 1 && <Thread live={live && anyRunning} />}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group flex min-h-cv-row w-full min-w-0 items-center gap-2.5 text-left text-cv-step text-cv-text-2 transition-colors hover:text-cv-text">
          <Node state={anyRunning ? "run" : failed.length ? "error" : "idle"} />
          <span className="min-w-0 truncate">{stepSummary(tools.map((u) => u.name), thinkMs)}</span>
          {failed.length > 0 && <span className="shrink-0 text-cv-meta text-cv-danger">· {failed.length} failed</span>}
          <ChevronRight size={14} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform duration-200", open && "rotate-90")} />
        </button>
        {!open && firstError && <div className="-mt-1 mb-1 ml-5.5 line-clamp-1 text-cv-meta text-cv-danger [overflow-wrap:anywhere]">{firstError}</div>}
        {open && (
          <ul className="pb-1">
            {steps.map((s) => (
              <StepRow key={s.key} step={s} res={resOf(s, res)} running={isRunning(s)} waiting={waiting} />
            ))}
          </ul>
        )}
      </div>
    );
  },
  (a, b) => a.steps === b.steps && a.res === b.res && a.running === b.running && a.live === b.live && a.waiting === b.waiting,
);
