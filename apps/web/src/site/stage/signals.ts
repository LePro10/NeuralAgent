// World signals turned into short readout lines for the active chapter ("● Claude Code in billing-api needs you").
// The lines are the proof that the two frames share one computer: an answer on the phone shows up here and on the desk.
// A line names the AGENT (engine and project), never the prompt it works on; a newer line of the same agent replaces the
// older one, so a question and its answer never sit side by side.
import type { DemoSignal } from "../../demo/api";
import { AGENTS } from "../content";
import type { ActivityKind } from "../ui";

export interface Line {
  key: number;
  kind: ActivityKind;
  text: string;
  /** The agent a line belongs to: a newer line of the same agent replaces it. */
  agent?: string;
}

const plain = (s: string) => s.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim();
/** Shorten at a word boundary, never mid-word. */
export const clip = (s: string, n = 56) => {
  const t = plain(s);
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > n * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
};

/** The activity vocabulary for a session status of the world ("working", "needs you", "done" ...). */
export const statusKind = (status: string): ActivityKind => {
  const s = status.toLowerCase();
  if (/work|run|think|busy/.test(s)) return "working";
  if (/wait|need|ask|prompt/.test(s)) return "waiting";
  if (/idle/.test(s)) return "idle";
  if (/done|finish|complete|ready/.test(s)) return "done";
  if (/err|fail/.test(s)) return "error";
  return "idle";
};

const who = (by: string) => (by === "phone" ? "your phone" : by === "desk" ? "the desktop" : "the script");

/** "Claude Code in billing-api" for a session id, or null when the id is not one of the world's named agents. */
export type Label = (agent: string) => string | null;

/**
 * Names the world's agents from its handles (`agent.claude-billing` -> "Claude Code in billing-api"). The handles are
 * stable per seed, so this is built once per world.
 */
export function agentLabels(handles: Readonly<Record<string, string>>): Label {
  const projects = Object.keys(handles).filter((k) => k.startsWith("project.")).map((k) => k.slice(8));
  const map = new Map<string, string>();
  for (const [key, id] of Object.entries(handles)) {
    if (!key.startsWith("agent.")) continue;
    const [engine = "", short = ""] = key.slice(6).split("-");
    const name = engine === "shell" ? "Terminal" : (AGENTS.find((a) => a.id === engine)?.name ?? engine);
    const project = projects.find((p) => p.split("-").includes(short)) ?? short;
    map.set(id, `${name} in ${project}`);
  }
  return (agent) => map.get(agent) ?? null;
}

/** One readout line for a signal, or null when it is not worth showing (scripted answers, chatter). */
export function describe(s: DemoSignal, label: Label = () => null): Omit<Line, "key"> | null {
  switch (s.type) {
    case "prompt-opened": {
      return { kind: "waiting", agent: s.agent, text: `${label(s.agent) ?? "An agent"} needs you` };
    }
    case "prompt-answered":
      if (s.by === "world") return null;
      return { kind: "done", agent: s.agent, text: `${s.allow ? "Allowed" : "Denied"} on ${who(s.by)}${s.allow ? ". The agent carries on" : ""}` };
    case "neural-message":
      return s.role === "user" ? { kind: "idle", text: `You: ${clip(s.text, 46)}` } : { kind: "working", text: `Neural: ${clip(s.text, 46)}` };
    case "agent-started":
      return { kind: "working", agent: s.agent, text: `Started: ${clip(s.name, 40)}` };
    default:
      return null;
  }
}

/**
 * Which signal types each chapter shows. Chapter 1 shows none (a line about a waiting agent would give away chapter 2),
 * and the files chapter has no signal worth a line: it is about the window itself. Status changes of an agent are not
 * shown on purpose: "finished" would replace "Allowed on your phone", which is the line that proves the two frames share a world.
 */
export const WATCH: Record<string, DemoSignal["type"][]> = {
  grid: [],
  permission: ["prompt-opened", "prompt-answered"],
  phone: ["prompt-opened", "prompt-answered"],
  neural: ["neural-message", "agent-started"],
  files: [],
};
