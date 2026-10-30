import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Multi-page build. The relay serves dist/ as-is: `/`, `/admin/*`, `/app/*`, `/imprint`, … (see na-relay web.rs).
export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
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
      },
    },
  },
});
