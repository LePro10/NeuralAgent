// The launch screen's first frame, written into every app entry page (desktop index.html and
// dev.html, the web remote /app/) by a Vite plugin, so it paints before any JavaScript runs: the
// appearance/scheme/accent from localStorage, then the NeuralAgent mark centred on the ground.
// lib/launch.ts animates this same element and lifts it once the app is ready; the Android splash
// (apps/android res/drawable/launch_mark_*.xml) draws the identical frame natively. See docs/notes/launch.md.
//
// No <style> element and no `style="…"`: Tauri gives inline <style> tags a CSP nonce, which turns
// off 'unsafe-inline' for the whole desktop page. Styles live in styles/launch.css, which the
// production build links render-blocking in <head>, so they are there for the first paint.
// Kept free of browser and React imports: the Vite configs import it.

/** The mark's panes in the 64-unit grid of BrandMark. The middle one (index 2) carries the accent. */
export const MARK_PANES = [
  { x: 8, y: 8, w: 10, h: 48 },
  { x: 20, y: 9, w: 12, h: 14 },
  { x: 26, y: 25, w: 12, h: 14 },
  { x: 32, y: 41, w: 12, h: 14 },
  { x: 46, y: 8, w: 10, h: 48 },
] as const;

/** Rendered size of the mark (CSS px = Android dp). The native splash draws it the same size. */
export const MARK_PX = 64;

/** Each scheme's own accent, as in lib/theme.ts SCHEMES (a test keeps them equal). */
export const SCHEME_ACCENT: Record<string, string> = { graphite: "graphite", midnight: "lilac", dusk: "ember", forest: "mint" };

/** Sets data-appearance, data-scheme and data-accent on <html> before the first paint. */
export const THEME_SCRIPT =
  `try{var t=(JSON.parse(localStorage.getItem("neuralagent.theme")||"{}").state)||{},a=t.appearance||"system",h=document.documentElement,s=t.scheme||"night";` +
  `h.dataset.appearance=a==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):a;h.dataset.scheme=s;` +
  `h.dataset.accent=t.accent||${JSON.stringify(SCHEME_ACCENT)}[s]||"ice"}catch(e){}`;

/**
 * The launch element: flat ground colour, the ground's lights, an accent bloom and the mark. The
 * mark's panes are plain elements, not SVG: their transforms then run on the compositor and stay
 * smooth while the app's script is still busy starting (SVG children animate on the main thread).
 * Their geometry is in styles/launch.css (a test keeps it equal to MARK_PANES).
 */
export const LAUNCH_MARKUP =
  `<div id="na-launch" aria-hidden="true">` +
  `<div class="nl-ground"></div><div class="nl-bloom"></div>` +
  `<div class="nl-mark">${MARK_PANES.map((_, i) => (i === 2 ? '<i class="nl-a"></i>' : "<i></i>")).join("")}</div>` +
  `</div>`;

/** Where an entry page wants the frame: first thing in <body>. */
export const LAUNCH_MARKER = "<!--launch-->";

/** Vite plugin: replaces `<!--launch-->` in an entry page with the theme script and the frame. */
export function launchFrame() {
  return {
    name: "na-launch-frame",
    transformIndexHtml: (html: string) => (html.includes(LAUNCH_MARKER) ? html.replace(LAUNCH_MARKER, `<script>${THEME_SCRIPT}</script>${LAUNCH_MARKUP}`) : html),
  };
}
