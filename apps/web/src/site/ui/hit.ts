// Cookieless visit counting (docs/notes/insights.md): one anonymous beacon per page view to the
// relay (`/api/hit`, page path and referrer host only; the relay derives the country and keeps
// no IP), and one per download click (`download:<kind>`). No cookie, no id, nothing stored in
// the browser, so the site needs no consent banner. Do Not Track and Global Privacy Control are
// respected here and again on the relay. The dev server and the demo frame send nothing.

function allowed(): boolean {
  if (import.meta.env.DEV) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack !== "1" && nav.globalPrivacyControl !== true && window.top === window;
}

function beacon(body: Record<string, string>) {
  try {
    const data = new Blob([JSON.stringify(body)], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/hit", data)) void fetch("/api/hit", { method: "POST", body: data, keepalive: true }).catch(() => {});
  } catch {
    /* counting must never break the page */
  }
}

/** Kind of a download link (`/download/latest/mac` → `mac`), else null. */
export function downloadKind(href: string): string | null {
  const m = /^\/download\/[^/]+\/([a-z0-9._-]+)$/i.exec(href);
  if (!m) return null;
  const last = m[1]!.toLowerCase();
  return last.includes(".") ? last.replace(/^.*\.(dmg|exe|msi|deb|rpm|appimage|apk|zip|tar\.gz)$/, "$1") : last;
}

export function countVisits() {
  if (!allowed()) return;
  let ref = "";
  try {
    ref = document.referrer ? new URL(document.referrer).origin : "";
  } catch {
    /* no referrer */
  }
  beacon({ path: location.pathname, referrer: ref });
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, location.href);
      const kind = url.origin === location.origin ? downloadKind(url.pathname) : null;
      if (kind) beacon({ path: location.pathname, event: `download:${kind}` });
    },
    { capture: true },
  );
}
