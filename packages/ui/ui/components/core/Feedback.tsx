/**
 * States are part of the feature: empty, loading, error, live.
 * One component per state, instead of ten hand-made variants.
 */
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { TONE, type Tone } from './Chips';

/** Empty state: a round icon, one line, one detail, one action. */
export function Empty({ Icon, title, detail, action, bare, className }: { Icon?: LucideIcon; title: string; detail?: ReactNode; action?: ReactNode; bare?: boolean; className?: string }) {
  return (
    <div className={cn('grid place-items-center px-6 py-10 text-center', !bare && 'card', className)}>
      {Icon && <span className="grid h-9 w-9 place-items-center rounded-full bg-fill-3 text-dim shadow-edge"><Icon size={16} strokeWidth={1.6} /></span>}
      <p className="mt-3 text-body text-bright">{title}</p>
      {detail && <p className="mt-1 max-w-[300px] text-small text-dim">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const CALLOUT_ICON: Partial<Record<Tone, LucideIcon>> = { danger: XCircle, warning: AlertTriangle, success: CheckCircle2, accent: Info, neutral: Info, live: Info, ember: AlertTriangle, tab: Info };

/** Inline message in a status tone (errors, hints, warnings). `action` sits at the end ("Try again"). */
export function Callout({ tone = 'neutral', title, children, action, Icon, className }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode; Icon?: LucideIcon; className?: string }) {
  const t = TONE[tone];
  const I = Icon ?? CALLOUT_ICON[tone] ?? Info;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-field px-3 py-2.5', t.bg, className)}>
      <I size={15} strokeWidth={1.75} className={cn('mt-[2px]', t.text)} />
      <div className="min-w-0 flex-1 text-small leading-relaxed text-ink">
        {title && <p className="font-medium text-bright">{title}</p>}
        {children}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** Status dot: quiet by default, `glow` for "this matters", `pulse` for "happening now". */
export function StatusDot({ tone = 'success', glow, pulse, size = 6, label }: { tone?: Tone; glow?: boolean; pulse?: boolean; size?: number; label?: string }) {
  const c = `var(--color-${({ neutral: 'dim', accent: 'accent', tab: 'tab', success: 'mint', warning: 'warning', danger: 'danger', live: 'live', ember: 'ember' } as const)[tone]})`;
  const style = { width: size, height: size, background: c, boxShadow: glow ? `0 0 ${size * 1.4}px ${c}` : undefined, ['--ping' as string]: c } as CSSProperties;
  return <i role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('inline-block shrink-0 rounded-full', pulse && 'ping deko')} style={style} />;
}

/** Spinner: hairline ring with an accent arc. */
export function Spinner({ size = 16, className, label = 'Loading' }: { size?: number; className?: string; label?: string }) {
  return <i role="status" aria-label={label} className={cn('spinner', className)} style={{ ['--size' as string]: `${size}px` } as CSSProperties} />;
}

/** Skeleton block. Compose shapes from it, or use a preset. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cn('skeleton deko', className)} style={style} />;
}

/** Text lines that taper like a paragraph (90 / 72 / 54 %). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className="h-3" style={{ width: `${[90, 72, 54, 80, 64][i % 5]}%` }} />)}
    </div>
  );
}

/** A list row in waiting: tile + two lines. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5" aria-hidden="true">
      <Skeleton className="h-[26px] w-[26px] !rounded-tile" />
      <div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-2.5 w-1/3" /></div>
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-grid h-[18px] min-w-[18px] place-items-center rounded-xs bg-fill-2 px-1 font-mono text-tiny text-dim shadow-key', className)}>{children}</kbd>;
}
