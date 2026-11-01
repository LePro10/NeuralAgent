// How each agent CLI looks in the terminal: bullets, result gutters, diffs, permission boxes, the
// welcome screen and the input box. One renderer reads a style table, so adding a CLI is a table row.

import { BOLD, COLOR, DIM, RESET, bgRgb, box, dim, fg, paint, width, wrap } from "../ansi.ts";
import { hunks } from "../diff.ts";

export type EngineId = "claude" | "codex" | "opencode" | "gemini" | string;

export interface Style {
  id: EngineId;
  name: string;
  /** The glyph before an assistant sentence. */
  say: string;
  sayColor: string;
  /** Tool call header: glyph + verbs. */
  tool: string;
  toolColor: string;
  verbs: { read: string; edit: string; write: string; run: string; search: string; todo: string };
  /** Gutter in front of a result line. */
  gutter: string;
  think: string;
  prompt: string;
  addBg: string;
  delBg: string;
  working: string[];
}

/** Calm tints for added and removed lines (the 256-colour 22 and 52 are saturated blocks next to the muted panes). */
const ADD_BG = bgRgb(22, 46, 34);
const DEL_BG = bgRgb(54, 28, 32);

const CLAUDE: Style = {
  id: "claude", name: "Claude Code", say: "●", sayColor: fg(252), tool: "●", toolColor: COLOR.green,
  verbs: { read: "Read", edit: "Update", write: "Write", run: "Bash", search: "Search", todo: "Update Todos" },
  gutter: "  ⎿  ", think: "✻", prompt: ">", addBg: ADD_BG, delBg: DEL_BG, working: ["Pondering", "Reading", "Thinking", "Cooking", "Tinkering"],
};
const CODEX: Style = {
  id: "codex", name: "Codex", say: "•", sayColor: fg(252), tool: "•", toolColor: COLOR.cyan,
  verbs: { read: "Explored", edit: "Edited", write: "Added", run: "Ran", search: "Searched", todo: "Plan" },
  gutter: "  └ ", think: "•", prompt: "›", addBg: ADD_BG, delBg: DEL_BG, working: ["Working"],
};
const OPENCODE: Style = {
  id: "opencode", name: "OpenCode", say: "┃", sayColor: COLOR.blue, tool: "→", toolColor: COLOR.magenta,
  verbs: { read: "Read", edit: "Edit", write: "Write", run: "Shell", search: "Grep", todo: "Todos" },
  gutter: "    ", think: "▣", prompt: "┃", addBg: ADD_BG, delBg: DEL_BG, working: ["Thinking"],
};
const GEMINI: Style = {
  id: "gemini", name: "Gemini CLI", say: "✦", sayColor: COLOR.magenta, tool: "✓", toolColor: COLOR.green,
  verbs: { read: "ReadFile", edit: "Edit", write: "WriteFile", run: "Shell", search: "SearchText", todo: "Plan" },
  gutter: "  │ ", think: "✦", prompt: ">", addBg: ADD_BG, delBg: DEL_BG, working: ["Thinking"],
};

export const styleOf = (engine: string): Style => (engine === "codex" ? CODEX : engine === "opencode" ? OPENCODE : engine === "gemini" ? GEMINI : CLAUDE);

export const num = (n: number, w = 4) => String(n).padStart(w);

/**
 * The sentence as the terminal types it: the glyph, then the words three at a time, wrapping at `cols`.
 * The same text the typing effect of the runner leaves on screen, so a later attach at another width sees it laid out for that width.
 */
export function sayText(st: Style, text: string, cols: number): string {
  const w = Math.max(30, Math.min(cols - 4, 96));
  const words = text.split(" ");
  let out = `${st.sayColor}${st.say}${RESET} `;
  let col = 0;
  for (let i = 0; i < words.length; i += 3) {
    const chunk = words.slice(i, i + 3).join(" ");
    if (col + chunk.length > w) {
      out += "\r\n  ";
      col = 0;
    }
    out += chunk + (i + 3 < words.length ? " " : "");
    col += chunk.length + 1;
  }
  return out;
}

/** The sentence block: glyph, then the text wrapped under it. */
export function sayLines(st: Style, text: string, cols: number): string[] {
  const w = Math.max(30, Math.min(cols - 4, 96));
  return wrap(text, w).map((l, i) => (i === 0 ? `${st.sayColor}${st.say}${RESET} ${l}` : `  ${l}`));
}

export function toolHeader(st: Style, verb: string, arg: string): string {
  if (st.id === "codex") return `${st.toolColor}${st.tool}${RESET} ${BOLD}${verb}${RESET} ${arg}`;
  if (st.id === "opencode") return `${st.toolColor}${st.tool}${RESET} ${dim(verb)} ${arg}`;
  if (st.id === "gemini") return `${st.toolColor}${st.tool}${RESET} ${BOLD}${verb}${RESET} ${dim(arg)}`;
  return `${st.toolColor}${st.tool}${RESET} ${BOLD}${verb}${RESET}${dim("(")}${arg}${dim(")")}`;
}

