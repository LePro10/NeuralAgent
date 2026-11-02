/** Formatting for the kept dictations (D85, `components/settings/DictationHistory.tsx`). */

/** "18:04" today, "Mon 18:04" within six days, "2 Nov, 18:04" before. */
export function dictationTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  if (now - at < 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** Words in a dictation, for the "· 312 words" line. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
