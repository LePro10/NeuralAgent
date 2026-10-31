/**
 * Words and numbers for tool calls (pure, no React; tested in `lib/cvEntries.test.ts`):
 * verbs, the argument next to a verb, the one-line summary of a run of steps, diffs from the
 * tool input or from the CLI's `structuredPatch`, failures.
 */
import type { CvBlock, CvToolMeta } from "@neuralagent/protocol";

export type Use = Extract<CvBlock, { k: "tool_use" }>;
export type Res = Extract<CvBlock, { k: "tool_result" }>;

export const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
export const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const inputOf = (u: Use) => (u.input ?? {}) as Record<string, unknown>;

/** Structured result fields from a newer daemon (`tool_result.meta`); absent from an older one. */
export type ToolMeta = CvToolMeta;
export interface Hunk {
  old_start: number;
  new_start: number;
  old_lines?: number;
  new_lines?: number;
  lines: string[];
}
export const metaOf = (res?: Res): ToolMeta | undefined => res?.meta ?? undefined;

/** "mcp__server__tool" → ["server", "tool"] */
export function toolTitle(name: string): { title: string; mcp?: string } {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (m) return { title: m[2]!.replace(/_/g, " "), mcp: m[1]! };
  if (name === "Task") return { title: "Agent" };
  return { title: name };
}

export const VERB: Record<string, string> = {
  Read: "Read",
  Write: "Write",
  Edit: "Edit",
  MultiEdit: "Edit",
  NotebookEdit: "Edit",
  Bash: "Bash",
  BashOutput: "Read output",
  KillShell: "Stop",
  TaskStop: "Stop",
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
  Monitor: "Watch",
  SendMessage: "Message",
  TodoWrite: "Tasks",
  TaskCreate: "Tasks",
  TaskUpdate: "Tasks",
  TaskList: "Tasks",
  EnterPlanMode: "Plan mode",
  ScheduleWakeup: "Wake up",
  SendUserFile: "Send file",
};

export const verbOf = (name: string) => VERB[name] ?? toolTitle(name).title;

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
    case "EnterPlanMode":
      return "";
    case "ToolSearch":
      return str(input.query);
    case "Monitor":
      return short(str(input.description ?? input.command), 80);
    case "SendMessage":
      return short(str(input.to ?? input.agent_id ?? input.recipient ?? ""), 60);
    case "TaskStop":
    case "KillShell":
      return str(input.task_id ?? input.shell_id ?? input.id ?? "");
    default: {
      const first = Object.values(input).find((v) => typeof v === "string") as string | undefined;
      return first ? short(first, 80) : "";
    }
  }
}

/** Tools whose argument is a path (shown relative to the session's folder). */
export const isPathTool = (name: string) => /^(Read|Write|Edit|MultiEdit|NotebookEdit|LS)$/.test(name);
/** Tools whose argument reads as code (mono chip). */
export const isCodeArg = (name: string) => isPathTool(name) || /^(Bash|Glob|Grep)$/.test(name);

export const isEdit = (name: string) => /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name);
export const isAgent = (name: string) => name === "Task" || name === "Agent";

// ───────────── todos ─────────────

export interface Todo {
  content: string;
  status: string;
  activeForm?: string;
}
export const todosOf = (use: Use): Todo[] => ((inputOf(use).todos as Todo[] | undefined) ?? []).filter((t) => t && typeof t.content === "string");

/** "Updated tasks · 2 of 5 done" and the like: the row text for tools without a useful argument. */
export function rowText(use: Use): string | null {
  const input = inputOf(use);
  if (use.name === "TodoWrite") {
    const todos = todosOf(use);
    const done = todos.filter((t) => t.status === "completed").length;
    return `Updated tasks · ${done} of ${todos.length} done`;
  }
  if (use.name === "TaskCreate") return `Added a task${input.subject || input.content ? `: ${short(str(input.subject ?? input.content), 60)}` : ""}`;
  if (use.name === "TaskUpdate") return `Updated a task${input.status ? ` · ${str(input.status).replace(/_/g, " ")}` : ""}`;
  if (use.name === "TaskList") return "Checked the tasks";
  if (use.name === "EnterPlanMode") return "Entered plan mode";
  if (use.name === "Bash" && input.description) return str(input.description);
  return null;
}

// ───────────── step summaries ─────────────

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));
const times = (n: number, s: string) => (n === 1 ? s : `${s} ${n} times`);

