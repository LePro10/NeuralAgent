// Files explorer (D67): the daemon calls. Files travel in pieces (`file_read` / `file_upload`,
// 512 KiB each) so a relay frame stays small and a big file shows progress.
import type { DaemonClient, FileChunk, FileEntry, FileListing, FileUploadResult } from "@neuralagent/protocol";
import type { Platform } from "../../lib/platform";
import { CHUNK, b64ToBytes, bytesToB64, chunksOf, uploadId } from "./model";

export const listFolder = (client: DaemonClient, path: string, hidden: boolean) => client.req<FileListing>({ m: "file_list", p: { path, hidden } });

export const searchFiles = (client: DaemonClient, path: string, query: string, hidden: boolean) =>
  client.req<FileEntry[]>({ m: "file_search", p: { path, query, hidden } });

export const readPiece = (client: DaemonClient, path: string, offset = 0, len = CHUNK) => client.req<FileChunk>({ m: "file_read", p: { path, offset, len } });

export const saveText = (client: DaemonClient, path: string, text: string, mtime?: number) =>
  client.req<FileEntry>({ m: "file_save", p: { path, text, ...(mtime ? { mtime } : {}) } });

/** Thrown when a read is stopped (the viewer closed). */
export class Aborted extends Error {
  constructor() {
    super("stopped");
  }
}

/**
 * The whole file as a Blob, piece by piece. `first` (an already read start) is reused.
 * A file that changes while it is read is read again from the start once.
 */
export async function readWhole(
  client: DaemonClient,
  path: string,
  opts: { first?: FileChunk; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<{ blob: Blob; head: FileChunk }> {
  for (let attempt = 0; ; attempt++) {
    const head = attempt === 0 && opts.first?.offset === 0 ? opts.first : await readPiece(client, path, 0);
    const parts: Uint8Array<ArrayBuffer>[] = [b64ToBytes(head.data)];
    let done = parts[0]!.length;
    opts.onProgress?.(done, head.size);
    let changed = false;
    for (const [offset] of chunksOf(head.size).slice(1)) {
      if (opts.signal?.aborted) throw new Aborted();
      const c = await readPiece(client, path, offset);
      if (c.mtime !== head.mtime || c.size !== head.size) {
        changed = true;
        break;
      }
      const bytes = b64ToBytes(c.data);
      parts.push(bytes);
      done += bytes.length;
      opts.onProgress?.(done, head.size);
    }
    if (!changed) return { blob: new Blob(parts, { type: head.mime }), head };
    // Half of one version and half of another is never handed out.
    if (attempt > 0) throw new Error("The file keeps changing on the computer; try again in a moment");
  }
}

/** Uploads `file` into the folder `dir` in pieces; resolves with the new entry (its name may get a number). */
export async function uploadInto(client: DaemonClient, dir: string, file: File, onProgress?: (done: number, total: number) => void): Promise<FileEntry> {
  const id = uploadId();
  const pieces = chunksOf(file.size);
  if (pieces.length === 0) pieces.push([0, 0]);
  let last: FileUploadResult | null = null;
  for (const [i, [offset, len]] of pieces.entries()) {
    const bytes = new Uint8Array(await file.slice(offset, offset + len).arrayBuffer());
    last = await client.req<FileUploadResult>({
      m: "file_upload",
      p: { dir, name: file.name || "upload", id, offset, data: bytesToB64(bytes), last: i === pieces.length - 1, size: file.size },
    });
    onProgress?.(last.received, file.size);
  }
  if (!last?.entry) throw new Error("The upload did not finish");
  return last.entry;
}

/**
 * Hands a file to the device: Android shares it to another app (open with, save, send), phones
 * with the share sheet use it, everything else downloads it.
 */
export async function giveToDevice(platform: Platform, blob: Blob, name: string): Promise<"shared" | "downloaded"> {
  if (platform.shareFile) {
    try {
      await platform.shareFile({ name, type: blob.type || "application/octet-stream", data: blob });
    } catch (e) {
      // APKs before Files lack the native method.
      if ((e as { code?: string }).code === "UNIMPLEMENTED" || /not implemented/i.test((e as Error).message)) {
        throw new Error("Update the NeuralAgent app to open files from the computer");
      }
      throw e;
    }
    return "shared";
  }
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}
