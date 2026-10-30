/**
 * AuroraField: the calm colour field behind the whole app. Three large soft
 * lights drift on the compositor (transform only); their colours come from the
 * scheme (`--aurora-1/3`) and the accent (`--aurora-2`), so every theme gets its
 * own tint. Glass surfaces (sidebar, bars, cards) pick the colour up through
 * their translucent fills and backdrop blur.
 *
 * Idea after fluid-goo's Aurora (MIT, (c) 2026 Frech-Dachs): blobs behind glass.
 * No blur filter, no canvas, no JS per frame — it costs one paint, then layers.
 */
import { cn } from '../../lib/cn';

export function AuroraField({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('aurora', className)}>
      <span className="aurora-blob a deko" />
      <span className="aurora-blob b deko" />
      <span className="aurora-blob c deko" />
    </div>
  );
}
