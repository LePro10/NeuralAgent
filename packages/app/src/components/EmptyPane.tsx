import type { Profile } from "@neuralagent/protocol";
import { Button, Callout, IconTile, cn, useLayoutMode } from "@neuralagent/ui";
import { useState } from "react";
import { launchable } from "../lib/profiles";
import { useCatalogSheet, useClient, useDaemon } from "../lib/store";
import { Download, Globe } from "lucide-react";
import { useWorktreeStart } from "../lib/worktree";
import { EngineTile } from "./EngineTile";

/** An empty pane is a launcher: pick what runs here. */
export function EmptyPane({ workspaceId, paneId, onFocus, onBrowser }: { workspaceId: string; paneId: string; onFocus: () => void; onBrowser: (url: string) => void }) {
  const client = useClient();
  const profiles = useDaemon((c) => c.state?.profiles);
  const catalog = useDaemon((c) => c.state?.catalog);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const worktree = useWorktreeStart(workspaceId);
  const phone = useLayoutMode() === "phone";
  // A dev server one of this workspace's agents started, else the usual default.
  const previewUrl = useDaemon((c) => Object.values(c.state?.sessions ?? {}).find((s) => s.workspace_id === workspaceId && s.alive && s.preview_url)?.preview_url);

  const start = async (p: Profile) => {
    setBusy(p.id);
    setError(null);
    try {
      await client.req({ m: "session_start", p: { workspace_id: workspaceId, profile_id: p.id, pane_id: paneId, ...worktree(p.engine) } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const list = launchable(profiles, catalog);
  const openBrowser = () => onBrowser(previewUrl ?? "http://localhost:3000/");

  // Phones: big agent tiles, two per row, like the "+" sheet.
  if (phone) {
    return (
      <div className="h-full w-full overflow-auto px-2 pt-4 pb-6" onMouseDown={onFocus}>
        <h2 className="px-2 text-title-3 text-bright">Start an agent</h2>
        <p className="mt-1 px-2 text-subhead text-dim">Pick what runs in this workspace.</p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy !== null}
              onClick={() => start(p)}
              className={cn(
                "pressable surface flex min-h-28 flex-col items-start justify-between gap-3 rounded-list p-3.5 text-left transition-opacity",
                busy !== null && busy !== p.id && "opacity-50",
              )}
            >
              <EngineTile engine={p.engine} size="lg" />
              <span className="flex w-full min-w-0 flex-col">
                <span className="truncate text-headline text-bright">{busy === p.id ? "Starting…" : p.name}</span>
                <span className="truncate text-footnote text-dim">{p.engine === "shell" ? "Terminal" : p.command}</span>
              </span>
            </button>
          ))}
          <button type="button" onClick={openBrowser} className="pressable surface flex min-h-28 flex-col items-start justify-between gap-3 rounded-list p-3.5 text-left">
            <IconTile color="blue" className="size-11 rounded-tile"><Globe /></IconTile>
            <span className="flex w-full min-w-0 flex-col">
              <span className="truncate text-headline text-bright">Preview</span>
              <span className="truncate text-footnote text-dim">{(previewUrl ?? "localhost:3000").replace(/^https?:\/\//, "")}</span>
            </span>
          </button>
        </div>
        <Button variant="quiet" size="md" Icon={Download} onClick={() => openCatalog(true)} className="mt-4 w-full">
          Install more agents
        </Button>
        {error && <Callout tone="danger" className="mt-3">{error}</Callout>}
      </div>
    );
  }

  // Desktop: chips that wrap, so the launcher still fits a pane in a 4×4 grid; `m-auto` (not justify-center) keeps it scrollable.
  return (
    <div className="flex h-full w-full overflow-auto p-3" onMouseDown={onFocus}>
      <div className="m-auto flex max-w-md flex-col items-center gap-3">
        <span className="text-footnote text-faint">Start here</span>
        <div className="flex flex-wrap justify-center gap-1.5">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy !== null}
              onClick={() => start(p)}
              className="hoverable flex h-9 items-center gap-2 rounded-full bg-fill-1 pr-3.5 pl-1.5 text-chip text-ink shadow-rim transition-colors hover:text-bright disabled:opacity-50"
            >
              <EngineTile engine={p.engine} className="!size-6 !rounded-full" />
              <span className="truncate">{busy === p.id ? "Starting…" : p.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={openBrowser}
            className="hoverable flex h-9 items-center gap-2 rounded-full bg-fill-1 pr-3.5 pl-1.5 text-chip text-ink shadow-rim transition-colors hover:text-bright"
          >
            <IconTile color="blue" className="!size-6 !rounded-full"><Globe /></IconTile>
            Preview
          </button>
          <button
            type="button"
            onClick={() => openCatalog(true)}
            className="hoverable flex h-9 items-center gap-2 rounded-full px-3 text-chip text-dim transition-colors hover:text-ink"
          >
            <Download size={14} strokeWidth={1.7} aria-hidden />
            Install agents…
          </button>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </div>
  );
}
