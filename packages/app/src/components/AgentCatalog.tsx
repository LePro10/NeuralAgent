import type { CatalogEntry, Session } from "@neuralagent/protocol";
import { Button, Callout, List, Pill, Row, Sheet, toast } from "@neuralagent/ui";
import { ExternalLink, RotateCw } from "lucide-react";
import { useState } from "react";
import { useCatalogSheet, useClient, useDaemon, usePlatform, useUi } from "../lib/store";
import { GlyphTile } from "./AgentGlyph";

/** Every known agent CLI: what is installed, and a one-click install that runs visibly in a pane. */
export function AgentCatalog() {
  const client = useClient();
  const platform = usePlatform();
  const { open, setOpen } = useCatalogSheet();
  const catalog = useDaemon((c) => c.state?.catalog);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const { workspace, setWorkspace } = useUi();
  const [refreshing, setRefreshing] = useState(false);
  const target = workspaces?.find((w) => w.id === workspace) ?? workspaces?.[0];

  const refresh = async () => {
    setRefreshing(true);
    try {
      await client.req({ m: "catalog_refresh" });
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setRefreshing(false);
    }
  };

  const install = async (a: CatalogEntry) => {
    if (!target) return;
    try {
      await client.req<Session>({ m: "session_start", p: { workspace_id: target.id, profile_id: `install:${a.id}` } });
      setWorkspace(target.id);
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  const sorted = [...(catalog ?? [])].sort((a, b) => Number(b.installed) - Number(a.installed));

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Agents"
      size="lg"
      action={
        <Button size="sm" variant="quiet" Icon={RotateCw} busy={refreshing} onClick={refresh}>
          Refresh
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        {!target && <Callout tone="warning">Add a workspace first: installs run in one of its panes.</Callout>}
        <List footer={target ? `Installs run in a pane of ${target.name}, so you can see and answer every step.` : undefined}>
          {sorted.map((a) => (
            <Row
              key={a.id}
              leading={<GlyphTile engine={a.id} />}
              title={
                <span className="flex items-center gap-2">
                  {a.name}
                  {a.installed && (
                    <Pill size="sm" tone="success">
                      {a.version ?? "Installed"}
                    </Pill>
                  )}
                </span>
              }
              detail={
                a.installed ? (
                  <span className="font-mono">{a.path}</span>
                ) : (
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono break-all text-faint">{a.install}</span>
                    {a.install_note && <span>{a.install_note}</span>}
                  </span>
                )
              }
              wrap
              trailing={
                <span className="flex items-center gap-1">
                  {platform.openExternal && (
                    <Button size="xs" variant="quiet" Icon={ExternalLink} onClick={() => platform.openExternal?.(a.docs_url)} aria-label={`${a.name} docs`}>
                      Docs
                    </Button>
                  )}
                  {!a.installed && a.install && (
                    <Button size="xs" variant="ghost" disabled={!target} onClick={() => install(a)}>
                      Install
                    </Button>
                  )}
                </span>
              }
            />
          ))}
        </List>
      </div>
    </Sheet>
  );
}
