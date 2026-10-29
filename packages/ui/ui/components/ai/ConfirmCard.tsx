/**
 * Approval before an external or irreversible action (send a mail, pay,
 * delete for good). It states exactly what will happen, then two buttons.
 * Once decided, the card folds into one line — the decision stays visible,
 * the noise goes away.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Check, ShieldCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { EASE, SPRING } from '../../lib/motion';
import { Button } from '../core/Button';

export type Decision = 'approved' | 'denied' | null;

export function ConfirmCard({ title, detail, children, decision, onDecide, approveLabel = 'Allow', denyLabel = 'Deny', danger, className }: {
  title: string;
  detail?: ReactNode;
  /** Preview of what happens (recipient, amount, diff …). */
  children?: ReactNode;
  decision: Decision;
  onDecide: (d: Exclude<Decision, null>) => void;
  approveLabel?: string;
  denyLabel?: string;
  /** Destructive: the approve button turns red. */
  danger?: boolean;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {decision ? (
        <motion.div key="done" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE.outSoft }}
          className={cn('flex items-center gap-2 overflow-hidden py-1 text-small', className)}>
          <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={SPRING.pop} className={cn('grid h-[18px] w-[18px] place-items-center rounded-full', decision === 'approved' ? 'bg-mint/15 text-mint' : 'bg-fill-3 text-dim')}>
            {decision === 'approved' ? <Check size={10} strokeWidth={2.8} /> : <X size={10} strokeWidth={2.8} />}
          </motion.span>
          <span className="truncate text-dim"><span className="text-ink">{decision === 'approved' ? 'Allowed' : 'Denied'}:</span> {title}</span>
        </motion.div>
      ) : (
        <motion.div key="ask" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }} transition={SPRING.pop}
          className={cn('card overflow-hidden !rounded-list', className)}>
          <div className="flex gap-2.5 px-3.5 pt-3.5">
            <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full', danger ? 'bg-danger/[.12] text-danger' : 'bg-tab/[.12] text-tab')}><ShieldCheck size={14} strokeWidth={1.7} /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-body leading-snug text-bright">{title}</p>
              {detail && <p className="mt-0.5 text-small leading-relaxed text-dim">{detail}</p>}
            </div>
          </div>
          {children && <div className="mx-3.5 mt-2.5 rounded-field bg-fill-2 px-3 py-2.5 text-small text-ink">{children}</div>}
          <div className="flex justify-end gap-1.5 px-3.5 pt-3 pb-3.5">
            <Button size="sm" variant="ghost" onClick={() => { haptic('select'); onDecide('denied'); }}>{denyLabel}</Button>
            <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={() => { haptic('heavy'); onDecide('approved'); }}>{approveLabel}</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
