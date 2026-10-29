/** The NeuralAgent mark: an N built from terminal panes (docs/brand/neuralagent-mark.svg). */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden fill="currentColor">
      <rect x="8" y="8" width="10" height="48" rx="3" />
      <rect x="46" y="8" width="10" height="48" rx="3" />
      <rect x="20" y="9" width="12" height="14" rx="3" />
      <rect x="26" y="25" width="12" height="14" rx="3" className="text-accent" fill="currentColor" style={{ color: "var(--color-accent)" }} />
      <rect x="32" y="41" width="12" height="14" rx="3" />
    </svg>
  );
}
