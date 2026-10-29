import type { CatalogEntry, Profile } from "@neuralagent/protocol";

/** What can start right now: the terminal, custom profiles, and built-in agents whose CLI is installed. */
export function launchable(profiles: Profile[] | undefined, catalog: CatalogEntry[] | undefined): Profile[] {
  const installed = new Set((catalog ?? []).filter((c) => c.installed).map((c) => c.id));
  return (profiles ?? []).filter((p) => !p.builtin || p.engine === "shell" || installed.has(p.engine));
}

/** Splits an argument line like a shell would for simple cases: spaces, and '…' or "…" quotes. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

export function joinArgs(args: string[]): string {
  return args.map((a) => (a === "" || /[\s'"]/.test(a) ? `"${a.replace(/"/g, "'")}"` : a)).join(" ");
}
