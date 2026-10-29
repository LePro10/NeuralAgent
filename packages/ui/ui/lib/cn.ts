/** Joins class names, skipping falsy values. No merging: components never need to override their own classes. */
export function cn(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(' ');
}
