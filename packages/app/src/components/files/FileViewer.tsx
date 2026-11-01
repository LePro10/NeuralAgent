// Files explorer (D68): one open file. Code and text with line numbers, Markdown rendered (with
// its source a tap away), pictures, PDFs (inline where the browser shows them), audio and video;
// anything else as a card to open, show, download or share. Big text opens with its first part.
// Text can be edited and saved; a file changed on the computer meanwhile is never overwritten
// without asking.
import type { FileEntry } from "@neuralagent/protocol";
import { RequestError } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Empty, IconButton, Menu, type MenuEntry, Spinner, cn, toast } from "@neuralagent/ui";
import { Code2, Ellipsis, Eye, FileQuestion, FileWarning, Pencil, RotateCw, Save, WrapText, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useClient, usePlatform } from "../../lib/store";
import { Markdown } from "../claude/Markdown";
import type { FileActions, Fetch } from "./actions";
import { saveText } from "./api";
import { CodeView } from "./CodeView";
import { iconOf } from "./FileIcon";
import { useFile } from "./hooks";
import { MAX_MEDIA, MAX_TEXT, formatDate, formatSize, langOf, lineCount } from "./model";
import { useFilePrefs } from "./prefs";

/** How the viewer is framed: a phone page or the desktop pane's right side. */
export type ViewerChrome = (p: { title: string; eyebrow: string; tools: ReactNode; body: ReactNode; editing: boolean }) => ReactNode;

