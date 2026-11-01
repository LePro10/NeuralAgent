// Files explorer (D67), desktop: a pane next to the agents. The folder on the left, the open file
// on the right; a narrow pane shows one at a time. Where it is (folder and file) lives in the
// layout (`PaneContent::Files`), so it comes back after a restart.
import type { FileListing } from "@neuralagent/protocol";
import { IconButton, cn } from "@neuralagent/ui";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDaemon } from "../../lib/store";
import { useFileActions } from "./actions";
import { FileViewer } from "./FileViewer";
import { Crumbs, FolderView, crumbsFor } from "./FolderView";
import { dirOf } from "./model";

const TWO_COLUMNS = 620;

export function FilesPane({
  workspaceId,
  path,
  file,
  onNavigate,
  onFocus,
}: {
  workspaceId: string;
  path: string;
  file?: string;
  onNavigate: (to: { path: string; file?: string }) => void;
  onFocus?: () => void;
}) {
  const ws = useDaemon((c) => c.state?.workspaces.find((w) => w.id === workspaceId));
  const actions = useFileActions({ workspaceId, phone: false });
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [folded, setFolded] = useState(false);
  const [listing, setListing] = useState<FileListing | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide((e?.contentRect.width ?? 0) >= TWO_COLUMNS));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const root = listing?.root ?? ws?.path ?? path;
  const crumbs = crumbsFor(listing, path, root, ws?.name ?? "Files");
  // Paths from the daemon are resolved (`/tmp` → `/private/tmp`); compare those.
  const here = listing?.path ?? path;
  const up = here !== root ? () => onNavigate({ path: dirOf(here) }) : undefined;
  const onListing = useCallback((l: FileListing | null) => setListing(l), []);
  const showFolder = wide ? !(folded && file) : !file;
  const showFile = !!file && (wide || !showFolder);

  return (
    <div ref={box} className="flex size-full min-h-0 flex-col bg-surface" onPointerDown={onFocus}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        {!wide && file ? (
          <IconButton label="Back to the folder" variant="ghost" size="sm" onClick={() => onNavigate({ path })}>
            <ArrowLeft size={15} />
          </IconButton>
        ) : (
          wide &&
          file && (
            <IconButton label={folded ? "Show the folder" : "Hide the folder"} variant="ghost" size="sm" onClick={() => setFolded(!folded)}>
              {folded ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </IconButton>
          )
        )}
        <Crumbs crumbs={crumbs} onGo={(p) => onNavigate({ path: p })} className="min-w-0 flex-1" />
      </div>
      <div className="flex min-h-0 flex-1">
        {showFolder && (
          <div className={cn("min-h-0 shrink-0", showFile ? "w-72 border-r border-line" : "flex-1")}>
            <FolderView
              path={path}
              phone={false}
              actions={actions}
              selected={file}
              onListing={onListing}
              onOpenFolder={(p) => onNavigate({ path: p })}
              onOpenFile={(e) => onNavigate({ path, file: e.path })}
              onUp={up}
            />
          </div>
        )}
        {showFile && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <FileViewer
              key={file}
              path={file!}
              phone={false}
              actions={actions}
              chrome={({ title, eyebrow, tools, body }) => (
                <>
                  <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-subhead text-bright">{title}</p>
                      <p className="truncate text-caption text-faint">{eyebrow}</p>
                    </div>
                    {tools}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">{body}</div>
                </>
              )}
            />
          </div>
        )}
      </div>
      {!file && actions.sheet}
    </div>
  );
}
