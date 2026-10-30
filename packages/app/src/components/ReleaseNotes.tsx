// Release notes from CHANGELOG.md (lib/changelog.ts): used by the update dialog and Settings → Updates.
import { Pill, Skeleton, type Tone } from "@neuralagent/ui";
import { Bug, Sparkles, Wand2, type LucideIcon } from "lucide-react";
import { inlineParts } from "../lib/changelog";
import type { ChangelogEntry } from "../lib/platform";
import { usePlatform } from "../lib/store";

export const CHANGELOG_URL = "https://agent.neuralhub.dev/changelog";

const GROUP: Record<string, { tone: Tone; Icon: LucideIcon }> = {
  New: { tone: "accent", Icon: Sparkles },
  Improved: { tone: "tab", Icon: Wand2 },
  Fixed: { tone: "success", Icon: Bug },
};

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function Inline({ text }: { text: string }) {
  const openExternal = usePlatform().openExternal;
  return (
    <>
      {inlineParts(text).map((p, i) =>
        p.t === "b" ? (
          <span key={i} className="text-bright">{p.s}</span>
        ) : p.t === "code" ? (
          <code key={i} className="rounded-xs bg-fill-2 px-1 font-mono text-small text-ink">{p.s}</code>
        ) : p.t === "link" ? (
          <a key={i} href={p.href} className="text-accent underline underline-offset-2" onClick={(e) => (e.preventDefault(), openExternal(p.href))}>{p.s}</a>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </>
  );
}

/** One or more versions; `heading` shows version and date above each (off for a single version under its own title). */
export function ReleaseNotes({ entries, heading = true }: { entries: ChangelogEntry[] | null; heading?: boolean }) {
  if (entries === null) {
    return (
      <div className="flex flex-col gap-2 py-1" aria-label="Loading release notes">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    );
  }
  if (!entries.length) return <p className="text-small text-dim">No release notes for this version.</p>;
  return (
    <div className="flex flex-col gap-5">
      {entries.map((e) => (
        <section key={e.version} className="flex flex-col gap-3">
          {heading && (
            <header className="flex items-baseline gap-2">
              <h3 className="font-mono text-title text-bright">{e.version}</h3>
              {e.date && <span className="text-detail text-dim">{longDate(e.date)}</span>}
            </header>
          )}
          {e.summary && <p className="text-body text-ink"><Inline text={e.summary} /></p>}
          {e.groups.map((g) => {
            const { tone, Icon } = GROUP[g.title] ?? GROUP.Improved!;
            return (
              <div key={g.title} className="flex flex-col gap-1.5">
                <Pill tone={tone} Icon={Icon} className="self-start">{g.title}</Pill>
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((it) => (
                    <li key={it} className="flex gap-2.5 text-small text-dim">
                      <i className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
                      <span className="min-w-0"><Inline text={it} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
