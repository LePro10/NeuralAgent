import type { CSSProperties } from "react";

/** Colour pairs for a page's light: [left, right, centre] as colour tokens. */
const TINTS = {
  neural: ["--color-accent-deep", "--color-sys-purple", "--color-sys-teal"],
  agents: ["--color-accent-deep", "--color-sys-indigo", "--color-sys-teal"],
  swarm: ["--color-sys-purple", "--color-sys-pink", "--color-accent-deep"],
  history: ["--color-sys-teal", "--color-accent-deep", "--color-sys-indigo"],
  usage: ["--color-sys-green", "--color-sys-teal", "--color-accent-deep"],
  mcp: ["--color-sys-orange", "--color-sys-purple", "--color-accent-deep"],
} as const;

/**
 * Soft coloured light at the top of a page (behind the content), over the app's ground. Works on
 * light and dark grounds: the colours are mixed into transparency, never painted as a dark or white
 * slab. The page's own colours lean toward the accent, so every page still reads in the theme.
 */
export function Glow({ tint = "neural", className }: { tint?: keyof typeof TINTS; className?: string }) {
  const [a, b, c] = TINTS[tint];
  const style: CSSProperties = {
    background: [
      `radial-gradient(70% 60% at 10% 0%, color-mix(in oklab, var(${a}) 30%, transparent), transparent 72%)`,
      `radial-gradient(55% 50% at 94% 6%, color-mix(in oklab, color-mix(in oklab, var(${b}) 55%, var(--color-accent-deep)) 22%, transparent), transparent 70%)`,
      `radial-gradient(45% 40% at 55% 0%, color-mix(in oklab, color-mix(in oklab, var(${c}) 55%, var(--color-accent-deep)) 12%, transparent), transparent 70%)`,
    ].join(", "),
  };
  return <div aria-hidden="true" className={className ?? "pointer-events-none absolute inset-x-0 top-0 h-80"} style={style} />;
}
