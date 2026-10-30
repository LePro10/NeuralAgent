// Injected by apps/web/vite.config.ts (`define` and the `virtual:changelog` module).

/** This bundle's version (Cargo workspace) and build id; `/version.json` on the relay says the deployed one. */
declare const __NA_WEB__: { version: string; build: string };

/** CHANGELOG.md parsed by scripts/changelog.mjs (same shape as scripts/changelog.d.mts). */
declare module "virtual:changelog" {
  const versions: {
    version: string;
    date: string | null;
    unreleased: boolean;
    summary: string;
    groups: { title: string; items: string[] }[];
  }[];
  export default versions;
}
