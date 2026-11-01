import { applyCv, emptyConversation, fromAttach, prepend, sortTasks, type Conversation, type CvTask } from "@neuralagent/protocol";
import type { CvHistoryResult } from "@neuralagent/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClient } from "../../lib/store";

/**
 * The conversation of a Claude session, live from the daemon (reconnects included). With
 * `agent`, one subagent's own transcript instead (`CvTask.id`); an older daemon simply answers
 * with nothing for it. `skip`: attach nothing yet (a subagent whose id is not known yet).
 */
export function useConversation(sid: string, startedAt: number, opts?: { agent?: string; skip?: boolean }) {
  const client = useClient();
  const agent = opts?.agent;
  const skip = !!opts?.skip;
  const [conv, setConv] = useState<Conversation>(emptyConversation);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const convRef = useRef(conv);
  convRef.current = conv;

  useEffect(() => {
    setConv(emptyConversation());
    if (skip) return;
    return client.attachCv(
      sid,
      {
        reset: (r) => setConv(fromAttach(r)),
        event: (ev) => setConv((c) => applyCv(c, ev)),
      },
      agent ? { agent } : undefined,
    );
  }, [client, sid, startedAt, agent, skip]);

  const loadOlder = useCallback(async () => {
    const c = convRef.current;
    const first = c.messages[0];
    if (!first || !c.more || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await client.req<CvHistoryResult>({ m: "cv_history", p: { sid, before: first.i, ...(agent ? { agent } : {}) } });
      setConv((cur) => prepend(cur, r.messages, r.more));
    } catch {
      // try again on the next scroll
    } finally {
      setLoadingOlder(false);
    }
  }, [client, sid, agent, loadingOlder]);

  return { conv, loadOlder, loadingOlder };
}

/** Running count and the sorted list of a conversation's background tasks. */
export interface Tasks {
  /** Running first, newest first. */
  list: CvTask[];
  running: number;
  /** Subagents only (cards in the transcript). */
  agents: CvTask[];
}

/** Derives the task list (pure, memoised on the array identity). */
export function useTaskList(tasks: CvTask[], runningHint?: number): Tasks {
  return useMemo(() => {
    const list = sortTasks(tasks);
    const counted = list.filter((t) => t.status === "running").length;
    return { list, running: Math.max(counted, list.length ? counted : (runningHint ?? 0)), agents: list.filter((t) => t.kind === "agent") };
  }, [tasks, runningHint]);
}
