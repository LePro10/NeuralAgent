/**
 * What a tool call shows: the body of a step (Bash command and output, search results, tool
 * input as readable lines), file changes as their own card with a short preview (real line
 * numbers when the daemon sends the CLI's structuredPatch), the task list, the plan and the
 * answered question. Words and diff maths live in `toolText.ts`.
 */
import { cn } from "@neuralagent/ui";
import { Check, ChevronDown, Circle, LoaderCircle, MessageCircleQuestion, WrapText } from "lucide-react";
import { createContext, memo, useContext, useMemo, useState } from "react";
import { sourceOf, withoutSources } from "../../lib/cvImages";
import type { Pic } from "./Images";
import { CopyButton, Markdown } from "./Markdown";
import { changeHunks, deniedReason, diffStat, inputOf, metaOf, previewRows, problem, str, todosOf, type Res, type Row, type Todo, type Use } from "./toolText";

export { changeRows, diffLines, toolArg, toolTitle, type Res, type Row, type Use } from "./toolText";

/** The session's folder, so paths read relative to it. */
export const CwdContext = createContext("");

export function useRel() {
  const cwd = useContext(CwdContext).replace(/\/+$/, "");
  return (p: string) => (cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p);
}

/** The pictures a call returned, named by the file it read or the source the tool gave. */
export function picsOf(use: Use, res?: Res): Pic[] {
  const images = res?.images ?? [];
  if (!images.length) return [];
  return images.map((img) => ({ img, caption: picName(use, res!) }));
}
export const picName = (use: Use, res: Res): string | undefined => (use.name === "Read" ? str(inputOf(use).file_path) : (sourceOf(res.text) ?? undefined));

/** The result text to show: without the "[Image: source: …]" lines when the picture is shown. */
export const resultText = (res: Res) => (res.images?.length ? withoutSources(res.text) : res.text);

export function DiffStat({ rows, className }: { rows: Row[]; className?: string }) {
  const { add, del } = diffStat(rows);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 font-cv-mono text-cv-code tabular-nums", className)}>
      {add > 0 && <span className="text-cv-diff-add">+{add}</span>}
      {del > 0 && <span className="text-cv-diff-del">−{del}</span>}
    </span>
  );
}

