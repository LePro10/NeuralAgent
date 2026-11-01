// Settings → Discord (D72): the privacy presets, the stats each part of the card can show, and how
// a change to one part turns a preset into "custom". The card itself is computed by the daemon
// (`discord_preview`, crates/na-daemon/src/discord.rs); `presetOptions` mirrors its `resolve`.
import type { DiscordOptions, DiscordPresence, DiscordStat, Settings } from "@neuralagent/protocol";

export const PRESETS: { value: DiscordPresence; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "Nothing is shown" },
  { value: "general", label: "General", detail: "Only that you work with AI agents" },
  { value: "stats", label: "Stats", detail: "Agents, tokens today and your streak. No names" },
  { value: "detailed", label: "Detailed", detail: "The project name, agents and model" },
  { value: "custom", label: "Custom", detail: "You pick every part below" },
];

/** What a line can show, with an example of how it reads on Discord. */
export const STATS: { value: DiscordStat; label: string; example: string }[] = [
  { value: "activity", label: "Activity", example: "Working with AI agents" },
  { value: "agents", label: "Agents", example: "3 agents · 2 working" },
  { value: "subagents", label: "Subagents", example: "4 subagents running" },
  { value: "project", label: "Project", example: "In website" },
  { value: "files", label: "Files changed", example: "7 files changed" },
  { value: "model", label: "Model", example: "Opus 5.5" },
  { value: "engine", label: "Agent CLIs", example: "Claude Code + Codex" },
  { value: "tokens_session", label: "Tokens this session", example: "184k tokens this session" },
  { value: "tokens_today", label: "Tokens today", example: "2.4M tokens today" },
  { value: "cost_today", label: "Cost today", example: "$12.40 at API prices today" },
  { value: "agent_time", label: "Agent time today", example: "3h 20m of agent work today" },
  { value: "streak", label: "Streak", example: "5-day streak" },
  { value: "none", label: "Nothing", example: "The line is left out" },
];

export const statLabel = (s: DiscordStat) => STATS.find((x) => x.value === s)?.label ?? s;

/** Defaults of `DiscordOptions` (Rust `impl Default`), for daemons that do not send them yet. */
export const DEFAULT_OPTIONS: DiscordOptions = {
  details: "agents",
  state: "tokens_today",
  hover: "model",
  party: false,
  timer: true,
  button: true,
  project_names: false,
};

const BASE = { party: false, timer: true, button: true, project_names: false } as const;

/** The options a preset stands for (mirrors `discord::resolve`); `null` for Off. */
export function presetOptions(level: DiscordPresence, custom: DiscordOptions = DEFAULT_OPTIONS): DiscordOptions | null {
  switch (level) {
    case "off":
      return null;
    case "general":
      return { ...BASE, details: "activity", state: "none", hover: "none" };
    case "detailed":
      return { ...BASE, details: "project", state: "agents", hover: "model", project_names: true };
    case "stats":
      return { ...BASE, details: "agents", state: "tokens_today", hover: "streak" };
    case "custom":
      return custom;
  }
}

/** The options the card uses now (custom ones, or the preset's). */
export function currentOptions(s: Pick<Settings, "discord_presence"> & { discord?: DiscordOptions }): DiscordOptions {
  return presetOptions(s.discord_presence === "off" ? "general" : s.discord_presence, s.discord ?? DEFAULT_OPTIONS) ?? DEFAULT_OPTIONS;
}

/**
 * Changing one part of the card: starts from what shows now and switches to Custom, so a preset
 * is never changed behind the user's back. Off stays off until a preset is picked.
 */
export function customize(s: Pick<Settings, "discord_presence"> & { discord?: DiscordOptions }, patch: Partial<DiscordOptions>): Pick<Settings, "discord_presence" | "discord"> {
  const next = { ...currentOptions(s), ...patch };
  return { discord_presence: "custom", discord: next };
}

/** The settings row: the preset's name. */
export const presenceLabel = (v: DiscordPresence | undefined) => PRESETS.find((p) => p.value === v)?.label;

/** Discord's elapsed timer: "04:12" or "1:02:09". */
export function elapsed(startSec: number, nowMs: number): string {
  const s = Math.max(0, Math.floor(nowMs / 1000 - startSec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "(2 of 5)" after the second line. */
export const partyText = (p: [number, number] | undefined) => (p ? `(${p[0]} of ${p[1]})` : "");
