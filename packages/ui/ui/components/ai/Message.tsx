/**
 * Messages. The user speaks in a bubble (right, tail at the bottom-right);
 * the assistant does not — its answer is plain text on the page, like a
 * document, with a quiet action row under it. Long user messages are clipped
 * with a fade and expand on tap.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Copy, RotateCcw, ThumbsDown, ThumbsUp, Volume2, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';

/** The user's message. `clip` = max height before it folds (px). */
export function UserBubble({ children, attachments, time, clip = 176, animate = true, className }: {
  children: ReactNode; attachments?: ReactNode; time?: string; clip?: number; animate?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(0);
  useLayoutEffect(() => { const el = ref.current; if (el) { setFull(el.scrollHeight); setLong(el.scrollHeight > clip + 24); } }, [children, clip]);
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 8, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING.pop}
      style={{ transformOrigin: '100% 100%' }}
      className={cn('ml-auto flex max-w-[min(82%,520px)] flex-col items-end gap-1', className)}
    >
      {attachments && <div className="flex flex-wrap justify-end gap-1.5">{attachments}</div>}
      <div className="selectable relative rounded-card rounded-br-chip bg-fill-3 px-3.5 py-2 text-body leading-[1.5] text-bright">
        <div ref={ref} className={cn('overflow-hidden whitespace-pre-wrap break-words transition-[max-height] duration-500 ease-out-soft', long && !open && '[mask-image:linear-gradient(180deg,#000_55%,transparent)]')}
          style={{ maxHeight: long ? (open ? full : clip) : undefined }}>
          {children}
        </div>
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="-mb-1 flex h-7 items-center gap-1 text-meta text-dim hover:text-ink">
            {open ? 'Show less' : 'Show all'}
            <ChevronDown size={12} strokeWidth={1.75} className="transition-transform duration-300 ease-out-soft" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
          </button>
        )}
      </div>
      {time && <span className="px-1 text-tiny text-faint tabular">{time}</span>}
    </motion.div>
  );
}

/** The assistant's answer: no bubble. Optional header (trace), body, footer (sources, actions). */
export function AssistantMessage({ header, children, footer, className }: { header?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cn('max-w-[660px]', className)}>
      {header}
      {children}
      {footer && <div className="mt-3 space-y-2.5">{footer}</div>}
    </div>
  );
}

export type Feedback = 'up' | 'down' | null;

/**
 * Quiet action row: copy (morphs to a check), retry, read aloud, feedback.
 * The icons draw at 30px but keep a 44px touch target. `meta` is a faint
 * line at the end (model, tokens, time) — trust signals, not decoration.
 */
export function MessageActions({ text, onRetry, onSpeak, feedback, onFeedback, meta, extra, className }: {
  text?: string; onRetry?: () => void; onSpeak?: () => void; feedback?: Feedback; onFeedback?: (f: Feedback) => void; meta?: ReactNode;
  extra?: { label: string; Icon: LucideIcon; onClick: () => void }[];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn('-ml-2 flex items-center', className)}>
      {text !== undefined && (
        <Act label={copied ? 'Copied' : 'Copy'} onClick={async () => { try { await navigator.clipboard.writeText(text); } catch { /* insecure context */ } haptic('success'); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={copied ? 'y' : 'n'} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.14 }}>
              {copied ? <Check size={14} strokeWidth={2} className="text-mint" /> : <Copy size={14} strokeWidth={1.6} />}
            </motion.span>
          </AnimatePresence>
        </Act>
      )}
      {onRetry && <Act label="Retry" onClick={onRetry}><RotateCcw size={14} strokeWidth={1.6} /></Act>}
      {onSpeak && <Act label="Read aloud" onClick={onSpeak}><Volume2 size={14} strokeWidth={1.6} /></Act>}
      {onFeedback && (
        <>
          <Act label="Good answer" active={feedback === 'up'} onClick={() => onFeedback(feedback === 'up' ? null : 'up')}><ThumbsUp size={14} strokeWidth={1.6} /></Act>
          <Act label="Bad answer" active={feedback === 'down'} onClick={() => onFeedback(feedback === 'down' ? null : 'down')}><ThumbsDown size={14} strokeWidth={1.6} /></Act>
        </>
      )}
      {extra?.map((x) => <Act key={x.label} label={x.label} onClick={x.onClick}><x.Icon size={14} strokeWidth={1.6} /></Act>)}
      {meta && <span className="ml-1.5 truncate text-tiny text-faint">{meta}</span>}
    </div>
  );
}

function Act({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={() => { haptic('select'); onClick(); }}
      className={cn('pressable relative grid h-[30px] w-[30px] place-items-center rounded-full transition-colors after:absolute after:-inset-[7px] after:content-[""]',
        active ? 'bg-fill-3 text-bright' : 'text-faint hover:bg-fill-2 hover:text-bright')}>
      {children}
    </button>
  );
}

/** Day / section divider in a long conversation. */
export function ChatDivider({ children }: { children: ReactNode }) {
  return (
    <div className="my-5 flex items-center gap-3" role="separator">
      <span className="h-[var(--hair)] flex-1 bg-line" /><span className="text-tiny text-faint tabular">{children}</span><span className="h-[var(--hair)] flex-1 bg-line" />
    </div>
  );
}
