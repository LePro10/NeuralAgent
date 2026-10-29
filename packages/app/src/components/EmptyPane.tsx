import type { Profile } from "@neuralagent/protocol";
import { Callout } from "@neuralagent/ui";
import { useState } from "react";
import { useClient, useDaemon } from "../lib/store";
import { AgentGlyph } from "./AgentGlyph";

/** An empty pane is a launcher: pick what runs here. */
export function EmptyPane({ workspaceId, paneId, onFocus }: { workspaceId: string; paneId: string; onFocus: () => void }) {
  const client = useClient();
  const profiles = useDaemon((c) => c.state?.profiles);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const start = async (p: Profile) => {
    setBusy(p.id);
    setError(null);
    try {
      await client.req({ m: "session_start", p: { workspace_id: workspaceId, profile_id: p.id, pane_id: paneId } });
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
          {(profiles ?? []).map((p) => (
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
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </div>
  );
}
