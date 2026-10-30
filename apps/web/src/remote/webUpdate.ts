// The web remote (and the Android shell, which loads it from the relay) runs the build that was
// deployed when the page loaded. The relay serves the deployed build's id as /version.json
// (no-cache, so a check is a 304 most of the time); the shared app polls it (packages/app
// lib/updates.ts) and offers "Reload to update" with the changelog. The APK itself has its own
// notice (useApkUpdate in Remote.tsx).
import type { ChangelogEntry, WebUpdateApi } from "@neuralagent/app";

export const webUpdate: WebUpdateApi = {
  current: __NA_WEB__,
  deployed: async () => {
    const res = await fetch("/version.json", { cache: "no-cache" });
    if (!res.ok) return null; // dev server or an old deploy without the file
    const v = (await res.json()) as { version?: string; build?: string };
    return v.version && v.build ? { version: v.version, build: v.build } : null;
  },
  changelog: async () => {
    const res = await fetch("/changelog.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`changelog: ${res.status}`);
    return ((await res.json()) as { versions: ChangelogEntry[] }).versions;
  },
  reload: () => location.reload(),
};
