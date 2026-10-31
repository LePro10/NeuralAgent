import type { HistoryEntry, Session, Workspace } from "@neuralagent/protocol";
import { ConfirmSheet, Empty, List, Page, SearchField, SkeletonList, Spinner, cn, toast, useLayoutMode } from "@neuralagent/ui";
import { History, Play, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { byDay, plainText, shortAgo, useNow } from "../lib/agentui";
import { phoneRouter } from "../lib/phoneRoute";
import { useClient, useDaemon, useUi } from "../lib/store";
import { EngineTile } from "./EngineTile";
import { Glow } from "./Glow";

/** The workspace whose folder holds `cwd` (the deepest one). */
const holder = (workspaces: Workspace[], cwd: string) => {
  const inside = (w: Workspace) => cwd === w.path || cwd.startsWith(`${w.path.replace(/[\\/]$/, "")}/`) || cwd.startsWith(`${w.path}\\`);
  return [...workspaces].filter(inside).sort((a, b) => b.path.length - a.path.length)[0];
};

/**
 * Past Claude Code and Codex conversations on this computer, searchable; tap one to resume it.
 * Phones ask first (a tap while scrolling must not start an agent) and then open the new agent;
 * `project` narrows the list to one workspace's folder (the project page's "Past conversations").
 */
export function HistoryPage({ project }: { project?: string } = {}) {
  const client = useClient();
  const home = useDaemon((c) => c.host?.home);
  const workspaces = useDaemon((c) => c.state?.workspaces ?? []);
  const setWorkspace = useUi((u) => u.setWorkspace);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HistoryEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<HistoryEntry | null>(null);
  const phone = useLayoutMode() === "phone";
  const scope = project ? workspaces.find((w) => w.id === project) : undefined;
  const now = useNow();

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
    if (busy) return;
    setBusy(h.id);
    try {
      // The workspace whose folder holds the conversation's folder, or a new one for it.
      const ws = holder(workspaces, h.cwd) ?? ((await client.req({ m: "workspace_add", p: { path: h.cwd } })) as Workspace);
      const s = (await client.req({ m: "session_start", p: { workspace_id: ws.id, profile_id: h.engine, resume: h.id, cwd: h.cwd } })) as Session;
      if (phone) phoneRouter().openAgent(s.id);
      else setWorkspace(ws.id);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const short = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const shown = useMemo(() => (scope ? (hits ?? []).filter((h) => holder([scope], h.cwd)) : (hits ?? [])), [hits, scope]);
  const days = useMemo(() => byDay(shown, (h) => h.updated_at, now), [shown, now]);

  return (
    <div className="relative h-full">
      {!phone && <Glow tint="history" />}
      <Page title={scope ? "Past conversations" : "History"} eyebrow={scope ? scope.name : "Conversations"} header={<SearchField value={query} onChange={setQuery} placeholder="Search prompts, titles, folders" />}>
        <div className="flex flex-col gap-7 pt-2 pb-8">
          {hits === null ? (
            <SkeletonList rows={6} label />
          ) : shown.length === 0 ? (
            <Empty
              Icon={query ? SearchX : History}
              title={query ? "Nothing found" : "No conversations yet"}
              detail={query ? "Try fewer or other words." : "Claude Code and Codex conversations on this computer show up here."}
            />
          ) : (
            <>
              {days.map((d) => (
                <List key={d.label} label={d.label}>
                  {d.items.map((h) => (
                    <HistoryRow key={`${h.engine}:${h.id}`} h={h} folder={short(h.cwd)} when={shortAgo(h.updated_at, now)} busy={busy === h.id} onResume={() => (phone ? setAsking(h) : void resume(h))} />
                  ))}
                </List>
              ))}
              <p className="px-4 text-footnote text-dim">From the CLIs’ own history on this computer. Only what you typed is searched. Tap a conversation to continue it.</p>
            </>
          )}
        </div>
      </Page>
      <ConfirmSheet
        open={!!asking}
        onClose={() => setAsking(null)}
        onConfirm={() => (asking ? resume(asking) : undefined)}
        title={asking?.title ?? ""}
        message={asking ? [asking.snippet ? plainText(asking.snippet) : "", `${short(asking.cwd)} · ${shortAgo(asking.updated_at, now)} · ${asking.prompts} ${asking.prompts === 1 ? "prompt" : "prompts"}`].filter(Boolean).join("\n\n") : undefined}
        confirmLabel="Continue this conversation"
        Icon={Play}
      />
    </div>
  );
}

function HistoryRow({ h, folder, when, busy, onResume }: { h: HistoryEntry; folder: string; when: string; busy: boolean; onResume: () => void }) {
  const snippet = h.snippet ? plainText(h.snippet) : "";
  return (
    <button
      type="button"
      data-lead=""
      onClick={onResume}
      aria-label={`Resume “${h.title}”`}
      className={cn("press-row flex w-full items-start gap-3 py-3 pr-3 pl-4 text-left hover:bg-fill-1", busy && "bg-fill-2")}
    >
      <EngineTile engine={h.engine} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 text-headline text-bright">{h.title}</span>
          <span className="shrink-0 text-footnote text-dim tabular">{when}</span>
        </span>
        {snippet && <span className="mt-0.5 line-clamp-2 block text-subhead text-ink">{snippet}</span>}
        <span className="mt-1 flex items-center gap-1.5 text-footnote text-faint">
          <span className="min-w-0 truncate">{folder}</span>
          <span className="shrink-0">
            · {h.prompts} {h.prompts === 1 ? "prompt" : "prompts"}
          </span>
        </span>
      </span>
      <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-fill-2 text-accent" aria-hidden="true">
        {busy ? <Spinner size={14} /> : <Play className="size-3.5 translate-x-px fill-current" />}
      </span>
    </button>
  );
}
