/**
 * A scrollable screen with a large, light title — and the one owner of page spacing.
 *
 * Phones: the title block scrolls up with the content until it sits 16px from
 * the top, then it stays, and a frosted black fade eases in behind it as the
 * content slides underneath (no second, smaller title). Actions sit in the
 * top bar, in thumb reach. Desktop: actions move onto the title line.
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
 *
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

/** The title starts 44px down; lifted 36px it sits at 8px (+8px padding = 16px, the side gutter). */
const LIFT = 36;

export function Page({ title, eyebrow, actions, backLabel, onBack, header, children, wide, heading, place, signal, ambient, ambientMotion, reveal = true, scrollRef, scrollTopKey, className }: PageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: ref });
  const lift = backLabel ? 0 : LIFT;
  // The fade eases in (smoothstep) as content reaches the title, with a long soft tail — a shadow, not a bar.
  const fade = useTransform(scrollY, [lift - 2, lift + 56], [0, 1], { ease: (t) => t * t * (3 - 2 * t) });
  // Only a boolean crosses into React; scrolling itself never re-renders the page.
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > Math.max(2, lift - 6)));

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    ref.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollTopKey]);

  const sig = signal ?? (place ? PLACES[place].signal : undefined);
  const light = ambient === false ? null : ambient ?? (place ? PLACES[place].ambient : undefined);
  const width = wide ? 'max-w-[1200px]' : 'max-w-[920px]';

  const titleNode = heading ?? <h1 className="display text-display @min-[900px]:text-display-lg">{title}</h1>;

  return (
    <div data-signal={sig} className={cn('@container relative h-full', className)}>
      {/* Top bar: back button + phone actions. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20" style={{ paddingTop: 'var(--safe-top)', paddingLeft: 'var(--sidebar-space, 0px)' }}>
        {/* Mounted only while scrolled: an invisible backdrop blur still costs every frame. */}
        {scrolled && <div className="top-fade fade-in @max-[899px]:hidden" />}
        <div className={cn('relative mx-auto flex h-[52px] w-full items-center justify-between gap-2 px-4 @min-[900px]:mt-3 @min-[900px]:px-8', width)}>
          <div className="pointer-events-auto flex min-w-0 flex-1">
            {backLabel && (
              <button type="button" onClick={onBack} aria-label={`Back to ${backLabel}`}
                className="pressable -ml-1.5 flex h-9 items-center gap-0.5 rounded-full pr-2.5 pl-1 text-body text-ink hover:text-bright">
                <ChevronLeft size={20} strokeWidth={1.75} />
                <span className="max-w-[40vw] truncate">{backLabel}</span>
              </button>
            )}
          </div>
          <div className={cn('pointer-events-auto flex flex-1 items-center justify-end gap-1.5', !backLabel && '@min-[900px]:hidden')}>{actions}</div>
        </div>
      </div>

      <div ref={(n) => { ref.current = n; if (scrollRef) scrollRef.current = n; }} className="scroller page-scroll relative h-full"
        style={{ paddingTop: 'calc(var(--safe-top) + 44px)', paddingBottom: 'calc(var(--tabbar-space) + 24px)' }}>
        {light && (typeof light === 'string'
          ? <Ambient name={light as AmbientName} scrollY={scrollY} motion={ambientMotion} />
          : <Ambient colors={light} scrollY={scrollY} motion={ambientMotion} />)}
        <div className="relative transition-[padding] duration-300 ease-out-soft" style={{ paddingLeft: 'var(--sidebar-space, 0px)' }}>
        <div className={cn('relative mx-auto w-full px-4 @min-[900px]:px-8', width)}>
          <header className="z-[15] pt-2 pb-5 @max-[899px]:sticky @min-[900px]:pt-6 @min-[900px]:pb-7" style={{ top: -lift }}>
            {scrolled && (
              <motion.div aria-hidden="true" className="top-fade-solid pointer-events-none absolute -inset-x-4 -bottom-14 @min-[900px]:hidden"
                style={{ top: `calc(${lift - 44}px - var(--safe-top))`, opacity: fade }} />
            )}
            <div className="relative flex items-end justify-between gap-6">
              <div className="min-w-0 flex-1">
                {eyebrow && (
                  <motion.div className="eyebrow mb-2" initial={reveal ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.12 }}>{eyebrow}</motion.div>
                )}
                {/* The title rises out of a mask, once, as the page opens. */}
                <div className="-mb-1 overflow-hidden pb-1">
                  <motion.div initial={reveal ? { y: '105%' } : false} animate={{ y: 0 }} transition={{ duration: 0.62, ease: EASE.outSoft }}>
                    {titleNode}
                  </motion.div>
                </div>
              </div>
              {actions && !backLabel && <div className="mb-1 hidden shrink-0 items-center gap-1.5 @min-[900px]:flex">{actions}</div>}
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
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 className="eyebrow">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
