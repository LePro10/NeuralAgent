// Chat or terminal for Claude agents. Desktop: one app-wide choice, one switch in the workspace bar
// next to the branch. Phones: each agent remembers its own choice (the switch per agent in the
// Island panel); an agent without one follows the app-wide choice (default: chat).
// It shows only where a Claude agent is in view; other agents have no chat view.
import { Segmented, cn, useLayoutMode } from "@neuralagent/ui";
import { MessageSquareText, SquareTerminal } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useUi } from "../../lib/store";
import { AgentGlyph } from "../AgentGlyph";

/** Whether Claude agents show the chat view: the saved choice, else the layout's default (phone: chat, desktop: terminal). */
export function useClaudeChat(phone: boolean): boolean {
  const pref = useUi((u) => u.claudeView);
  return pref ?? phone;
}

type View = "chat" | "terminal";
const KEY = "na.agentView";
const KEEP = 200;
let views: Record<string, View> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, View>) : {};
  } catch {
    return {};
  }
})();
const subs = new Set<() => void>();
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** Phones: show this agent as chat or terminal from now on. */
export function setAgentChat(sid: string, chat: boolean) {
  const { [sid]: _, ...rest } = views;
  const next = { ...rest, [sid]: chat ? "chat" : "terminal" } as Record<string, View>;
  const ids = Object.keys(next);
  views = ids.length > KEEP ? Object.fromEntries(ids.slice(-KEEP).map((k) => [k, next[k]!])) : next;
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    /* private mode: the choice lasts for this run */
  }
  for (const f of subs) f();
}

/** Whether this agent shows the chat view: on phones its own choice, else the app-wide one. */
export function useAgentChat(sid: string | null | undefined, phone: boolean): boolean {
  const app = useClaudeChat(phone);
  const own = useSyncExternalStore(subscribe, () => (sid ? views[sid] : undefined));
  return phone && own ? own === "chat" : app;
}

const OPTIONS = [
  { value: "chat" as const, label: "Chat", Icon: MessageSquareText },
  { value: "terminal" as const, label: "Terminal", Icon: SquareTerminal },
];

/** `sid` (phones): switch this one agent; without it, the app-wide choice. */
export function ClaudeViewSwitch({ className, sid }: { className?: string; sid?: string }) {
  const phone = useLayoutMode() === "phone";
  const chat = useAgentChat(sid, phone);
  const setApp = useUi((u) => u.setClaudeView);
  const set = (v: boolean) => (phone && sid ? setAgentChat(sid, v) : setApp(v));
  const segmented = (
    <Segmented
      size={phone ? "md" : "sm"}
      iconOnly={phone}
      label={phone && sid ? "Show this agent as" : "Show Claude agents as"}
      value={chat ? "chat" : "terminal"}
      options={OPTIONS}
      onChange={(v) => set(v === "chat")}
    />
  );
  if (phone) return <div className={cn("shrink-0", className)}>{segmented}</div>;
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)} title="How every Claude agent is shown: as a chat or as its terminal">
      <span className="flex items-center gap-1.5 text-chip text-dim">
        <AgentGlyph engine="claude" size={14} />
        Claude
      </span>
      {segmented}
    </div>
  );
}
