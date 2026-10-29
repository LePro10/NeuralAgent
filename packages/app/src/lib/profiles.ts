import type { CatalogEntry, Profile } from "@neuralagent/protocol";

/** What can start right now: the terminal, custom profiles, and built-in agents whose CLI is installed. */
export function launchable(profiles: Profile[] | undefined, catalog: CatalogEntry[] | undefined): Profile[] {
  const installed = new Set((catalog ?? []).filter((c) => c.installed).map((c) => c.id));
  return (profiles ?? []).filter((p) => !p.builtin || p.engine === "shell" || installed.has(p.engine));
}
