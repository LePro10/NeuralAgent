/**
 * Inset grouped list (iOS Settings) and its row. A surface lit from above,
 * h-row rows (50 on phones, 62 with a subtitle), a leading icon tile, separators
 * that start where the text starts, a chevron when the row navigates.
 * `tile="blue"` gives the iOS coloured tile (white glyph on a system colour);
 * without it the tile is quiet. Colour otherwise only for danger, selection or
 * the place's signal.
 */
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { ActivityMark, type Activity } from './Activity';

/** iOS system colours, for coloured icon tiles and semantic accents. */
export type SysColor = 'blue' | 'green' | 'orange' | 'red' | 'yellow' | 'purple' | 'pink' | 'teal' | 'indigo' | 'gray';

/** A coloured rounded square with a white glyph (iOS Settings). Size follows --spacing-icon-tile. */
export function IconTile({ Icon, color = 'blue', activity, className, children }: { Icon?: LucideIcon; color?: SysColor; activity?: Activity; className?: string; children?: ReactNode }) {
  const tile = (
    <span aria-hidden="true" className={cn('icon-tile', className)} style={{ ['--tile' as string]: `var(--color-sys-${color})` }}>
      {Icon ? <Icon strokeWidth={2} /> : children}
    </span>
  );
  return activity ? <span className="relative shrink-0">{tile}<ActivityMark activity={activity} shape="tile" size={10} corner="-top-1 -right-1" /></span> : tile;
}

/** A card of rows; optional quiet `label` above and `footer` note below. */
export function List({ children, label, action, footer, className }: { children: ReactNode; label?: string; action?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {(label || action) && (
        <div className="mb-1.5 flex min-h-6 items-center justify-between gap-3 px-4">
          {label && <h3 className="text-footnote text-dim uppercase tracking-[.04em]">{label}</h3>}
          {action}
        </div>
      )}
      <div className="surface list-rows overflow-hidden rounded-list">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-footnote text-dim">{footer}</p>}
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
  /** iOS coloured icon tile (white glyph on a system colour). */
  tile?: SysColor;
  /** Two-line titles instead of truncation. */
  wrap?: boolean;
  /** Agent activity on the icon tile: light ring (working) or dot (waiting/done/error). */
  activity?: Activity;
  /** Navigation chevron; default: shown when the row is pressable and has no `trailing`. */
  chevron?: boolean;
}

export function Row({ Icon, leading, title, detail, value, trailing, onClick, href, danger, selected, tint, tile, wrap, chevron, activity }: RowProps) {
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
        'flex w-full items-center gap-3 px-4 py-2 text-left',
        detail ? 'min-h-row-2' : 'min-h-row',
        interactive && 'press-row hover:bg-fill-1',
        selected && '!bg-fill-3',
      )}
    >
      {lead && (
        leading ?? (tile && !danger ? <IconTile Icon={Icon} color={tile} activity={activity} /> : (
          <span className={cn('relative',
            'grid size-icon-tile shrink-0 place-items-center rounded-tile',
            danger ? 'bg-danger/[.12] text-danger' : tint ? 'bg-tab/[.14] text-tab' : selected ? 'bg-fill-4 text-bright' : 'bg-fill-3 text-ink',
          )}>
            {Icon && <Icon strokeWidth={1.75} className="size-[58%]" />}
            <ActivityMark activity={activity} shape="tile" size={10} corner="-top-1 -right-1" />
          </span>
        ))
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block text-body leading-snug', !wrap && 'truncate', danger ? 'text-danger' : 'text-bright')}>{title}</span>
        {detail && <span className={cn('mt-0.5 block text-footnote text-dim', !wrap && 'truncate')}>{detail}</span>}
      </span>
      {value !== undefined && <span className="max-w-[45%] shrink-0 truncate text-body text-dim">{value}</span>}
      {trailing}
      {(chevron ?? (interactive && !trailing)) && <ChevronRight strokeWidth={2.2} className="-mr-1 size-icon-sm text-faint" />}
    </Tag>
  );
}
