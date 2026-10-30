import type { PaneContent } from "@neuralagent/protocol";
import { Button, Menu, Pill, cn, useLayoutMode } from "@neuralagent/ui";
import { Columns2, Ellipsis, GitBranch, Globe, Maximize2, Minimize2, RotateCw, Rows2, X } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { STATUS } from "../lib/status";
import { useChanges, useClient } from "../lib/store";
import { EngineTile, QuietTile, tileGlyph } from "./EngineTile";
import { BrowserPane } from "./BrowserPane";
import { EmptyPane } from "./EmptyPane";
import { ClaudeView } from "./claude/ClaudeView";
import { KeyBar } from "./KeyBar";
import { TerminalView } from "./TerminalView";
import { paneTitle, usePaneMenu, usePaneSession } from "./workspace/paneMenu";

export interface PaneActions {
  focus: () => void;
  split: (dir: "row" | "column") => void;
  close: () => void;
  zoom: () => void;
  swapWith: (otherPaneId: string) => void;
  setContent: (content: PaneContent) => void;
  /** Shows `url` in the tab's browser pane, or opens one to the right. */
  preview: (url: string) => void;
}

const DRAG_TYPE = "application/x-neuralagent-pane";

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="hoverable grid size-7 shrink-0 place-items-center rounded-full text-dim transition-colors hover:text-bright"
    >
      {children}
    </button>
  );
}

/**
 * One pane: an agent's terminal or Claude view, a preview, or a launcher. Desktop: a card with a
 * header (agent, status, split, zoom, close, "…"); drag the header to swap panes. Chat or terminal
 * for Claude agents is one switch in the workspace bar (ClaudeViewSwitch), not per pane.
 * Phones: no header — the workspace header and its action sheet carry the actions, and a Claude
 * pane fills the screen edge to edge.
 */
export function Pane({ workspaceId, paneId, content, focused, zoomed, webgl, actions }: {
  workspaceId: string;
  paneId: string;
  content: PaneContent;
  focused: boolean;
  zoomed: boolean;
  webgl: boolean;
  actions: PaneActions;
}) {
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const showChanges = useChanges((c) => c.show);
  const { sid, session, profile, claudeView } = usePaneSession(content, phone);
  const menu = usePaneMenu({ workspaceId, content, actions, zoomed, phone });
  const [dropTarget, setDropTarget] = useState(false);

  const st = session ? STATUS[session.status] : null;
  const title = content.kind === "empty" ? "New agent" : paneTitle(content, session);
  const restart = () => session && client.req({ m: "session_restart", p: { id: session.id } }).catch(() => {});

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, paneId);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE)) {
      e.preventDefault();
      setDropTarget(true);
    }
  };
  const onDrop = (e: DragEvent) => {
    const other = e.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(false);
    if (other && other !== paneId) actions.swapWith(other);
  };

  const bare = phone && claudeView;
  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden transition-shadow",
        bare ? "bg-cv-bg" : "rounded-tile bg-chrome",
        !phone && (focused ? "shadow-edge" : "shadow-rim"),
        dropTarget && "shadow-well-focus",
      )}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onDrop}
    >
      {!phone && (
        <div
          draggable
          onDragStart={onDragStart}
          onMouseDown={actions.focus}
          onDoubleClick={actions.zoom}
          className="group flex h-10 shrink-0 cursor-default items-center gap-2 pr-1.5 pl-2 select-none"
        >
          {profile ? (
            <EngineTile engine={profile.engine} size="sm" selected={focused} activity={session?.status === "working" ? "working" : undefined} edge="ring-chrome" />
          ) : content.kind === "browser" ? (
            <QuietTile size="sm" selected={focused}><Globe size={tileGlyph("sm")} strokeWidth={1.6} /></QuietTile>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <span className={cn("min-w-0 shrink truncate text-chip", focused ? "text-bright" : "text-dim")}>{title}</span>
          {st && session && (session.status === "waiting" || session.status === "error") && (
            <Pill size="sm" tone={st.tone === "warning" ? "warning" : "danger"} dot className="shrink-0">{st.label}</Pill>
          )}
          {session?.worktree && (
            <button
              type="button"
              title={`Own worktree on ${session.worktree.branch}: review, merge or discard`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => showChanges(workspaceId, session.id)}
              className="hoverable flex h-6 shrink-0 items-center gap-1 rounded-full bg-fill-2 px-2 text-meta text-ink hover:text-bright"
            >
              <GitBranch size={12} strokeWidth={1.7} aria-hidden />
              Worktree
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-meta text-faint">{session?.last_line && session.status !== "waiting" ? session.last_line : ""}</span>
          <div className={cn("flex shrink-0 items-center transition-opacity", focused ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
            {session?.preview_url && (
              <HeaderButton label={`Preview ${session.preview_url}`} onClick={() => actions.preview(session.preview_url!)}>
                <Globe size={15} strokeWidth={1.7} />
              </HeaderButton>
            )}
            {session && !session.alive && (
              <HeaderButton label="Restart" onClick={() => void restart()}>
                <RotateCw size={15} strokeWidth={1.7} />
              </HeaderButton>
            )}
            <HeaderButton label="Split right (⌘D)" onClick={() => actions.split("row")}>
              <Columns2 size={15} strokeWidth={1.7} />
            </HeaderButton>
            <HeaderButton label="Split down (⌘\\)" onClick={() => actions.split("column")}>
              <Rows2 size={15} strokeWidth={1.7} />
            </HeaderButton>
            <HeaderButton label={zoomed ? "Restore (⌘↩)" : "Zoom (⌘↩)"} onClick={actions.zoom}>
              {zoomed ? <Minimize2 size={15} strokeWidth={1.7} /> : <Maximize2 size={15} strokeWidth={1.7} />}
            </HeaderButton>
            <Menu
              title={title}
              items={menu.items}
              width={240}
              trigger={(open) => (
                <HeaderButton label="More" onClick={open}>
                  <Ellipsis size={16} strokeWidth={1.7} />
                </HeaderButton>
              )}
            />
            <HeaderButton label="Close (⌘W)" onClick={menu.requestClose}>
              <X size={16} strokeWidth={1.7} />
            </HeaderButton>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {sid && session && claudeView ? (
          <ClaudeView session={session} webgl={webgl} onFocus={actions.focus} />
        ) : sid && session ? (
          <TerminalView sid={sid} focused={focused} startedAt={session.started_at} webgl={webgl} touch={phone} onFocus={actions.focus} />
        ) : content.kind === "browser" ? (
          <BrowserPane url={content.url} onFocus={actions.focus} onNavigate={(url) => actions.setContent({ kind: "browser", url })} />
        ) : (
          <EmptyPane workspaceId={workspaceId} paneId={paneId} onFocus={actions.focus} onBrowser={(url) => actions.setContent({ kind: "browser", url })} />
        )}
        {session && !session.alive && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
            <div className="material pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-subhead text-ink shadow-float">
              <span>{session.exit_code ? `Exited with code ${session.exit_code}` : "The agent has stopped"}</span>
              <Button size="sm" variant="primary" Icon={RotateCw} onClick={() => void restart()}>
                Restart
              </Button>
            </div>
          </div>
        )}
      </div>
      {phone && sid && session?.alive && !claudeView && <KeyBar sid={sid} />}
      {menu.confirm}
    </div>
  );
}
