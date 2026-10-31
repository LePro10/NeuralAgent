/**
 * The command palette's catalogue: every Claude Code slash command (CLI 2.1.316, see
 * research A2 §1c) with a group, what tapping it does, an argument hint and aliases.
 * The daemon's `cv_commands` list is merged in: it adds custom commands, skills and plugins,
 * and, once it carries them, its own group/kind/args win over this table.
 * Pure (no React, no DOM) so it can be tested.
 */
import type { CvCommand } from "@neuralagent/protocol";

/**
 * What a tap does.
 * - `native`: the app has its own screen for it (model, effort, mode, context, rewind, tasks).
 * - `args`: typed straight in; an argument field opens first when it takes one.
 * - `run`: sent as is, the output shows in the conversation.
 * - `dialog`: opens a menu in the terminal UI (the live terminal opens with it).
 * - `prompt`: a prompt or skill for Claude (arguments optional).
 */
export type CommandKind = "native" | "args" | "run" | "dialog" | "prompt";

export interface Command {
  name: string;
  description: string;
  group: string;
  kind: CommandKind;
  /** Argument hint as the CLI shows it ("[instructions]", "<path>"). */
  args?: string;
  /** The argument is required (the hint is in angle brackets). */
  needsArgs?: boolean;
  /** Known values for the argument, shown as chips. */
  values?: string[];
  aliases?: string[];
  /** Hidden on phones unless searched (makes no sense there). */
  phone?: boolean;
  /** Ask before running (ends or clears the conversation). */
  confirm?: string;
  /** `builtin`, `user`, `project`, `skill`, `plugin`. */
  source: string;
  /** Without arguments it opens a terminal menu. */
  bareDialog?: boolean;
  /** `kind = native`: which app screen handles it (`model`, `effort`, `context`, `tasks`…). */
  native?: string;
}

/** Section order of the palette. */
export const GROUPS = [
  "Conversation",
  "Model and modes",
  "Context and cost",
  "Agents and tasks",
  "Code and review",
  "Project setup",
  "Extensions",
  "Account and app",
  "Your commands",
  "Skills",
  "Plugins",
] as const;

type Row = [name: string, kind: CommandKind, description: string, extra?: Partial<Command>];

const G = (group: string, rows: Row[]): Command[] =>
  rows.map(([name, kind, description, extra]) => ({
    name,
    kind,
    description,
    group,
    source: "builtin",
    ...extra,
    needsArgs: extra?.needsArgs ?? (extra?.args ? extra.args.startsWith("<") : undefined),
  }));

