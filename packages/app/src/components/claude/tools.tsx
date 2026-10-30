/** Tool calls the way Claude Code shows them: "● Name(argument)" with the result folded under it. */
import type { CvBlock } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { Check, ChevronRight, Circle, CircleDot, Loader } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CodeBlock, Markdown } from "./Markdown";

type Use = Extract<CvBlock, { k: "tool_use" }>;
type Res = Extract<CvBlock, { k: "tool_result" }>;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "mcp__server__tool" → ["server", "tool"] */
export function toolTitle(name: string): { title: string; mcp?: string } {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (m) return { title: m[2]!.replace(/_/g, " "), mcp: m[1]! };
  if (name === "Task") return { title: "Agent" };
  return { title: name };
}

/** The part in parentheses. */
export function toolArg(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash":
      return short(str(input.command).split("\n")[0]!, 100) || short(str(input.description), 100);
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return str(input.file_path ?? input.notebook_path);
    case "Grep":
      return `"${str(input.pattern)}"${input.path ? ` in ${str(input.path)}` : ""}`;
    case "Glob":
      return str(input.pattern);
    case "WebFetch":
      return str(input.url);
    case "WebSearch":
      return str(input.query);
    case "Task":
    case "Agent":
      return str(input.description);
    case "Skill":
      return str(input.skill ?? input.name);
    case "TodoWrite":
      return "";
    case "ToolSearch":
      return str(input.query);
    default: {
      const first = Object.values(input).find((v) => typeof v === "string") as string | undefined;
      return first ? short(first, 80) : "";
    }
  }
}

type Row = { kind: "+" | "-" | " "; text: string };

/** Line diff of two strings (LCS on lines; inputs are small edits). */
export function diffLines(a: string, b: string): Row[] {
  const x = a ? a.split("\n") : [];
  const y = b ? b.split("\n") : [];
  if (x.length * y.length > 250_000) return [...x.map((t): Row => ({ kind: "-", text: t })), ...y.map((t): Row => ({ kind: "+", text: t }))];
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) out.push({ kind: " ", text: x[i++]! }), j++;
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ kind: "-", text: x[i++]! });
    else out.push({ kind: "+", text: y[j++]! });
  }
  while (i < x.length) out.push({ kind: "-", text: x[i++]! });
  while (j < y.length) out.push({ kind: "+", text: y[j++]! });
  return out;
}

function Diff({ rows, max = 40 }: { rows: Row[]; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, max);
  return (
    <div className="overflow-hidden rounded-item bg-raised shadow-well">
      <div className="overflow-x-auto py-1.5 font-mono text-small leading-relaxed">
        {shown.map((r, i) => (
          <div
            key={i}
            className={cn("flex min-w-fit gap-2 px-3 whitespace-pre", r.kind === "+" && "bg-mint/10 text-mint", r.kind === "-" && "bg-danger/10 text-danger", r.kind === " " && "text-dim")}
          >
            <span className="w-3 shrink-0 select-none">{r.kind}</span>
            <span>{r.text || " "}</span>
          </div>
        ))}
      </div>
      {rows.length > max && (
        <button type="button" onClick={() => setAll(!all)} className="hoverable h-7 w-full text-meta text-dim">
          {all ? "Show less" : `Show ${rows.length - max} more lines`}
        </button>
      )}
    </div>
  );
}

function Output({ text, error }: { text: string; error?: boolean }) {
  const [all, setAll] = useState(false);
  const lines = text.split("\n");
  const shown = all ? text : lines.slice(0, 12).join("\n");
  return (
    <div className="overflow-hidden rounded-item bg-raised shadow-well">
      <pre className={cn("overflow-x-auto px-3 py-2 font-mono text-small leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]", error ? "text-danger" : "text-dim")}>{shown || "(no output)"}</pre>
      {lines.length > 12 && (
        <button type="button" onClick={() => setAll(!all)} className="hoverable h-7 w-full text-meta text-dim">
          {all ? "Show less" : `Show ${lines.length - 12} more lines`}
        </button>
      )}
    </div>
  );
}

interface Todo {
  content: string;
  status: string;
  activeForm?: string;
}

function Todos({ todos }: { todos: Todo[] }) {
  return (
    <ul className="space-y-1 text-small">
      {todos.map((t, i) => (
        <li key={i} className={cn("flex items-start gap-2", t.status === "completed" ? "text-faint line-through" : t.status === "in_progress" ? "text-bright" : "text-dim")}>
          {t.status === "completed" ? <Check size={13} className="mt-0.5 shrink-0 text-mint" /> : t.status === "in_progress" ? <CircleDot size={13} className="mt-0.5 shrink-0 text-ember" /> : <Circle size={13} className="mt-0.5 shrink-0" />}
          <span>{t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}</span>
        </li>
      ))}
    </ul>
  );
}

