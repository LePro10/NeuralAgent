/**
 * Images in the Claude view (a `Read` of a picture, pasted images, MCP screenshots). The daemon
 * sends only references (`CvImage`); the bytes come from `cv_image` when an image is shown, once
 * per image, and stay here as object URLs. Remote clients ask for a smaller picture.
 */
import type { CvImage, CvImageData } from "@neuralagent/protocol";

/** Longest edge remote clients (phone, web remote: over the relay) ask for. */
export const REMOTE_EDGE = 1600;

export const edgeFor = (kind: "desktop" | "web" | "android"): number | undefined => (kind === "desktop" ? undefined : REMOTE_EDGE);

export interface Loaded {
  url: string;
  blob: Blob;
  type: string;
  w: number;
  h: number;
}

export function b64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export const fromData = (d: CvImageData): Loaded => {
  const blob = b64ToBlob(d.data, d.media_type);
  return { url: URL.createObjectURL(blob), blob, type: d.media_type, w: d.w, h: d.h };
};

/**
 * Loads by key at most once at a time; a failed load is forgotten (so Retry fetches again).
 * Keeps the newest `limit` entries and revokes the object URLs of older ones (an `<img>` that
 * already shows one keeps its picture).
 */
export class ImageCache {
  private map = new Map<string, Promise<Loaded>>();
  private limit: number;
  private revoke: (url: string) => void;
  constructor(limit = 60, revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)) {
    this.limit = limit;
    this.revoke = revoke;
  }

  get(key: string, load: () => Promise<Loaded>): Promise<Loaded> {
    const have = this.map.get(key);
    if (have) {
      this.map.delete(key);
      this.map.set(key, have);
      return have;
    }
    const p = load();
    this.map.set(key, p);
    p.catch(() => {
      if (this.map.get(key) === p) this.map.delete(key);
    });
    while (this.map.size > this.limit) {
      const [old, op] = this.map.entries().next().value!;
      this.map.delete(old);
      op.then((l) => this.revoke(l.url), () => {});
    }
    return p;
  }

  get size() {
    return this.map.size;
  }
}

/** The size an image is drawn at: fits `maxW` × `maxH`, never upscaled; 4:3 when unknown. */
export function fitBox(img: Pick<CvImage, "w" | "h">, maxW: number, maxH: number): { w: number; h: number } {
  const w = img.w || 4;
  const h = img.h || 3;
  const s = Math.min(maxW / w, maxH / h, img.w && img.h ? 1 : Infinity);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** "[Image: source: /path/shot.png]" (how MCP tools name their pictures) → the path. */
export function sourceOf(text: string): string | null {
  return /\[Image: source: ([^\]\n]+)\]/.exec(text)?.[1]?.trim() ?? null;
}

/** The result text without those "[Image: source: …]" lines (the picture is shown instead). */
export const withoutSources = (text: string) => text.replace(/^\[Image: source: [^\]\n]+\]\n?/gm, "").trim();

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** A file name to save as: the caption's last path part, with the extension of the bytes. */
export function saveName(caption: string | undefined, type: string): string {
  const ext = EXT[type] ?? "png";
  const base = (caption ?? "").split(/[\\/]/).pop()?.replace(/\.[a-z0-9]{2,5}$/i, "") || "image";
  return `${base}.${ext}`;
}

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
