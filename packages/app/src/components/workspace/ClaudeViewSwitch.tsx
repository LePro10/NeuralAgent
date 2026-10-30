// Chat or terminal for Claude agents: one app-wide choice, so it is one switch in the workspace
// bar (desktop: next to the branch; phones: at the end of the agent strip), not a switch per pane.
// It shows only where a Claude agent is in view; other agents have no chat view.
import { Segmented, cn, useLayoutMode } from "@neuralagent/ui";
import { MessageSquareText, SquareTerminal } from "lucide-react";
import { useUi } from "../../lib/store";
import { AgentGlyph } from "../AgentGlyph";

/** Whether Claude agents show the chat view: the saved choice, else the layout's default (phone: chat, desktop: terminal). */
export function useClaudeChat(phone: boolean): boolean {
  const pref = useUi((u) => u.claudeView);
  return pref ?? phone;
}

const OPTIONS = [
  { value: "chat" as const, label: "Chat", Icon: MessageSquareText },
  { value: "terminal" as const, label: "Terminal", Icon: SquareTerminal },
];

export function ClaudeViewSwitch({ className }: { className?: string }) {
  const phone = useLayoutMode() === "phone";
  const chat = useClaudeChat(phone);
  const set = useUi((u) => u.setClaudeView);
  const segmented = (
    <Segmented
      size={phone ? "md" : "sm"}
      iconOnly={phone}
      label="Show Claude agents as"
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
