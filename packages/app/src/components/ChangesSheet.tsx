import type { GitChanges, GitDiff, GitFile, GitFileStatus } from "@neuralagent/protocol";
import { Button, Callout, ConfirmSheet, Empty, IconTile, Sheet, Spinner, cn, toast, useLayoutMode } from "@neuralagent/ui";
import { GitBranch, GitMerge, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useChanges, useClient, useDaemon } from "../lib/store";

const LETTER: Record<GitFileStatus, { l: string; cls: string; label: string }> = {
  modified: { l: "M", cls: "text-warning", label: "Modified" },
  added: { l: "A", cls: "text-mint", label: "Added" },
  untracked: { l: "U", cls: "text-mint", label: "New file" },
  deleted: { l: "D", cls: "text-danger", label: "Deleted" },
  renamed: { l: "R", cls: "text-live", label: "Renamed" },
  conflicted: { l: "!", cls: "text-danger", label: "Conflict" },
};

/** What changed in a workspace, or in one agent's worktree, with merge / discard for the latter. */
export function ChangesSheet() {
  const { target, close } = useChanges();
  const client = useClient();
  const session = useDaemon((c) => (target?.sessionId ? c.state?.sessions[target.sessionId] : undefined));
  const workspace = useDaemon((c) => c.state?.workspaces.find((w) => w.id === target?.workspaceId));
  const [changes, setChanges] = useState<GitChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const p = target ? { workspace_id: target.workspaceId, ...(target.sessionId ? { session_id: target.sessionId } : {}) } : null;
  const key = p ? `${p.workspace_id}/${target?.sessionId ?? ""}` : "";

  const load = useCallback(async () => {
    if (!p) return;
    setError(null);
    try {
      const c = (await client.req({ m: "git_changes", p })) as GitChanges;
      setChanges(c);
      setFile((f) => (f && c.files.some((x) => x.path === f) ? f : (c.files[0]?.path ?? null)));
    } catch (e) {
      setError((e as Error).message);
      setChanges(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  useEffect(() => {
    setChanges(null);
    setFile(null);
    setDiff(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!p || !file) return setDiff(null);
    let stale = false;
    client
      .req({ m: "git_diff", p: { ...p, path: file } })
      .then((d) => !stale && setDiff(d as GitDiff))
      .catch((e) => !stale && setDiff({ text: (e as Error).message, truncated: false }));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, file, changes]);

  const wt = session?.worktree;
  const phone = useLayoutMode() === "phone";
  const [asking, setAsking] = useState(false);
  const adds = changes?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
  const dels = changes?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;
  const merge = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const msg = (await client.req({ m: "worktree_merge", p: { session_id: session.id } })) as string;
      toast(msg);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!session) return;
    await client.req({ m: "worktree_discard", p: { session_id: session.id } }).catch((e) => toast((e as Error).message, { tone: "danger" }));
    close();
  };

  const title = wt ? `${session?.title ?? "Agent"} · changes` : `${workspace?.name ?? "Workspace"} · changes`;
  return (
    <Sheet
      open={!!target}
      onClose={close}
      title={title}
      size="lg"
      action={
        <Button size="sm" variant="quiet" Icon={RotateCw} onClick={() => void load()}>
          Refresh
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-4">
        {changes && (
          <div className="surface flex items-center gap-3 rounded-list p-4">
            <IconTile color={wt ? "purple" : "gray"} className="size-11 rounded-tile">
              <GitBranch />
            </IconTile>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-headline text-bright">{wt ? wt.branch : changes.branch}</span>
              <span className="truncate text-footnote text-dim">
                {wt
                  ? `From ${workspace?.git?.branch ?? "the workspace"} at ${wt.base.slice(0, 7)}`
                  : changes.ahead > 0 || changes.behind > 0
                    ? `${changes.ahead} ahead · ${changes.behind} behind`
                    : "Nothing to push or pull"}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end font-mono text-footnote tabular-nums">
              <span className="text-ink">{changes.files.length === 1 ? "1 file" : `${changes.files.length} files`}</span>
              <span>
                <span className="text-mint">+{adds}</span> <span className="text-danger">−{dels}</span>
              </span>
            </div>
          </div>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        {wt && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button variant="primary" size="lg" Icon={GitMerge} busy={busy} onClick={merge} className="flex-1">
                Merge into {workspace?.git?.branch ?? "workspace"}
              </Button>
              <Button variant="danger" size="lg" Icon={Trash2} onClick={() => setAsking(true)} aria-label="Discard worktree">
                {phone ? undefined : "Discard"}
              </Button>
            </div>
            <p className="px-1 text-footnote text-dim">Merging commits the agent's work, merges it and closes the agent.</p>
          </div>
        )}
        {!changes && !error && (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        )}
        {changes && changes.files.length === 0 && <Empty bare Icon={GitBranch} title="No changes" detail={wt ? "The agent has not changed anything yet." : "The working tree is clean."} />}
        {changes && changes.files.length > 0 && (
          <div className="flex flex-col gap-4">
            <ul className="surface flex max-h-80 flex-col overflow-auto rounded-list py-1">
              {changes.files.map((f) => (
                <FileRow key={f.path} f={f} selected={f.path === file} onSelect={() => setFile(f.path)} />
              ))}
            </ul>
            {diff ? <DiffView diff={diff} /> : file && <Spinner />}
          </div>
        )}
      </div>
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={discard}
        title="Discard this worktree?"
        message={`Everything ${session?.title ?? "the agent"} changed on ${wt?.branch ?? "its branch"} is deleted and the agent closes.`}
        confirmLabel="Discard"
        destructive
        Icon={Trash2}
      />
    </Sheet>
  );
}

function FileRow({ f, selected, onSelect }: { f: GitFile; selected: boolean; onSelect: () => void }) {
  const s = LETTER[f.status];
  const slash = f.path.lastIndexOf("/");
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn("press-row flex min-h-12 w-full items-center gap-3 px-3 py-1.5 text-left transition-colors", selected ? "bg-fill-3" : "hover:bg-fill-2")}
      >
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-item bg-fill-2 font-mono text-footnote", s.cls)} title={s.label} aria-label={s.label}>
          {s.l}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-subhead", selected ? "text-bright" : "text-ink")}>
            {f.path.slice(slash + 1)}
            {f.from && <span className="text-faint"> ← {f.from}</span>}
          </span>
          {slash >= 0 && <span className="truncate text-caption text-dim">{f.path.slice(0, slash)}</span>}
        </span>
        <span className="shrink-0 font-mono text-footnote tabular-nums">
          {f.additions > 0 && <span className="text-mint">+{f.additions}</span>}
          {f.deletions > 0 && <span className="ml-1.5 text-danger">−{f.deletions}</span>}
        </span>
      </button>
    </li>
  );
}

function DiffView({ diff }: { diff: GitDiff }) {
  const lines = diff.text.split("\n");
  if (!diff.text.trim()) return <p className="px-1 text-subhead text-dim">No text changes (binary file or mode change).</p>;
  return (
    <div className="surface overflow-auto rounded-list py-2.5 font-mono text-footnote leading-relaxed">
      {lines.map((l, i) => {
        // The file header lines repeat what the list shows.
        if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l)) return null;
        const cls = l.startsWith("@@")
          ? "text-live mt-2 first:mt-0"
          : l.startsWith("+")
            ? "bg-mint/10 text-mint"
            : l.startsWith("-")
              ? "bg-danger/10 text-danger"
              : "text-dim";
        return (
          <div key={i} className={cn("px-3 whitespace-pre", cls)}>
            {l || " "}
          </div>
        );
      })}
      {diff.truncated && <p className="px-3 pt-2 text-faint">The diff is too long to show completely.</p>}
    </div>
  );
}
