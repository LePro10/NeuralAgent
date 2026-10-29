/**
 * Grouped list (iOS settings style) and its row. A surface lit from above,
 * 46px rows, a quiet icon tile, separators that start where the text starts. Reads as text first;
 * colour only for danger, selection or the place's signal.
 */
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A card of rows; optional quiet `label` above and `footer` note below. */
export function List({ children, label, action, footer, className }: { children: ReactNode; label?: string; action?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {(label || action) && (
        <div className="mb-2 flex items-end justify-between px-1">
          {label && <h3 className="eyebrow">{label}</h3>}
          {action}
        </div>
      )}
      <div className="surface list-rows overflow-hidden rounded-list">{children}</div>
      {footer && <p className="mt-2 px-1 text-detail text-faint">{footer}</p>}
    </div>
  );
}

export interface RowProps {
  Icon?: LucideIcon;
  /** Anything instead of an icon: an avatar, an app icon, a colour dot. */
  leading?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** Right-aligned value in dim ("On", "3", "English"). */
  value?: ReactNode;
  /** Replaces the chevron (a Switch, a Check, a Pill). */
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  selected?: boolean;
  /** Icon tile in the place's signal colour. */
  tint?: boolean;
  /** Two-line titles instead of truncation. */
  wrap?: boolean;
}

export function Row({ Icon, leading, title, detail, value, trailing, onClick, href, danger, selected, tint, wrap }: RowProps) {
  const interactive = !!(onClick || href);
  const Tag = href ? 'a' : onClick ? 'button' : 'div';
  const lead = Icon || leading;
  return (
    <Tag
      {...(href ? { href } : {})}
      type={Tag === 'button' ? 'button' : undefined}
      onClick={onClick}
      aria-current={selected || undefined}
      data-lead={lead ? '' : undefined}
      className={cn(
        'flex min-h-[46px] w-full items-center gap-3 px-3.5 py-2 text-left',
        interactive && 'transition-colors duration-150 hover:bg-fill-1 active:bg-fill-2 active:duration-0',
        selected && '!bg-fill-3',
      )}
    >
      {lead && (
        leading ?? (
          <span className={cn(
            'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-tile shadow-lip',
            danger ? 'bg-danger/[.12] text-danger' : tint ? 'bg-tab/[.14] text-tab' : selected ? 'bg-fill-4 text-bright' : 'bg-fill-3 text-ink',
          )}>
            {Icon && <Icon size={14} strokeWidth={1.7} />}
          </span>
        )
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-body leading-snug', !wrap && 'truncate', danger ? 'text-danger' : 'text-bright')}>{title}</span>
        {detail && <span className={cn('mt-px block text-detail text-dim', !wrap && 'truncate')}>{detail}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 text-small text-dim">{value}</span>}
      {trailing}
      {interactive && !trailing && <ChevronRight size={15} strokeWidth={1.75} className="-mr-1 text-faint" />}
    </Tag>
  );
}
