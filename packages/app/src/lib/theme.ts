// Themes: a colour scheme (ground, surfaces, ink; data-scheme) plus an accent (data-accent) and an
// appearance (System/Light/Dark → data-appearance="light"|"dark"), all from the design tokens. Chosen per device, so a phone can stay pitch black while the desktop
// is graphite. Other windows of the app (the voice HUD) follow through the storage event.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Scheme = "night" | "graphite" | "midnight" | "black" | "dusk" | "forest";
export type Accent = "ice" | "mint" | "ember" | "lilac" | "sand" | "graphite";
export type Appearance = "system" | "light" | "dark";

export const APPEARANCES: { id: Appearance; name: string }[] = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

export const SCHEMES: { id: Scheme; name: string; accent: Accent }[] = [
  { id: "night", name: "Night", accent: "ice" },
  { id: "graphite", name: "Graphite", accent: "graphite" },
  { id: "midnight", name: "Midnight", accent: "lilac" },
  { id: "black", name: "Black", accent: "ice" },
  { id: "dusk", name: "Dusk", accent: "ember" },
  { id: "forest", name: "Forest", accent: "mint" },
];

export const ACCENTS: { id: Accent; name: string }[] = [
  { id: "ice", name: "Ice" },
  { id: "mint", name: "Mint" },
  { id: "ember", name: "Ember" },
  { id: "lilac", name: "Lilac" },
  { id: "sand", name: "Sand" },
  { id: "graphite", name: "Graphite" },
];

interface ThemeState {
  scheme: Scheme;
  /** null: the scheme's own accent. */
  accent: Accent | null;
  /** System follows the OS (prefers-color-scheme). */
  appearance: Appearance;
  setScheme: (scheme: Scheme) => void;
  setAccent: (accent: Accent | null) => void;
  setAppearance: (appearance: Appearance) => void;
}

const KEY = "neuralagent.theme";

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      scheme: "night",
      accent: null,
      appearance: "system",
      setScheme: (scheme) => set({ scheme }),
      setAccent: (accent) => set({ accent }),
      setAppearance: (appearance) => set({ appearance }),
    }),
    { name: KEY },
  ),
);

export const accentOf = (scheme: Scheme, accent: Accent | null): Accent =>
  accent ?? SCHEMES.find((s) => s.id === scheme)?.accent ?? "ice";

/** Fired on window after the theme changed, for things that copy colours (xterm). */
export const THEME_EVENT = "neuralagent-theme";

const darkQuery = () =>
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

/** The appearance actually shown: "system" resolved against the OS. */
export function resolvedAppearance(appearance: Appearance = useTheme.getState().appearance ?? "system"): "light" | "dark" {
  if (appearance !== "system") return appearance;
  return darkQuery()?.matches === false ? "light" : "dark";
}

/** Paints the browser/OS chrome (status bar, PWA title bar) in the colour at the top of the app. */
export function syncThemeColor() {
  const html = document.documentElement;
  const bg = getComputedStyle(html).getPropertyValue("--color-bg").trim();
  if (!bg) return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", bg);
    // Our choice wins over the page's prefers-color-scheme variants.
    meta.removeAttribute("media");
  }
}

function apply({ scheme, accent, appearance }: Pick<ThemeState, "scheme" | "accent" | "appearance">) {
  const html = document.documentElement;
  html.dataset.scheme = scheme;
  html.dataset.accent = accentOf(scheme, accent);
  html.dataset.appearance = resolvedAppearance(appearance ?? "system");
  syncThemeColor();
  window.dispatchEvent(new Event(THEME_EVENT));
}

let started = false;
/** Applies the saved theme now and on every change, also from other windows. */
export function startTheme() {
  if (started || typeof document === "undefined") return;
  started = true;
  apply(useTheme.getState());
  useTheme.subscribe(apply);
  darkQuery()?.addEventListener("change", () => {
    if (useTheme.getState().appearance === "system") apply(useTheme.getState());
  });
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) void useTheme.persist.rehydrate();
  });
}