/** Claude Code 2.1.316 built-ins and bundled skills. */
export const CATALOGUE: Command[] = [
  ...G("Conversation", [
    ["clear", "args", "Start over with an empty context", { args: "[name]", aliases: ["reset", "new"], confirm: "Start a new conversation? Claude forgets this one (it stays in History)." }],
    ["compact", "args", "Summarize the conversation to free up context", { args: "[instructions]" }],
    ["rewind", "native", "Go back to an earlier message (code, conversation or both)", { aliases: ["checkpoint", "undo"] }],
    ["branch", "args", "Branch the conversation into a new session", { args: "[name]" }],
    ["fork", "args", "Fork into a parallel conversation", { args: "[prompt]" }],
    ["resume", "dialog", "Resume an earlier conversation", { args: "[session]", aliases: ["continue"] }],
    ["rename", "args", "Rename this conversation", { args: "<name>" }],
    ["export", "args", "Save the conversation to a file", { args: "[file]", bareDialog: true }],
    ["copy", "run", "Copy Claude's last reply", { args: "[N]" }],
    ["recap", "prompt", "A short recap of the session so far"],
    ["btw", "args", "Ask a side question that stays out of the conversation", { args: "<question>" }],
    ["exit", "run", "End this Claude Code session", { aliases: ["quit"], confirm: "End this Claude session?" }],
  ]),
  ...G("Model and modes", [
    ["model", "native", "Choose the model", { args: "[model]", values: ["default", "opus", "sonnet", "haiku", "opusplan"] }],
    ["effort", "native", "How hard Claude thinks", { args: "[level]", values: ["low", "medium", "high", "xhigh", "max", "auto"] }],
    ["fast", "native", "Fast mode: quicker output on the same model", { args: "[on|off]", values: ["on", "off"] }],
    ["plan", "args", "Switch to plan mode, optionally with a task", { args: "[description]" }],
    ["advisor", "args", "A second model that reviews Claude's work", { args: "[model|off]", values: ["opus", "sonnet", "off"] }],
    ["output-style", "args", "How Claude writes its replies", { args: "[style]", values: ["default", "explanatory", "learning"], bareDialog: true }],
    ["focus", "run", "Toggle focus mode"],
    ["brief", "run", "Toggle brief replies"],
    ["goal", "args", "A goal Claude keeps working toward until it is met", { args: "[condition|clear]", values: ["clear"] }],
    ["autocompact", "args", "When the conversation compacts itself", { args: "[auto|tokens]", values: ["auto"] }],
  ]),
  ...G("Context and cost", [
    ["context", "native", "What fills the context window", { args: "[all]" }],
    ["usage", "native", "Cost, time and plan limits", { aliases: ["cost", "stats"] }],
    ["status", "dialog", "Version, model, account and connection"],
    ["skill-doctor", "prompt", "Check your skills for problems"],
    ["insights", "prompt", "A report on your recent sessions"],
  ]),
  ...G("Agents and tasks", [
    ["tasks", "native", "Background agents, shells and monitors", { aliases: ["bashes"] }],
    ["subtask", "args", "Hand a task to a subagent", { args: "<task>" }],
    ["background", "args", "Keep this work going in the background", { args: "[prompt]" }],
    ["stop", "run", "Stop background work"],
    ["list-agents", "run", "List the running agents"],
    ["workflows", "dialog", "Saved multi-step workflows"],
    ["loop", "prompt", "Run a prompt again and again on an interval", { args: "[interval] <prompt>" }],
    ["loops", "dialog", "Running loops"],
    ["schedule", "args", "Run a prompt later or on a schedule", { args: "<when> <prompt>" }],
    ["batch", "prompt", "Run one task over many items", { args: "<task>" }],
  ]),
  ...G("Code and review", [
    ["diff", "dialog", "Uncommitted changes, file by file"],
    ["code-review", "prompt", "Review the current changes for bugs", { args: "[level] [target]", values: ["low", "medium", "high", "xhigh", "max"], aliases: ["review"] }],
    ["security-review", "prompt", "Security review of the pending changes"],
    ["simplify", "prompt", "Clean up and simplify the changed code"],
    ["verify", "prompt", "Check that the change really works"],
    ["run", "prompt", "Start the app and look at the change"],
    ["debug", "prompt", "Track down a bug step by step", { args: "[problem]" }],
    ["ultrareview", "prompt", "Deep multi-agent review in the cloud"],
    ["autofix-pr", "args", "Fix the review comments on a pull request", { args: "[PR]" }],
  ]),
  ...G("Project setup", [
    ["init", "prompt", "Write a CLAUDE.md that describes this project"],
    ["memory", "dialog", "Edit Claude's memory files (CLAUDE.md)"],
    ["add-dir", "args", "Let Claude work in another folder too", { args: "<path>" }],
    ["cd", "args", "Move the session to another folder", { args: "<path>" }],
    ["permissions", "dialog", "Allow and deny rules for tools", { aliases: ["allowed-tools"] }],
    ["hooks", "dialog", "Commands that run on Claude's events"],
    ["sandbox", "dialog", "Sandbox for shell commands"],
    ["doctor", "dialog", "Check the Claude Code installation"],
    ["fewer-permission-prompts", "prompt", "Allow the safe commands you keep approving"],
    ["update-config", "prompt", "Change settings.json by describing it", { args: "[change]" }],
    ["run-skill-generator", "prompt", "Turn what you just did into a skill"],
    ["statusline", "args", "Set up the status line", { args: "[description]" }],
    ["keybindings", "dialog", "Keyboard shortcuts", { phone: false }],
    ["terminal-setup", "dialog", "Shift+Enter for newlines in your terminal", { phone: false }],
  ]),
  ...G("Extensions", [
    ["skills", "dialog", "Installed skills"],
    ["reload-skills", "run", "Load new or changed skills"],
    ["plugin", "dialog", "Install and manage plugins", { args: "[command]", aliases: ["plugins"] }],
    ["reload-plugins", "run", "Load new or changed plugins"],
    ["mcp", "dialog", "MCP servers: status, reconnect, enable", { args: "[reconnect|enable|disable] [server]", values: ["reconnect", "enable", "disable"] }],
    ["agents", "prompt", "Ask Claude to create or manage subagents"],
    ["ide", "dialog", "Connect to an IDE", { phone: false }],
    ["chrome", "dialog", "Claude in Chrome"],
    ["claude-api", "prompt", "Help with the Claude API and SDKs"],
    ["artifacts", "dialog", "Your published artifacts"],
  ]),
  ...G("Account and app", [
    ["config", "dialog", "Claude Code settings", { aliases: ["settings"] }],
    ["login", "dialog", "Sign in or switch accounts"],
    ["logout", "run", "Sign out", { confirm: "Sign Claude Code out on the computer?" }],
    ["release-notes", "dialog", "What is new in Claude Code"],
    ["version", "run", "Show the Claude Code version"],
    ["upgrade", "dialog", "Upgrade your plan"],
    ["usage-credits", "dialog", "Extra usage credits"],
    ["rate-limit-options", "dialog", "What to do when you hit a limit"],
    ["privacy-settings", "dialog", "Privacy settings"],
    ["feedback", "args", "Send feedback or report a bug", { args: "[report]", aliases: ["bug"] }],
    ["restart", "run", "Restart Claude Code and keep the conversation"],
    ["remote-control", "dialog", "Control this session from claude.ai"],
    ["mobile", "dialog", "Get the Claude app on your phone"],
    ["desktop", "dialog", "Continue in Claude Desktop"],
    ["teleport", "dialog", "Bring a cloud session here"],
    ["remote-env", "dialog", "Cloud environment settings"],
    ["web-setup", "dialog", "Set up Claude Code on the web"],
    ["install-github-app", "dialog", "Claude on your GitHub pull requests"],
    ["install-slack-app", "dialog", "Claude in Slack"],
    ["setup-bedrock", "dialog", "Use Claude through Amazon Bedrock"],
    ["setup-vertex", "dialog", "Use Claude through Google Vertex AI"],
    ["passes", "dialog", "Guest passes for friends"],
    ["powerup", "dialog", "Tips and tricks"],
    ["help", "dialog", "Help and shortcuts"],
    ["color", "args", "Prompt bar colour", { args: "[color]", phone: false }],
    ["theme", "dialog", "Terminal colour theme", { phone: false }],
    ["tui", "dialog", "Terminal display mode", { phone: false }],
    ["voice", "dialog", "Voice input in the terminal", { phone: false }],
    ["stickers", "dialog", "Order Claude Code stickers", { phone: false }],
    ["radio", "dialog", "Music while Claude works", { phone: false }],
    ["heapdump", "run", "Write a memory snapshot (debugging)", { phone: false }],
  ]),
];

