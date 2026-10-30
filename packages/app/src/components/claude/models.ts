/** Claude Code's model aliases (what `/model <alias>` takes) and friendly names for model ids. */
export const MODELS: { alias: string; name: string; hint: string }[] = [
  { alias: "default", name: "Default", hint: "Recommended for your plan" },
  { alias: "opus", name: "Opus", hint: "Most capable, for complex work" },
  { alias: "sonnet", name: "Sonnet", hint: "Best for everyday tasks" },
  { alias: "haiku", name: "Haiku", hint: "Fastest, for quick answers" },
  { alias: "opusplan", name: "Opus plan", hint: "Opus to plan, Sonnet to build" },
  { alias: "sonnet[1m]", name: "Sonnet 1M", hint: "Sonnet with a 1M token context" },
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

export const MODES: Record<string, { label: string; hint: string }> = {
  default: { label: "Ask", hint: "Asks before editing files or running commands" },
  acceptEdits: { label: "Auto-accept edits", hint: "Edits files without asking" },
  plan: { label: "Plan mode", hint: "Plans first, changes nothing until you approve" },
  bypassPermissions: { label: "Bypass permissions", hint: "Runs everything without asking" },
  auto: { label: "Auto mode", hint: "A classifier approves safe actions" },
};

/** Slash commands that open a menu in the terminal UI that the view cannot show. */
export const TERMINAL_COMMANDS = new Set(["config", "login", "logout", "resume", "mcp", "agents", "permissions", "hooks", "plugin", "theme", "terminal-setup", "ide", "install-github-app", "statusline", "output-style", "memory", "doctor", "rewind", "add-dir", "tasks", "status", "privacy-settings", "upgrade", "release-notes", "help", "export", "usage", "context", "cost"]);
