import { compact, money, totalTokens } from "../lib/format";
import type { Session } from "@neuralagent/protocol";
import { Button, Empty, IconButton, List, Page, Row, StatusDot, toast } from "@neuralagent/ui";
import { ArrowUpRight, Bot, Download, RotateCw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { panes } from "../lib/layout";
import { STATUS, since } from "../lib/status";
import { useCatalogSheet, useClient, useDaemon, useUi } from "../lib/store";
import { GlyphTile } from "./AgentGlyph";

const FIRST: Record<string, number> = { waiting: 0, error: 1, done: 2, working: 3, starting: 4, idle: 5, exited: 6 };

/** Every agent across all workspaces: what it is doing, its last words, and quick controls. */
export function AgentsDashboard() {
  const client = useClient();
  const state = useDaemon((c) => c.state);
  const setWorkspace = useUi((u) => u.setWorkspace);
  const openCatalog = useCatalogSheet((c) => c.setOpen);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => {
    // Agents only: plain terminals and installers live in their panes.
    const engine = (s: Session) => state?.profiles.find((p) => p.id === s.profile_id)?.engine ?? "shell";
    const all = Object.values(state?.sessions ?? {}).filter((s) => engine(s) !== "shell" && !s.profile_id.startsWith("install:"));
    return (state?.workspaces ?? [])
      .map((w) => ({
        w,
        sessions: all.filter((s) => s.workspace_id === w.id).sort((a, b) => FIRST[a.status] - FIRST[b.status] || b.status_since - a.status_since),
      }))
      .filter((g) => g.sessions.length > 0);
  }, [state?.sessions, state?.workspaces, state?.profiles]);

  const engineOf = (s: Session) => state?.profiles.find((p) => p.id === s.profile_id)?.engine ?? "shell";

  /** Switch to the session's workspace and bring its tab to the front. */
  const open = (s: Session) => {
    const layout = state?.layouts[s.workspace_id];
    const tab = layout?.tabs.find((t) => panes(t.root).some((p) => p.content.kind === "terminal" && p.content.session === s.id));
    if (layout && tab && layout.active_tab !== tab.id) {
      client.req({ m: "layout_set", p: { workspace_id: s.workspace_id, layout: { ...layout, active_tab: tab.id } } }).catch(() => {});
    }
    setWorkspace(s.workspace_id);
  };
  const act = (r: Parameters<typeof client.req>[0]) => client.req(r).catch((e) => toast((e as Error).message, { tone: "danger" }));

  return (
    <Page
      title="Agents"
      eyebrow="Overview"
      actions={
        <Button size="sm" variant="ghost" Icon={Download} onClick={() => openCatalog(true)}>
          Install agents
        </Button>
      }
    >
      {groups.length === 0 ? (
        <Empty Icon={Bot} title="No agents running" detail="Start one from an empty pane or with New agent in a workspace." />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ w, sessions }) => (
            <List key={w.id} label={w.name}>
              {sessions.map((s) => {
                const st = STATUS[s.status];
                const said = (s.last_message ?? s.last_line ?? s.prompt ?? "").split("\n")[0];
                return (
                  <Row
                    key={s.id}
                    leading={<GlyphTile engine={engineOf(s)} />}
                    title={
                      <span className="flex items-center gap-2">
                        <StatusDot tone={st.tone} pulse={st.pulse} size={6} label={st.label} />
                        <span className="truncate">{s.title}</span>
                      </span>
                    }
                    detail={
                      s.usage ? (
                        <>
                          {said && <span className="block truncate">{said}</span>}
                          <span className="block text-dim">
                            {[s.usage.cost_usd != null ? money(s.usage.cost_usd) : null, `${compact(totalTokens(s.usage.tokens))} tokens`].filter(Boolean).join(" · ")}
                          </span>
                        </>
                      ) : (
                        said || undefined
                      )
                    }
                    value={`${st.label} · ${since(s.status_since, now)}`}
                    trailing={
                      <span className="flex items-center gap-1">
                        {s.alive ? (
                          <IconButton size="sm" variant="ghost" label="Stop" onClick={() => act({ m: "session_stop", p: { id: s.id } })}>
                            <Square size={13} strokeWidth={1.6} />
                          </IconButton>
                        ) : (
                          <IconButton size="sm" variant="ghost" label="Restart" onClick={() => act({ m: "session_restart", p: { id: s.id } })}>
                            <RotateCw size={13} strokeWidth={1.6} />
                          </IconButton>
                        )}
                        <IconButton size="sm" variant="ghost" label="Open" onClick={() => open(s)}>
                          <ArrowUpRight size={14} strokeWidth={1.6} />
                        </IconButton>
                      </span>
                    }
                  />
                );
              })}
            </List>
          ))}
        </div>
      )}
    </Page>
  );
}