const BY_NAME = new Map(CATALOGUE.flatMap((c) => [[c.name, c] as const, ...(c.aliases ?? []).map((a) => [a, c] as const)]));

export const catalogued = (name: string): Command | undefined => BY_NAME.get(name);

type DaemonCommand = CvCommand & { args?: string | null };

const KINDS = new Set<CommandKind>(["native", "args", "run", "dialog", "prompt"]);

/** The daemon's group ids (`CvCommand.group`) → palette sections. */
const GROUP_IDS: Record<string, string> = {
  conversation: "Conversation",
  model: "Model and modes",
  context: "Context and cost",
  agents: "Agents and tasks",
  code: "Code and review",
  project: "Project setup",
  extensions: "Extensions",
  account: "Account and app",
  custom: "Your commands",
  skills: "Skills",
  plugins: "Plugins",
};
const groupName = (g?: string) => (g ? (GROUP_IDS[g] ?? g) : undefined);
/** `output` prints into the conversation: for the palette it just runs. */
const kindOf = (k?: string): CommandKind | undefined => (k === "output" ? "run" : k && KINDS.has(k as CommandKind) ? (k as CommandKind) : undefined);

function groupOfSource(source: string): string {
  if (source === "skill") return "Skills";
  if (source === "plugin" || source.startsWith("plugin")) return "Plugins";
  if (source === "user" || source === "project") return "Your commands";
  return "Account and app";
}

/** The daemon's list (built-ins, custom commands, skills, plugins) over the catalogue. */
export function mergeCommands(fromDaemon: CvCommand[]): Command[] {
  const out = new Map<string, Command>();
  for (const c of CATALOGUE) out.set(c.name, c);
  for (const raw of fromDaemon as DaemonCommand[]) {
    const known = out.get(raw.name) ?? BY_NAME.get(raw.name);
    const kind = kindOf(raw.kind);
    const group = groupName(raw.group);
    if (known && raw.source === "builtin") {
      out.set(known.name, {
        ...known,
        description: known.description || raw.description,
        group: group || known.group,
        kind: kind ?? known.kind,
        args: raw.args ?? known.args,
        values: raw.values?.length ? raw.values : known.values,
        aliases: raw.aliases?.length ? raw.aliases : known.aliases,
        phone: raw.phone ?? known.phone,
        native: raw.native ?? known.native,
      });
      continue;
    }
    // A custom command or skill with a built-in's name shadows it in the CLI too.
    const args = raw.args ?? undefined;
    out.set(raw.name, {
      name: raw.name,
      description: raw.description,
      source: raw.source,
      group: group && raw.source === "builtin" ? group : groupOfSource(raw.source),
      kind: kind ?? (raw.source === "builtin" ? "run" : "prompt"),
      args,
      needsArgs: args ? args.startsWith("<") : undefined,
      values: raw.values,
      aliases: raw.aliases,
      phone: raw.phone,
      native: raw.native,
    });
  }
  return [...out.values()];
}

