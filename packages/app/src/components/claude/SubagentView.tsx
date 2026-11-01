/**
 * A subagent's own transcript, pushed over the conversation (A3 §2.7, D65): a breadcrumb header
 * ("‹ Conversation · Explore: Find the build script"), the same transcript as the main chat
 * (read-only, from `cv_attach` with `agent`, live while it runs) and the shared status line
 * (status, last step, time, tokens). Back (gesture, Escape, Android back, the button) pops one
 * level; nested subagents push further.
 *
 * Opened before the daemon linked the agent's id (a foreground agent that just started), it
 * waits for the id on the task list and attaches then.
 */
import type { CvTask } from "@neuralagent/protocol";
import { cn, useLayer } from "@neuralagent/ui";
import { ChevronLeft } from "lucide-react";
import { useContext, useEffect, useMemo, useState } from "react";
import { TasksContext, type AgentRef } from "./AgentCard";
import { ChatScroll } from "./ChatScroll";
import { lastTurn, openTools } from "./entries";
import { ImageAgentContext } from "./Images";
import { useEntries } from "./Transcript";
import { useConversation } from "./useConversation";
import { useNow } from "./useWork";
import { agentIdOf, detailOf, isLive, isToolId, statusOf, typeOf } from "./work";
import { WorkStatusLine } from "./WorkRow";
import { useIslandOverride } from "../workspace/islandOverride";

export type { AgentRef };

const NONE: ReadonlySet<string> = new Set();

/** The task behind a ref: by id, else by the Agent call that started it. */
export function taskOfRef(tasks: CvTask[], a: AgentRef): CvTask | undefined {
  return tasks.find((t) => t.id === a.id) ?? (a.toolUseId ? tasks.find((t) => t.tool_use_id === a.toolUseId) : undefined);
}

export function SubagentView({ sid, startedAt, trail, phone, onBack, onCopied }: {
  sid: string;
  startedAt: number;
  /** Opened subagents, outermost first; the last one is shown. */
  trail: AgentRef[];
  phone: boolean;
  onBack: () => void;
  onCopied: (what: string) => void;
}) {
  const top = trail[trail.length - 1]!;
  useLayer(true, onBack);
  const { tasks } = useContext(TasksContext);
  const task = taskOfRef(tasks, top);
  const agentId = agentIdOf(task) ?? (isToolId(top.id) ? undefined : top.id);
  const { conv, loadOlder, loadingOlder } = useConversation(sid, startedAt, { agent: agentId, skip: !agentId });
  const entries = useEntries(conv.messages);
  // An older daemon (or a subagent without a file) never answers the attach.
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    const t = setTimeout(() => setLate(true), 4000);
    return () => clearTimeout(t);
  }, [agentId]);
  const tail = useMemo(() => lastTurn(entries), [entries]);
  const status = task ? statusOf(task) : conv.meta.busy ? "running" : "done";
  const live = isLive(status);
  const now = useNow(live && !!task?.started);
  const running = live ? openTools(tail) : NONE;
  const back = trail.length > 1 ? trail[trail.length - 2]!.title : "Conversation";
  const type = task ? typeOf(task) : "Agent";
  const detail = task ? detailOf(task, now) || (!live ? task.summary : "") || "" : "";
  // Phones: the Island shows "‹  Title / Conversation › Explore" and its back pops this layer,
  // so there is one back on screen (Android back pops it too: useLayer above).
  const inIsland = useIslandOverride(phone ? { title: top.title, subtitle: [back, type].filter(Boolean).join(" › "), backLabel: back, onBack } : null);

  return (
    // On phones the Island floats over the top of the chat: the header starts below it.
    <div className="absolute inset-0 z-30 flex flex-col bg-cv-bg font-cv-sans text-cv-text animate-cv-rise" style={inIsland ? undefined : { paddingTop: "var(--island-space, 0px)" }} role="dialog" aria-label={`Subagent: ${top.title}`}>
      {!inIsland && (
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-cv-line-soft pr-4 pl-1.5">
          <button type="button" onClick={onBack} className="flex h-10 max-w-2/5 shrink-0 items-center gap-0.5 rounded-cv-sm pr-2 text-cv-ui text-cv-text-2 active:bg-cv-press hover:text-cv-text">
            <ChevronLeft size={20} strokeWidth={1.8} className="shrink-0" />
            <span className="truncate">{back}</span>
          </button>
          <span className="text-cv-muted" aria-hidden>
            /
          </span>
          <div className="ml-1.5 flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="shrink-0 text-cv-meta text-cv-muted">{type}</span>
            <span className="min-w-0 truncate text-cv-ui text-cv-text">{top.title}</span>
          </div>
        </div>
      )}
      <ImageAgentContext.Provider value={agentId ?? top.id}>
        <ChatScroll
          entries={entries}
          resetKey={`${sid}|${agentId ?? top.id}`}
          more={conv.more}
          loadingOlder={loadingOlder}
          loadOlder={loadOlder}
          running={running}
          working={live}
          waiting={false}
          phone={phone}
          island={inIsland}
          onCopied={onCopied}
          top={
            !conv.messages.length ? (
              <p className="m-auto py-16 text-center text-cv-ui text-cv-muted">
                {!agentId && live ? "Starting…" : !conv.ready && !late ? "Loading…" : live ? "Starting…" : "The steps of this subagent are not available."}
              </p>
            ) : null
          }
        />
      </ImageAgentContext.Provider>
      <div className={cn("flex min-h-11 shrink-0 items-center gap-2 border-t border-cv-line-soft px-4", phone && "pb-(--safe-bottom)")} role="status" aria-live="polite">
        <WorkStatusLine status={status} detail={detail} className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
