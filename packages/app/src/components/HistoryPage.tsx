import type { HistoryEntry, Workspace } from "@neuralagent/protocol";
import { Button, Empty, List, Page, Row, SearchField, Spinner, toast } from "@neuralagent/ui";
import { History, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useClient, useDaemon, useUi } from "../lib/store";
import { GlyphTile } from "./AgentGlyph";
import { ago } from "../lib/time";

/** Past Claude Code and Codex conversations on this computer, searchable and resumable. */
export function HistoryPage() {
  const client = useClient();
  const home = useDaemon((c) => c.host?.home);
  const workspaces = useDaemon((c) => c.state?.workspaces ?? []);
  const setWorkspace = useUi((u) => u.setWorkspace);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HistoryEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Wait for a pause in typing; the daemon answers in milliseconds once its index is warm.
    const t = setTimeout(() => {
      client
        .req({ m: "history_search", p: { query, limit: 80 } })
        .then((r) => live && setHits(r as HistoryEntry[]))
        .catch((e) => live && (setHits([]), toast((e as Error).message, { tone: "danger" })));
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [client, query]);

  const resume = async (h: HistoryEntry) => {
    setBusy(h.id);
    try {
      // The workspace whose folder holds the conversation's folder, or a new one for it.
      const inside = (w: Workspace) => h.cwd === w.path || h.cwd.startsWith(`${w.path.replace(/[\\/]$/, "")}/`) || h.cwd.startsWith(`${w.path}\\`);
      const ws = [...workspaces].filter(inside).sort((a, b) => b.path.length - a.path.length)[0] ?? ((await client.req({ m: "workspace_add", p: { path: h.cwd } })) as Workspace);
      await client.req({ m: "session_start", p: { workspace_id: ws.id, profile_id: h.engine, resume: h.id, cwd: h.cwd } });
      setWorkspace(ws.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const short = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

  return (
    <Page title="History" eyebrow="Conversations">
      <div className="flex flex-col gap-4 pb-8">
        <SearchField value={query} onChange={setQuery} placeholder="Search what you asked, titles and folders" autoFocus />
        {hits === null ? (
          <div className="grid place-items-center py-16">
            <Spinner label="Reading past conversations" />
          </div>
        ) : hits.length === 0 ? (
          <Empty
            Icon={History}
            title={query ? "Nothing found" : "No conversations yet"}
            detail={query ? "Try fewer or other words." : "Claude Code and Codex conversations on this computer show up here."}
          />
        ) : (
          <List footer="From the CLIs' own history on this computer. Only what you typed is searched.">
            {hits.map((h) => (
              <Row
                key={`${h.engine}:${h.id}`}
                leading={<GlyphTile engine={h.engine} />}
                title={h.title}
                detail={h.snippet ?? short(h.cwd)}
                value={`${ago(h.updated_at)} · ${h.prompts} ${h.prompts === 1 ? "prompt" : "prompts"}`}
                trailing={
                  <Button size="xs" variant="ghost" Icon={Play} busy={busy === h.id} onClick={() => void resume(h)}>
                    Resume
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </div>
    </Page>
  );
}

