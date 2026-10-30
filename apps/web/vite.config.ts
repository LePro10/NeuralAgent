import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { CHANGELOG, readChangelog } from "../../scripts/changelog.mjs";

// One version for everything: the Cargo workspace's (scripts/set-version.mjs).
const version = readFileSync(new URL("../../Cargo.toml", import.meta.url), "utf8").match(/\[workspace\.package\][^[]*?\nversion = "([^"]+)"/)![1]!;
// Changes with every build: the web remote compares it with the relay's /version.json and offers a reload.
const build = `${version}+${Date.now().toString(36)}`;

/**
 * Release data for the pages and clients:
 * - `/version.json` {version, build, built}: the deployed web build (polled by the web remote and the Android shell).
 * - `/changelog.json` {versions}: CHANGELOG.md parsed (the desktop update dialog fetches it from the relay).
 * - `virtual:changelog`: the same data bundled into the /changelog page.
 */
function releaseData(): Plugin {
  return {
    name: "na-release-data",
    resolveId: (id) => (id === "virtual:changelog" ? "\0virtual:changelog" : null),
    load(id) {
      if (id !== "\0virtual:changelog") return null;
      this.addWatchFile(CHANGELOG);
      return `export default ${JSON.stringify(readChangelog())};`;
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version, build, built: new Date().toISOString() }) });
      this.emitFile({ type: "asset", fileName: "changelog.json", source: JSON.stringify({ versions: readChangelog() }) });
    },
  };
}

// Multi-page build. The relay serves dist/ as-is: `/`, `/admin/*`, `/app/*`, `/imprint`, … (see na-relay web.rs).
export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), releaseData()],
  define: { __NA_WEB__: JSON.stringify({ version, build }) },
  // `pnpm dev` talks to a local relay for the API and the OAuth redirects.
  server: {
    port: 5180,
    proxy: { "/api": "http://localhost:8080", "/auth": "http://localhost:8080" },
  },
  build: {
    target: "safari16",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: "index.html",
        admin: "admin/index.html",
        app: "app/index.html",
        notFound: "404.html",
        imprint: "imprint/index.html",
        privacy: "privacy/index.html",
        terms: "terms/index.html",
        download: "download/index.html",
        changelog: "changelog/index.html",
      },
    },
  },
});
