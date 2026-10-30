// The swarm conversation as a readable feed: messages in runs (same sender and recipient, close
// together, so the name is said once), with a day label wherever the day changes.

export interface FeedMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  at: number;
}

/** One block of the feed: a day label, or a run of messages from one sender to one recipient. */
export type FeedBlock<M extends FeedMessage> = { kind: "day"; key: string; at: number } | { kind: "run"; key: string; from: string; to: string; items: M[] };

/** Messages further apart than this start a new run, even from the same sender. */
export const RUN_GAP_MS = 5 * 60 * 1000;

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function feedBlocks<M extends FeedMessage>(messages: M[]): FeedBlock<M>[] {
  const out: FeedBlock<M>[] = [];
  let day = "";
  let run: Extract<FeedBlock<M>, { kind: "run" }> | null = null;
  for (const m of messages) {
    const k = dayKey(m.at);
    if (k !== day) {
      day = k;
      run = null;
      out.push({ kind: "day", key: `day-${k}`, at: m.at });
    }
    const last = run?.items.at(-1);
    if (run && last && run.from === m.from && run.to === m.to && m.at - last.at <= RUN_GAP_MS) {
      run.items.push(m);
      continue;
    }
    run = { kind: "run", key: m.id, from: m.from, to: m.to, items: [m] };
    out.push(run);
  }
  return out;
}

/** "to everyone", "to you", "to Builder". */
export const toLabel = (to: string) => (to === "all" ? "everyone" : to.toLowerCase() === "you" ? "you" : to);

/** Short running time: "45s", "12m", "2h 05m", "3d". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d`;
}
