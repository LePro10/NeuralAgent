// Settings → Agents (every known agent CLI: installed, or one-click install that runs visibly in a
// pane) and Settings → Profiles (your own launch profiles). They were one sheet before (D71); now
// they are Settings pages like the others, and the profile editor is a detail page.
import type { CatalogEntry, Profile, Session } from "@neuralagent/protocol";
import { Button, Callout, Empty, IconButton, List, Row, toast, useLayoutMode } from "@neuralagent/ui";
import { ExternalLink, Plus, RotateCw, UserCog } from "lucide-react";
import { useState } from "react";
import { phoneRouter } from "../../lib/phoneRoute";
import { joinArgs } from "../../lib/profiles";
import { useClient, useDaemon, usePlatform, useUi } from "../../lib/store";
import { EngineTile } from "../EngineTile";
import { ProfileEditor } from "../ProfileEditor";
import { useSettingsNav } from "./nav";

/** The workspace an install runs in: the one Settings → Agents was opened from, else the first. */
let installTarget: string | null = null;
export function rememberInstallTarget(workspaceId: string | null) {
  installTarget = workspaceId;
}

export function AgentsPanel() {
  const client = useClient();
  const platform = usePlatform();
  const catalog = useDaemon((c) => c.state?.catalog);
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const setWorkspace = useUi((u) => u.setWorkspace);
  const phone = useLayoutMode() === "phone";
  const [refreshing, setRefreshing] = useState(false);
  const target = workspaces?.find((w) => w.id === installTarget) ?? workspaces?.[0];

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
      const s = await client.req<Session>({ m: "session_start", p: { workspace_id: target.id, profile_id: `install:${a.id}` } });
      // The installer runs visibly: phones open its screen, desktop its workspace.
      if (phone) phoneRouter().openAgent(s.id);
      else setWorkspace(target.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  const installed = (catalog ?? []).filter((a) => a.installed);
  const available = (catalog ?? []).filter((a) => !a.installed);
  const docs = (a: CatalogEntry) =>
    platform.openExternal && (
      <IconButton size="sm" variant="ghost" label={`${a.name} docs`} onClick={() => platform.openExternal?.(a.docs_url)}>
        <ExternalLink />
      </IconButton>
    );

  return (
    <div className="flex flex-col gap-7">
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
              trailing={docs(a)}
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
                  {docs(a)}
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
      <List footer="Looks again for CLIs you installed outside NeuralAgent.">
        <Row Icon={RotateCw} title={refreshing ? "Looking…" : "Look for agents again"} chevron={false} onClick={refreshing ? undefined : () => void refresh()} />
      </List>
    </div>
  );
}

/** The editor as a detail page: new (`profile === null`) or an existing custom profile. */
export function profileDetail(profile: Profile | null, back: () => void) {
  return { title: profile ? profile.name : "New profile", node: <ProfileEditor key={profile?.id ?? "new"} profile={profile} onDone={back} /> };
}

/** The key a profile's detail page has (phones: `#/settings/profiles/<key>`). */
export const profileKey = (p: Profile | null) => (p ? `p-${p.id}` : "new");

export function ProfilesPanel() {
  const nav = useSettingsNav();
  const profiles = useDaemon((c) => c.state?.profiles);
  const custom = (profiles ?? []).filter((p) => !p.builtin);
  const open = (p: Profile | null) => {
    const d = profileDetail(p, nav.back);
    nav.push(profileKey(p), d.title, d.node);
  };
  return (
    <div className="flex flex-col gap-7">
      {custom.length === 0 ? (
        <Empty
          Icon={UserCog}
          title="No profiles yet"
          detail="A profile starts an agent CLI with your own arguments, for example Claude with another model."
          action={
            <Button variant="accent" Icon={Plus} onClick={() => open(null)} className="rounded-full">
              New profile
            </Button>
          }
        />
      ) : (
        <>
          <List label="Your profiles" footer="A profile starts a CLI with your own arguments, for example another model.">
            {custom.map((p) => (
              <Row
                key={p.id}
                leading={<EngineTile engine={p.engine} />}
                title={p.name}
                detail={<span className="block truncate font-mono">{[p.command, joinArgs(p.args)].filter(Boolean).join(" ")}</span>}
                onClick={() => open(p)}
              />
            ))}
          </List>
          <List>
            <Row Icon={Plus} title="New profile" onClick={() => open(null)} />
          </List>
        </>
      )}
    </div>
  );
}
