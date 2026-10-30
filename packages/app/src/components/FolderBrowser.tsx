import type { FsEntry, FsRoots } from "@neuralagent/protocol";
import { Button, Empty, Input, List, Row, Sheet, Spinner, toast } from "@neuralagent/ui";
import { ArrowUp, Clock, Folder, FolderGit2, FolderPlus, Home } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { useClient, useDaemon, usePlatform } from "../lib/store";

interface Listing {
  path: string;
  parent: string | null;
  git: boolean;
  entries: FsEntry[];
}

/** Opens the host folder browser; resolves with the chosen path, or null when closed. */
const useBrowser = create<{ resolve: ((p: string | null) => void) | null }>(() => ({ resolve: null }));

export function pickHostFolder(): Promise<string | null> {
  useBrowser.getState().resolve?.(null);
  return new Promise((resolve) => useBrowser.setState({ resolve }));
}

/**
 * Folder picker for clients without a native one (phones, browsers): browses the folders of the
 * host computer through the daemon. Remote clients see the host's home folder tree.
 */
export function FolderBrowserSheet() {
  const resolve = useBrowser((s) => s.resolve);
  const client = useClient();
  const platform = usePlatform();
  const workspaces = useDaemon((c) => c.state?.workspaces);
  const [roots, setRoots] = useState<FsRoots | null>(null);
  const [dir, setDir] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const open = resolve !== null;

  const go = (path: string) => {
    setLoading(true);
    setFilter("");
    client.req<Listing>({ m: "fs_list", p: { path } }).then(
      (l) => setDir(l),
      (e) => toast((e as Error).message, { tone: "danger" }),
    ).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setDir(null);
    client.req<FsRoots>({ m: "fs_roots" }).then(
      (r) => {
        setRoots(r);
        go(r.home);
      },
      (e) => toast((e as Error).message, { tone: "danger" }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client]);

  const close = (path: string | null) => {
    resolve?.(path);
    useBrowser.setState({ resolve: null });
  };

  const recent = useMemo(() => [...(workspaces ?? [])].sort((a, b) => b.created_at - a.created_at).slice(0, 4), [workspaces]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (dir?.entries ?? []).filter((e) => e.dir && (!q || e.name.toLowerCase().includes(q)));
  }, [dir, filter]);
  const isGit = !!dir?.git;

  const mkdir = async () => {
    if (!dir || !name.trim()) return;
    try {
      const made = await client.req<FsEntry>({ m: "fs_mkdir", p: { path: dir.path, name: name.trim() } });
      setCreating(false);
      setName("");
      go(made.path);
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => close(null)}
      title="Choose a folder"
      eyebrow="On the host computer"
      size="md"
      action={
        <Button size="sm" disabled={!dir} onClick={() => dir && close(dir.path)}>
          Choose
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        {roots && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="ghost" Icon={Home} onClick={() => go(roots.home)}>
              Home
            </Button>
            {recent.map((w) => (
              <Button key={w.id} size="xs" variant="ghost" Icon={Clock} onClick={() => go(w.path)}>
                {w.name}
              </Button>
            ))}
            {roots.projects.map((p) => (
              <Button key={p.path} size="xs" variant="ghost" Icon={p.git ? FolderGit2 : Folder} onClick={() => go(p.path)}>
                {p.name}
              </Button>
            ))}
          </div>
        )}
        <Input value={filter} onChange={(e) => setFilter(e.currentTarget.value)} placeholder="Search in this folder" aria-label="Search in this folder" />
        <List
          label={dir?.path ?? "…"}
          action={
            <Button size="xs" variant="quiet" Icon={FolderPlus} onClick={() => setCreating((v) => !v)}>
              New folder
            </Button>
          }
          footer={isGit ? "This folder is a git repository." : undefined}
        >
          {creating && (
            <div className="flex gap-2 p-3">
              <Input autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Folder name" className="flex-1" aria-label="New folder name" onKeyDown={(e) => e.key === "Enter" && void mkdir()} />
              <Button size="sm" disabled={!name.trim()} onClick={() => void mkdir()}>
                Create
              </Button>
            </div>
          )}
          {dir?.parent && (platform.kind === "desktop" || dir.path !== roots?.home) && <Row Icon={ArrowUp} title="Up" detail={dir.parent} onClick={() => go(dir.parent!)} />}
          {shown.map((e) => (
            <Row key={e.path} Icon={e.git ? FolderGit2 : Folder} title={e.name} detail={e.git ? "git repository" : undefined} onClick={() => go(e.path)} />
          ))}
        </List>
        {loading && <Spinner label="Loading" />}
        {!loading && dir && shown.length === 0 && <Empty Icon={Folder} title={filter ? "No match" : "No subfolders"} detail="Choose this folder, or create a new one." />}
      </div>
    </Sheet>
  );
}
