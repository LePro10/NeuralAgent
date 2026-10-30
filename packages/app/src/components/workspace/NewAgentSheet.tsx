// Phones: "+" in a workspace opens this sheet: every agent you can start as a big tile, the
// worktree switch, and a way to install more. Desktop keeps the "New agent" pull-down.
import type { Profile } from "@neuralagent/protocol";
import { List, Row, Sheet, Switch, cn, haptic, toast, useLayoutMode } from "@neuralagent/ui";
import { Download, GitBranch } from "lucide-react";
import { useState } from "react";
import { launchable } from "../../lib/profiles";
import { useCatalogSheet, useClient, useDaemon, useUi } from "../../lib/store";
import { useWorktreeStart } from "../../lib/worktree";
import { EngineTile } from "../EngineTile";

export function NewAgentSheet({ open, onClose, workspaceId }: { open: boolean; onClose: () => void; workspaceId: string }) {
  const client = useClient();
  const profiles = useDaemon((c) => c.state?.profiles);
  const catalog = useDaemon((c) => c.state?.catalog);
  const workspace = useDaemon((c) => c.state?.workspaces.find((w) => w.id === workspaceId));
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const { worktrees, setWorktrees } = useUi();
  const worktree = useWorktreeStart(workspaceId);
  const [busy, setBusy] = useState<string | null>(null);
  const list = launchable(profiles, catalog);
  const phone = useLayoutMode() === "phone";

  const start = async (p: Profile) => {
    setBusy(p.id);
    haptic("select");
    try {
      await client.req({ m: "session_start", p: { workspace_id: workspaceId, profile_id: p.id, ...worktree(p.engine) } });
      onClose();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New agent" eyebrow={workspace?.name} size="md">
      <div className="flex flex-col gap-6 pb-2">
        <div className={cn("grid gap-2.5", phone ? "grid-cols-2" : "grid-cols-3")}>
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void start(p)}
              className={cn(
                "pressable surface flex min-h-28 flex-col items-start justify-between gap-3 rounded-list p-3.5 text-left transition-opacity",
                busy !== null && busy !== p.id && "opacity-50",
              )}
            >
              <EngineTile engine={p.engine} size="lg" />
              <span className="flex w-full min-w-0 flex-col">
                <span className="truncate text-headline text-bright">{busy === p.id ? "Starting…" : p.name}</span>
                <span className="truncate text-footnote text-dim">{p.engine === "shell" ? "Shell" : p.command}</span>
              </span>
            </button>
          ))}
        </div>
        <List footer={workspace?.git ? "Each agent works on its own branch in a separate folder; you review and merge its changes." : undefined}>
          {workspace?.git && (
            <Row
              Icon={GitBranch}
              tile="purple"
              title="Own worktree per agent"
              trailing={<Switch label="Own worktree per agent" checked={worktrees} onChange={setWorktrees} />}
            />
          )}
          <Row
            Icon={Download}
            tile="blue"
            title="Install more agents"
            onClick={() => {
              onClose();
              openCatalog(true);
            }}
          />
        </List>
      </div>
    </Sheet>
  );
}
