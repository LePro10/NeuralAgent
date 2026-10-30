/**
 * Calm connection indicator: a small material pill that drops in under the
 * status bar — only once the connection has been gone for a while (the caller
 * decides; ~2–3 s, so a phone waking up never flashes it). Never a banner,
 * never blocks the page; pointer-events pass through.
 */
import { AnimatePresence, motion } from 'motion/react';
import { SPRING } from '../../lib/motion';

export function ConnectionPill({ show, label = 'Reconnecting…' }: { show: boolean; label?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="conn"
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 z-[var(--z-toast)] flex justify-center"
          style={{ top: 'calc(var(--safe-top) + 6px)' }}
          initial={{ opacity: 0, y: -16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.94, transition: { duration: 0.2 } }}
          transition={SPRING.pop}
        >
          <span className="material flex h-8 items-center gap-2 rounded-full pr-3.5 pl-3 text-footnote text-ink">
            <i className="spinner shrink-0" style={{ ['--size' as string]: '12px' }} />
            {label}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
