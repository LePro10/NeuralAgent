/** Claude Code's model aliases (what `/model <alias>` takes), effort levels and permission modes, with Claude's own wording. */
import { Ban, Code2, Hand, ScrollText, TriangleAlert, Zap, type LucideIcon } from "lucide-react";

export const MODELS: { alias: string; name: string; hint: string }[] = [
  { alias: "default", name: "Default", hint: "Recommended model for your plan" },
  { alias: "opus", name: "Opus", hint: "Most capable for ambitious work" },
  { alias: "sonnet", name: "Sonnet", hint: "Most efficient for everyday tasks" },
  { alias: "haiku", name: "Haiku", hint: "Fastest for quick answers" },
  { alias: "opusplan", name: "Opus plan", hint: "Opus plans, Sonnet builds" },
  { alias: "sonnet[1m]", name: "Sonnet 1M", hint: "Sonnet with a 1M-token context" },
];

/** claude-haiku-5-5 → "Haiku 5.5" */
export function modelName(id?: string | null): string {
  if (!id) return "Model";
  const m = /^claude-(?:(\d+)(?:-(\d+))?-)?([a-z]+)(?:-(\d+)(?:-(\d{1,2}))?)?/.exec(id);
  if (!m) return id;
  const fam = m[3]!.charAt(0).toUpperCase() + m[3]!.slice(1);
  const major = m[4] ?? m[1];
  const minor = m[4] ? m[5] : m[2];
  return major ? `${fam} ${major}${minor ? `.${minor}` : ""}` : fam;
}

/** The alias row that matches the running model (by family; "Default" and "Opus plan" cannot be told apart). */
export function modelAlias(id?: string | null): string | null {
  if (!id) return null;
  const fam = /opus|sonnet|haiku/.exec(id)?.[0];
  if (!fam) return null;
  return fam === "sonnet" && /\[1m\]/i.test(id) ? "sonnet[1m]" : fam;
}

/** Effort levels (what `/effort <level>` takes), lowest first. */
export const EFFORTS: { level: string; name: string; hint: string }[] = [
  { level: "low", name: "Low", hint: "Quick replies to simple questions" },
  { level: "medium", name: "Medium", hint: "Light, casual tasks" },
  { level: "high", name: "High", hint: "Balanced for everyday work" },
  { level: "xhigh", name: "Extra", hint: "Complex, detailed work" },
  { level: "max", name: "Max", hint: "The hardest problems. Takes longest." },
];

/** The level Claude Code uses when none is set (`/effort auto`). */
export const DEFAULT_EFFORT = "high";
export const EFFORT_NOTE = "Higher effort means more thorough responses, but takes longer and uses your limits faster.";

export const effortName = (level?: string | null) => EFFORTS.find((e) => e.level === (level || DEFAULT_EFFORT))?.name ?? "Effort";

export interface Mode {
  id: string;
  label: string;
  /** Short form for the composer. */
  short: string;
  hint: string;
  Icon: LucideIcon;
  warning?: boolean;
}

/** Permission modes in Claude's order and words. */
export const MODES: Mode[] = [
  { id: "default", label: "Manual", short: "Manual", hint: "Always ask before making changes", Icon: Hand },
  { id: "acceptEdits", label: "Accept edits", short: "Accept", hint: "Automatically accept all file edits", Icon: Code2 },
  { id: "plan", label: "Plan", short: "Plan", hint: "Create a plan before making changes", Icon: ScrollText },
  { id: "auto", label: "Auto", short: "Auto", hint: "Claude handles permission decisions", Icon: Zap },
  { id: "bypassPermissions", label: "Bypass permissions", short: "Bypass", hint: "Accepts all permissions", Icon: TriangleAlert, warning: true },
  { id: "dontAsk", label: "Don't ask", short: "Don't ask", hint: "Deny actions that aren't pre-approved, without prompting", Icon: Ban },
];

export const modeOf = (id?: string | null): Mode => MODES.find((m) => m.id === (id || "default")) ?? MODES[0]!;

/** Slash commands that open a menu in the terminal UI that the view cannot show. */
export const TERMINAL_COMMANDS = new Set(["config", "login", "logout", "resume", "mcp", "agents", "permissions", "hooks", "plugin", "theme", "terminal-setup", "ide", "install-github-app", "statusline", "output-style", "memory", "doctor", "rewind", "add-dir", "tasks", "status", "privacy-settings", "upgrade", "release-notes", "help", "export", "usage", "context", "cost"]);

/** Context window of a model id, for the usage ring. */
export const contextLimit = (model?: string | null) => (/\[1m\]|1m/i.test(model ?? "") ? 1_000_000 : 200_000);
