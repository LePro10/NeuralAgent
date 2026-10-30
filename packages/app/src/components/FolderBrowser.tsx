import type { FsEntry, FsRoots } from "@neuralagent/protocol";
import { Button, Empty, Input, List, Row, SearchField, Sheet, Spinner, cn, toast } from "@neuralagent/ui";
import { ArrowUp, ChevronRight, Clock, Folder, FolderGit2, FolderPlus, Home } from "lucide-react";
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

  // Breadcrumbs from the home folder down ("Home › code › app"), or from the root outside it.
  const crumbs = useMemo(() => {
    if (!dir || !roots) return [];
    const home = roots.home.replace(/\/$/, "");
    const inHome = dir.path === home || dir.path.startsWith(`${home}/`);
    const base = inHome ? home : "";
    const rest = dir.path.slice(base.length).split("/").filter(Boolean);
    const out = [{ name: inHome ? "Home" : "/", path: inHome ? home : "/" }];
    let cur = base;
    for (const part of rest) {
      cur = `${cur}/${part}`;
      out.push({ name: part, path: cur });
    }
    return out;
  }, [dir, roots]);
  const here = crumbs.at(-1)?.name ?? "this folder";

  const chip = "pressable flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-subhead text-ink";
  return (
    <Sheet
      open={open}
      onClose={() => close(null)}
      title="Choose a folder"
      eyebrow="On the host computer"
      size="lg"
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!dir} onClick={() => dir && close(dir.path)}>
          {dir ? `Use “${here}”` : "Choose"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        {roots && (
          <div className="scroll-x -mx-4 flex gap-2 px-4" data-no-swipe>
            <button type="button" className={chip} onClick={() => go(roots.home)}>
              <Home className="size-4 text-dim" strokeWidth={1.8} aria-hidden />
              Home
            </button>
            {recent.map((w) => (
              <button key={w.id} type="button" className={chip} onClick={() => go(w.path)}>
                <Clock className="size-4 text-dim" strokeWidth={1.8} aria-hidden />
                {w.name}
              </button>
            ))}
            {roots.projects.map((p) => (
              <button key={p.path} type="button" className={chip} onClick={() => go(p.path)}>
                {p.git ? <FolderGit2 className="size-4 text-dim" strokeWidth={1.8} aria-hidden /> : <Folder className="size-4 text-dim" strokeWidth={1.8} aria-hidden />}
                {p.name}
              </button>
            ))}
          </div>
        )}
        <SearchField value={filter} onChange={setFilter} placeholder={`Search in ${here}`} />
        {crumbs.length > 0 && (
          <nav aria-label="Path" className="scroll-x -mx-4 flex items-center gap-0.5 px-4" data-no-swipe>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <span key={c.path} className="flex shrink-0 items-center gap-0.5">
                  {i > 0 && <ChevronRight className="size-3.5 text-faint" aria-hidden />}
                  <button
                    type="button"
                    disabled={last}
                    aria-current={last ? "location" : undefined}
                    onClick={() => go(c.path)}
                    className={cn("pressable h-8 max-w-48 truncate rounded-full px-2 text-subhead", last ? "text-bright" : "text-accent")}
                  >
                    {c.name}
                  </button>
                </span>
              );
            })}
          </nav>
        )}
        <List
          action={
            <Button size="sm" variant="quiet" Icon={FolderPlus} onClick={() => setCreating((v) => !v)}>
              New folder
            </Button>
          }
          label={isGit ? "Git repository" : "Folders"}
        >
          {creating && (
            <div className="flex gap-2 px-4 py-3">
              <Input autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Folder name" className="flex-1" aria-label="New folder name" onKeyDown={(e) => e.key === "Enter" && void mkdir()} />
              <Button variant="primary" disabled={!name.trim()} onClick={() => void mkdir()}>
                Create
              </Button>
            </div>
          )}
          {dir?.parent && (platform.kind === "desktop" || dir.path !== roots?.home) && <Row Icon={ArrowUp} tile="gray" title="Up one level" onClick={() => go(dir.parent!)} />}
          {shown.map((e) => (
            <Row key={e.path} Icon={e.git ? FolderGit2 : Folder} tile={e.git ? "orange" : "blue"} title={e.name} value={e.git ? "git" : undefined} onClick={() => go(e.path)} />
          ))}
        </List>
        {loading && <Spinner label="Loading" />}
        {!loading && dir && shown.length === 0 && <Empty Icon={Folder} title={filter ? "No match" : "No subfolders"} detail="Use this folder, or create a new one." />}
      </div>
    </Sheet>
  );
}
