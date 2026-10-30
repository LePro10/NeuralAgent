/** Claude's clay spark: a burst of uneven rays. It turns and breathes while Claude works. */
import { cn } from "@neuralagent/ui";

const RAYS = [1, 0.74, 0.93, 0.68, 0.98, 0.8, 0.9, 0.7, 1, 0.77, 0.94, 0.72];

const lines = RAYS.map((len, i) => {
  const a = ((i * 360) / RAYS.length + (i % 2 ? 7 : -4)) * (Math.PI / 180);
  const r = 10.6 * len;
  return { x1: 12 + Math.cos(a) * 1.6, y1: 12 + Math.sin(a) * 1.6, x2: 12 + Math.cos(a) * r, y2: 12 + Math.sin(a) * r };
});

export function Spark({ size = 18, spinning = false, className }: { size?: number; spinning?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0 text-cv-clay", spinning && "animate-cv-spark", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.3}
      strokeLinecap="round"
    >
      {lines.map((l, i) => (
        <line key={i} {...l} />
      ))}
    </svg>
  );
}
