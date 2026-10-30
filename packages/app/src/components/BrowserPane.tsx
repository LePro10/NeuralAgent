import { Callout, cn, useLayoutMode } from "@neuralagent/ui";
import { ExternalLink, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { usePlatform } from "../lib/store";

/** Normalises what was typed: `localhost:3000` → `http://localhost:3000/`. */
export function toUrl(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `${/^(localhost|127\.|\[::1\]|\d+\.\d+\.\d+\.\d+)/.test(t) ? "http" : "https"}://${t}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * A page next to the terminals, usually the dev server of the app an agent is building. It is
 * sandboxed: it can run scripts and use its own origin, but cannot navigate the NeuralAgent window.
 */
export function BrowserPane({ url, onNavigate, onFocus }: { url: string; onNavigate: (url: string) => void; onFocus: () => void }) {
  const platform = usePlatform();
  const [draft, setDraft] = useState(url);
  const [reloads, setReloads] = useState(0);
  useEffect(() => setDraft(url), [url]);

  const go = () => {
    const u = toUrl(draft);
    if (!u) return setDraft(url);
    if (u === url) setReloads((n) => n + 1);
    else onNavigate(u);
  };
  const phone = useLayoutMode() === "phone";
  const btn = cn("hoverable grid shrink-0 place-items-center rounded-full text-dim hover:text-bright", phone ? "size-11" : "size-7");
  const icon = phone ? 18 : 14;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(url);

  return (
    <div className="flex h-full min-h-0 flex-col" onMouseDown={onFocus}>
      <div className={cn("flex shrink-0 items-center gap-1", phone ? "h-14 px-1" : "h-9 px-1.5")}>
        <button
          type="button"
          aria-label="Reload"
          title="Reload"
          onClick={() => setReloads((n) => n + 1)}
          className={btn}
        >
          <RotateCw size={icon} strokeWidth={1.7} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
            if (e.key === "Escape") setDraft(url);
          }}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          aria-label="Address"
          className={cn("min-w-0 flex-1 rounded-full bg-fill-2 text-ink outline-none focus:bg-fill-3", phone ? "h-10 px-4 text-center text-input" : "h-7 px-3 text-meta")}
        />
        <button
          type="button"
          aria-label="Open in browser"
          title="Open in browser"
          onClick={() => platform.openExternal(url)}
          className={btn}
        >
          <ExternalLink size={icon} strokeWidth={1.7} />
        </button>
      </div>
      {platform.kind !== "desktop" && local ? (
        <div className="p-4">
          <Callout tone="neutral" title="Preview runs on the computer">This preview runs on the computer. Open it there; showing it on this device comes with remote previews.</Callout>
        </div>
      ) : (
        <iframe
          key={`${url}#${reloads}`}
          src={url}
          title="Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          className="min-h-0 w-full flex-1 border-0 bg-bright"
        />
      )}
    </div>
  );
}