export function FileViewer({ path, phone, actions, chrome }: { path: string; phone: boolean; actions: FileActions; chrome: ViewerChrome }) {
  const client = useClient();
  const platform = usePlatform();
  const { file, error, progress, loadAll, fetchBlob, reload, replace } = useFile(path);
  const prefs = useFilePrefs();
  const wrap = prefs.wrap ?? phone;
  const [source, setSource] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setDraft(null);
    setSource(false);
  }, [path]);

  const name = file?.head.name ?? path.split("/").pop() ?? path;
  const editing = draft !== null;
  const dirty = editing && draft !== file?.text;
  const entry: Pick<FileEntry, "path" | "name" | "dir" | "size"> = { path: file?.head.path ?? path, name, dir: false, size: file?.head.size ?? 0 };
  const canEdit = !!file && file.head.writable && file.text !== null && file.head.size <= MAX_TEXT && file.kind !== "binary" && !file.lossy;

  const save = async (force = false) => {
    if (!file || draft === null) return;
    setSaving(true);
    try {
      // A textarea turns line ends into "\n": a file with Windows line ends keeps them.
      const out = file.text?.includes("\r\n") ? draft.replace(/\r?\n/g, "\r\n") : draft;
      const saved = await saveText(client, file.head.path, out, force ? undefined : file.head.mtime);
      replace(out, saved);
      setDraft(null);
      toast("Saved", { tone: "success" });
    } catch (e) {
      if (e instanceof RequestError && e.code === "conflict") setConflict(true);
      else toast((e as Error).message, { tone: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const startEdit = () => {
    if (!file) return;
    if (!file.complete) {
      loadAll();
      toast("Loading the whole file first…", { tone: "neutral" });
      return;
    }
    setDraft(file.text ?? "");
    setTimeout(() => area.current?.focus(), 0);
  };
  // Once a "load all" for editing lands, editing can start.
  const wantEdit = useRef(false);
  useEffect(() => {
    if (wantEdit.current && file?.complete) {
      wantEdit.current = false;
      if (canEdit) startEdit();
      else toast("This file is not plain UTF-8 text, so it is not edited here", { tone: "neutral" });
    }
  });

  const eyebrow = !file
    ? ""
    : [formatSize(file.head.size), file.text !== null && file.complete ? `${lineCount(file.text).toLocaleString()} lines` : null, formatDate(file.head.mtime), file.lossy ? `${file.encoding ?? "not UTF-8"}, read-only` : file.head.writable ? null : "read-only"]
        .filter(Boolean)
        .join(" · ");

  const more: MenuEntry[] = [
    ...(file?.text !== null && file?.kind !== "markdown" && !editing ? [{ label: wrap ? "Don't wrap lines" : "Wrap lines", Icon: WrapText, onSelect: () => prefs.setWrap(!wrap) } satisfies MenuEntry] : []),
    ...(file?.kind === "markdown" && !editing ? [{ label: source ? "Show formatted" : "Show source", Icon: source ? Eye : Code2, onSelect: () => setSource(!source) } satisfies MenuEntry] : []),
    { label: "Reload", Icon: RotateCw, disabled: editing, onSelect: reload },
    ...actions.menu(entry, file?.blob ? async () => file.blob! : fetchBlob).map((m, i) => (i === 0 ? { ...m, divider: true } : m)),
  ];

  const tools = editing ? (
    <>
      <Button size="sm" variant="quiet" onClick={() => (dirty ? setDiscard(true) : setDraft(null))}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" Icon={Save} busy={saving} disabled={!dirty} onClick={() => void save()}>
        Save
      </Button>
    </>
  ) : (
    <>
      {canEdit && (
        <IconButton label="Edit" variant={phone ? "glass" : "ghost"} size={phone ? "md" : "sm"} onClick={() => ((wantEdit.current = !file!.complete), startEdit())}>
          <Pencil size={phone ? 18 : 15} />
        </IconButton>
      )}
      <Menu
        title={name}
        items={more}
        trigger={(show) => (
          <IconButton label={`More for ${name}`} variant={phone ? "glass" : "ghost"} size={phone ? "md" : "sm"} onClick={show}>
            <Ellipsis size={phone ? 18 : 15} />
          </IconButton>
        )}
      />
    </>
  );

  let body: ReactNode;
  if (error && !file) {
    body = <Empty Icon={FileWarning} title="This file cannot be opened" detail={error} bare={!phone} action={<Button size="sm" variant="ghost" onClick={reload}>Try again</Button>} />;
  } else if (!file) {
    body = (
      <div className="grid h-40 place-items-center">
        <Spinner />
      </div>
    );
  } else if (editing) {
    body = (
      <textarea
        ref={area}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            if (dirty) void save();
          }
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const t = e.currentTarget;
            const [a, b] = [t.selectionStart, t.selectionEnd];
            setDraft(`${draft!.slice(0, a)}\t${draft!.slice(b)}`);
            requestAnimationFrame(() => t.setSelectionRange(a + 1, a + 1));
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`Edit ${name}`}
        className={cn("fv-edit h-full min-h-96 w-full px-4 py-3", phone && "rounded-2xl bg-fill-1")}
      />
    );
  } else if (file.text !== null) {
    const partial = !file.complete;
    body = (
      <>
        {partial && (
          <div className={cn("mb-2 flex items-center gap-3 rounded-xl bg-fill-2 px-3.5 py-2.5 text-footnote text-dim", !phone && "mx-3 mt-2")}>
            <span className="min-w-0 flex-1">
              {progress
                ? `Loading… ${formatSize(progress.done)} of ${formatSize(progress.total)}`
                : `Showing the first ${formatSize(file.head.data.length ? Math.floor((file.head.data.length * 3) / 4) : 0)} of ${formatSize(file.head.size)}.`}
            </span>
            {!progress &&
              (file.head.size <= MAX_TEXT ? (
                <Button size="xs" variant="ghost" onClick={loadAll}>
                  Load all
                </Button>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => actions.give(entry, fetchBlob)}>
                  {platform.kind === "desktop" ? "Save a copy" : "Download"}
                </Button>
              ))}
          </div>
        )}
        {file.kind === "markdown" && !source ? (
          <div className={cn("fv-md", phone ? "px-1" : "px-6 py-4")}>
            <Markdown text={file.text} />
          </div>
        ) : (
          <div className={cn(!wrap && "overflow-x-auto", phone && "-mx-4")}>
            <CodeView text={file.text} lang={file.kind === "markdown" ? "" : langOf(name)} wrap={wrap} />
          </div>
        )}
      </>
    );
  } else if (file.url && file.kind === "image") {
    body = (
      <div className={cn("grid min-h-full place-items-center", !phone && "p-4")}>
        <img src={file.url} alt={name} className="fv-checker max-h-full max-w-full rounded-lg object-contain" />
      </div>
    );
  } else if (file.url && file.kind === "pdf" && !phone && platform.kind !== "android") {
    body = <iframe src={file.url} title={name} className="size-full min-h-96 border-0 bg-fill-1" />;
  } else if (file.url && file.kind === "audio") {
    body = (
      <div className="grid place-items-center p-8">
        <audio src={file.url} controls className="w-full max-w-md" />
      </div>
    );
  } else if (file.url && file.kind === "video") {
    body = (
      <div className="grid min-h-full place-items-center p-2">
        <video src={file.url} controls playsInline className="max-h-full max-w-full rounded-lg" />
      </div>
    );
  } else if (progress || (file.kind !== "binary" && file.head.size <= MAX_MEDIA && !file.url)) {
    body = (
      <div className="grid h-48 place-items-center text-footnote text-dim">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          {progress && `${formatSize(progress.done)} of ${formatSize(progress.total)}`}
        </div>
      </div>
    );
  } else {
    body = <FileCard name={name} size={file.head.size} entry={entry} phone={phone} actions={actions} fetch={file.blob ? async () => file.blob! : fetchBlob} />;
  }

  return (
    <>
      {chrome({ title: name, eyebrow, tools, body, editing })}
      {actions.sheet}
      <ConfirmSheet
        open={conflict}
        onClose={() => setConflict(false)}
        onConfirm={() => save(true)}
        title="The file changed on the computer"
        message="Someone (maybe an agent) changed it since you opened it. Saving replaces their version with yours."
        confirmLabel="Replace with mine"
        destructive
      />
      <ConfirmSheet
        open={discard}
        onClose={() => setDiscard(false)}
        onConfirm={() => setDraft(null)}
        title="Discard your changes?"
        confirmLabel="Discard"
        destructive
        Icon={X}
      />
    </>
  );
}

/** Files the viewer cannot show (or too big to fetch): what you can do with them instead. */
function FileCard({ name, size, entry, phone, actions, fetch }: { name: string; size: number; entry: Pick<FileEntry, "path" | "name" | "dir" | "size">; phone: boolean; actions: FileActions; fetch: Fetch }) {
  const platform = usePlatform();
  const { Icon } = iconOf({ name, dir: false, protected: false });
  const local = platform.kind === "desktop" && !!platform.openPath;
  const share = !!platform.shareFile || (phone && typeof navigator !== "undefined" && "share" in navigator);
  return (
    <Empty
      Icon={Icon ?? FileQuestion}
      title={name}
      detail={`${formatSize(size)} · ${local ? "Opens in its own app." : "This device can open it in another app."}`}
      bare={!phone}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {local ? (
            <>
              <Button size="sm" onClick={() => void platform.openPath!(entry.path).catch((e: Error) => toast(e.message, { tone: "danger" }))}>
                Open
              </Button>
              {platform.revealPath && (
                <Button size="sm" variant="ghost" onClick={() => void platform.revealPath!(entry.path).catch((e: Error) => toast(e.message, { tone: "danger" }))}>
                  Show in Finder
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" onClick={() => actions.give(entry, fetch)}>
              {share ? "Open or share" : "Download"}
            </Button>
          )}
        </div>
      }
    />
  );
}
