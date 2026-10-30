/** Getting images from paste, drop, camera and clipboard buttons to the host's upload folder. */
import type { DaemonClient, UploadResult } from "@neuralagent/protocol";

/** On a computer, images up to this size go as they are (screenshots stay sharp PNGs). */
const MAX_RAW = 3.5 * 1024 * 1024;
/** Long edge photos are scaled to (Claude downsizes anything bigger anyway). */
const LONG_EDGE = 2000;
/**
 * Largest file sent at all. The bytes travel base64 in JSON, and over the relay base64 again
 * inside a sealed envelope (~1.8×): the relay and the daemon take frames up to 16 MB, and a
 * bigger one does not fail alone, it closes the whole connection.
 */
export const MAX_SEND = 8 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/bmp": "bmp", "application/pdf": "pdf", "text/plain": "txt" };
const BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", bmp: "image/bmp", pdf: "application/pdf" };

/** The file's type; some pickers (Android galleries, HEIC on Chrome) leave `type` empty. */
export const typeOf = (f: Blob) => f.type || BY_EXT[/\.([a-z0-9]+)$/i.exec((f as File).name ?? "")?.[1]?.toLowerCase() ?? ""] || "";
export const isImage = (f: Blob) => typeOf(f).startsWith("image/");

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
  return out.filter((f) => isImage(f) || typeOf(f) === "application/pdf");
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

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * Photos are scaled to a 2000 px long edge JPEG: always on a phone (camera photos are
 * 3–12 MB and the mobile link is slow), on a computer only when big. GIFs keep their
 * animation; anything the browser cannot decode (HEIC on most browsers) goes as it is.
 */
export async function shrink(file: File, phone: boolean): Promise<{ blob: Blob; name: string }> {
  const type = typeOf(file);
  const ext = EXT[type] ?? "png";
  const name = /\.[a-z0-9]{2,4}$/i.test(file.name) ? file.name : `${file.name || "image"}.${ext}`;
  const want = type.startsWith("image/") && type !== "image/gif" && (phone || file.size > MAX_RAW);
  if (want) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      const g = canvas.getContext("2d")!;
      // JPEG has no transparency: a white page instead of black.
      g.fillStyle = "white";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
      if (blob && (blob.size < file.size || type !== "image/jpeg")) return { blob, name: name.replace(/\.[a-z0-9]+$/i, ".jpg") };
    } catch {
      // not decodable here: send the original if it is small enough
    }
  }
  if (file.size > MAX_SEND) {
    const heic = /heic|heif/.test(type);
    throw new Error(heic ? `HEIC photo too big to send (${mb(file.size)}, max ${mb(MAX_SEND)}). Pick it as JPEG, or set the camera to "Most compatible".` : `File too big to send (${mb(file.size)}, max ${mb(MAX_SEND)}).`);
  }
  return { blob: file, name };
}

/** Uploads to the host (the session's computer) and returns the absolute path there. */
export async function uploadFile(client: DaemonClient, sid: string, file: File, phone = false): Promise<string> {
  const { blob, name } = await shrink(file, phone);
  const data = await blobToB64(blob);
  const r = await client.req<UploadResult>({ m: "upload", p: { sid, name, data } });
  return r.path;
}

/** A path for a prompt: quoted when it has spaces. */
export const pathToken = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
