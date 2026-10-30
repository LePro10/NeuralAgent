import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { launchFrame } from "../../packages/app/src/lib/launchFrame";

// Tauri expects a fixed port and must see Rust-side errors in the terminal.
export default defineConfig({
  plugins: [react(), tailwindcss(), launchFrame()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "safari16",
    chunkSizeWarningLimit: 4000,
    // Audio worklets must stay real files: inlined as data: URLs, the CSP (script-src 'self') blocks them.
    assetsInlineLimit: (file: string) => (file.endsWith("worklet.js") ? false : undefined),
    // Second page: the listening pill window.
    rollupOptions: { input: { main: "index.html", hud: "hud.html" } },
  },
});
