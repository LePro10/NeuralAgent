// Autopilot (D87): the pure logic behind its screens: grouping and filtering the inbox, schedule
// labels, tool permissions as the user sees them, the setup form of a connector and the
// before/after of a suggested playbook. No React, no daemon: tests live in autopilot.test.ts.
import type {
  Allow,
  AutopilotState,
  Connector,
  ConnectorStatus,
  FieldKind,
  InboxItem,
  ItemKind,
  Pilot,
  PilotMessage,
  PilotPending,
  PilotSuggestion,
  Playbook,
  Routine,
  Schedule,
  SetupField,
  SourceUse,
  ToolClass,
  ToolRule,
} from "@neuralagent/protocol";

export const EMPTY_AUTOPILOT: AutopilotState = { pilots: [], items: [], messages: [], pending: [], suggestions: [], connectors: [], browser: { connected: false } };

// ───────────────────────────── inbox ─────────────────────────────

export type ItemFilter = "open" | "done";

/** What the Inbox tab shows for one pilot. `needs` comes first; `rest` follows the filter chip. */
export interface InboxView {
  /** Actions waiting for the user's OK (Allow / Deny). */
  pending: PilotPending[];
  /** Items the pilot wants the user for: a draft to send, or a question. */
  needs: InboxItem[];
  /** Everything else of the chosen filter. */
  rest: InboxItem[];
  counts: { open: number; done: number; needs: number };
}

const isDone = (i: InboxItem) => i.status === "done" || i.status === "dismissed";
/** A draft that is still to be sent, or the pilot asked for the user. */
export const needsUser = (i: InboxItem) => !isDone(i) && (i.status === "needs_you" || !!i.draft);

const byImportance = (a: InboxItem, b: InboxItem) => b.urgency - a.urgency || b.updated - a.updated;

export function inboxView(state: AutopilotState, pilotId: string, filter: ItemFilter): InboxView {
  const mine = state.items.filter((i) => i.pilot_id === pilotId);
  const pending = state.pending.filter((p) => p.pilot_id === pilotId).sort((a, b) => a.created - b.created);
  const needs = mine.filter(needsUser).sort(byImportance);
  const open = mine.filter((i) => !isDone(i) && !needsUser(i)).sort(byImportance);
  const done = mine.filter(isDone).sort((a, b) => b.updated - a.updated);
  return {
    pending,
    needs: filter === "open" ? needs : [],
    rest: filter === "open" ? open : done,
    counts: { open: open.length + needs.length, done: done.length, needs: needs.length + pending.length },
  };
}

/** How many things wait for the user across all pilots (sidebar badge): OKs, drafts, questions, suggestions. */
export function attentionCount(state: AutopilotState | undefined): number {
  if (!state) return 0;
  const live = new Set(state.pilots.map((p) => p.id));
  return (
    state.pending.filter((p) => live.has(p.pilot_id)).length +
    state.items.filter((i) => live.has(i.pilot_id) && needsUser(i)).length +
    state.suggestions.filter((s) => live.has(s.pilot_id)).length
  );
}

/** Attention for one pilot (project switcher). */
export function pilotAttention(state: AutopilotState, pilotId: string): number {
  return attentionCount({ ...state, pilots: state.pilots.filter((p) => p.id === pilotId) });
}

export const anyWorking = (state: AutopilotState | undefined) => !!state?.pilots.some((p) => p.enabled && p.status === "working");

export const KIND_LABEL: Record<ItemKind, string> = { bug: "Bug", question: "Question", feedback: "Feedback", idea: "Idea", task: "Task", other: "Note" };

export const URGENCY_LABEL = ["Low", "Normal", "High", "Urgent"];

// ───────────────────────────── time and status ─────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_OPTIONS = DAYS.map((label, i) => ({ value: String(i), label }));

