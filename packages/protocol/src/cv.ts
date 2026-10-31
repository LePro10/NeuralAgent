import type { CvAttachResult, CvEvent, CvMessage, CvMeta, CvPrompt, CvTask } from "./gen/index.ts";

/** A client's copy of a Claude session's conversation (or of one subagent's, see `attachCv`). */
export interface Conversation {
  messages: CvMessage[];
  /** Older messages exist (`cv_history`). */
  more: boolean;
  meta: CvMeta;
  prompt: CvPrompt | null;
  /** Background work: subagents, background shells, monitors (main conversation only). */
  tasks: CvTask[];
  /** The first attach answer has arrived. */
  ready: boolean;
}

export const emptyConversation = (): Conversation => ({ messages: [], more: false, meta: {}, prompt: null, tasks: [], ready: false });

export function fromAttach(r: CvAttachResult): Conversation {
  return { messages: r.messages, more: r.more, meta: r.meta, prompt: r.prompt ?? null, tasks: r.tasks ?? [], ready: true };
}

/** Older messages go in front (those already present win). */
export function prepend(c: Conversation, older: CvMessage[], more: boolean): Conversation {
  const have = new Set(c.messages.map((m) => m.id));
  const add = older.filter((m) => !have.has(m.id));
  return { ...c, messages: [...add, ...c.messages], more };
}

/** Applies a live event, immutably. Unknown event kinds (a newer daemon) are ignored. */
export function applyCv(c: Conversation, ev: CvEvent): Conversation {
  switch (ev.k) {
    case "reset":
      return { ...c, messages: ev.messages, more: ev.more, meta: ev.meta, ready: true };
    case "meta":
      return { ...c, meta: ev.meta };
    case "prompt":
      return { ...c, prompt: ev.prompt ?? null };
    case "tasks":
      return { ...c, tasks: ev.tasks };
    case "upsert": {
      const m = ev.message;
      const i = c.messages.findIndex((x) => x.id === m.id);
      if (i >= 0) return { ...c, messages: c.messages.map((x, j) => (j === i ? m : x)) };
      return { ...c, messages: [...c.messages, m] };
    }
    default:
      return c;
  }
}

/** Running tasks first (newest first), then finished ones (newest first). */
export function sortTasks(tasks: CvTask[]): CvTask[] {
  const live = (t: CvTask) => (t.status === "running" ? 0 : 1);
  return [...tasks].sort((a, b) => live(a) - live(b) || (b.started ?? 0) - (a.started ?? 0));
}

/** The task a tool call started (Agent / background Bash card ↔ task row). */
export function taskForTool(tasks: CvTask[], toolUseId: string): CvTask | undefined {
  return tasks.find((t) => t.tool_use_id === toolUseId);
}
