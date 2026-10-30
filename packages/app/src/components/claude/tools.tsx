/**
 * Tool calls the way Claude Code desktop shows them: one quiet row per call — bold verb,
 * monospace path chip, green +N / red −N — that opens into the diff or the output. Runs of
 * reads and searches fold into one sentence ("Read 3 files, searched code ›").
 */
import type { CvBlock } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { Check, ChevronRight, Circle, LoaderCircle } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { CodeBlock, CopyButton, Markdown } from "./Markdown";

export type Use = Extract<CvBlock, { k: "tool_use" }>;
export type Res = Extract<CvBlock, { k: "tool_result" }>;

/** The session's folder, so paths read relative to it. */
export const CwdContext = createContext("");

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const inputOf = (u: Use) => (u.input ?? {}) as Record<string, unknown>;

function useRel() {
  const cwd = useContext(CwdContext).replace(/\/+$/, "");
  return (p: string) => (cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p);
}

/** "mcp__server__tool" → ["server", "tool"] */
export function toolTitle(name: string): { title: string; mcp?: string } {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (m) return { title: m[2]!.replace(/_/g, " "), mcp: m[1]! };
  if (name === "Task") return { title: "Agent" };
  return { title: name };
}

const VERB: Record<string, string> = {
  Read: "Read",
  Write: "Write",
  Edit: "Edit",
  MultiEdit: "Edit",
  NotebookEdit: "Edit",
  Bash: "Bash",
  BashOutput: "Read output",
  KillShell: "Stop",
  Grep: "Search",
  Glob: "Find",
  LS: "List",
  WebFetch: "Fetch",
  WebSearch: "Web search",
  Task: "Agent",
  Agent: "Agent",
  Skill: "Skill",
  ToolSearch: "Load tools",
  SlashCommand: "Command",
};

/** The part next to the verb. */
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
      return `${str(input.pattern)}${input.path ? ` in ${str(input.path)}` : ""}`;
    case "Glob":
      return str(input.pattern);
    case "LS":
      return str(input.path);
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

/** The rows of a file change (Edit, MultiEdit, Write), or null for other tools. */
export function changeRows(use: Use): Row[] | null {
  const input = inputOf(use);
  switch (use.name) {
    case "Edit":
      return diffLines(str(input.old_string), str(input.new_string));
    case "MultiEdit":
      return ((input.edits as { old_string?: string; new_string?: string }[] | undefined) ?? []).flatMap((e) => diffLines(e.old_string ?? "", e.new_string ?? ""));
    case "Write":
      return str(input.content).split("\n").map((t): Row => ({ kind: "+", text: t }));
    default:
      return null;
  }
}

export function DiffStat({ rows, className }: { rows: Row[]; className?: string }) {
  const add = rows.filter((r) => r.kind === "+").length;
  const del = rows.filter((r) => r.kind === "-").length;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 font-cv-mono text-cv-code tabular-nums", className)}>
      {add > 0 && <span className="text-cv-diff-add">+{add}</span>}
      {del > 0 && <span className="text-cv-diff-del">−{del}</span>}
    </span>
  );
}

export function Diff({ rows, path, max = 40 }: { rows: Row[]; path?: string; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, max);
  // Line numbers on the new side (the old side is unknown without the file; count from 1 per hunk).
  let n = 0;
  return (
    <div className="overflow-hidden rounded-cv-md border border-cv-line-soft bg-cv-surface">
      {path && (
        <div className="flex h-9 items-center gap-2 border-b border-cv-line-soft pr-1.5 pl-3.5 font-cv-sans text-cv-meta">
          <span className="min-w-0 truncate font-cv-mono text-cv-text">{path.split("/").pop()}</span>
          <span className="min-w-0 flex-1 truncate text-cv-muted">{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}</span>
          <DiffStat rows={rows} />
        </div>
      )}
      <div className="cv-scroll overflow-x-auto py-1 font-cv-mono text-cv-code">
        {shown.map((r, i) => {
          if (r.kind !== "-") n++;
          return (
            <div key={i} className={cn("flex min-w-fit pr-4 whitespace-pre", r.kind === "+" && "bg-cv-diff-add-bg", r.kind === "-" && "bg-cv-diff-del-bg")}>
              <span className="w-10 shrink-0 pr-2 text-right text-cv-muted tabular-nums select-none">{r.kind === "-" ? "" : n}</span>
              <span className={cn("w-4 shrink-0 select-none", r.kind === "+" ? "text-cv-diff-add" : r.kind === "-" ? "text-cv-diff-del" : "text-cv-muted")}>{r.kind === " " ? "" : r.kind === "-" ? "−" : "+"}</span>
              <span className={r.kind === " " ? "text-cv-text-2" : "text-cv-text"}>{r.text || " "}</span>
            </div>
          );
        })}
      </div>
      {rows.length > max && (
        <button type="button" onClick={() => setAll(!all)} className="h-9 w-full border-t border-cv-line-soft font-cv-sans text-cv-meta text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text">
          {all ? "Show less" : `Show ${rows.length - max} more lines`}
        </button>
      )}
    </div>
  );
}

