import { applyCv, emptyConversation, fromAttach, prepend, type Conversation } from "@neuralagent/protocol";
import type { CvHistoryResult } from "@neuralagent/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "../../lib/store";

/** The conversation of a Claude session, live from the daemon (reconnects included). */
export function useConversation(sid: string, startedAt: number) {
  const client = useClient();
  const [conv, setConv] = useState<Conversation>(emptyConversation);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const convRef = useRef(conv);
  convRef.current = conv;

  useEffect(() => {
    setConv(emptyConversation());
    return client.attachCv(sid, {
      reset: (r) => setConv(fromAttach(r)),
      event: (ev) => setConv((c) => applyCv(c, ev)),
    });
  }, [client, sid, startedAt]);

  const loadOlder = useCallback(async () => {
    const c = convRef.current;
    const first = c.messages[0];
    if (!first || !c.more || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await client.req<CvHistoryResult>({ m: "cv_history", p: { sid, before: first.i } });
      setConv((cur) => prepend(cur, r.messages, r.more));
    } catch {
      // try again on the next scroll
    } finally {
      setLoadingOlder(false);
    }
  }, [client, sid, loadingOlder]);

  return { conv, loadOlder, loadingOlder };
}
