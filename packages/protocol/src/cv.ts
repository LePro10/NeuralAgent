import type { CvAttachResult, CvEvent, CvMessage, CvMeta, CvPrompt } from "./gen/index.ts";

/** A client's copy of a Claude session's conversation. */
export interface Conversation {
  messages: CvMessage[];
  /** Older messages exist (`cv_history`). */
  more: boolean;
  meta: CvMeta;
  prompt: CvPrompt | null;
  /** The first attach answer has arrived. */
  ready: boolean;
}

export const emptyConversation = (): Conversation => ({ messages: [], more: false, meta: {}, prompt: null, ready: false });

export function fromAttach(r: CvAttachResult): Conversation {
  return { messages: r.messages, more: r.more, meta: r.meta, prompt: r.prompt ?? null, ready: true };
}

/** Older messages go in front (those already present win). */
export function prepend(c: Conversation, older: CvMessage[], more: boolean): Conversation {
  const have = new Set(c.messages.map((m) => m.id));
  const add = older.filter((m) => !have.has(m.id));
  return { ...c, messages: [...add, ...c.messages], more };
}

/** Applies a live event, immutably. */
export function applyCv(c: Conversation, ev: CvEvent): Conversation {
  switch (ev.k) {
    case "reset":
      return { ...c, messages: ev.messages, more: ev.more, meta: ev.meta, ready: true };
    case "meta":
      return { ...c, meta: ev.meta };
    case "prompt":
      return { ...c, prompt: ev.prompt ?? null };
    case "upsert": {
      const m = ev.message;
      const i = c.messages.findIndex((x) => x.id === m.id);
      if (i >= 0) return { ...c, messages: c.messages.map((x, j) => (j === i ? m : x)) };
      return { ...c, messages: [...c.messages, m] };
    }
  }
}