/** "14:00", "tomorrow 09:00", "Fri 09:00": when something happens next, relative to `now`. */
export function whenLabel(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(n)) / 86400000);
  if (diff <= 0) return clock(d);
  if (diff === 1) return `tomorrow ${clock(d)}`;
  if (diff < 7) return `${DAYS[(d.getDay() + 6) % 7]!.slice(0, 3)} ${clock(d)}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${clock(d)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function agoLabel(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/** The pilot's status in one line: "Reading Discord…", "Idle, next run 14:00", "Waiting for you". */
export function statusLine(p: Pilot, now: number): string {
  if (!p.enabled || p.status === "off") return "Switched off";
  if (p.status === "working") return p.activity || "Working…";
  if (p.status === "needs_you") return "Waiting for you";
  if (p.status === "error") return p.activity || "Something went wrong";
  return p.next_run ? `Idle, next run ${whenLabel(p.next_run, now)}` : "Idle, asks nothing of you";
}

// ───────────────────────────── schedules ─────────────────────────────

export const MIN_EVERY_MINUTES = 5;

/** "Every 6 hours", "Every 30 minutes", "Every day at 09:00", "Every Monday at 09:00". */
export function scheduleLabel(s: Schedule): string {
  switch (s.kind) {
    case "every": {
      const m = Math.max(MIN_EVERY_MINUTES, s.minutes);
      if (m % 1440 === 0) return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
      if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
      return `Every ${m} minutes`;
    }
    case "daily":
      return `Every day at ${s.at}`;
    case "weekly":
      return `Every ${DAYS[s.day] ?? DAYS[0]} at ${s.at}`;
  }
}

export type ScheduleKind = Schedule["kind"];

/** A schedule as the editor's fields: a kind, an amount with a unit, a time and a weekday. */
export interface ScheduleForm {
  kind: ScheduleKind;
  amount: string;
  unit: "minutes" | "hours";
  at: string;
  day: string;
}

export function scheduleToForm(s: Schedule): ScheduleForm {
  const base: ScheduleForm = { kind: s.kind, amount: "6", unit: "hours", at: "09:00", day: "0" };
  if (s.kind === "every") return s.minutes % 60 === 0 ? { ...base, amount: String(s.minutes / 60), unit: "hours" } : { ...base, amount: String(s.minutes), unit: "minutes" };
  if (s.kind === "daily") return { ...base, at: s.at };
  return { ...base, at: s.at, day: String(s.day) };
}

export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** The schedule a form describes, or null while it is incomplete (a time that is not a time, 0 hours). */
export function formToSchedule(f: ScheduleForm): Schedule | null {
  if (f.kind === "every") {
    const n = Math.floor(Number(f.amount));
    if (!Number.isFinite(n) || n < 1) return null;
    const minutes = f.unit === "hours" ? n * 60 : n;
    return minutes >= MIN_EVERY_MINUTES ? { kind: "every", minutes } : null;
  }
  if (!validTime(f.at)) return null;
  if (f.kind === "daily") return { kind: "daily", at: f.at };
  const day = Number(f.day);
  return day >= 0 && day <= 6 ? { kind: "weekly", day, at: f.at } : null;
}

export function newRoutine(id: string): Routine {
  return { id, task: "", schedule: { kind: "every", minutes: 360 }, enabled: true };
}

// ───────────────────────────── connectors ─────────────────────────────

export const STATUS_LABEL: Record<ConnectorStatus, string> = {
  needs_setup: "Needs setup",
  off: "Off",
  starting: "Starting",
  running: "Running",
  error: "Error",
  building: "Building",
};

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "accent";
export const STATUS_TONE: Record<ConnectorStatus, StatusTone> = {
  needs_setup: "warning",
  off: "neutral",
  starting: "accent",
  running: "success",
  error: "danger",
  building: "accent",
};

/** Built-in connectors first (in the daemon's order), then the user's own. */
export function splitConnectors(list: Connector[]): { builtin: Connector[]; yours: Connector[] } {
  return { builtin: list.filter((c) => c.builtin), yours: list.filter((c) => !c.builtin) };
}

/** A connector the pilots can use right now. */
export const usable = (c: Connector) => c.enabled && (c.status === "running" || c.status === "starting");

export const FIELD_PLACEHOLDER: Partial<Record<FieldKind, string>> = { url: "https://", number: "0" };

export const CLASS_GROUPS: { class: ToolClass; label: string; detail: string }[] = [
  { class: "read", label: "Reads", detail: "Looks at things, changes nothing" },
  { class: "write", label: "Changes", detail: "Changes something of yours" },
  { class: "external", label: "Speaks for you", detail: "Writes to other people or the public" },
];
export const CLASS_LABEL: Record<ToolClass, string> = { read: "Reads", write: "Changes", external: "Speaks for you" };

/** A tool of a connector: the manifest's class wins, a tool missing there counts as external. */
export function classOf(c: Connector, tool: string): ToolClass {
  return c.tools.find((t) => t.name === tool)?.class ?? c.manifest.tools[tool] ?? "external";
}

/** The tool names with their class, in the daemon's order, then manifest-only ones. */
export function toolsOf(c: Connector): { name: string; description: string; class: ToolClass }[] {
  const seen = new Set<string>();
  const out = c.tools.map((t) => {
    seen.add(t.name);
    return { name: t.name, description: t.description, class: t.class };
  });
  for (const [name, cls] of Object.entries(c.manifest.tools)) if (!seen.has(name)) out.push({ name, description: "", class: cls });
  return out;
}

/** "get_issue" → "Get issue". */
export function toolLabel(name: string): string {
  const s = name.replace(/[_-]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : name;
}

// ───────────────────────────── permissions ─────────────────────────────

export const ALLOW_LABEL: Record<Allow, string> = { auto: "On its own", ask: "Ask me", never: "Never" };
export const ALLOW_OPTIONS = (["auto", "ask", "never"] as Allow[]).map((value) => ({ value, label: ALLOW_LABEL[value] }));

/** What happens without a rule: reading is free, everything else asks (spec: "Permissions"). */
export function defaultAllow(cls: ToolClass): Allow {
  return cls === "read" ? "auto" : "ask";
}

/** Built-in tools of the pilot (no connector): shown under "The pilot itself". */
export const BUILTIN_TOOLS: { name: string; label: string; detail: string; class: ToolClass; fixed?: Allow }[] = [
  { name: "start_agent", label: "Start a coding agent", detail: "Lets an agent work in this project", class: "write" },
  { name: "send_to_agent", label: "Message a running agent", detail: "Gives a running agent new instructions", class: "write" },
];

const sameRule = (r: ToolRule, connectorId: string | undefined, tool: string) => (r.connector_id ?? undefined) === connectorId && r.tool === tool;

/** The rule in force for a tool: the user's own, else the default of its class. */
export function effectiveAllow(rules: ToolRule[], connectorId: string | undefined, tool: string, cls: ToolClass): { allow: Allow; custom: boolean } {
  const r = rules.find((x) => sameRule(x, connectorId, tool));
  return r ? { allow: r.allow, custom: true } : { allow: defaultAllow(cls), custom: false };
}

/** Sets a tool's permission; choosing the default again removes the rule so the list stays short. */
export function setAllow(rules: ToolRule[], connectorId: string | undefined, tool: string, cls: ToolClass, allow: Allow): ToolRule[] {
  const rest = rules.filter((x) => !sameRule(x, connectorId, tool));
  if (allow === defaultAllow(cls)) return rest;
  return [...rest, { ...(connectorId ? { connector_id: connectorId } : {}), tool, allow }];
}

/** "Allowed on its own: 3 · Asks first: 4 · Never: 1" for a connector's tools. */
export function permissionSummary(rules: ToolRule[], c: Connector): string {
  const n: Record<Allow, number> = { auto: 0, ask: 0, never: 0 };
  for (const t of toolsOf(c)) n[effectiveAllow(rules, c.id, t.name, t.class).allow]++;
  const parts = [n.auto && `${n.auto} on its own`, n.ask && `${n.ask} ask first`, n.never && `${n.never} never`].filter(Boolean);
  return parts.join(" · ") || "No tools yet";
}

/** Plain words for a confirmation card's title, from the tool name: "Reply" → "Reply". */
export function pendingTitle(p: PilotPending, connectors: Connector[]): string {
  const c = connectors.find((x) => x.id === p.connector_id);
  const tool = toolLabel(p.tool.includes("__") ? p.tool.split("__").pop()! : p.tool);
  return c ? `${c.manifest.name}: ${tool}` : tool;
}

// ───────────────────────────── sources ─────────────────────────────

/** Sources the pilot can still add: connectors it does not use yet that are set up. */
export function addableSources(playbook: Playbook, connectors: Connector[]): Connector[] {
  const used = new Set(playbook.sources.map((s) => s.connector_id));
  return connectors.filter((c) => !used.has(c.id) && c.status !== "needs_setup" && c.status !== "building");
}

export function withSource(playbook: Playbook, connectorId: string): Playbook {
  if (playbook.sources.some((s) => s.connector_id === connectorId)) return playbook;
  return { ...playbook, sources: [...playbook.sources, { connector_id: connectorId, listen: false, scope: {} }] };
}

export function patchSource(playbook: Playbook, connectorId: string, patch: Partial<SourceUse>): Playbook {
  return { ...playbook, sources: playbook.sources.map((s) => (s.connector_id === connectorId ? { ...s, ...patch } : s)) };
}

/** Fields of a connector that can narrow a pilot's view (channels, repositories, subreddits). */
export const scopeFields = (c: Connector): SetupField[] => c.manifest.setup.filter((f) => f.type === "pick" || f.type === "list");

// ───────────────────────────── connector setup form ─────────────────────────────

/** Values of the non-secret fields as the user sees them; secrets are typed fresh (`drafts`). */
export type FormValues = Record<string, unknown>;

export function initialValues(c: Connector): FormValues {
  const out: FormValues = {};
  for (const f of c.manifest.setup) {
    if (f.type === "secret") continue;
    const have = c.config[f.key];
    out[f.key] = have !== undefined ? have : f.default !== undefined ? f.default : emptyValue(f.type);
  }
  return out;
}

export function emptyValue(kind: FieldKind): unknown {
  switch (kind) {
    case "bool":
      return false;
    case "pick":
    case "list":
      return [];
    default:
      return "";
  }
}

export const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? [v] : []);

/** True when `v` counts as filled in for a required field. */
export function filled(kind: FieldKind, v: unknown): boolean {
  if (kind === "bool") return true;
  if (kind === "pick" || kind === "list") return asList(v).length > 0;
  if (kind === "number") return v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));
  return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;
}

/** Labels of required fields that are still empty (a secret counts as filled when stored or typed). */
export function missingFields(c: Connector, values: FormValues, drafts: Record<string, string>): string[] {
  return c.manifest.setup
    .filter((f) => f.required)
    .filter((f) => (f.type === "secret" ? !(c.secrets_set.includes(f.key) || (drafts[f.key] ?? "").trim() !== "") : !filled(f.type, values[f.key])))
    .map((f) => f.label);
}

/** The ConnectorConfigure payload: typed values by field kind; only secrets the user typed or cleared. */
export function buildConfigure(c: Connector, values: FormValues, drafts: Record<string, string>, cleared: string[] = []): { config: Record<string, unknown>; secrets: Record<string, string> } {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  for (const f of c.manifest.setup) {
    if (f.type === "secret") {
      const typed = (drafts[f.key] ?? "").trim();
      if (typed) secrets[f.key] = typed;
      else if (cleared.includes(f.key)) secrets[f.key] = "";
      continue;
    }
    const v = values[f.key];
    switch (f.type) {
      case "number":
        if (filled("number", v)) config[f.key] = Number(v);
        break;
      case "bool":
        config[f.key] = !!v;
        break;
      case "pick":
      case "list":
        config[f.key] = asList(v).map((x) => x.trim()).filter(Boolean);
        break;
      default:
        config[f.key] = typeof v === "string" ? v.trim() : v;
    }
  }
  return { config, secrets };
}

/** A pick field loads its choices from the connector once the fields before it are saved. */
export const loadsOptions = (f: SetupField) => f.type === "pick" && !!f.from;

/** Splits "a, b\nc" into a list: free lists (subreddits, keywords) are typed in one box. */
export function parseList(text: string): string[] {
  return text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
}

/** Guide step text with its Markdown links turned into parts, so the app can open them itself. */
export type GuidePart = { text: string; href?: string };
export function guideParts(step: string): GuidePart[] {
  const out: GuidePart[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(step); m; m = re.exec(step)) {
    if (m.index > last) out.push({ text: step.slice(last, m.index) });
    out.push({ text: m[1]!, href: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < step.length) out.push({ text: step.slice(last) });
  return out.map((p) => ({ ...p, text: p.text.replace(/\*\*|`/g, "") }));
}