/** Lower is better; null = no match. */
export function scoreCommand(c: Command, query: string): number | null {
  const q = query.trim().replace(/^\//, "").toLowerCase();
  if (!q) return 0;
  const name = c.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (c.aliases?.some((a) => a.toLowerCase().startsWith(q))) return 2;
  // "rev" finds "code-review", "pr" finds "autofix-pr".
  if (name.split(/[-:_]/).some((part) => part.startsWith(q))) return 3;
  if (name.includes(q)) return 4;
  const words = q.split(/\s+/);
  const hay = `${c.description} ${c.group}`.toLowerCase();
  if (words.every((w) => hay.includes(w))) return 6;
  return null;
}

/** For the `/` list under the composer: best matches first, phone-hidden ones only when typed. */
export function searchCommands(all: Command[], query: string, phone: boolean, limit = 40): Command[] {
  const scored: [Command, number][] = [];
  for (const c of all) {
    const s = scoreCommand(c, query);
    if (s === null) continue;
    if (phone && c.phone === false && s > 1) continue;
    scored.push([c, s]);
  }
  scored.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name));
  return scored.slice(0, limit).map(([c]) => c);
}

export interface Section {
  title: string;
  items: Command[];
}

/** Palette sections: with a query one ranked list; without, Recent, then the groups in order, then More. */
export function paletteSections(all: Command[], query: string, recent: string[], phone: boolean): Section[] {
  if (query.trim()) {
    const items = searchCommands(all, query, false, 80);
    return items.length ? [{ title: "Results", items }] : [];
  }
  const byName = new Map(all.map((c) => [c.name, c]));
  const out: Section[] = [];
  const rec = recent.map((n) => byName.get(n)).filter((c): c is Command => !!c).slice(0, 6);
  if (rec.length) out.push({ title: "Recent", items: rec });
  const more: Command[] = [];
  const groups = new Map<string, Command[]>();
  for (const c of all) {
    if (phone && c.phone === false) {
      more.push(c);
      continue;
    }
    const list = groups.get(c.group) ?? [];
    list.push(c);
    groups.set(c.group, list);
  }
  const order = [...GROUPS, ...[...groups.keys()].filter((g) => !(GROUPS as readonly string[]).includes(g))];
  for (const g of order) {
    const items = groups.get(g);
    if (!items?.length) continue;
    // Built-ins keep the catalogue's order (most used first); custom ones go A to Z.
    if (!items.every((c) => c.source === "builtin")) items.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ title: g, items });
  }
  if (more.length) out.push({ title: "More", items: more });
  return out;
}

/** The text that goes into the CLI. */
export function commandLine(c: Command, args: string): string {
  const a = args.trim();
  return a ? `/${c.name} ${a}` : `/${c.name}`;
}

/** Does sending this line open a terminal menu? (`/mcp`, `/config`, `/export` without a file…) */
export function opensDialog(line: string, all?: Command[]): boolean {
  const m = /^\/([\w:.-]+)(?:\s+(.*))?$/s.exec(line.trim());
  if (!m) return false;
  const name = m[1]!;
  const c = (all && all.find((x) => x.name === name || x.aliases?.includes(name))) ?? BY_NAME.get(name);
  if (!c) return false;
  const hasArgs = !!m[2]?.trim();
  if (c.kind === "dialog") return !(hasArgs && c.values?.length);
  if (c.bareDialog) return !hasArgs;
  return false;
}

// ── recents (per device) ──
const RECENT_KEY = "na.cv.recentCommands";

export function pushRecent(list: string[], name: string, max = 8): string[] {
  return [name, ...list.filter((n) => n !== name)].slice(0, max);
}

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecent(name: string): string[] {
  const next = pushRecent(loadRecent(), name);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode: no recents */
  }
  return next;
}
