/** Getting images from paste, drop, camera and clipboard buttons to the host's upload folder. */
import type { DaemonClient, UploadResult } from "@neuralagent/protocol";

const MAX_RAW = 3.5 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/bmp": "bmp", "application/pdf": "pdf", "text/plain": "txt" };

export const isImage = (f: Blob) => f.type.startsWith("image/");

/** Files carried by a paste or drop event (images first). */
export function filesOf(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const f of Array.from(dt.files ?? [])) out.push(f);
  if (!out.length) {
    for (const it of Array.from(dt.items ?? [])) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out.filter((f) => isImage(f) || f.type === "application/pdf");
}

/** The clipboard through the async API (needs a user gesture and permission; may be unsupported). */
export async function readClipboardFiles(): Promise<{ files: File[]; text: string; error?: string }> {
  const nav = navigator;
  if (!nav.clipboard?.read) {
    const text = (await nav.clipboard?.readText?.().catch(() => "")) ?? "";
    return { files: [], text, error: text ? undefined : "Your browser does not let this page read the clipboard. Use the picker or paste with the keyboard." };
  }
  try {
    const items = await nav.clipboard.read();
    const files: File[] = [];
    let text = "";
    for (const it of items) {
      for (const type of it.types) {
        if (type.startsWith("image/")) {
          const blob = await it.getType(type);
          files.push(new File([blob], `pasted.${EXT[type] ?? "png"}`, { type }));
          break;
        }
      }
      if (!files.length && it.types.includes("text/plain")) text += await (await it.getType("text/plain")).text();
    }
    return { files, text, error: files.length || text ? undefined : "The clipboard has no image." };
  } catch (e) {
    const name = (e as Error).name;
    return { files: [], text: "", error: name === "NotAllowedError" ? "Clipboard access was not allowed." : "Could not read the clipboard." };
  }
}

function blobToB64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** Big photos are scaled down first (phones send 10 MB JPEGs; Claude resizes anyway). */
async function shrink(file: File): Promise<{ blob: Blob; name: string }> {
  const ext = EXT[file.type] ?? "png";
  const name = /\.[a-z0-9]{2,4}$/i.test(file.name) ? file.name : `${file.name || "image"}.${ext}`;
  if (file.size <= MAX_RAW || !/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (blob && blob.size < file.size) return { blob, name: name.replace(/\.[a-z0-9]+$/i, ".jpg") };
  } catch {
    // keep the original
  }
  return { blob: file, name };
}

/** Uploads to the host (the session's computer) and returns the absolute path there. */
export async function uploadFile(client: DaemonClient, sid: string, file: File): Promise<string> {
  const { blob, name } = await shrink(file);
  const data = await blobToB64(blob);
  const r = await client.req<UploadResult>({ m: "upload", p: { sid, name, data } });
  return r.path;
}

/** A path for a prompt: quoted when it has spaces. */
export const pathToken = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