// ───────────────────────────── suggestions ─────────────────────────────

export interface PlaybookChange {
  label: string;
  before: string;
  after: string;
}

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/** What a suggested playbook changes, field by field, in words (before → after). Unchanged parts are left out. */
export function playbookChanges(before: Playbook, after: Playbook, connectorName: (id: string) => string = (id) => id): PlaybookChange[] {
  const out: PlaybookChange[] = [];
  const text = (label: string, a: string, b: string) => {
    if (a.trim() !== b.trim()) out.push({ label, before: a.trim() ? clip(a.trim()) : "Empty", after: b.trim() ? clip(b.trim()) : "Empty" });
  };
  text("What is this project", before.mission, after.mission);
  text("How to work", before.instructions, after.instructions);
  text("How to talk to people", before.tone, after.tone);
  const routine = (r: Routine) => `${scheduleLabel(r.schedule)} · ${r.task || "(no task)"}${r.enabled ? "" : " (off)"}`;
  const rb = before.routines.map(routine);
  const ra = after.routines.map(routine);
  if (rb.join("\n") !== ra.join("\n")) out.push({ label: "Routines", before: rb.join("\n") || "None", after: ra.join("\n") || "None" });
  const src = (s: SourceUse) => `${connectorName(s.connector_id)}${s.listen ? " (reacts to new events)" : ""}`;
  const sb = before.sources.map(src);
  const sa = after.sources.map(src);
  if (sb.join("\n") !== sa.join("\n")) out.push({ label: "Sources", before: sb.join("\n") || "None", after: sa.join("\n") || "None" });
  const rule = (r: ToolRule) => `${r.connector_id ? connectorName(r.connector_id) : "Pilot"}: ${toolLabel(r.tool)} → ${ALLOW_LABEL[r.allow]}`;
  const ub = before.rules.map(rule);
  const ua = after.rules.map(rule);
  if (ub.join("\n") !== ua.join("\n")) out.push({ label: "Permissions", before: ub.join("\n") || "Defaults", after: ua.join("\n") || "Defaults" });
  if (before.notify !== after.notify) out.push({ label: "Notifications", before: NOTIFY_LABEL[before.notify], after: NOTIFY_LABEL[after.notify] });
  return out;
}

export const NOTIFY_LABEL = { all: "Everything", needs_you: "Only when I am needed", never: "Never" } as const;

/** A playbook with nothing in it (a fresh pilot before its setup conversation is done). */
export const playbookEmpty = (p: Playbook) => !p.mission.trim() && !p.instructions.trim() && p.routines.length === 0 && p.sources.length === 0;

/** The newest suggestion of a pilot, if any. */
export function suggestionFor(list: PilotSuggestion[], pilotId: string): PilotSuggestion | undefined {
  return list.filter((s) => s.pilot_id === pilotId).sort((a, b) => b.created - a.created)[0];
}

/** Which workspaces have no pilot yet (the picker of the empty state and "+ Project"). */
export function workspacesWithoutPilot<W extends { id: string }>(workspaces: W[], pilots: Pilot[]): W[] {
  const has = new Set(pilots.map((p) => p.workspace_id));
  return workspaces.filter((w) => !has.has(w.id));
}

// ───────────────────────────── chat ─────────────────────────────

/** One pilot's conversation, oldest first. */
export function pilotMessages(all: PilotMessage[], pilotId: string): PilotMessage[] {
  return all.filter((m) => m.pilot_id === pilotId).sort((a, b) => a.at - b.at);
}
