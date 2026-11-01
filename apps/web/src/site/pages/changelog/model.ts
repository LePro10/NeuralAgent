// The changelog as the page needs it: ids, anchors, titles. Data: `virtual:changelog` (CHANGELOG.md parsed at build time
// by scripts/changelog.mjs, see vite.config.ts). The page never reads the file itself.
import versions from "virtual:changelog";

export type Release = (typeof versions)[number];

export const hasItems = (r: Release) => r.groups.some((g) => g.items.length > 0);
export const released = versions.filter((r) => !r.unreleased && hasItems(r));
export const next = versions.find((r) => r.unreleased && hasItems(r)) ?? null;
/** Newest first: the unreleased section (if it has entries), then every release. */
export const list: Release[] = next ? [next, ...released] : released;
export const latest = released[0] ?? null;

/** Anchor of a release: `v0.3.4`; the unreleased section is `next`. */
export const idOf = (r: Release) => (r.unreleased ? "next" : `v${r.version}`);
export const ids = list.map(idOf);
export const count = (r: Release) => r.groups.reduce((n, g) => n + g.items.length, 0);

/**
 * The release a URL hash points at. Accepts `#v0.3.4` (current), `#0.3.4`, `#v0-3-4` (the form the site used before,
 * still in old links) and `#next` / `#unreleased`.
 */
export function fromHash(hash: string): string | null {
  let h = hash.replace(/^#/, "");
  try {
    h = decodeURIComponent(h);
  } catch {
    /* keep the raw text */
  }
  h = h.toLowerCase();
  if (!h) return null;
  if (h === "next" || h === "unreleased") return next ? "next" : null;
  const v = h.replace(/^v/, "").replace(/-/g, ".");
  const hit = released.find((r) => r.version === v);
  return hit ? idOf(hit) : null;
}

export interface GroupMeta { label: string; one: string; many: string }
/** The three groups CHANGELOG.md allows (scripts/changelog.mjs GROUPS). */
export const GROUP: Record<string, GroupMeta> = {
  New: { label: "New", one: "new", many: "new" },
  Improved: { label: "Improved", one: "improved", many: "improved" },
  Fixed: { label: "Fixed", one: "fixed", many: "fixed" },
};
export const groupMeta = (title: string): GroupMeta => GROUP[title] ?? GROUP.Improved!;

/** One line for releases without a summary: "2 fixes", "1 improvement and 1 fix". */
export function autoTitle(r: Release): string {
  const noun: Record<string, [string, string]> = { New: ["new feature", "new features"], Improved: ["improvement", "improvements"], Fixed: ["fix", "fixes"] };
  const parts = r.groups.filter((g) => g.items.length).map((g) => {
    const [one, many] = noun[g.title] ?? noun.Improved!;
    return `${g.items.length} ${g.items.length === 1 ? one : many}`;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}
