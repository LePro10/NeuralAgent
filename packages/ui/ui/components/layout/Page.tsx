/**
 * A scrollable screen with a large title — and the one owner of page spacing.
 *
 * Phones (iOS anatomy): a 44px nav bar under the status bar holds back (left)
 * and actions (right). The large title (34px) sits in the content and scrolls
 * away; as it passes under the bar, a small centred title fades in and the bar
 * turns into frosted material with a hairline. Back comes from `onBack`, or
 * from the shell's NavPage (useNavBack) for pushed pages.
 * Desktop: the title line carries the actions; a soft fade appears on scroll.
 *
 * A page belongs to a place: `place="plan"` gives it the place's light
 * (ambient SVG) and its signal colour (`--color-tab`, used by text-tab,
 * bg-tab, Button tint …). Both can also be set on their own.
 *
 * Spacing contract — nothing else adds space around a page:
 *   top     safe area + 44px bar
 *   sides   16px phone / 32px desktop
 *   width   920px max (`wide` 1200px)
 *   bottom  var(--tabbar-space) + 24px, so the end is never under a tab bar
 *   left    var(--sidebar-space): the light runs under a floating sidebar,
 *           the content stays clear of it
 *
 * Phone/desktop is decided by the page's own width (container query), so a
 * page in a narrow pane or a device preview behaves like a phone.
 */
import { motion, useMotionValueEvent, useScroll, useTransform } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/cn';
import { EASE } from '../../lib/motion';
import { useNavBack } from '../../lib/navigation';
import { PLACES, type AmbientName, type Place, type Signal } from '../../lib/tokens';
import { Ambient, type AmbientMotion } from '../effects/Ambient';

export interface PageProps {
  title: string;
  eyebrow?: string;
  /** Top-right actions (IconButtons, a small Button). */
  actions?: ReactNode;
  /** Shows a back button labelled with the previous level. */
  backLabel?: string;
  onBack?: () => void;
  /** Between title and body (search field, segmented control). */
  header?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Replaces the large title (e.g. a date with a weekday). */
  heading?: ReactNode;
  /** Light + signal colour of a place in one go. */
  place?: Place;
  /** Signal colour of this page (overrides the place's). */
  signal?: Signal;
  /** Ambient light: a named palette, five colours, or false for none (overrides the place's). */
  ambient?: AmbientName | readonly string[] | false;
  ambientMotion?: AmbientMotion;
  /** Title rises out of a mask when the page opens. */
  reveal?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Scrolls to top when this value changes (re-tapping the active tab). */
  scrollTopKey?: unknown;
  className?: string;
}

/** Scroll distance over which the large title hands over to the inline one. */
const HANDOFF: [number, number] = [26, 46];

/** iOS back button: accent chevron + the previous level's title. */
/** iOS back: accent chevron + previous title. `compact` shows the chevron only (crowded bars). */
export function BackButton({ label, onBack, compact }: { label: string; onBack: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onBack} aria-label={`Back to ${label}`}
      className={cn('pressable flex h-tap min-w-tap items-center gap-0.5 rounded-full text-body text-accent', compact ? 'justify-center' : '-ml-2 pr-2')}>
      <ChevronLeft className="size-icon-lg" strokeWidth={2} />
      {!compact && <span className="max-w-[34vw] truncate">{label}</span>}
    </button>
  );
}

