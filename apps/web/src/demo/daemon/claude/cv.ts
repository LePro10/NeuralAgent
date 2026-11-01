// The Claude view of one session: a transcript the app renders as chat (messages, blocks), the
// meta strip (model, mode, context, cost), the pending prompt (permission, question, plan), the
// background tasks (subagents, shells) and the queue of prompts that wait for the turn to end.
// Streaming means upserting the same message id again, like the real daemon does.

import type { CvAttachResult, CvBlock, CvCommand, CvEvent, CvMessage, CvMeta, CvPrompt, CvRole, CvTask } from "@neuralagent/protocol";
import type { Sim } from "../sim.ts";

export const CLAUDE_MODEL = "claude-sonnet-5-5";
/** Messages kept in memory (older ones drop off the front). */
const KEEP = 400;
/** Messages a fresh `cv_attach` carries; the rest is served by `cv_history`. */
export const ATTACH = 48;
const PAGE = 24;

export const MODELS: Record<string, { id: string; name: string }> = {
  default: { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  sonnet: { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  "sonnet[1m]": { id: "claude-sonnet-5-5[1m]", name: "Sonnet 5.5 (1M context)" },
  opus: { id: "claude-opus-5-5", name: "Opus 5.5" },
  opusplan: { id: "claude-opus-5-5", name: "Opus 5.5 (plan mode), Sonnet 5.5 otherwise" },
  haiku: { id: "claude-haiku-5-5", name: "Haiku 5.5" },
};

export const COMMANDS: CvCommand[] = [
  { name: "compact", description: "Clear history but keep a summary in context", source: "builtin", group: "context", kind: "args", args: "[instructions]" } as CvCommand,
  { name: "context", description: "Show what fills the context window", source: "builtin" },
  { name: "cost", description: "Show the cost and duration of this session", source: "builtin" },
  { name: "clear", description: "Start a new conversation", source: "builtin" },
  { name: "model", description: "Set the AI model", source: "builtin", args: "[model]" },
  { name: "effort", description: "Set the effort level", source: "builtin", args: "[low|medium|high|xhigh|max]" },
  { name: "review", description: "Review the changes of this branch", source: "builtin", args: "[pr]" },
  { name: "init", description: "Create a CLAUDE.md for this project", source: "builtin" },
  { name: "rewind", description: "Go back to an earlier point", source: "builtin" },
  { name: "memory", description: "Edit memory files", source: "builtin" },
  { name: "plan", description: "Switch to plan mode", source: "builtin" },
  { name: "release-notes", description: "Write release notes from the commits since the last tag", source: "project" },
] as CvCommand[];

/** A subagent's own transcript (opened from its card). */
export interface SubTranscript {
  id: string;
  messages: CvMessage[];
}

export class CvSession {
  readonly sim: Sim;
  readonly sid: string;
  messages: CvMessage[] = [];
  meta: CvMeta;
  prompt: CvPrompt | null = null;
  tasks: CvTask[] = [];
  subs = new Map<string, SubTranscript>();
  /** Task id -> its output text (`cv_task_output`). */
  outputs = new Map<string, string>();
  private n = 0;
  /** Messages written before the first client attached are not broadcast one by one. */
  quiet = false;

  constructor(sim: Sim, sid: string, meta: CvMeta = {}) {
    this.sim = sim;
    this.sid = sid;
    this.meta = { model: CLAUDE_MODEL, mode: "default", effort: "high", version: "2.1.316", actions: true, busy: false, queued: [], todos: [], tasks_running: 0, ...meta };
  }

  private send(ev: CvEvent, agent?: string) {
    if (this.quiet) return;
    for (const c of this.sim.conns) c.sendCv(this.sid, ev, agent);
  }

  private nextId(role: CvRole): string {
    const raw = this.sim.id("cvm", 16);
    if (role === "assistant") return `msg_01${raw}`;
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(12, 15)}-a${raw.slice(13, 16)}-${this.sim.id("cvu", 12)}`;
  }

  /** Add a message and tell the clients. */
  push(role: CvRole, blocks: CvBlock[], extra: Partial<CvMessage> = {}): CvMessage {
    const m: CvMessage = { i: 200 + this.n++ * 331, id: this.nextId(role), role, ts: this.sim.now(), blocks, ...extra };
    this.messages.push(m);
    if (this.messages.length > KEEP) this.messages.splice(0, this.messages.length - KEEP);
    this.send({ k: "upsert", message: m });
    return m;
  }

  /** What the visitor typed: a user message the prompt can be rewound to. */
  user(text: string, extra: Partial<CvMessage> = {}): CvMessage {
    return this.push("user", [{ k: "text", text }], { checkpoint: true, ...extra });
  }

  /** A system row: a command's output, a notice, "Worked for 41s". */
  system(kind: string, blocks: CvBlock[]): CvMessage {
    return this.push("system", blocks, { kind });
  }

  /** Replace the blocks of a message already sent (streaming text, a tool result arriving). */
  update(m: CvMessage, blocks: CvBlock[]): CvMessage {
    const next: CvMessage = { ...m, blocks };
    const i = this.messages.findIndex((x) => x.id === m.id);
    if (i >= 0) this.messages[i] = next;
    this.send({ k: "upsert", message: next });
    return next;
  }

  setMeta(p: Partial<CvMeta>) {
    this.meta = { ...this.meta, ...p, actions: true };
    this.send({ k: "meta", meta: this.meta });
  }

  setPrompt(p: CvPrompt | null) {
    this.prompt = p;
    this.send({ k: "prompt", prompt: p });
  }

  setTasks(t: CvTask[]) {
    this.tasks = t;
    this.meta = { ...this.meta, tasks_running: t.filter((x) => x.status === "running").length, actions: true };
    this.send({ k: "tasks", tasks: t });
    this.send({ k: "meta", meta: this.meta });
  }

  /** Add or replace one task by id. */
  upsertTask(t: CvTask) {
    const i = this.tasks.findIndex((x) => x.id === t.id);
    this.setTasks(i >= 0 ? this.tasks.map((x, k) => (k === i ? t : x)) : [...this.tasks, t]);
  }

  // ── subagents ──────────────────────────────────────────────────────────────────────────────

  /** A subagent's transcript grows by one message (live to clients that opened it). */
  subPush(agent: string, role: CvRole, blocks: CvBlock[], extra: Partial<CvMessage> = {}): CvMessage {
    let t = this.subs.get(agent);
    if (!t) this.subs.set(agent, (t = { id: agent, messages: [] }));
    const m: CvMessage = { i: 100 + t.messages.length * 317, id: this.nextId(role), role, ts: this.sim.now(), blocks, ...extra };
    t.messages.push(m);
    this.send({ k: "upsert", message: m }, agent);
    return m;
  }

  subUpdate(agent: string, m: CvMessage, blocks: CvBlock[]): CvMessage {
    const t = this.subs.get(agent);
    const next: CvMessage = { ...m, blocks };
    if (t) t.messages = t.messages.map((x) => (x.id === m.id ? next : x));
    this.send({ k: "upsert", message: next }, agent);
    return next;
  }

  attachAgent(agent: string): CvAttachResult {
    return { messages: this.subs.get(agent)?.messages ?? [], more: false, meta: { model: "claude-haiku-5-5", busy: false } };
  }

  // ── reading ────────────────────────────────────────────────────────────────────────────────

  attach(): CvAttachResult {
    const msgs = this.messages.length > ATTACH ? this.messages.slice(-ATTACH) : this.messages;
    return { messages: msgs, more: this.messages.length > msgs.length, meta: this.meta, ...(this.prompt ? { prompt: this.prompt } : {}), tasks: this.tasks };
  }

  /** `cv_history`: the page of messages before the one with offset `before`. */
  history(before: number): { messages: CvMessage[]; more: boolean } {
    const older = this.messages.filter((m) => m.i < before);
    const page = older.slice(-PAGE);
    return { messages: page, more: older.length > page.length };
  }

  /** Everything again (after a world reset the client re-attaches; this also covers live replays). */
  reset() {
    const a = this.attach();
    this.send({ k: "reset", messages: a.messages, more: a.more, meta: this.meta });
  }

  /** Rewind: drop everything from the user message `id` on (the prompt returns to the composer in the real app). */
  rewind(id: string): boolean {
    const at = this.messages.findIndex((m) => m.id === id);
    if (at < 0) return false;
    this.messages = this.messages.slice(0, at);
    this.setPrompt(null);
    this.reset();
    return true;
  }

  /** `/clear`: an empty conversation. */
  clear() {
    this.messages = [];
    this.tasks = [];
    this.subs.clear();
    this.meta = { ...this.meta, context_tokens: 4_200, context_pct: 2, busy: false, activity: undefined, todos: [], queued: [], tasks_running: 0, actions: true };
    this.setPrompt(null);
    this.reset();
  }
}
