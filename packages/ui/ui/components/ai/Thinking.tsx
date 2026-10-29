/**
 * "Working" indicators, quietest first. Use the one that matches what you
 * actually know: a label if you know what is happening (shimmer), dots if
 * you only know *that* something is happening, the mark at work for the
 * assistant itself (default) — the orb only where it is the assistant's face.
 */
import { motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { LogoLoader } from '../effects/LogoLoader';
import { Shimmer } from '../effects/Shimmer';
import { AssistantOrb } from './AssistantOrb';

export type ThinkingVariant = 'mark' | 'shimmer' | 'dots' | 'orb' | 'pulse';

export function ThinkingIndicator({ variant = 'mark', label = 'Thinking', className }: { variant?: ThinkingVariant; label?: string; className?: string }) {
  const text = `${label.replace(/[.…]+$/, '')}…`;
  if (variant === 'mark') {
    return (
      <span role="status" className={cn('inline-flex items-center gap-2 text-chip', className)}>
        <LogoLoader size={15} className="text-ink" label={text} />
        <Shimmer>{text}</Shimmer>
      </span>
    );
  }
  if (variant === 'dots') {
    return (
      <span role="status" aria-label={text} className={cn('inline-flex h-5 items-center gap-[5px]', className)}>
        {[0, 1, 2].map((i) => (
          <motion.i key={i} className="deko h-[5px] w-[5px] rounded-full bg-dim"
            animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.13 }} />
        ))}
      </span>
    );
  }
  if (variant === 'orb') {
    return (
      <span role="status" className={cn('inline-flex items-center gap-2 text-chip', className)}>
        <AssistantOrb size={16} state="busy" />
        <Shimmer>{text}</Shimmer>
      </span>
    );
  }
  if (variant === 'pulse') {
    return (
      <span role="status" className={cn('inline-flex items-center gap-2 text-chip text-dim', className)}>
        <span className="relative grid h-4 w-4 place-items-center">
          <motion.i className="absolute inset-0 rounded-full border-hair border-tab/60" animate={{ scale: [0.5, 1.3], opacity: [0.9, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }} />
          <i className="h-1.5 w-1.5 rounded-full bg-tab" />
        </span>
        {text}
      </span>
    );
  }
  return <span role="status" className={cn('text-chip', className)}><Shimmer>{text}</Shimmer></span>;
}
