import type { GitChanges, GitDiff, GitFile, GitFileStatus } from "@neuralagent/protocol";
import { Button, Callout, ConfirmButton, Empty, Sheet, Spinner, cn, toast } from "@neuralagent/ui";
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
      <div className="flex flex-col gap-4 pb-4">
        {changes && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-dim">
            <span className="flex items-center gap-1.5 text-ink">
              <GitBranch size={13} strokeWidth={1.6} aria-hidden />
              {wt ? wt.branch : changes.branch}
            </span>
            {wt && <span>from {workspace?.git?.branch ?? "the workspace"} at {wt.base.slice(0, 7)}</span>}
            {!wt && (changes.ahead > 0 || changes.behind > 0) && (
              <span>
                {changes.ahead} ahead · {changes.behind} behind
              </span>
            )}
            <span>{changes.files.length === 1 ? "1 file changed" : `${changes.files.length} files changed`}</span>
          </div>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        {wt && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" Icon={GitMerge} busy={busy} onClick={merge}>
              Merge into {workspace?.git?.branch ?? "workspace"}
            </Button>
            <ConfirmButton size="sm" label="Discard worktree" confirmLabel="Click again to discard" Icon={Trash2} onConfirm={discard} />
            <span className="text-meta text-faint">Merging commits the agent's work, merges it and closes the agent.</span>
          </div>
        )}
        {!changes && !error && (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        )}
        {changes && changes.files.length === 0 && <Empty bare Icon={GitBranch} title="No changes" detail={wt ? "The agent has not changed anything yet." : "The working tree is clean."} />}
        {changes && changes.files.length > 0 && (
          <div className="flex flex-col gap-3">
            <ul className="flex max-h-56 flex-col overflow-auto rounded-field bg-fill-1 py-1">
              {changes.files.map((f) => (
                <FileRow key={f.path} f={f} selected={f.path === file} onSelect={() => setFile(f.path)} />
              ))}
            </ul>
            {diff ? <DiffView diff={diff} /> : file && <Spinner />}
          </div>
        )}
      </div>
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
        className={cn("flex w-full items-center gap-2.5 px-3 py-1 text-left text-small transition-colors", selected ? "bg-fill-2 text-bright" : "text-ink hover:bg-fill-2")}
      >
        <span className={cn("w-3 shrink-0 text-center font-mono text-meta", s.cls)} title={s.label}>
          {s.l}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {slash >= 0 && <span className="text-dim">{f.path.slice(0, slash + 1)}</span>}
          {f.path.slice(slash + 1)}
          {f.from && <span className="text-faint"> ← {f.from}</span>}
        </span>
        <span className="shrink-0 font-mono text-meta">
          {f.additions > 0 && <span className="text-mint">+{f.additions}</span>}
          {f.deletions > 0 && <span className="ml-1.5 text-danger">−{f.deletions}</span>}
        </span>
      </button>
    </li>
  );
}

function DiffView({ diff }: { diff: GitDiff }) {
  const lines = diff.text.split("\n");
  if (!diff.text.trim()) return <p className="text-small text-dim">No text changes (binary file or mode change).</p>;
  return (
    <div className="overflow-auto rounded-field bg-fill-1 py-2 font-mono text-meta leading-relaxed">
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