/** "Ran 6 commands, read 3 files, used blender 3 times" for a run of tool calls. */
export function stepSummary(names: string[], thinkingMs = 0): string {
  const order: string[] = [];
  const count = new Map<string, number>();
  const bump = (k: string) => {
    if (!count.has(k)) order.push(k);
    count.set(k, (count.get(k) ?? 0) + 1);
  };
  for (const n of names) {
    const mcp = /^mcp__(.+?)__/.exec(n)?.[1];
    if (mcp) bump(`mcp:${mcp}`);
    else if (n === "Grep" || n === "Glob") bump("search");
    else if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList)$/.test(n)) bump("tasks");
    else if (n === "KillShell" || n === "TaskStop") bump("stop");
    else bump(n);
  }
  const parts = order.map((k) => {
    const n = count.get(k)!;
    if (k.startsWith("mcp:")) return times(n, `used ${k.slice(4)}`);
    switch (k) {
      case "Bash":
        return plural(n, "ran a command", "ran # commands");
      case "Read":
        return plural(n, "read a file", "read # files");
      case "search":
        return times(n, "searched code");
      case "LS":
        return plural(n, "listed a folder", "listed # folders");
      case "WebSearch":
        return times(n, "searched the web");
      case "WebFetch":
        return plural(n, "fetched a page", "fetched # pages");
      case "ToolSearch":
        return "loaded tools";
      case "BashOutput":
        return "checked output";
      case "tasks":
        return "updated tasks";
      case "stop":
        return plural(n, "stopped a task", "stopped # tasks");
      case "Monitor":
        return plural(n, "watched an output", "watched # outputs");
      case "SendMessage":
        return plural(n, "messaged an agent", "sent # messages");
      case "Skill":
        return plural(n, "used a skill", "used # skills");
      case "EnterPlanMode":
        return "entered plan mode";
      default:
        return times(n, `used ${toolTitle(k).title}`);
    }
  });
  if (!parts.length) return thinkingMs >= 1000 ? `Thought for ${duration(thinkingMs)}` : "Thought";
  const s = parts.length > 4 ? `${parts.slice(0, 3).join(", ")} and ${parts.length - 3} more` : parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 5s, 2m 10s, 1h 4m */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 && m < 10 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** Short line under a failed or interrupted call. */
/** The owner said no to a permission card: `""` without a reason, the reason, or null. */
export function deniedReason(res?: Res): string | null {
  if (!res?.is_error || !/doesn't want to (proceed|take this action)|tool use was rejected/i.test(res.text)) return null;
  const m = /the user said:\s*([\s\S]+)$/i.exec(res.text);
  return m ? m[1]!.trim().split("\n")[0]!.trim() : "";
}

export function problem(res?: Res): { text: string; error: boolean } | null {
  if (!res) return null;
  if (res.text === "Interrupted by user" || /^\[Request interrupted/.test(res.text) || metaOf(res)?.interrupted) return { text: "Interrupted", error: false };
  const denied = deniedReason(res);
  if (denied !== null) return { text: denied ? `Denied: ${short(denied, 140)}` : "Denied", error: false };
  if (res.is_error) return { text: short((res.text.replace(/<\/?tool_use_error>/g, "").split("\n").find((l) => l.trim()) ?? "Failed").trim(), 160), error: true };
  return null;
}

// ───────────── diffs ─────────────

export type Row = { kind: "+" | "-" | " "; text: string; /** line number on the new side (old side for "-"), when known */ n?: number };

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

/** Rows with real file line numbers from the CLI's structuredPatch hunks. */
export function patchRows(hunks: Hunk[]): Row[][] {
  return hunks.map((h) => {
    let o = h.old_start;
    let n = h.new_start;
    return h.lines.map((l): Row => {
      const c = l.charAt(0);
      const text = l.slice(1);
      if (c === "+") return { kind: "+", text, n: n++ };
      if (c === "-") return { kind: "-", text, n: o++ };
      o++;
      return { kind: " ", text: c === " " ? text : l, n: n++ };
    });
  });
}

/** The rows of a file change (Edit, MultiEdit, Write), or null for other tools. */
export function changeRows(use: Use, res?: Res): Row[] | null {
  const patch = metaOf(res)?.patch;
  if (patch?.length && isEdit(use.name) && use.name !== "Write") return patchRows(patch).flat();
  const input = inputOf(use);
  switch (use.name) {
    case "Edit":
      return diffLines(str(input.old_string), str(input.new_string));
    case "MultiEdit":
      return ((input.edits as { old_string?: string; new_string?: string }[] | undefined) ?? []).flatMap((e) => diffLines(e.old_string ?? "", e.new_string ?? ""));
    case "Write":
      return str(input.content).split("\n").map((t, i): Row => ({ kind: "+", text: t, n: i + 1 }));
    case "NotebookEdit":
      return str(input.new_source).split("\n").map((t): Row => ({ kind: "+", text: t }));
    default:
      return null;
  }
}

/** Hunks of a change for the preview (several hunks with a gap between them). */
export function changeHunks(use: Use, res?: Res): Row[][] {
  const patch = metaOf(res)?.patch;
  if (patch?.length && use.name !== "Write") return patchRows(patch);
  const rows = changeRows(use, res);
  return rows ? [rows] : [];
}

export function diffStat(rows: Row[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const r of rows) {
    if (r.kind === "+") add++;
    else if (r.kind === "-") del++;
  }
  return { add, del };
}

/** The first `max` lines around the first change (a little context before it). */
export function previewRows(rows: Row[], max: number): Row[] {
  if (rows.length <= max) return rows;
  const first = Math.max(0, rows.findIndex((r) => r.kind !== " "));
  const start = Math.max(0, Math.min(first - 1, rows.length - max));
  return rows.slice(start, start + max);
}

// ───────────── subagents ─────────────

/** "general-purpose" → "Agent"; custom names as they are. */
export function agentTypeName(t?: string | null): string {
  if (!t || t === "general-purpose") return "Agent";
  return t;
}

/** The parent's tool result of a background launch is internal metadata, never shown. */
export const isAsyncLaunch = (res?: Res) => metaOf(res)?.status === "async_launched" || /^Async agent launched successfully/i.test(res?.text ?? "");
