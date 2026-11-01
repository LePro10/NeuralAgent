// Files explorer: one folder. A filter field (and a name search through everything below), sort
// and "hidden files" options, then the entries: folders first, git marks, size and date. Phones get
// finger-sized rows (long-press for actions); the desktop pane gets compact rows with arrow keys
// and a right-click menu.
import type { FileEntry, FileListing } from "@neuralagent/protocol";
import { ContextMenu, Empty, IconButton, List, Menu, type MenuEntry, Row, SearchField, SkeletonList, Spinner, type SysColor, cn, toast } from "@neuralagent/ui";
import { ArrowDownUp, ChevronRight, Eye, EyeOff, FolderX, Link2, RotateCw, SearchX, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useClient } from "../../lib/store";
import type { FileActions } from "./actions";
import { uploadInto } from "./api";
import { GitMark, iconOf } from "./FileIcon";
import { useFileSearch, useFolder } from "./hooks";
import { type Crumb, crumbsOf, dirOf, filterEntries, formatDate, formatSize, relPath, type SortKey, sortEntries } from "./model";
import { useFilePrefs } from "./prefs";

const INK: Record<SysColor, string> = {
  blue: "text-sys-blue",
  green: "text-sys-green",
  orange: "text-sys-orange",
  red: "text-sys-red",
  yellow: "text-sys-yellow",
  purple: "text-sys-purple",
  pink: "text-sys-pink",
  teal: "text-sys-teal",
  indigo: "text-sys-indigo",
  gray: "text-dim",
};

const ROWS = 400;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "date", label: "Date modified" },
  { key: "size", label: "Size" },
  { key: "kind", label: "Kind" },
];

