/**
 * The first screen of a chat: the mark (or a small orb), a greeting that
 * rises out of a mask with the name in dim, and (optionally) suggestions.
 * Shrinks on short screens (landscape phones, keyboard open) so the composer
 * never covers it.
 */
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';
import { LogoLoader } from '../effects/LogoLoader';
import { RevealText } from '../effects/RevealText';
import { AssistantOrb } from './AssistantOrb';

export function EmptyChatHero({ name, greeting = 'How can I help', visual = 'mark', working, orb, children, align = 'center', className }: {
  name?: string; greeting?: string;
  /** The mark at rest (default) or a small voice orb. */
  visual?: 'mark' | 'orb';
  /** The mark runs its light (e.g. while context loads). */
  working?: boolean;
  /** Replace the visual entirely (e.g. a particle sphere). */
  orb?: ReactNode;
  /** Suggestions under the greeting. */
  children?: ReactNode;
  align?: 'center' | 'start';
  className?: string;
}) {
  const center = align === 'center';
  return (
    <div className={cn('flex flex-col', center ? 'items-center text-center' : 'items-start', className)}>
      <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: EASE.outSoft }} className="text-bright">
        {orb ?? (visual === 'orb'
          ? <AssistantOrb size={56} className="[@media(max-height:700px)]:!h-10 [@media(max-height:700px)]:!w-10" />
          : <LogoLoader size={40} active={!!working} label="Getting ready" className="[@media(max-height:700px)]:h-8 [@media(max-height:700px)]:w-8" />)}
      </motion.div>
      <RevealText as="h1" delay={0.12} className="display mt-5 text-display @min-[700px]:text-display-lg [@media(max-height:700px)]:mt-3 [@media(max-height:700px)]:text-headline">
        {/* Explicit lines: RevealText treats every child as a line, so the name gets its own (dim) one. */}
        {name ? <RevealText.Line>{greeting},</RevealText.Line> : <RevealText.Line>{greeting}?</RevealText.Line>}
        {name && <RevealText.Line className="text-dim">{name}?</RevealText.Line>}
      </RevealText>
      {children && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.3 }} className="mt-6 w-full max-w-[540px]">{children}</motion.div>
      )}
    </div>
  );
}
