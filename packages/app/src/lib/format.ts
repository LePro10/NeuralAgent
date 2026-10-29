import type { TokenCounts } from "@neuralagent/protocol";

/** 1234 -> "1.2k", 1_200_000 -> "1.2M". */
export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export const totalTokens = (t: TokenCounts) => t.input + t.output + t.cache_read + t.cache_write;

/** Dollar amount; tiny values keep a cent of precision. */
export function money(usd: number): string {
  return `$${usd < 0.1 && usd > 0 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

/** Milliseconds as "3 h 12 min" / "12 min" / "< 1 min". */
export function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return ms > 0 ? "< 1 min" : "0 min";
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}