/** Command output / tool output in a sunken box; `cmd` puts the command on top like a terminal. */
function Output({ text, error, cmd, max = 14 }: { text: string; error?: boolean; cmd?: string; max?: number }) {
  const [all, setAll] = useState(false);
  const lines = text.replace(/\n+$/, "").split("\n");
  const shown = all ? lines.join("\n") : lines.slice(0, max).join("\n");
  return (
    <div className="group/out relative overflow-hidden rounded-cv-md border border-cv-line-soft bg-cv-sunken">
      <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/out:opacity-100 [[data-mode=phone]_&]:opacity-100">
        <CopyButton text={cmd ? `${cmd}\n${text}` : text} label="Copy output" />
      </div>
      <pre className="cv-scroll overflow-x-auto px-3.5 py-2.5 pr-10 font-cv-mono text-cv-code whitespace-pre-wrap [overflow-wrap:anywhere]">
        {cmd && <div className="text-cv-text"><span className="text-cv-muted select-none">$ </span>{cmd}</div>}
        {(text || !cmd) && <div className={cn(cmd && "mt-1.5", error ? "text-cv-danger" : "text-cv-text-2")}>{shown || "(no output)"}</div>}
      </pre>
      {lines.length > max && (
        <button type="button" onClick={() => setAll(!all)} className="h-9 w-full border-t border-cv-line-soft font-cv-sans text-cv-meta text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text">
          {all ? "Show less" : `Show ${lines.length - max} more lines`}
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
    <ul className="space-y-1.5 rounded-cv-md border border-cv-line-soft bg-cv-surface px-3.5 py-3 font-cv-sans text-cv-ui">
      {todos.map((t, i) => (
        <li key={i} className={cn("flex items-start gap-2.5", t.status === "completed" ? "text-cv-muted line-through" : t.status === "in_progress" ? "text-cv-text" : "text-cv-text-2")}>
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
            {t.status === "completed" ? (
              <span className="grid size-4 place-items-center rounded-full bg-cv-success text-cv-on-clay"><Check size={10} strokeWidth={3} /></span>
            ) : t.status === "in_progress" ? (
              <LoaderCircle size={15} className="animate-spin text-cv-clay [animation-duration:1.6s]" />
            ) : (
              <Circle size={15} className="text-cv-line-strong" />
            )}
          </span>
          <span>{t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a call shows when opened. */
function Body({ use, res }: { use: Use; res?: Res }) {
  const rel = useRel();
  const input = inputOf(use);
  const result = res ? <Output text={res.text} error={res.is_error} /> : null;
  const rows = changeRows(use);
  if (rows) {
    return (
      <>
        <Diff rows={rows} path={rel(str(input.file_path ?? input.notebook_path))} max={use.name === "Write" ? 24 : 40} />
        {res?.is_error && result}
      </>
    );
  }
  switch (use.name) {
    case "Bash":
      return <Output cmd={str(input.command)} text={res?.text ?? ""} error={res?.is_error} />;
    case "TodoWrite":
      return <Todos todos={(input.todos as Todo[]) ?? []} />;
    case "Task":
    case "Agent":
      return (
        <div className="space-y-2">
          {!!input.prompt && <Output text={str(input.prompt)} max={6} />}
          {res && (res.is_error ? result : <div className="rounded-cv-md border border-cv-line-soft bg-cv-surface px-4 py-3"><Markdown text={res.text} compact /></div>)}
        </div>
      );
    case "Read":
    case "Glob":
    case "Grep":
    case "LS":
    case "WebSearch":
    case "WebFetch":
    case "ToolSearch":
      return result ?? <Output text="Waiting for the result…" />;
    default:
      return (
        <>
          {Object.keys(input).length > 0 && <CodeBlock code={JSON.stringify(input, null, 2)} lang="input" bare />}
          {result}
        </>
      );
  }
}

/** Short line under a failed or interrupted call. */
function problem(res?: Res): { text: string; error: boolean } | null {
  if (!res) return null;
  if (res.text === "Interrupted by user" || /^\[Request interrupted/.test(res.text)) return { text: "Interrupted", error: false };
  if (res.is_error) return { text: short((res.text.replace(/<\/?tool_use_error>/g, "").split("\n").find((l) => l.trim()) ?? "Failed").trim(), 120), error: true };
  return null;
}

/** "Updated todos · 2 of 5 done" and the like: the row's text for tools without a path. */
function rowText(use: Use): string | null {
  const input = inputOf(use);
  if (use.name === "TodoWrite") {
    const todos = (input.todos as Todo[] | undefined) ?? [];
    const done = todos.filter((t) => t.status === "completed").length;
    return `Updated todos · ${done} of ${todos.length} done`;
  }
  if (use.name === "Bash" && input.description) return str(input.description);
  return null;
}

/** Disclosure with a smooth height animation; the body mounts on first open. */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div className="cv-fold" data-open={open}>
      <div>{seen && <div className="pt-2 pb-1">{children}</div>}</div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight size={15} strokeWidth={1.8} className={cn("shrink-0 text-cv-muted transition-transform duration-200", open && "rotate-90")} />;
}

export function ToolCall({ use, res, running, nested }: { use: Use; res?: Res; running: boolean; nested?: boolean }) {
  const rel = useRel();
  const input = inputOf(use);
  const { title, mcp } = toolTitle(use.name);
  const verb = VERB[use.name] ?? title;
  const arg = toolArg(use.name, input);
  const isPath = /^(Read|Write|Edit|MultiEdit|NotebookEdit|LS)$/.test(use.name);
  const rows = changeRows(use);
  const special = use.name === "ExitPlanMode" || use.name === "AskUserQuestion";
  const [open, setOpen] = useState(false);
  const pending = !res && running;
  const issue = problem(res);
  const text = rowText(use);

  if (use.name === "ExitPlanMode") {
    return (
      <div className="my-4 overflow-hidden rounded-cv-card border border-cv-line bg-cv-surface">
        <div className="flex items-center gap-2 border-b border-cv-line-soft px-4 py-2.5 font-cv-sans text-cv-meta text-cv-muted">Plan</div>
        <div className="px-4 py-3.5"><Markdown text={str(input.plan)} /></div>
      </div>
    );
  }
  if (special) return <Answered use={use} res={res} />;

  return (
    <div className={cn("font-cv-sans", nested ? "my-0.5" : "my-1.5")}>
      <div className="-mx-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex min-h-9 w-full min-w-0 items-center gap-2 rounded-cv-sm px-2 py-1 text-left text-cv-ui transition-colors hover:bg-cv-hover [[data-mode=phone]_&]:min-h-11"
      >
        {pending && <LoaderCircle size={14} className="shrink-0 animate-spin text-cv-clay [animation-duration:1.2s]" />}
        {issue?.error && <span className="size-1.5 shrink-0 rounded-full bg-cv-danger" />}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {text ? (
            <span className="min-w-0 truncate text-cv-text-2">{text}</span>
          ) : (
            <>
              <span className="shrink-0 font-cv-strong text-cv-text">{verb}</span>
              {mcp && <span className="shrink-0 text-cv-meta text-cv-muted">{mcp}</span>}
              {arg && (
                <span className={cn("min-w-0 truncate", isPath || use.name === "Bash" || use.name === "Glob" || use.name === "Grep" ? "rounded-cv-xs bg-cv-chip px-1.5 py-px font-cv-mono text-cv-code text-cv-text-2" : "text-cv-text-2")}>
                  {isPath ? rel(arg) : arg}
                </span>
              )}
            </>
          )}
          {rows && !issue && <DiffStat rows={rows} />}
        </span>
        <Chevron open={open} />
      </button>
      </div>
      {issue && !open && <div className={cn("ml-0.5 flex gap-1.5 pt-0.5 text-cv-meta", issue.error ? "text-cv-danger" : "text-cv-muted")}><span className="select-none">└</span><span className="min-w-0 [overflow-wrap:anywhere]">{issue.text}</span></div>}
      <Fold open={open}>
        <Body use={use} res={res} />
      </Fold>
    </div>
  );
}

/** A question Claude asked (AskUserQuestion) with the answer, as a quiet card. */
function Answered({ use, res }: { use: Use; res?: Res }) {
  const qs = (inputOf(use).questions as { question: string; header?: string; options?: { label: string; description?: string }[] }[] | undefined) ?? [];
  const answer = res?.text.replace(/^User has answered[^:]*:\s*/i, "").replace(/\. You can now continue.*$/s, "").trim();
  return (
    <div className="my-4 rounded-cv-card border border-cv-line-soft bg-cv-surface px-4 py-3.5 font-cv-sans">
      <div className="mb-1.5 text-cv-meta text-cv-muted">Question</div>
      {qs.map((q, i) => (
        <div key={i} className="text-cv-ui text-cv-text-2">{q.question}</div>
      ))}
      {answer ? <div className="mt-2 font-cv-strong text-cv-ui text-cv-text [overflow-wrap:anywhere]">{answer}</div> : <div className="mt-2 text-cv-meta text-cv-muted">Waiting for your answer…</div>}
    </div>
  );
}

// ───────────── groups of reads and searches ─────────────

const EXPLORE = new Set(["Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch", "ToolSearch", "BashOutput"]);
export const isExplore = (name: string) => EXPLORE.has(name);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));

/** "Read 3 files, searched code" */
export function groupSummary(uses: Use[]): string {
  const c = (names: string[]) => uses.filter((u) => names.includes(u.name)).length;
  const parts: string[] = [];
  const read = c(["Read"]);
  const search = c(["Grep", "Glob"]);
  const ls = c(["LS"]);
  const web = c(["WebSearch"]);
  const fetch = c(["WebFetch"]);
  const tools = c(["ToolSearch"]);
  const out = c(["BashOutput"]);
  if (read) parts.push(plural(read, "read a file", "read # files"));
  if (search) parts.push(search === 1 ? "searched code" : `searched code ${search} times`);
  if (ls) parts.push(plural(ls, "listed a folder", "listed # folders"));
  if (web) parts.push(plural(web, "searched the web", "searched the web # times"));
  if (fetch) parts.push(plural(fetch, "fetched a page", "fetched # pages"));
  if (tools) parts.push("loaded tools");
  if (out) parts.push("checked output");
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ToolGroup({ uses, results, running }: { uses: Use[]; results: Map<string, Res>; running: string | null }) {
  const [open, setOpen] = useState(false);
  const pending = uses.some((u) => u.id === running && !results.has(u.id));
  const failed = uses.filter((u) => results.get(u.id)?.is_error).length;
  return (
    <div className="my-1.5 font-cv-sans">
      <div className="-mx-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-9 w-full items-center gap-2 rounded-cv-sm px-2 py-1 text-left text-cv-ui text-cv-text-2 transition-colors hover:bg-cv-hover [[data-mode=phone]_&]:min-h-11"
      >
        {pending && <LoaderCircle size={14} className="shrink-0 animate-spin text-cv-clay [animation-duration:1.2s]" />}
        <span className="min-w-0 truncate">{groupSummary(uses)}</span>
        {failed > 0 && <span className="shrink-0 text-cv-meta text-cv-danger">{failed} failed</span>}
        <Chevron open={open} />
      </button>
      </div>
      <Fold open={open}>
        <div className="ml-1 border-l border-cv-line pl-3.5">
          {uses.map((u) => (
            <ToolCall key={u.id} use={u} res={results.get(u.id)} running={u.id === running} nested />
          ))}
        </div>
      </Fold>
    </div>
  );
}
