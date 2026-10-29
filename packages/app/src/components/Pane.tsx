import type { PaneContent, Session } from "@neuralagent/protocol";
import { StatusDot, useLayoutMode } from "@neuralagent/ui";
import { Columns2, GitBranch, Globe, Maximize2, Minimize2, Rows2, RotateCw, X } from "lucide-react";
import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "@neuralagent/ui";
import { STATUS } from "../lib/status";
import { useChanges, useClient, useDaemon } from "../lib/store";
import { AgentGlyph } from "./AgentGlyph";
import { BrowserPane } from "./BrowserPane";
import { EmptyPane } from "./EmptyPane";
import { TerminalView } from "./TerminalView";

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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="hoverable grid size-6 place-items-center rounded-xs text-dim transition-colors hover:text-ink"
    >
      {children}
    </button>
  );
}

export function Pane({ workspaceId, paneId, content, focused, zoomed, webgl, actions }: {
  workspaceId: string;
  paneId: string;
  content: PaneContent;
  focused: boolean;
  zoomed: boolean;
  webgl: boolean;
  actions: PaneActions;
}) {
  const sid = content.kind === "terminal" ? content.session : null;
  const session: Session | undefined = useDaemon((c) => (sid ? c.state?.sessions[sid] : undefined));
  const profile = useDaemon((c) => (session ? c.state?.profiles.find((p) => p.id === session.profile_id) : undefined));
  const client = useClient();
  const phone = useLayoutMode() === "phone";
  const showChanges = useChanges((c) => c.show);
  const [dropTarget, setDropTarget] = useState(false);
  // Closing a pane stops its process; a running one needs a second click within 3 s.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const close = () => {
    if (session?.alive && !armed) setArmed(true);
    else actions.close();
  };

  const st = session ? STATUS[session.status] : null;
  const title = session ? session.title : content.kind === "browser" ? hostOf(content.url) : "Empty";

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

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-tile bg-chrome transition-shadow",
        focused ? "shadow-edge" : "shadow-rim",
        dropTarget && "shadow-well-focus",
      )}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onDrop}
    >
      <div
        draggable
        onDragStart={onDragStart}
        onMouseDown={actions.focus}
        onDoubleClick={actions.zoom}
        className="group flex h-7 shrink-0 cursor-default items-center gap-2 pr-1 pl-2.5 select-none"
      >
        {st ? <StatusDot tone={st.tone} pulse={st.pulse} label={st.label} /> : <span className="size-1.5" />}
        {profile && <AgentGlyph engine={profile.engine} size={12} className={focused ? "text-ink" : "text-faint"} />}
        <span className={cn("truncate text-detail", focused ? "text-bright" : "text-dim")}>{title}</span>
        {session?.worktree && (
          <button
            type="button"
            title={`Own worktree on ${session.worktree.branch}: review, merge or discard`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => showChanges(workspaceId, session.id)}
            className="hoverable flex h-5 shrink-0 items-center gap-1 rounded-xs bg-fill-1 px-1.5 text-meta text-dim hover:text-ink"
          >
            <GitBranch size={11} strokeWidth={1.6} aria-hidden />
            Worktree
          </button>
        )}
        {session?.last_line && <span className="min-w-0 flex-1 truncate text-meta text-faint">{session.last_line}</span>}
        {!session?.last_line && <span className="flex-1" />}
        <div className={cn("flex items-center gap-0.5 transition-opacity", focused ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {session?.preview_url && (
            <HeaderButton label={`Preview ${session.preview_url}`} onClick={() => actions.preview(session.preview_url!)}>
              <Globe size={13} strokeWidth={1.6} />
            </HeaderButton>
          )}
          {session && !session.alive && (
            <HeaderButton label="Restart" onClick={() => client.req({ m: "session_restart", p: { id: session.id } }).catch(() => {})}>
              <RotateCw size={13} strokeWidth={1.6} />
            </HeaderButton>
          )}
          <HeaderButton label="Split right" onClick={() => actions.split("row")}>
            <Columns2 size={13} strokeWidth={1.6} />
          </HeaderButton>
          <HeaderButton label="Split down" onClick={() => actions.split("column")}>
            <Rows2 size={13} strokeWidth={1.6} />
          </HeaderButton>
          <HeaderButton label={zoomed ? "Restore" : "Zoom"} onClick={actions.zoom}>
            {zoomed ? <Minimize2 size={13} strokeWidth={1.6} /> : <Maximize2 size={13} strokeWidth={1.6} />}
          </HeaderButton>
          {armed ? (
            <button type="button" onClick={(e) => (e.stopPropagation(), actions.close())} className="h-6 rounded-xs px-2 text-meta text-danger hoverable">
              Stop &amp; close
            </button>
          ) : (
            <HeaderButton label="Close pane" onClick={close}>
              <X size={14} strokeWidth={1.6} />
            </HeaderButton>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {sid && session ? (
          <TerminalView sid={sid} focused={focused} startedAt={session.started_at} webgl={webgl} onFocus={actions.focus} />
        ) : content.kind === "browser" ? (
          <BrowserPane url={content.url} onFocus={actions.focus} onNavigate={(url) => actions.setContent({ kind: "browser", url })} />
        ) : (
          <EmptyPane workspaceId={workspaceId} paneId={paneId} onFocus={actions.focus} onBrowser={(url) => actions.setContent({ kind: "browser", url })} />
        )}
        {session && !session.alive && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
            <div className="glass pointer-events-auto flex items-center gap-3 rounded-menu px-3 py-1.5 text-small text-ink">
              <span>{session.exit_code ? `Exited with code ${session.exit_code}` : "Process exited"}</span>
              <button type="button" className="text-accent" onClick={() => client.req({ m: "session_restart", p: { id: session.id } }).catch(() => {})}>
                Restart
              </button>
            </div>
          </div>
        )}
      </div>
      {phone && sid && session?.alive && <KeyBar sid={sid} />}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || "Browser";
  } catch {
    return "Browser";
  }
}

// Keys a phone keyboard lacks, for answering agent prompts (menus, approvals, interrupts).
const KEYS: [string, string][] = [
  ["Esc", "\x1b"],
  ["Tab", "\t"],
  ["⇧Tab", "\x1b[Z"],
  ["↑", "\x1b[A"],
  ["↓", "\x1b[B"],
  ["←", "\x1b[D"],
  ["→", "\x1b[C"],
  ["^C", "\x03"],
  ["Enter", "\r"],
];

function KeyBar({ sid }: { sid: string }) {
  const client = useClient();
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-line px-2 py-1.5">
      {KEYS.map(([label, seq]) => (
        <button
          key={label}
          type="button"
          // Keep the terminal (and the on-screen keyboard) focused.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => client.write(sid, seq)}
          className="h-8 min-w-10 shrink-0 rounded-xs bg-fill-2 px-2.5 font-mono text-meta text-ink active:bg-fill-4"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
