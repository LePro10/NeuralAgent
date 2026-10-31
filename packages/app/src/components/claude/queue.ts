/**
 * Messages sent while Claude works wait in the CLI's queue until the next step. The view shows
 * them as chips above the composer. Once the daemon reports the queue (`meta.queued`, A2 §1a)
 * that list is the truth; until then the client remembers what it sent while busy and drops
 * an entry when it shows up in the transcript (or the turn has been over for a while).
 * Pure so it can be tested.
 */

export interface Queued {
  id: string;
  text: string;
  /** When it was sent (ms). */
  at: number;
}

let seq = 0;
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

export function addQueued(list: Queued[], text: string, now: number): Queued[] {
  const t = text.trim();
  if (!t) return list;
  return [...list, { id: `q${++seq}`, text: t, at: now }];
}

/** Drop entries that arrived as user messages (the CLI may join several into one). */
export function reconcile(list: Queued[], users: { text: string; ts: number }[]): Queued[] {
  if (!list.length) return list;
  const recent = users.map((u) => ({ text: norm(u.text), ts: u.ts }));
  const next = list.filter((q) => {
    const t = norm(q.text);
    // ts may be 0 or a little behind the client's clock.
    return !recent.some((u) => (!u.ts || u.ts >= q.at - 5_000) && (u.text === t || (t.length > 8 && u.text.includes(t))));
  });
  return next.length === list.length ? list : next;
}

/** Idle for a while: the CLI has sent or dropped what was queued. */
export function expire(list: Queued[], busy: boolean, idleSince: number, now: number, after = 6_000): Queued[] {
  if (!list.length || busy || !idleSince) return list;
  return now - idleSince >= after ? [] : list;
}

/** The daemon's queue when it sends one, else the client's guess. */
export function shownQueue(local: Queued[], fromDaemon: (string | { text: string; ts?: number })[] | null | undefined): Queued[] {
  if (!Array.isArray(fromDaemon)) return local;
  return fromDaemon.map((d, i) => {
    const text = typeof d === "string" ? d : d.text;
    return local.find((q) => norm(q.text) === norm(text)) ?? { id: `d${i}:${text.slice(0, 24)}`, text, at: typeof d === "string" ? 0 : (d.ts ?? 0) };
  });
}

/** Keys: Enter on an empty CLI prompt sends the queue now ("Enter to send them immediately"). */
export const SEND_NOW = "\r";
/** Up on an empty CLI prompt pulls the queued messages back into the input, Ctrl+L clears it. */
export const TAKE_BACK = ["\x1b[A", "\x0c"] as const;
