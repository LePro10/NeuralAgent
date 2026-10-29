/**
 * App frame: a floating glass sidebar on desktop, a floating liquid-glass tab
 * bar on phones, the page in between. It owns the full height (h-dvh by
 * default) and nothing else — no content spacing (that is Page's job).
 *
 * Define the places once with `nav` and the shell builds both bodies from
 * it: the first four go in the tab bar and the rest open from its last cell
 * (five or fewer all fit), while the sidebar lists everything, in groups.
 * Pass `sidebar` / `tabbar` instead for hand-made navigation.
 *
 * The mode comes from the shell's own width, not the viewport, and is handed
 * to everything inside through <Surface>: sheets, menus and the tab-bar gap
 * (`--tabbar-space`) follow it. On desktop the page runs full width under the
 * glass sidebar and keeps its content clear of it with `--sidebar-space`.
 */
import { MotionConfig } from 'motion/react';
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { ShellProvider, Surface, useWidthMode, type LayoutMode } from '../../lib/surface';
import { Sidebar, type SidebarItem } from './Sidebar';
import { TabBar } from './TabBar';

/** One place in the app — a tab on phones, an entry in the sidebar. */
export type NavItem<T extends string = string> = SidebarItem<T>;

export interface Nav<T extends string = string> {
  items: NavItem<T>[];
  value: T;
  /** Also called for the active place (re-tap: scroll to top). */
  onChange: (id: T) => void;
  /** Places in the tab bar before "More" takes the rest (default 4; five or fewer items all fit). */
  tabs?: number;
  /** Sidebar extras. */
  brand?: { mark: ReactNode; word?: ReactNode; onClick?: () => void };
  account?: (open: boolean) => ReactNode;
  settings?: () => void;
  settingsActive?: boolean;
  search?: () => void;
  pinned?: boolean;
  onPinnedChange?: (v: boolean) => void;
}

export function AppShell<T extends string>({ nav, sidebar, tabbar, children, mode: forced, className, style }: {
  nav?: Nav<T>;
  sidebar?: ReactNode;
  tabbar?: ReactNode;
  children: ReactNode;
  /** Force a mode (previews); otherwise measured. */
  mode?: LayoutMode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useWidthMode(ref);
  const mode = forced ?? measured ?? 'phone';
  const phone = mode === 'phone';
  const [space, setSpace] = useState(0);
  const shell = useMemo(() => ({ setSidebarSpace: setSpace }), []);

  let side = sidebar, bar = tabbar;
  if (nav) {
    const k = nav.items.length <= Math.max(5, (nav.tabs ?? 4) + 1) ? nav.items.length : nav.tabs ?? 4;
    bar ??= <TabBar items={nav.items.slice(0, k)} more={nav.items.slice(k)} value={nav.value} onChange={nav.onChange} />;
    side ??= <Sidebar items={nav.items} value={nav.value} onChange={nav.onChange} brand={nav.brand} footer={nav.account} onSettings={nav.settings} settingsActive={nav.settingsActive} search={nav.search} pinned={nav.pinned} onPinnedChange={nav.onPinnedChange} />;
  }

  return (
    <div
      ref={ref}
      data-mode={mode}
      className={cn('relative flex h-dvh w-full overflow-hidden bg-bg [transform:translateZ(0)]', className)}
      style={{
        ['--tabbar-space' as string]: phone && bar ? 'calc(88px + var(--safe-bottom))' : '0px',
        ['--sidebar-space' as string]: !phone && side ? `${space}px` : '0px',
        ...style,
      }}
    >
      {/* Reduced motion reaches every motion component inside, not only CSS. */}
      <MotionConfig reducedMotion="user">
        <Surface portal={ref} mode={mode}>
          <ShellProvider value={shell}>
            {!phone && side}
            <main className="relative min-w-0 flex-1">{children}</main>
            {phone && bar}
          </ShellProvider>
        </Surface>
      </MotionConfig>
    </div>
  );
}
