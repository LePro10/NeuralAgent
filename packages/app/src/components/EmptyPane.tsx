import type { Profile } from "@neuralagent/protocol";
import { Callout } from "@neuralagent/ui";
import { useState } from "react";
import { launchable } from "../lib/profiles";
import { useCatalogSheet, useClient, useDaemon } from "../lib/store";
import { Download } from "lucide-react";
import { useWorktreeStart } from "../lib/worktree";
import { AgentGlyph } from "./AgentGlyph";

/** An empty pane is a launcher: pick what runs here. */
export function EmptyPane({ workspaceId, paneId, onFocus }: { workspaceId: string; paneId: string; onFocus: () => void }) {
  const client = useClient();
  const profiles = useDaemon((c) => c.state?.profiles);
  const catalog = useDaemon((c) => c.state?.catalog);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const worktree = useWorktreeStart(workspaceId);

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

  // Chips that wrap, so the launcher still fits a pane in a 4×4 grid; `m-auto` (not justify-center) keeps it scrollable.
  return (
    <div className="flex h-full w-full overflow-auto p-3" onMouseDown={onFocus}>
      <div className="m-auto flex max-w-96 flex-col items-center gap-3">
        <div className="flex flex-wrap justify-center gap-1.5">
          {launchable(profiles, catalog).map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy !== null}
              onClick={() => start(p)}
              className="hoverable flex h-8 items-center gap-2 rounded-field bg-fill-1 px-3 text-chip text-ink transition-colors disabled:opacity-50"
            >
              <AgentGlyph engine={p.engine} size={13} className="text-dim" />
              <span className="truncate">{busy === p.id ? "Starting…" : p.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => openCatalog(true)}
            className="hoverable flex h-8 items-center gap-2 rounded-field px-3 text-chip text-dim transition-colors hover:text-ink"
          >
            <Download size={13} strokeWidth={1.6} aria-hidden />
            Install agents…
          </button>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </div>
  );
}
