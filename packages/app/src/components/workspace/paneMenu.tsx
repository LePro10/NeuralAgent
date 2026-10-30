// What you can do with one pane, in one place: the desktop pane header's "…" menu and the phone
// workspace header's action sheet use the same entries. Closing a running agent asks first.
import type { PaneContent, Session } from "@neuralagent/protocol";
import { ConfirmSheet, MOD_KEY, toast, type MenuEntry } from "@neuralagent/ui";
import { Columns2, GitBranch, Globe, Maximize2, MessageSquareText, Minimize2, RotateCw, Rows2, SquareTerminal, TextSelect, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useChanges, useClient, useDaemon, useUi } from "../../lib/store";
import type { PaneActions } from "../Pane";
import { showTerminalText } from "../TerminalText";

/** The session shown in a pane, its profile, and whether it is shown as the Claude view. */
export function usePaneSession(content: PaneContent | undefined, phone: boolean) {
  const sid = content?.kind === "terminal" ? content.session : null;
  const session: Session | undefined = useDaemon((c) => (sid ? c.state?.sessions[sid] : undefined));
  const profile = useDaemon((c) => (session ? c.state?.profiles.find((p) => p.id === session.profile_id) : undefined));
  const claudePref = useUi((u) => u.claudeView);
  const isClaude = profile?.engine === "claude";
  const claudeView = !!isClaude && (claudePref ?? phone);
  return { sid, session, profile, isClaude, claudeView };
}

/** A short label for a pane: the agent's title, the preview's host, or "New agent". */
export function paneTitle(content: PaneContent | undefined, session: Session | undefined): string {
  if (session) return session.title;
  if (content?.kind === "browser") {
    try {
      return new URL(content.url).host || "Preview";
    } catch {
      return "Preview";
    }
  }
  return "New agent";
}

export function usePaneMenu({ workspaceId, content, actions, zoomed, phone }: {
  workspaceId: string;
  content: PaneContent | undefined;
  actions: PaneActions | null;
  zoomed?: boolean;
  phone: boolean;
}): { items: MenuEntry[]; requestClose: () => void; confirm: ReactNode } {
  const client = useClient();
  const showChanges = useChanges((c) => c.show);
  const setClaudePref = useUi((u) => u.setClaudeView);
  const { sid, session, isClaude, claudeView } = usePaneSession(content, phone);
  const [asking, setAsking] = useState(false);

  const close = () => actions?.close();
  const requestClose = () => (session?.alive ? setAsking(true) : close());
  const restart = () => session && client.req({ m: "session_restart", p: { id: session.id } }).catch((e) => toast((e as Error).message, { tone: "danger" }));

  const items: MenuEntry[] = [];
  if (!actions) return { items, requestClose, confirm: null };
  if (isClaude) {
    items.push(
      claudeView
        ? { label: "Show the terminal", Icon: SquareTerminal, onSelect: () => setClaudePref(false) }
        : { label: "Show the Claude view", Icon: MessageSquareText, onSelect: () => setClaudePref(true) },
    );
  }
  if (sid && !claudeView) items.push({ label: "Select and copy text", Icon: TextSelect, onSelect: () => showTerminalText(sid) });
  if (session?.preview_url) items.push({ label: "Open the preview", detail: session.preview_url.replace(/^https?:\/\//, ""), Icon: Globe, onSelect: () => actions.preview(session.preview_url!) });
  if (session?.worktree) items.push({ label: "Review worktree changes", detail: session.worktree.branch, Icon: GitBranch, onSelect: () => showChanges(workspaceId, session.id) });
  if (session && !session.alive) items.push({ label: "Restart", Icon: RotateCw, onSelect: () => void restart() });
  if (!phone) {
    items.push(
      { label: "Split right", Icon: Columns2, shortcut: `${MOD_KEY}D`, divider: true, onSelect: () => actions.split("row") },
      { label: "Split down", Icon: Rows2, shortcut: `${MOD_KEY}\\`, onSelect: () => actions.split("column") },
      { label: zoomed ? "Restore size" : "Zoom", Icon: zoomed ? Minimize2 : Maximize2, shortcut: `${MOD_KEY}↩`, onSelect: actions.zoom },
    );
  }
  items.push({
    label: session ? (session.alive ? "Stop and close" : "Close") : "Close pane",
    Icon: X,
    destructive: true,
    divider: true,
    shortcut: phone ? undefined : `${MOD_KEY}W`,
    onSelect: requestClose,
  });

  const confirm = (
    <ConfirmSheet
      open={asking}
      onClose={() => setAsking(false)}
      onConfirm={() => close()}
      title={`Stop ${session?.title ?? "this agent"}?`}
      message="The agent stops and its pane closes."
      confirmLabel="Stop and close"
      destructive
    />
  );
  return { items, requestClose, confirm };
}
