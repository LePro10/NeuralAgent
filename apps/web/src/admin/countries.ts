// Country helpers: flag emoji from a 2-letter code and a display name.

const names = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

const FALLBACK: Record<string, string> = {
  DE: "Germany", US: "United States", GB: "United Kingdom", FR: "France", AT: "Austria", CH: "Switzerland",
  NL: "Netherlands", ES: "Spain", IT: "Italy", CA: "Canada", AU: "Australia", IN: "India", BR: "Brazil",
  JP: "Japan", CN: "China", PL: "Poland", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
};

const valid = (cc?: string | null): cc is string => !!cc && /^[A-Za-z]{2}$/.test(cc) && cc !== "--";

export function flag(cc?: string | null): string {
  if (!valid(cc)) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function countryName(cc?: string | null): string {
  if (!valid(cc)) return "Unknown";
  const up = cc.toUpperCase();
  try {
    return names?.of(up) ?? FALLBACK[up] ?? up;
  } catch {
    return FALLBACK[up] ?? up;
  }
}

/** "🇩🇪 DE" or "—". */
export const countryTag = (cc?: string | null) => (valid(cc) ? `${flag(cc)} ${cc.toUpperCase()}` : "—");

/** "🇩🇪 Germany" or "Unknown". */
export const countryLabel = (cc?: string | null) => (valid(cc) ? `${flag(cc)} ${countryName(cc)}` : "Unknown");