/** What is shown when the card is open. */
function Body({ use, res }: { use: Use; res?: Res }) {
  const input = (use.input ?? {}) as Record<string, unknown>;
  const result = res ? <Output text={res.text} error={res.is_error} /> : null;
  switch (use.name) {
    case "Edit":
      return (
        <>
          <Diff rows={diffLines(str(input.old_string), str(input.new_string))} />
          {res?.is_error && result}
        </>
      );
    case "MultiEdit": {
      const edits = (input.edits as { old_string: string; new_string: string }[] | undefined) ?? [];
      return (
        <>
          {edits.map((e, i) => <Diff key={i} rows={diffLines(e.old_string ?? "", e.new_string ?? "")} />)}
          {res?.is_error && result}
        </>
      );
    }
    case "Write":
      return <Diff rows={str(input.content).split("\n").map((t): Row => ({ kind: "+", text: t }))} max={24} />;
    case "Bash":
      return (
        <>
          <CodeBlock code={str(input.command)} lang="bash" />
          {result}
        </>
      );
    case "ExitPlanMode":
      return <div className="rounded-item bg-fill-1 p-3 shadow-well"><Markdown text={str(input.plan)} /></div>;
    case "AskUserQuestion": {
      const qs = (input.questions as { question: string; header?: string; options?: { label: string; description?: string }[] }[] | undefined) ?? [];
      return (
        <div className="space-y-3">
          {qs.map((q, i) => (
            <div key={i}>
              <div className="text-body text-bright">{q.question}</div>
              <ul className="mt-1 space-y-0.5 text-small text-dim">
                {q.options?.map((o, j) => <li key={j}><span className="text-ink">{o.label}</span>{o.description ? ` — ${o.description}` : ""}</li>)}
              </ul>
            </div>
          ))}
          {res && <div className="text-small text-ink">{res.text}</div>}
        </div>
      );
    }
    case "Read":
    case "Glob":
    case "Grep":
    case "WebSearch":
    case "WebFetch":
    case "Task":
    case "Agent":
      return result;
    default:
      return (
        <>
          <Output text={JSON.stringify(input, null, 2)} />
          {result}
        </>
      );
  }
}

/** Short line under the title once the call is done, like "Read 120 lines". */
function summary(use: Use, res?: Res): string {
  if (!res) return "";
  if (res.text === "Interrupted by user") return res.text;
  if (res.is_error) return short(res.text.split("\n")[0] ?? "Failed", 100);
  const input = (use.input ?? {}) as Record<string, unknown>;
  const lines = res.text ? res.text.split("\n").length : 0;
  switch (use.name) {
    case "Read":
      return `Read ${lines} lines`;
    case "Write":
      return `Wrote ${str(input.content).split("\n").length} lines`;
    case "Edit": {
      const r = diffLines(str(input.old_string), str(input.new_string));
      return `Added ${r.filter((x) => x.kind === "+").length} lines, removed ${r.filter((x) => x.kind === "-").length}`;
    }
    case "Grep":
    case "Glob":
      return res.text.trim() ? `${res.text.trim().split("\n").length} results` : "No results";
    case "Bash":
      return res.text.trim() ? short(res.text.trim().split("\n")[0]!, 100) : "Done";
    default:
      return res.text ? short(res.text.split("\n")[0]!, 100) : "Done";
  }
}

export function ToolCall({ use, res, running }: { use: Use; res?: Res; running: boolean }) {
  const input = (use.input ?? {}) as Record<string, unknown>;
  const { title, mcp } = toolTitle(use.name);
  const arg = toolArg(use.name, input);
  const alwaysOpen = use.name === "TodoWrite" || use.name === "ExitPlanMode" || use.name === "AskUserQuestion";
  const [open, setOpen] = useState(false);
  const isOpen = open || alwaysOpen;
  const pending = !res && running;
  const failed = res?.is_error;
  let body: ReactNode = null;
  if (use.name === "TodoWrite") body = <Todos todos={(input.todos as Todo[]) ?? []} />;
  else if (isOpen) body = <Body use={use} res={res} />;
  const sum = summary(use, res);
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => !alwaysOpen && setOpen(!open)}
        className="group flex w-full min-w-0 items-start gap-2 text-left"
        aria-expanded={isOpen}
      >
        <span className="mt-1.5 grid size-3 shrink-0 place-items-center">
          {pending ? <Loader size={12} className="animate-spin text-ember" /> : <span className={cn("size-2 rounded-full", failed ? "bg-danger" : res?.text === "Interrupted by user" ? "bg-faint" : "bg-mint")} />}
        </span>
        <span className="min-w-0 flex-1 text-body">
          <span className="font-medium text-bright">{title}</span>
          {mcp && <span className="ml-1.5 text-meta text-faint">{mcp}</span>}
          {arg && <span className="text-dim">{" ("}<span className="font-mono text-small [overflow-wrap:anywhere]">{short(arg, 140)}</span>{")"}</span>}
          {sum && !isOpen && <span className={cn("mt-0.5 block text-small", failed ? "text-danger" : "text-faint")}>⎿ {sum}</span>}
        </span>
        {!alwaysOpen && <ChevronRight size={14} className={cn("mt-1 shrink-0 text-faint transition-transform", isOpen && "rotate-90")} />}
      </button>
      {body && <div className="mt-1.5 ml-5 space-y-2">{body}</div>}
    </div>
  );
}