export function Page({ title, eyebrow, actions, backLabel, onBack, header, children, wide, heading, place, signal, ambient, ambientMotion, reveal = true, scrollRef, scrollTopKey, className }: PageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: ref });
  const ctx = useNavBack();
  const back = onBack ? { label: backLabel ?? 'Back', onBack } : ctx;
  // Inline title and bar material arrive together as the large title slides under the bar.
  const inline = useTransform(scrollY, HANDOFF, [0, 1]);
  const inlineY = useTransform(scrollY, HANDOFF, [6, 0]);
  // Only a boolean crosses into React; scrolling itself never re-renders the page.
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 2));

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    ref.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollTopKey]);

  const sig = signal ?? (place ? PLACES[place].signal : undefined);
  const light = ambient === false ? null : ambient ?? (place ? PLACES[place].ambient : undefined);
  const width = wide ? 'max-w-[1200px]' : 'max-w-[920px]';

  const titleNode = heading ?? <h1 className="text-large-title text-bright @min-[900px]:display @min-[900px]:text-display-lg">{title}</h1>;

  return (
    <div data-signal={sig} className={cn('@container relative h-full', className)}>
      {/* Nav bar: back, inline title, actions. Material fades in with the inline title (phones). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20" style={{ paddingTop: 'var(--safe-top)', paddingLeft: 'var(--sidebar-space, 0px)' }}>
        {scrolled && (
          <>
            <motion.div aria-hidden="true" className="absolute inset-0 border-b-hair border-line bg-navbar backdrop-blur-xl backdrop-saturate-150 @min-[900px]:hidden" style={{ opacity: inline }} />
            <div className="top-fade fade-in @max-[899px]:hidden" />
          </>
        )}
        <div className={cn('relative mx-auto grid h-navbar w-full grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 @min-[900px]:mt-3 @min-[900px]:h-[52px] @min-[900px]:px-8', width)}>
          <div className="pointer-events-auto flex min-w-0">{back && <BackButton label={back.label} onBack={back.onBack} />}</div>
          <motion.div aria-hidden="true" className="max-w-[52vw] truncate text-headline text-bright @min-[900px]:hidden" style={{ opacity: inline, y: inlineY }}>{title}</motion.div>
          <div className={cn('pointer-events-auto flex min-w-0 items-center justify-end gap-1', !back && '@min-[900px]:hidden')}>{actions}</div>
        </div>
      </div>

      <div ref={(n) => { ref.current = n; if (scrollRef) scrollRef.current = n; }} className="scroller page-scroll relative h-full"
        style={{ paddingTop: 'calc(var(--safe-top) + var(--spacing-navbar))', paddingBottom: 'calc(var(--tabbar-space) + 24px)' }}>
        {light && (typeof light === 'string'
          ? <Ambient name={light as AmbientName} scrollY={scrollY} motion={ambientMotion} />
          : <Ambient colors={light} scrollY={scrollY} motion={ambientMotion} />)}
        <div className="relative transition-[padding] duration-300 ease-out-soft" style={{ paddingLeft: 'var(--sidebar-space, 0px)' }}>
        <div className={cn('relative mx-auto w-full px-4 @min-[900px]:px-8', width)}>
          <header className="pt-0.5 pb-4 @min-[900px]:pt-6 @min-[900px]:pb-7">
            <div className="relative flex items-end justify-between gap-6">
              <div className="min-w-0 flex-1">
                {eyebrow && (
                  <motion.div className="eyebrow mb-1.5" initial={reveal ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.12 }}>{eyebrow}</motion.div>
                )}
                {/* The title rises out of a mask, once, as the page opens. */}
                <div className="-mb-1 overflow-hidden pb-1">
                  <motion.div initial={reveal ? { y: '105%' } : false} animate={{ y: 0 }} transition={{ duration: 0.55, ease: EASE.outSoft }}>
                    {titleNode}
                  </motion.div>
                </div>
              </div>
              {actions && !back && <div className="mb-1 hidden shrink-0 items-center gap-1.5 @min-[900px]:flex">{actions}</div>}
            </div>
          </header>
          <div className="@container">
            {header}
            {children}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

/** A section inside a page, labelled in the quiet index voice. */
export function Section({ label, action, children, className }: { label: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-7 @min-[700px]:mt-9', className)}>
      <div className="mb-2 flex items-end justify-between px-4 @min-[900px]:px-1">
        <h2 className="text-footnote text-dim uppercase tracking-[.04em] @min-[900px]:eyebrow">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
