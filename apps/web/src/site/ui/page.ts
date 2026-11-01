import { startScrollLoop } from "./hooks";
import { countVisits } from "./hit";

/**
 * Call once, before React renders, from every marketing page entry:
 *  - marks <html class="na-js"> so entrance animations may hide things (without JS everything stays visible)
 *  - starts the shared scroll loop (`data-scrolled` on <html> after 24 px, `--page` 0-1)
 */
export function initPage() {
  document.documentElement.classList.add("na-js");
  startScrollLoop();
  smoothAnchors();
  countVisits();
}

/**
 * In-page links ("#security", "/#faq" on the landing) scroll smoothly; everything else (focus moves, find-in-page, the
 * keyboard) jumps. CSS `scroll-behavior: smooth` on <html> would animate every one of them, so it is switched on only for
 * the moment after such a click (`html[data-smooth]`, see foundation.css). Reduced motion never gets it.
 */
function smoothAnchors() {
  const root = document.documentElement;
  let timer = 0;
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const to = new URL(a.href, location.href);
      const bare = (p: string) => p.replace(/\/(index\.html)?$/, "");
      if (to.origin !== location.origin || !to.hash || bare(to.pathname) !== bare(location.pathname)) return;
      root.setAttribute("data-smooth", "");
      clearTimeout(timer);
      timer = window.setTimeout(() => root.removeAttribute("data-smooth"), 1500);
    },
    true,
  );
}

/**
 * Scrolls to `location.hash` once the page has rendered (the browser tries too early: React mounts after load).
 * Call from an effect in the page component. Sections have `scroll-margin` through html scroll-padding-top.
 */
export function scrollToHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const go = () => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "auto" });
  requestAnimationFrame(() => {
    go();
    setTimeout(go, 350); // late layout (fonts, images, iframes)
  });
}
