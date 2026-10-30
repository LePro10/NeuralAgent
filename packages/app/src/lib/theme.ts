// Themes: a colour scheme (ground, surfaces, ink; data-scheme) plus an accent (data-accent), both
// from the design tokens. Chosen per device, so a phone can stay pitch black while the desktop
// is graphite. Other windows of the app (the voice HUD) follow through the storage event.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Scheme = "night" | "graphite" | "midnight" | "black" | "dusk" | "forest";
export type Accent = "ice" | "mint" | "ember" | "lilac" | "sand" | "graphite";

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
  setScheme: (scheme: Scheme) => void;
  setAccent: (accent: Accent | null) => void;
}

const KEY = "neuralagent.theme";

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      scheme: "night",
      accent: null,
      setScheme: (scheme) => set({ scheme }),
      setAccent: (accent) => set({ accent }),
    }),
    { name: KEY },
  ),
);

export const accentOf = (scheme: Scheme, accent: Accent | null): Accent =>
  accent ?? SCHEMES.find((s) => s.id === scheme)?.accent ?? "ice";

/** Fired on window after the theme changed, for things that copy colours (xterm). */
export const THEME_EVENT = "neuralagent-theme";

function apply({ scheme, accent }: Pick<ThemeState, "scheme" | "accent">) {
  const html = document.documentElement;
  html.dataset.scheme = scheme;
  html.dataset.accent = accentOf(scheme, accent);
  const bg = getComputedStyle(html).getPropertyValue("--color-bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  window.dispatchEvent(new Event(THEME_EVENT));
}

let started = false;
/** Applies the saved theme now and on every change, also from other windows. */
export function startTheme() {
  if (started || typeof document === "undefined") return;
  started = true;
  apply(useTheme.getState());
  useTheme.subscribe(apply);
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) void useTheme.persist.rehydrate();
  });
}
