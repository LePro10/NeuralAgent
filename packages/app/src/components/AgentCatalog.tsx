import type { CatalogEntry, Profile, Session } from "@neuralagent/protocol";
import { Button, Callout, IconButton, List, Row, Sheet, toast } from "@neuralagent/ui";
import { ExternalLink, Plus, RotateCw } from "lucide-react";
import { useState } from "react";
import { joinArgs } from "../lib/profiles";
import { useCatalogSheet, useClient, useDaemon, usePlatform, useUi } from "../lib/store";
import { EngineTile } from "./EngineTile";
import { ProfileEditor } from "./ProfileEditor";

/** Every known agent CLI: what is installed, and a one-click install that runs visibly in a pane. */
export function AgentCatalog() {
  const client = useClient();
  const platform = usePlatform();
  const { open, setOpen } = useCatalogSheet();
  const catalog = useDaemon((c) => c.state?.catalog);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const profiles = useDaemon((c) => c.state?.profiles);
  /** `null` while listing; "new" or a profile while the editor is shown. */
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const custom = (profiles ?? []).filter((p) => !p.builtin);
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

  const installed = (catalog ?? []).filter((a) => a.installed);
  const available = (catalog ?? []).filter((a) => !a.installed);

  return (
    <Sheet
      open={open}
      onClose={() => {
        setOpen(false);
        setEditing(null);
      }}
      title={editing === "new" ? "New profile" : editing ? editing.name : "Agents"}
      size="lg"
      action={
        !editing && (
          <Button size="sm" variant="quiet" Icon={RotateCw} busy={refreshing} onClick={refresh}>
            Refresh
          </Button>
        )
      }
    >
      {editing ? (
        <ProfileEditor key={editing === "new" ? "new" : editing.id} profile={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="flex flex-col gap-7 pb-4">
          {!target && <Callout tone="warning">Add a workspace first: installs run in one of its panes.</Callout>}
          {installed.length > 0 && (
            <List label="Installed">
              {installed.map((a) => (
                <Row
                  key={a.id}
                  leading={<EngineTile engine={a.id} />}
                  title={a.name}
                  detail={<span className="block truncate font-mono">{a.path}</span>}
                  value={a.version ?? undefined}
                  chevron={false}
                  trailing={
                    platform.openExternal && (
                      <IconButton size="sm" variant="ghost" label={`${a.name} docs`} onClick={() => platform.openExternal?.(a.docs_url)}>
                        <ExternalLink />
                      </IconButton>
                    )
                  }
                />
              ))}
            </List>
          )}
          {available.length > 0 && (
            <List label="Available" footer={target ? `Installs run in a pane of ${target.name}, so you can see and answer every step.` : undefined}>
              {available.map((a) => (
                <Row
                  key={a.id}
                  leading={<EngineTile engine={a.id} />}
                  title={a.name}
                  detail={<span className="block truncate">{a.install_note ?? <span className="font-mono">{a.install}</span>}</span>}
                  chevron={false}
                  trailing={
                    <span className="flex items-center gap-1">
                      {platform.openExternal && (
                        <IconButton size="sm" variant="ghost" label={`${a.name} docs`} onClick={() => platform.openExternal?.(a.docs_url)}>
                          <ExternalLink />
                        </IconButton>
                      )}
                      {a.install && (
                        <Button size="sm" variant="tint" disabled={!target} onClick={() => install(a)}>
                          Install
                        </Button>
                      )}
                    </span>
                  }
                />
              ))}
            </List>
          )}
          <List label="Profiles" footer="A profile starts a CLI with your own arguments, for example another model.">
            {custom.map((p) => (
              <Row
                key={p.id}
                leading={<EngineTile engine={p.engine} />}
                title={p.name}
                detail={<span className="block truncate font-mono">{[p.command, joinArgs(p.args)].filter(Boolean).join(" ")}</span>}
                onClick={() => setEditing(p)}
              />
            ))}
            <Row Icon={Plus} tile="blue" title="New profile" onClick={() => setEditing("new")} />
          </List>
        </div>
      )}
    </Sheet>
  );
}