/** "project › src › components": each part goes back up to that folder. */
export function Crumbs({ crumbs, onGo, className }: { crumbs: Crumb[]; onGo: (path: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [crumbs]);
  return (
    <nav ref={ref} aria-label="Folder path" className={cn("scroll-x flex min-w-0 items-center overflow-x-auto", className)}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.path} className="flex shrink-0 items-center">
            {i > 0 && <ChevronRight size={13} strokeWidth={1.8} className="mx-0.5 shrink-0 text-faint" aria-hidden />}
            <button
              type="button"
              onClick={() => !last && onGo(c.path)}
              aria-current={last ? "page" : undefined}
              className={cn(
                "max-w-48 truncate rounded-md px-1.5 py-0.5 text-subhead transition-colors",
                last ? "text-bright" : "text-dim hover:bg-fill-2 hover:text-bright",
              )}
            >
              {c.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export function crumbsFor(listing: FileListing | null, path: string, fallbackRoot: string, fallbackName: string): Crumb[] {
  return crumbsOf(listing?.path ?? path, listing?.root ?? fallbackRoot, listing?.root_name ?? fallbackName);
}

export interface FolderViewProps {
  path: string;
  phone: boolean;
  actions: FileActions;
  /** The open file (desktop: highlighted). */
  selected?: string;
  onOpenFolder: (path: string) => void;
  onOpenFile: (entry: FileEntry) => void;
  /** Desktop: Backspace / ⌘↑ goes to the folder above. */
  onUp?: () => void;
  /** Told what the folder is (crumbs above the list). */
  onListing?: (l: FileListing | null) => void;
  /** Extra toolbar buttons (desktop: close the pane's viewer, …). */
  tools?: ReactNode;
}

export function FolderView({ path, phone, actions, selected, onOpenFolder, onOpenFile, onUp, onListing, tools }: FolderViewProps) {
  const client = useClient();
  const { sort, hidden, setSort, setHidden } = useFilePrefs();
  const { listing, error, loading, reload } = useFolder(path, hidden);
  const [query, setQuery] = useState("");
  const search = useFileSearch(path, query, hidden);
  const upload = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => onListing?.(listing), [listing, onListing]);
  // Big folders draw their first rows at once and the rest on request (5000 rows is slow on phones).
  const [limit, setLimit] = useState(ROWS);
  useEffect(() => (setQuery(""), setLimit(ROWS)), [path]);

  const entries = useMemo(() => filterEntries(sortEntries(listing?.entries ?? [], sort), query), [listing, sort, query]);
  // Search hits that are not already shown (they live deeper).
  const deeper = useMemo(() => (search.results ?? []).filter((e) => dirOf(e.path) !== (listing?.path ?? path)), [search.results, listing, path]);

  const open = (e: FileEntry) => (e.dir ? onOpenFolder(e.path) : onOpenFile(e));

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || !listing) return;
    setUploading(true);
    const t = toast(`Uploading ${files.length === 1 ? files[0]!.name : `${files.length} files`}…`, { tone: "loading", duration: 3_600_000 });
    try {
      let last: FileEntry | null = null;
      for (const f of Array.from(files)) {
        last = await uploadInto(client, listing.path, f, (done, total) => t.update(`Uploading ${f.name}… ${formatSize(done)} of ${formatSize(total)}`, { tone: "loading", duration: 3_600_000 }));
      }
      t.update(files.length === 1 && last ? `Added ${last.name}` : `Added ${files.length} files`, { tone: "success" });
      reload();
    } catch (e) {
      t.update((e as Error).message, { tone: "danger" });
    } finally {
      setUploading(false);
      if (upload.current) upload.current.value = "";
    }
  };

  const options: MenuEntry[] = [
    ...SORTS.map((s): MenuEntry => ({
      label: s.label,
      section: s.key === "name" ? "Sort by" : undefined,
      checked: sort.key === s.key,
      onSelect: () => setSort({ key: s.key, desc: sort.key === s.key ? !sort.desc : false }),
    })),
    { label: "Show hidden files", Icon: hidden ? EyeOff : Eye, kind: "check", checked: hidden, divider: true, onSelect: () => setHidden(!hidden) },
    ...(listing?.writable ? [{ label: "Add files from this device…", Icon: Upload, onSelect: () => upload.current?.click() } satisfies MenuEntry] : []),
    { label: "Refresh", Icon: RotateCw, onSelect: reload },
  ];

  const toolbar = (
    <div className={cn("flex items-center gap-2", phone ? "mb-4" : "px-2 pt-2 pb-1.5")}>
      <SearchField value={query} onChange={setQuery} placeholder={phone ? "Search files" : "Filter or search"} className="min-w-0 flex-1" />
      {uploading && <Spinner size={14} />}
      <Menu
        title="View"
        items={options}
        trigger={(show) => (
          <IconButton label="Sort and view" variant={phone ? "glass" : "ghost"} size={phone ? "md" : "sm"} onClick={show}>
            <ArrowDownUp size={phone ? 18 : 15} />
          </IconButton>
        )}
      />
      {tools}
      <input ref={upload} type="file" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
    </div>
  );

  let body: ReactNode;
  if (error && !listing) {
    body = (
      <Empty
        Icon={FolderX}
        title="This folder cannot be opened"
        detail={error}
        action={
          <button type="button" className="text-subhead text-tab" onClick={reload}>
            Try again
          </button>
        }
      />
    );
  } else if (!listing) {
    body = phone ? <SkeletonList rows={8} /> : <div className="grid h-32 place-items-center"><Spinner /></div>;
  } else if (entries.length === 0 && !query) {
    body = <Empty Icon={FolderX} title="Empty folder" detail={hidden ? undefined : "Hidden files are not shown."} bare={!phone} />;
  } else {
    const rows = entries.length > limit ? entries.slice(0, limit) : entries;
    const shown = phone ? (
      <PhoneRows entries={rows} root={listing.root} actions={actions} onOpen={open} />
    ) : (
      <DeskRows entries={rows} root={listing.root} actions={actions} selected={selected} onOpen={open} onUp={onUp} />
    );
    body = (
      <>
        {(entries.length > 0 || !query) && shown}
        {rows.length < entries.length && (
          <button type="button" onClick={() => setLimit(Infinity)} className={cn("w-full py-3 text-subhead text-tab", !phone && "py-2 text-footnote")}>
            Show all {entries.length.toLocaleString()}
          </button>
        )}
        {listing.truncated && <p className="px-4 py-2 text-footnote text-faint">Only the first {listing.entries.length} entries are shown. Use search to find the rest.</p>}
        {query.trim().length >= 2 && (
          <SearchResults phone={phone} busy={search.busy} results={deeper} root={listing.root} actions={actions} onOpen={open} selected={selected} none={entries.length === 0} />
        )}
      </>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col", !phone && "h-full")}>
      {toolbar}
      <div className={cn(!phone && "min-h-0 flex-1 overflow-y-auto pb-4", loading && listing && "transition-opacity")}>{body}</div>
    </div>
  );
}

function detailOf(e: FileEntry): string {
  const date = formatDate(e.mtime);
  if (e.protected) return "Opens only on the computer";
  if (e.dir) return date;
  return [formatSize(e.size), date].filter(Boolean).join(" · ");
}

function PhoneRows({ entries, root, actions, onOpen, label }: { entries: FileEntry[]; root: string; actions: FileActions; onOpen: (e: FileEntry) => void; label?: string }) {
  return (
    <List label={label}>
      {entries.map((e) => {
        const { Icon, color } = iconOf(e);
        return (
          <ContextMenu key={e.path} items={actions.menu(e)} onTap={() => !e.protected && onOpen(e)} radius={14}>
            <Row
              Icon={Icon}
              tile={color}
              title={
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{e.name}</span>
                  {e.link && <Link2 size={13} className="shrink-0 text-faint" aria-label="Link" />}
                </span>
              }
              detail={label ? relPath(dirOf(e.path), root) : detailOf(e)}
              trailing={e.git ? <GitMark status={e.git} dir={e.dir} /> : undefined}
              chevron={e.dir && !e.protected}
              onClick={() => {}}
            />
          </ContextMenu>
        );
      })}
    </List>
  );
}

function DeskRows({
  entries,
  root,
  actions,
  selected,
  onOpen,
  onUp,
  showDir,
}: {
  entries: FileEntry[];
  root: string;
  actions: FileActions;
  selected?: string;
  onOpen: (e: FileEntry) => void;
  onUp?: () => void;
  showDir?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const move = (by: number) => {
    const rows = Array.from(box.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ?? []);
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + by))]?.focus();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "ArrowDown") (ev.preventDefault(), move(1));
    else if (ev.key === "ArrowUp" && !ev.metaKey) (ev.preventDefault(), move(-1));
    else if ((ev.key === "Backspace" || (ev.key === "ArrowUp" && ev.metaKey)) && onUp) (ev.preventDefault(), onUp());
  };
  return (
    <div ref={box} role="list" onKeyDown={onKey} className="flex flex-col px-1.5">
      {entries.map((e) => {
        const { Icon, color } = iconOf(e);
        return (
          <ContextMenu key={e.path} items={actions.menu(e)} radius={8}>
            <button
              type="button"
              data-row
              role="listitem"
              onClick={() => !e.protected && onOpen(e)}
              title={e.protected ? "macOS guards this folder; open it on the computer" : e.name}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-subhead outline-none transition-colors",
                selected === e.path ? "bg-fill-3 text-bright" : "text-ink hover:bg-fill-2 focus-visible:bg-fill-2",
                e.protected && "opacity-60",
              )}
            >
              <Icon size={15} strokeWidth={1.8} className={cn("shrink-0", INK[color])} />
              <span className="min-w-0 flex-1 truncate">
                {e.name}
                {showDir && <span className="ml-2 text-footnote text-faint">{relPath(dirOf(e.path), root)}</span>}
              </span>
              {e.link && <Link2 size={12} className="shrink-0 text-faint" aria-label="Link" />}
              {e.git && <GitMark status={e.git} dir={e.dir} />}
              {!e.dir && <span className="w-14 shrink-0 text-right text-caption text-faint tabular-nums">{formatSize(e.size)}</span>}
            </button>
          </ContextMenu>
        );
      })}
    </div>
  );
}

function SearchResults({
  phone,
  busy,
  results,
  root,
  actions,
  onOpen,
  selected,
  none,
}: {
  phone: boolean;
  busy: boolean;
  results: FileEntry[];
  root: string;
  actions: FileActions;
  onOpen: (e: FileEntry) => void;
  selected?: string;
  none: boolean;
}) {
  if (busy && results.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-footnote text-faint">
        <Spinner size={13} /> Searching the folders below…
      </div>
    );
  }
  if (results.length === 0) return none ? <Empty Icon={SearchX} title="Nothing found" detail="No file or folder below this one has that name." bare={!phone} /> : null;
  return phone ? (
    <div className="mt-6">
      <PhoneRows entries={results} root={root} actions={actions} onOpen={onOpen} label="In folders below" />
    </div>
  ) : (
    <div className="mt-3">
      <p className="px-3.5 pb-1 text-caption text-faint">In folders below</p>
      <DeskRows entries={results} root={root} actions={actions} selected={selected} onOpen={onOpen} showDir />
    </div>
  );
}