export function resultLines(st: Style, lines: string[], max = 5): string[] {
  const shown = lines.slice(0, max);
  const out = shown.map((l, i) => (i === 0 ? dim(st.gutter) : " ".repeat(st.gutter.length)) + l);
  if (lines.length > max) out.push(" ".repeat(st.gutter.length) + dim(`… +${lines.length - max} lines (ctrl+r to expand)`));
  return out;
}

/** An edit as a diff with line numbers and coloured +/- lines. */
export function diffLines(st: Style, oldText: string, newText: string, indent = 6, cols = Infinity): string[] {
  const out: string[] = [];
  // A line longer than the pane would wrap into the diff's gutter: cut it instead.
  const room = Math.max(12, cols - indent - 7);
  const clip = (t: string) => (t.length > room ? `${t.slice(0, room - 1)}…` : t);
  for (const h of hunks(oldText, newText, 2)) {
    let o = h.oldStart;
    let n = h.newStart;
    for (const l of h.lines) {
      const pad = " ".repeat(indent);
      if (l.t === "+") out.push(`${pad}${dim(num(n++))} ${st.addBg}${COLOR.green}+ ${clip(l.text)}${RESET}`);
      else if (l.t === "-") out.push(`${pad}${dim(num(o++))} ${st.delBg}${COLOR.red}- ${clip(l.text)}${RESET}`);
      else {
        out.push(`${pad}${dim(num(n))}   ${dim(clip(l.text))}`);
        o++;
        n++;
      }
    }
  }
  return out;
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The first screen of a CLI: a welcome box and the input box below it. */
export function banner(st: Style, cwd: string, cols: number, model: string): string[] {
  const inner = Math.max(40, Math.min(cols - 6, 64));
  if (st.id === "claude")
    return [
      ...box([`${COLOR.orange}✻${RESET} ${BOLD}Welcome to Claude Code${RESET}`, "", dim("  /help for help, /status for your current setup"), "", dim(`  cwd: ${cwd}`)], inner, { color: COLOR.orange }),
      "",
    ];
  if (st.id === "codex")
    return [
      ...box([`${BOLD}>_ OpenAI Codex${RESET} ${dim("(v0.166.0)")}`, "", `${dim("model:")}     ${model}`, `${dim("directory:")} ${cwd}`], inner, { color: COLOR.grey }),
      "",
    ];
  if (st.id === "opencode") return [`${BOLD}opencode${RESET} ${dim("2.2.3")}`, dim(cwd), ""];
  if (st.id === "gemini") return [`${COLOR.blue}${BOLD}  ▄▄▄▄ Gemini CLI${RESET}`, dim(`  Tips: ask questions, edit files, or run commands.   ${cwd}`), ""];
  return [`${BOLD}${st.name}${RESET}`, dim(cwd), ""];
}

/** The permission question as a box; returns the lines (so the caller can erase exactly that many). */
export function askBox(st: Style, o: { title: string; body: string[]; question: string; options: string[]; selected: number }, cols: number): string[] {
  const inner = Math.max(36, Math.min(cols - 6, 76));
  const opts = o.options.map((t, i) => {
    const on = i === o.selected;
    return `${on ? COLOR.cyan + "❯ " : "  "}${i + 1}. ${t}${RESET}`;
  });
  if (st.id === "codex")
    return [
      "",
      `  ${BOLD}${o.question}${RESET}`,
      ...o.body.map((l) => `  ${l}`),
      "",
      ...o.options.map((t, i) => `${i === o.selected ? COLOR.cyan + "› " : "  "}${i + 1}. ${t}${RESET}`),
      "",
    ];
  const lines = [`${BOLD}${o.title}${RESET}`, "", ...o.body.map((l) => "  " + l), "", `${o.question}`, ...opts];
  return box(lines, inner, { color: COLOR.yellow });
}

/** The input box that sits under the finished run. */
export function inputBox(st: Style, cols: number, typed = ""): string[] {
  const inner = Math.max(30, Math.min(cols - 6, 76));
  if (st.id === "claude") return [...box([`${st.prompt} ${typed}`], inner, { color: COLOR.grey }), dim("  ? for shortcuts")];
  if (st.id === "codex") return [`${COLOR.cyan}${st.prompt}${RESET} ${typed || dim("Ask Codex to do anything")}`, dim("  ⏎ send   ⌃C quit")];
  if (st.id === "opencode") return [`${COLOR.blue}┃${RESET} ${typed || dim("Ask anything...")}`, dim("  tab agents   ctrl+p commands")];
  return box([`${st.prompt} ${typed || dim("Type your message or @path/to/file")}`], inner, { color: COLOR.blue });
}

export const statusLine = (st: Style, frame: string, label: string, secs: number) => {
  if (st.id === "claude") return `${COLOR.orange}${frame}${RESET} ${COLOR.orange}${label}…${RESET} ${dim(`(${secs}s · esc to interrupt)`)}`;
  if (st.id === "codex") return `${dim(frame)} ${BOLD}${label}${RESET} ${dim(`(${secs}s • esc to interrupt)`)}`;
  return `${COLOR.blue}${frame}${RESET} ${dim(`${label}… ${secs}s`)}`;
};

export { DIM, width, paint };
