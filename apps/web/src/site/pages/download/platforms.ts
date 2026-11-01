// The builds the release manifest can contain (`/api/releases/latest` → `downloads`, keys from
// crates/na-relay/src/releases.rs) and the logic that picks the visitor's primary one. The page keys off the manifest's
// own keys; it never parses file names for logic (a file name is only shown).
import { useEffect, useState } from "react";
import type { Os } from "../../ui";
import { Apple, Globe, Monitor, Package, Smartphone, Terminal, type LucideIcon } from "../icons";

export interface Kind {
  /** Key in `downloads`. */
  kind: string;
  os: Os;
  Icon: LucideIcon;
  name: string;
  detail: string;
}

export const KINDS: Kind[] = [
  { kind: "mac", os: "mac", Icon: Apple, name: "macOS", detail: "Apple silicon · .dmg" },
  { kind: "mac-intel", os: "mac", Icon: Apple, name: "macOS", detail: "Intel · .dmg" },
  { kind: "windows", os: "windows", Icon: Monitor, name: "Windows", detail: "64-bit installer · .exe" },
  { kind: "linux", os: "linux", Icon: Terminal, name: "Linux", detail: "x86_64 · AppImage" },
  { kind: "linux-deb", os: "linux", Icon: Terminal, name: "Linux", detail: "Debian, Ubuntu · .deb" },
  { kind: "android", os: "android", Icon: Smartphone, name: "Android", detail: "APK, Android 7.0 or later" },
];

/** Every build in the manifest: the known kinds first (in table order), then any kind this page does not know yet. */
export function listKinds(downloads: Record<string, string>): Kind[] {
  const known = KINDS.filter((k) => downloads[k.kind]);
  const extra = Object.keys(downloads)
    .filter((k) => downloads[k] && !KINDS.some((x) => x.kind === k))
    .map<Kind>((k) => ({ kind: k, os: "other", Icon: Package, name: k, detail: "Download" }));
  return [...known, ...extra];
}

export type MacArch = "arm" | "x86" | "unknown";

/**
 * Apple silicon or Intel? The user agent cannot say (every Mac reports "Intel"). Chromium can, through the
 * high-entropy client hints; Safari and Firefox cannot, so the answer stays "unknown" and the page offers the
 * Intel build right next to the Apple silicon one.
 */
export function useMacArch(): MacArch {
  const [arch, setArch] = useState<MacArch>("unknown");
  useEffect(() => {
    const uad = (navigator as unknown as { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
    uad?.getHighEntropyValues?.(["architecture"]).then(
      (v) => setArch(v.architecture === "arm" ? "arm" : v.architecture === "x86" ? "x86" : "unknown"),
      () => {},
    );
  }, []);
  return arch;
}

/** The kind to offer first for this system, or null (iPhone, unknown systems, or no matching build in this release). */
export function primaryKind(os: Os, arch: MacArch, downloads: Record<string, string>): string | null {
  const order: Record<Os, string[]> = {
    mac: arch === "x86" ? ["mac-intel", "mac"] : ["mac", "mac-intel"],
    windows: ["windows"],
    linux: ["linux", "linux-deb"],
    android: ["android"],
    ios: [],
    other: [],
  };
  return order[os].find((k) => downloads[k]) ?? null;
}

/** File name of a download URL, for display only. */
export function fileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

export const WEB_REMOTE = { href: "/app/", Icon: Globe, name: "iPhone and any browser", detail: "Web remote · no install" };
