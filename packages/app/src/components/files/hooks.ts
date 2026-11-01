// Files explorer: loading a folder (kept per path, so going back shows it at once and refreshes
// behind) and opening a file (its first part; the rest on request; pictures and media whole).
import type { DaemonClient, FileChunk, FileEntry, FileListing } from "@neuralagent/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "../../lib/store";
import { Aborted, listFolder, readPiece, readWhole, searchFiles } from "./api";
import { CHUNK, MAX_MEDIA, MAX_TEXT, PREVIEW_BYTES, b64ToBytes, decodeChecked, type Encoding, type FileKind, kindOf } from "./model";

const folders = new Map<string, FileListing>();
const KEEP = 60;
const keyOf = (path: string, hidden: boolean) => `${hidden ? 1 : 0}:${path}`;

export interface FolderState {
  listing: FileListing | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useFolder(path: string | null | undefined, hidden: boolean): FolderState {
  const client = useClient();
  const key = path ? keyOf(path, hidden) : "";
  const [state, setState] = useState<{ key: string; listing: FileListing | null; error: string | null; loading: boolean }>(() => ({
    key,
    listing: folders.get(key) ?? null,
    error: null,
    loading: true,
  }));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => (s.key === key ? { ...s, loading: true } : { key, listing: folders.get(key) ?? null, error: null, loading: true }));
    listFolder(client, path, hidden).then(
      (l) => {
        folders.delete(key);
        folders.set(key, l);
        if (folders.size > KEEP) folders.delete(folders.keys().next().value!);
        if (live) setState({ key, listing: l, error: null, loading: false });
      },
      (e: Error) => live && setState((s) => ({ ...s, key, error: e.message, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [client, path, hidden, key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const shown = state.key === key ? state : { listing: folders.get(key) ?? null, error: null, loading: true };
  return { listing: shown.listing, error: shown.error, loading: shown.loading, reload };
}

/** Name search under `path` (debounced); null while there is no query. */
export function useFileSearch(path: string | null | undefined, query: string, hidden: boolean): { results: FileEntry[] | null; busy: boolean } {
  const client = useClient();
  const [st, setSt] = useState<{ q: string; results: FileEntry[] | null; busy: boolean }>({ q: "", results: null, busy: false });
  const q = query.trim();
  useEffect(() => {
    if (!path || q.length < 2) {
      setSt({ q: "", results: null, busy: false });
      return;
    }
    let live = true;
    setSt((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      searchFiles(client, path, q, hidden).then(
        (r) => live && setSt({ q, results: r, busy: false }),
        () => live && setSt({ q, results: [], busy: false }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [client, path, q, hidden]);
  return { results: q.length < 2 ? null : st.results, busy: st.busy };
}

export interface OpenFile {
  /** The path it was opened with (the head names the resolved one). */
  src: string;
  head: FileChunk;
  kind: FileKind;
  /** Text shown (the first part, or all of it). */
  text: string | null;
  /** All of the text is loaded (it can be edited). */
  complete: boolean;
  /** The text is not all UTF-8: shown, never saved back. */
  lossy?: boolean;
  /** Not UTF-8: how it was decoded (shown, read-only). */
  encoding?: Encoding;
  /** Pictures, PDFs, audio, video: the whole file. */
  blob: Blob | null;
  url: string | null;
}

export interface FileState {
  file: OpenFile | null;
  error: string | null;
  /** Bytes loaded while a whole file comes in. */
  progress: { done: number; total: number } | null;
  loadAll: () => void;
  /** The whole file as a Blob (for download/share/open), reading what is missing. */
  fetchBlob: (onProgress?: (done: number, total: number) => void, signal?: AbortSignal) => Promise<Blob>;
  reload: () => void;
  /** After a save: the new text and times. */
  replace: (text: string, entry: FileEntry) => void;
}

/** Aborts when either signal does. */
function eitherSignal(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a || !b) return a ?? b;
  const ac = new AbortController();
  const stop = () => ac.abort();
  if (a.aborted || b.aborted) stop();
  a.addEventListener("abort", stop, { once: true });
  b.addEventListener("abort", stop, { once: true });
  return ac.signal;
}

const isMedia = (k: FileKind) => k === "image" || k === "pdf" || k === "audio" || k === "video";
const isText = (k: FileKind) => k === "markdown" || k === "code" || k === "text";

async function whole(client: DaemonClient, path: string, first: FileChunk | undefined, set: (p: { done: number; total: number } | null) => void, signal: AbortSignal) {
  const r = await readWhole(client, path, { first, signal, onProgress: (done, total) => set(total > CHUNK ? { done, total } : null) });
  set(null);
  return r;
}

export function useFile(path: string | null | undefined): FileState {
  const client = useClient();
  const [file, setFile] = useState<OpenFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tick, setTick] = useState(0);
  const ctl = useRef<AbortController | null>(null);
  const fileRef = useRef<OpenFile | null>(null);
  fileRef.current = file;

  useEffect(() => {
    if (!path) return;
    const ac = new AbortController();
    ctl.current = ac;
    setError(null);
    setProgress(null);
    setFile((f) => (f && f.src === path ? f : null));
    (async () => {
      const head = await readPiece(client, path, 0, PREVIEW_BYTES);
      const kind = kindOf(head.name, head.mime, head.text);
      if (ac.signal.aborted) return;
      if (isText(kind) || (kind === "binary" && head.text)) {
        const done = head.eof;
        const { text, lossy, encoding } = decodeChecked(b64ToBytes(head.data), done);
        setFile({ src: path, head, kind, text, lossy, encoding, complete: done, blob: null, url: null });
        return;
      }
      if (isMedia(kind) && head.size <= MAX_MEDIA) {
        setFile({ src: path, head, kind, text: null, complete: false, blob: null, url: null });
        const { blob, head: h } = await whole(client, path, head.size <= PREVIEW_BYTES ? head : undefined, setProgress, ac.signal);
        if (ac.signal.aborted) return;
        setFile({ src: path, head: h, kind, text: null, complete: true, blob, url: URL.createObjectURL(blob) });
        return;
      }
      setFile({ src: path, head, kind, text: null, complete: false, blob: null, url: null });
    })().catch((e: Error) => {
      if (!(e instanceof Aborted) && !ac.signal.aborted) setError(e.message);
    });
    return () => ac.abort();
  }, [client, path, tick]);

  // Object URLs are let go when the file changes or the viewer closes.
  useEffect(() => {
    const url = file?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file?.url]);

  const loadAll = useCallback(() => {
    const f = fileRef.current;
    if (!f || !path || f.complete || f.head.size > MAX_TEXT) return;
    const ac = ctl.current ?? new AbortController();
    whole(client, path, undefined, setProgress, ac.signal).then(
      async ({ blob, head }) => {
        if (ac.signal.aborted) return;
        const { text, lossy, encoding } = decodeChecked(new Uint8Array(await blob.arrayBuffer()), true);
        setFile({ ...f, head: { ...head, data: "" }, text, lossy, encoding, complete: true });
      },
      (e: Error) => !(e instanceof Aborted) && setError(e.message),
    );
  }, [client, path]);

  const fetchBlob = useCallback(
    async (onProgress?: (done: number, total: number) => void, signal?: AbortSignal) => {
      const f = fileRef.current;
      if (f?.blob) return f.blob;
      if (!path) throw new Error("No file");
      // Stops when the viewer closes or the caller cancels.
      const { blob } = await readWhole(client, path, { onProgress, signal: eitherSignal(ctl.current?.signal, signal) });
      return blob;
    },
    [client, path],
  );

  const replace = useCallback((text: string, entry: FileEntry) => {
    setFile((f) => (f ? { ...f, text, complete: true, head: { ...f.head, size: entry.size, mtime: entry.mtime } } : f));
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { file: file && path && file.src === path ? file : null, error, progress, loadAll, fetchBlob, reload, replace };
}
