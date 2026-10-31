/**
 * Background work of a session (subagents, background shells, monitors) for badges and the
 * Tasks sheet, outside the Claude view too (the Island, the composer).
 *
 * The Claude view that shows a session publishes its live list here (`usePublishTasks`), so a
 * badge costs nothing extra. Without one (terminal mode, another screen) `useTasks` attaches to
 * the conversation itself after a short wait and keeps only the task list.
 */
import type { CvTask } from "@neuralagent/protocol";
import { useEffect, useSyncExternalStore } from "react";
import { useClient } from "../../lib/store";
import { useTaskList, type Tasks } from "./useConversation";

interface Snap {
  tasks: CvTask[];
  /** `CvMeta.tasks_running` (a count the daemon may send before the list). */
  hint?: number;
}

const EMPTY: Snap = { tasks: [] };
const snaps = new Map<string, Snap>();
const subs = new Map<string, Set<() => void>>();
const owners = new Map<string, number>();

function publish(sid: string, next: Snap) {
  const cur = snaps.get(sid);
  if (cur && cur.tasks === next.tasks && cur.hint === next.hint) return;
  snaps.set(sid, next);
  for (const f of subs.get(sid) ?? []) f();
}

function subscribe(sid: string, f: () => void) {
  let s = subs.get(sid);
  if (!s) subs.set(sid, (s = new Set()));
  s.add(f);
  return () => {
    s.delete(f);
    if (!s.size) {
      subs.delete(sid);
      if (!owners.get(sid)) snaps.delete(sid);
    }
  };
}

/** The Claude view of `sid` hands its live list over. */
export function usePublishTasks(sid: string, tasks: CvTask[], hint: number | undefined) {
  useEffect(() => {
    owners.set(sid, (owners.get(sid) ?? 0) + 1);
    return () => {
      const n = (owners.get(sid) ?? 1) - 1;
      if (n) owners.set(sid, n);
      else owners.delete(sid);
    };
  }, [sid]);
  useEffect(() => publish(sid, { tasks, hint }), [sid, tasks, hint]);
}

/**
 * `{ list, running, agents }` for a session: running first, newest first. `running` is the badge
 * number. Empty for an older daemon.
 */
export function useTasks(sid: string | null | undefined): Tasks {
  const client = useClient();
  const key = sid ?? "";
  const snap = useSyncExternalStore(
    (f) => (key ? subscribe(key, f) : () => {}),
    () => (key ? (snaps.get(key) ?? EMPTY) : EMPTY),
  );
  useEffect(() => {
    if (!key) return;
    let off: (() => void) | null = null;
    const t = setTimeout(() => {
      if (owners.get(key)) return;
      let hint: number | undefined;
      let tasks: CvTask[] = [];
      off = client.attachCv(key, {
        reset: (r) => {
          tasks = r.tasks ?? [];
          hint = r.meta.tasks_running ?? undefined;
          if (!owners.get(key)) publish(key, { tasks, hint });
        },
        event: (ev) => {
          if (ev.k === "tasks") tasks = ev.tasks;
          else if (ev.k === "meta" || ev.k === "reset") hint = ev.meta.tasks_running ?? undefined;
          else return;
          if (!owners.get(key)) publish(key, { tasks, hint });
        },
      });
    }, 400);
    return () => {
      clearTimeout(t);
      off?.();
    };
  }, [client, key]);
  return useTaskList(snap.tasks, snap.hint);
}

// ───────────── opening the Tasks sheet from outside the view ─────────────

const openers = new Map<string, () => void>();

/** The Claude view of `sid` registers how to open its Tasks sheet. */
export function useTasksOpener(sid: string, open: () => void) {
  useEffect(() => {
    openers.set(sid, open);
    return () => {
      if (openers.get(sid) === open) openers.delete(sid);
    };
  }, [sid, open]);
}

/** Opens the Tasks sheet of `sid` (Island badge, composer). False when no Claude view shows it. */
export function openTasksSheet(sid: string): boolean {
  const f = openers.get(sid);
  f?.();
  return !!f;
}
