// OS detection and the latest release (shared by Nav, Hero, Footer, download page). One fetch per page load.
import { useEffect, useState } from "react";

export interface Latest {
  version: string;
  pub_date: string;
  downloads: Record<string, string>;
}

export type Os = "mac" | "windows" | "linux" | "android" | "ios" | "other";

export function detectOs(): Os {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "other";
}

export const OS_LABEL: Record<Os, string> = { mac: "macOS", windows: "Windows", linux: "Linux", android: "Android", ios: "iPhone", other: "your computer" };
/** Key of the matching installer in `/api/releases/latest` → `downloads`. */
const KIND: Record<Os, string> = { mac: "mac", windows: "windows", linux: "linux", android: "android", ios: "", other: "" };

/** Phones and tablets: visitors who cannot install the desktop app. */
export const isMobileOs = (os: Os) => os === "android" || os === "ios";

export type ReleaseStatus = "loading" | "ok" | "offline";
export interface ReleaseState { latest: Latest | null; status: ReleaseStatus }

// Module-level cache: Nav, Hero and Footer ask separately, the network is hit once.
let state: ReleaseState = { latest: null, status: "loading" };
let started = false;
const listeners = new Set<(s: ReleaseState) => void>();
function load() {
  if (started) return;
  started = true;
  fetch("/api/releases/latest")
    .then((r) => (r.ok ? (r.json() as Promise<Latest>) : null))
    .then(
      (latest) => set(latest?.version ? { latest, status: "ok" } : { latest: null, status: "offline" }),
      () => set({ latest: null, status: "offline" }),
    );
}
function set(s: ReleaseState) {
  state = s;
  listeners.forEach((l) => l(s));
}

export interface Cta { href: string; label: string; short: string; external: boolean }

/**
 * The latest release and the visitor's system.
 * - `cta`: the primary download action for this system. Desktop: the direct installer (else /download).
 *   Android: the APK. iPhone: the web remote (there is no store build). `short` fits the nav button.
 * - `phone`: true on Android / iPhone, where the desktop app cannot be installed: pair the CTA with "Try it live" and "Send to my computer".
 */
export function useRelease() {
  const [s, setS] = useState(state);
  const [os] = useState<Os>(detectOs);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    load();
    return () => void listeners.delete(setS);
  }, []);
  const direct = s.latest?.downloads[KIND[os]];
  const cta: Cta =
    os === "ios"
      ? { href: "/app/", label: "Open the web remote", short: "Open remote", external: false }
      : os === "android"
        ? { href: direct ?? "/download/", label: "Get the Android app", short: "Get the app", external: false }
        : { href: direct ?? "/download/", label: os === "other" ? "Download" : `Download for ${OS_LABEL[os]}`, short: "Download", external: false };
  return { latest: s.latest, status: s.status, os, phone: isMobileOs(os), cta, osLabel: OS_LABEL[os] };
}

/** "30 Oct 2026" from an ISO timestamp. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
