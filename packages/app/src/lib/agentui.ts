// Small shared helpers for the agent-facing pages (Neural, Agents, Swarm, History):
// plain-text previews, short relative times, day groups.
import { useEffect, useState } from "react";

/** Markdown and terminal noise → one readable line ("**README.md** now…" → "README.md now…"). */
export function plainText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_]/g, "$1$2")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*[-–—]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Neural's notices about agents: "<label> finished: <text>" (see the daemon's orch::watch). */
export const NOTICE = /^([\s\S]*?) (finished|needs input|stopped with an error)(?:: ([\s\S]*))?$/;

/** A terminal menu line ("❯ 1. Yes", "› 2. No") says nothing on its own. */
const MENU_LINE = /^\s*[❯›>]?\s*\d+[.)]\s/;

/**
 * What a row says about an agent: why it waits (from Neural's notice), else its last words,
 * its last screen line (not a menu entry) or its prompt.
 */
export function agentSays(s: { id: string; status: string; last_message?: string; last_line?: string; prompt?: string }, notices: { text: string; session_id?: string; role: string }[] = []): string {
  if (s.status === "waiting") {
    for (let i = notices.length - 1; i >= 0; i--) {
      const m = notices[i]!;
      if (m.session_id !== s.id || m.role !== "notice") continue;
      const [, , what, said] = NOTICE.exec(m.text) ?? [];
      if (what === "needs input" && said) return plainText(said);
      break;
    }
  }
  const line = s.last_line && !MENU_LINE.test(s.last_line) ? s.last_line : undefined;
  return plainText(s.last_message ?? line ?? s.prompt ?? "");
}

/** Short relative time for rows: "now", "4m", "2h", "Yesterday", "Mon", "12 Oct". */
export function shortAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  const day = dayKey(ms);
  if (day === dayKey(now)) return `${Math.floor(s / 3600)}h`;
  if (day === dayKey(now - 86400000)) return "Yesterday";
  if (now - ms < 6 * 86400000) return new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Clock time "14:05". */
export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Section label for a day: "Today", "Yesterday", "Monday", "12 October". */
export function dayLabel(ms: number, now = Date.now()): string {
  const k = dayKey(ms);
  if (k === dayKey(now)) return "Today";
  if (k === dayKey(now - 86400000)) return "Yesterday";
  if (now - ms < 6 * 86400000) return new Date(ms).toLocaleDateString("en-US", { weekday: "long" });
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** Splits a time-sorted list into day sections, keeping the order. */
export function byDay<T>(items: T[], at: (t: T) => number, now = Date.now()): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const label = dayLabel(at(it), now);
    const last = out.at(-1);
    if (last?.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

/** A clock that ticks, for relative times. */
export function useNow(every = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}