function DiffLines({ rows, wrap }: { rows: Row[]; wrap: boolean }) {
  const numbered = rows.some((r) => r.n !== undefined);
  return (
    <div className={cn("py-1 font-cv-mono text-cv-code", !wrap && "cv-thin overflow-x-auto")}>
      {rows.map((r, i) => (
        <div key={i} className={cn("flex pr-3", wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "min-w-fit whitespace-pre", r.kind === "+" && "bg-cv-diff-add-bg", r.kind === "-" && "bg-cv-diff-del-bg")}>
          {numbered && <span className="w-9 shrink-0 pr-1.5 text-right text-cv-muted tabular-nums select-none [[data-mode=phone]_&]:w-8">{r.n ?? ""}</span>}
          <span className={cn("w-4 shrink-0 text-center select-none", !numbered && "ml-1.5", r.kind === "+" ? "text-cv-diff-add" : r.kind === "-" ? "text-cv-diff-del" : "text-cv-muted")}>{r.kind === " " ? "" : r.kind === "-" ? "−" : "+"}</span>
          <span className={cn("min-w-0", r.kind === " " ? "text-cv-text-2" : "text-cv-text")}>{r.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

const FoldButton = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="flex h-9 w-full items-center justify-center gap-1 border-t border-cv-line-soft font-cv-sans text-cv-meta text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text">
    {children}
  </button>
);

/** A diff in a box (also used by the permission card). */
export function Diff({ rows, path, max = 40, wrap: wrapInit = true }: { rows: Row[]; path?: string; max?: number; wrap?: boolean }) {
  const [all, setAll] = useState(false);
  const [wrap, setWrap] = useState(wrapInit);
  const shown = all ? rows : rows.slice(0, max);
  return (
    <div className="overflow-hidden rounded-cv-md border border-cv-line-soft bg-cv-surface">
      {path && <FileHeader path={path} rows={rows} wrap={wrap} onWrap={() => setWrap(!wrap)} />}
      <DiffLines rows={shown} wrap={wrap} />
      {rows.length > max && <FoldButton onClick={() => setAll(!all)}>{all ? "Show less" : `Show ${rows.length - max} more lines`}</FoldButton>}
    </div>
  );
}

function FileHeader({ path, rows, wrap, onWrap, running, error }: { path: string; rows: Row[]; wrap: boolean; onWrap: () => void; running?: boolean; error?: boolean }) {
  const name = path.split("/").pop();
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return (
    <div className="flex h-9 items-center gap-2 border-b border-cv-line-soft pr-1 pl-3 font-cv-sans text-cv-meta">
      {running && <LoaderCircle size={13} className="shrink-0 animate-spin text-cv-clay [animation-duration:1.2s]" />}
      {error && <span className="size-1.5 shrink-0 rounded-full bg-cv-danger" />}
      <span className="min-w-0 shrink truncate font-cv-mono font-cv-strong text-cv-text">{name}</span>
      <span className="min-w-0 flex-1 truncate text-cv-muted">{dir}</span>
      <DiffStat rows={rows} />
      <button type="button" onClick={onWrap} aria-pressed={!wrap} aria-label={wrap ? "Don't wrap lines" : "Wrap lines"} title={wrap ? "No wrap" : "Wrap"} className={cn("relative grid size-7 shrink-0 place-items-center rounded-cv-sm transition-colors after:absolute after:-inset-1.5 hover:bg-cv-hover", wrap ? "text-cv-muted" : "text-cv-text")}>
        <WrapText size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

const PREVIEW = 8;
const WRITE_PREVIEW = 6;

/** A file change as its own card: header, a short preview, "Show full diff" in place. */
export const EditCard = memo(
  function EditCard({ use, res, running }: { use: Use; res?: Res; running: boolean }) {
    const rel = useRel();
    const input = inputOf(use);
    const path = rel(str(input.file_path ?? input.notebook_path));
    // Diffs are computed once per call and result, not on every update.
    const hunks = useMemo(() => changeHunks(use, res), [use.id, res]); // eslint-disable-line react-hooks/exhaustive-deps
    const rows = useMemo(() => hunks.flat(), [hunks]);
    const [all, setAll] = useState(false);
    const [wrap, setWrap] = useState(true);
    const issue = problem(res);
    const max = use.name === "Write" ? WRITE_PREVIEW : PREVIEW;
    const preview = useMemo(() => previewRows(hunks[0] ?? [], max), [hunks, max]);
    const more = all ? 0 : rows.length - preview.length;
    return (
      <div className="my-2 overflow-hidden rounded-cv-md border border-cv-line-soft bg-cv-surface font-cv-sans">
        <FileHeader path={path || use.name} rows={rows} wrap={wrap} onWrap={() => setWrap(!wrap)} running={running && !res} error={issue?.error} />
        {issue && <div className={cn("border-b border-cv-line-soft px-3 py-1.5 text-cv-meta [overflow-wrap:anywhere]", issue.error ? "text-cv-danger" : "text-cv-muted")}>{issue.text}</div>}
        {rows.length > 0 && <DiffLines rows={all ? rows : preview} wrap={wrap} />}
        {more > 0 && (
          <FoldButton onClick={() => setAll(true)}>
            {use.name === "Write" ? `Show all ${rows.length} lines` : `Show full diff (${rows.length} lines)`}
          </FoldButton>
        )}
        {all && rows.length > preview.length && <FoldButton onClick={() => setAll(false)}>Show less</FoldButton>}
      </div>
    );
  },
  (a, b) => a.use.id === b.use.id && a.res === b.res && a.running === b.running,
);

const EDITS_SHOWN = 3;

/** Several changes in a row: stacked cards, the 4th and later behind one line. */
export function EditCards({ uses, results, running }: { uses: Use[]; results: Map<string, Res>; running: ReadonlySet<string> }) {
  const [all, setAll] = useState(false);
  const shown = all ? uses : uses.slice(0, EDITS_SHOWN);
  const files = new Set(uses.slice(EDITS_SHOWN).map((u) => str(inputOf(u).file_path ?? inputOf(u).notebook_path))).size;
  return (
    <div className="my-2">
      {shown.map((u) => (
        <EditCard key={u.id} use={u} res={results.get(u.id)} running={running.has(u.id)} />
      ))}
      {!all && uses.length > EDITS_SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="flex h-cv-row w-full items-center gap-1.5 font-cv-sans text-cv-step text-cv-text-2 transition-colors hover:text-cv-text">
          {files === 1 ? `${uses.length - EDITS_SHOWN} more changes` : `Edited ${files} more files`}
          <ChevronDown size={15} strokeWidth={1.8} className="text-cv-muted" />
        </button>
      )}
    </div>
  );
}

const OUT_MAX = 12;

/** Command or tool output in a sunken box; the copy button sits in its own header strip. */
export function Output({ text, error, cmd, stderr, label, max = OUT_MAX }: { text: string; error?: boolean; cmd?: string; stderr?: string; label?: string; max?: number }) {
  const [all, setAll] = useState(false);
  const body = text.replace(/\n+$/, "");
  const lines = body ? body.split("\n") : [];
  const errLines = (stderr ?? "").replace(/\n+$/, "");
  const total = lines.length + (errLines ? errLines.split("\n").length : 0);
  const shown = all ? body : lines.slice(0, max).join("\n");
  return (
    <div className="overflow-hidden rounded-cv-md border border-cv-line-soft bg-cv-sunken">
      <div className="flex h-8 items-center gap-2 pr-1 pl-3 font-cv-sans text-cv-meta text-cv-muted">
        <span className="min-w-0 flex-1 truncate">{label ?? (cmd ? "Command" : "Output")}</span>
        <CopyButton text={[cmd, body, errLines].filter(Boolean).join("\n")} label="Copy output" />
      </div>
      <pre className="px-3 pb-2.5 font-cv-mono text-cv-code whitespace-pre-wrap [overflow-wrap:anywhere]">
        {cmd && (
          <div className="text-cv-text">
            <span className="text-cv-muted select-none">$ </span>
            {cmd}
          </div>
        )}
        {(body || !cmd) && <div className={cn(cmd && "mt-1.5", error && !stderr ? "text-cv-danger" : "text-cv-text-2")}>{shown || (errLines ? "" : "(no output)")}</div>}
        {errLines && (all || lines.length < max) && <div className="mt-1 text-cv-danger">{errLines}</div>}
      </pre>
      {total > max && <FoldButton onClick={() => setAll(!all)}>{all ? "Show less" : `Show all ${total} lines`}</FoldButton>}
    </div>
  );
}

/** Tool input as quiet "key value" lines instead of JSON. */
function InputLines({ input }: { input: Record<string, unknown> }) {
  const keys = Object.keys(input).filter((k) => input[k] !== undefined && input[k] !== null && input[k] !== "");
  if (!keys.length) return null;
  return (
    <dl className="space-y-1 rounded-cv-md bg-cv-sunken px-3 py-2 font-cv-sans text-cv-meta">
      {keys.map((k) => {
        const v = input[k];
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return (
          <div key={k} className="flex gap-3">
            <dt className="w-20 shrink-0 truncate text-cv-muted">{k.replace(/_/g, " ")}</dt>
            <dd className="line-clamp-4 min-w-0 flex-1 font-cv-mono text-cv-text-2 [overflow-wrap:anywhere] whitespace-pre-wrap">{s}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** What a step shows when opened. */
export function StepBody({ use, res }: { use: Use; res?: Res }) {
  const input = inputOf(use);
  const meta = metaOf(res);
  const text = res ? resultText(res) : "";
  const result = res && text ? <Output text={text} error={res.is_error} /> : null;
  switch (use.name) {
    case "Bash":
      return <Output cmd={str(input.command)} text={meta?.stdout ?? res?.text ?? ""} stderr={meta?.stderr} error={res?.is_error} label={input.description ? str(input.description) : "Command"} />;
    case "Read":
    case "Glob":
    case "Grep":
    case "LS":
    case "WebSearch":
    case "WebFetch":
    case "ToolSearch":
    case "BashOutput":
      return result ?? <div className="font-cv-sans text-cv-meta text-cv-muted">{res ? "No output" : "Waiting for the result…"}</div>;
    case "TodoWrite":
      return <TodoList todos={todosOf(use)} />;
    default:
      return (
        <div className="space-y-2">
          <InputLines input={input} />
          {result}
        </div>
      );
  }
}

// ───────────── todos ─────────────

function TodoMark({ status }: { status: string }) {
  if (status === "completed") return <span className="grid size-4 place-items-center rounded-full bg-cv-success text-cv-on-clay"><Check size={10} strokeWidth={3} /></span>;
  if (status === "in_progress") return <LoaderCircle size={15} className="animate-spin text-cv-clay [animation-duration:1.6s]" />;
  return <Circle size={15} className="text-cv-line-strong" />;
}

function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul className="font-cv-sans text-cv-step">
      {todos.map((t, i) => (
        <li key={i} className={cn("flex min-h-7 items-start gap-2.5 py-0.5", t.status === "completed" ? "text-cv-muted" : t.status === "in_progress" ? "text-cv-text" : "text-cv-text-2")}>
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
            <TodoMark status={t.status} />
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}</span>
        </li>
      ))}
    </ul>
  );
}

const TODO_MAX = 8;

/** The newest task list as a card; older ones as one quiet line. */
export const TodoCard = memo(function TodoCard({ use, latest }: { use: Use; latest: boolean }) {
  const [all, setAll] = useState(false);
  const todos = todosOf(use);
  const done = todos.filter((t) => t.status === "completed").length;
  if (!latest) {
    return (
      <div className="flex h-cv-row items-center gap-2 font-cv-sans text-cv-step text-cv-muted">
        <Check size={14} strokeWidth={2} className="shrink-0" />
        Updated tasks · {done} of {todos.length} done
      </div>
    );
  }
  let shown = todos;
  if (!all && todos.length > TODO_MAX) {
    const at = Math.max(0, todos.findIndex((t) => t.status !== "completed"));
    const start = Math.max(0, Math.min(at - 3, todos.length - (TODO_MAX - 1)));
    shown = todos.slice(start, start + TODO_MAX - 1);
  }
  return (
    <div className="my-3 rounded-cv-md border border-cv-line-soft bg-cv-surface px-3.5 pt-2.5 pb-2">
      <div className="mb-1 font-cv-sans text-cv-meta text-cv-muted">
        Tasks · {done} of {todos.length}
      </div>
      <TodoList todos={shown} />
      {shown.length < todos.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-0.5 h-8 font-cv-sans text-cv-meta text-cv-muted transition-colors hover:text-cv-text">
          {todos.length - shown.length} more
        </button>
      )}
    </div>
  );
});

// ───────────── plan and question ─────────────

const PLAN_LINES = 14;

export const PlanCard = memo(function PlanCard({ use, res }: { use: Use; res?: Res }) {
  const plan = str(inputOf(use).plan);
  const denied = deniedReason(res);
  const status = !res ? null : denied !== null ? (denied ? `Not approved · ${denied}` : "Not approved") : res.is_error ? null : "Approved";
  const long = plan.split("\n").length > PLAN_LINES;
  const [all, setAll] = useState(false);
  return (
    <div className="my-4 overflow-hidden rounded-cv-md border border-cv-line bg-cv-surface">
      <div className="flex min-w-0 items-center gap-1.5 px-4 pt-2.5 font-cv-sans text-cv-meta text-cv-muted">
        <span className="shrink-0">Plan</span>
        {status && <span className={cn("min-w-0 truncate", denied === null ? "text-cv-success" : "text-cv-text-2")}>· {status}</span>}
      </div>
      <div className={cn("px-4 pt-1.5 pb-3.5", long && !all && "cv-clamp")}>
        <Markdown text={plan} />
      </div>
      {long && <FoldButton onClick={() => setAll(!all)}>{all ? "Show less" : "Show full plan"}</FoldButton>}
    </div>
  );
});

/** A question Claude asked (AskUserQuestion), once answered: one line, open for the details. */
export const Answered = memo(function Answered({ use, res }: { use: Use; res?: Res }) {
  const qs = (inputOf(use).questions as { question: string; header?: string }[] | undefined) ?? [];
  const given = metaOf(res)?.answers;
  const answer = given && Object.keys(given).length ? Object.values(given).join(", ") : res?.text.replace(/^User has answered[^:]*:\s*/i, "").replace(/\. You can now continue.*$/s, "").trim();
  const [open, setOpen] = useState(false);
  const q = qs[0];
  return (
    <div className="my-2 font-cv-sans">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-cv-row w-full min-w-0 items-center gap-2 text-left text-cv-step">
        <MessageCircleQuestion size={15} strokeWidth={1.8} className="shrink-0 text-cv-muted" />
        <span className="min-w-0 truncate text-cv-text-2">{q?.header || q?.question || "Question"}</span>
        {answer ? <span className="min-w-0 shrink-0 truncate font-cv-strong text-cv-text">· {answer.split("\n")[0]}</span> : <span className="shrink-0 text-cv-clay">· Waiting for you</span>}
      </button>
      {open && (
        <div className="mb-2 ml-6 space-y-1 text-cv-step">
          {qs.map((x, i) => (
            <div key={i} className="text-cv-text-2">{x.question}</div>
          ))}
          {answer && <div className="font-cv-strong text-cv-text [overflow-wrap:anywhere] whitespace-pre-wrap">{answer}</div>}
        </div>
      )}
    </div>
  );
});
