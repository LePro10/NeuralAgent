/**
 * App frame: a floating glass sidebar on desktop, the glass Dock (tab bar) on
 * phones, the page in between. It owns the full height (h-dvh by default) and
 * nothing else — no content spacing (that is Page's job).
 *
 * Define the places once with `nav` and the shell builds both bodies from it:
 * on phones every item is a Dock tab (pass four), the sidebar lists everything,
 * in groups. Pass `sidebar` / `tabbar` instead for hand-made navigation.
 *
 * Phones: `dock="hidden"` hides the Dock (agent screens). The room it takes is
 * published as `--dock-h` (and the old `--tabbar-space`): its height plus the
 * bottom safe area, 0 while hidden or while the keyboard is up. Pages use
 * `pb-dock` / `bottom-dock`. The Dock folds to icons while a list scrolls down.
 * No Aurora field on phones (calm flat ground, less GPU); Android WebView gets
 * the lighter glass (`data-glass="lite"`) unless the page chose one.
 *
 * The mode comes from the shell's own width, not the viewport, and is handed
 * to everything inside through <Surface>: sheets, menus and the dock gap
 * follow it. On desktop the page runs full width under the glass sidebar and
 * keeps its content clear of it with `--sidebar-space`.
 */
import { MotionConfig } from 'motion/react';
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useHideOnScroll, useKeyboardOpen } from '../../lib/hooks';
import { ShellProvider, Surface, useWidthMode, type LayoutMode } from '../../lib/surface';
import { AuroraField } from '../effects/AuroraField';
import { Sidebar, type SidebarItem } from './Sidebar';
import { Dock } from './Dock';

/** One place in the app — a tab on phones, an entry in the sidebar. */
export type NavItem<T extends string = string> = SidebarItem<T>;

export interface Nav<T extends string = string> {
  items: NavItem<T>[];
  value: T;
  /** Also called for the active place (re-tap: scroll to top). */
  onChange: (id: T) => void;
  /** Unused since the Dock (every item is a tab on phones); kept so old callers compile. */
  tabs?: number;
  /** Sidebar extras. */
  brand?: { mark: ReactNode; word?: ReactNode; onClick?: () => void };
  account?: (open: boolean) => ReactNode;
  /** Unused since the Dock (there is no More grid); kept so old callers compile. */
  moreHeader?: (close: () => void) => ReactNode;
  settings?: () => void;
  settingsActive?: boolean;
  search?: () => void;
  pinned?: boolean;
  onPinnedChange?: (v: boolean) => void;
}

export function AppShell<T extends string>({ nav, sidebar, tabbar, children, mode: forced, aurora = true, dock = 'auto', className, style }: {
  nav?: Nav<T>;
  sidebar?: ReactNode;
  tabbar?: ReactNode;
  children: ReactNode;
  /** Force a mode (previews); otherwise measured. */
  mode?: LayoutMode;
  /** The colour field behind everything (default on; always off on phones). */
  aurora?: boolean;
  /** Phones: `hidden` slides the Dock away (agent screens). `auto`: shown, hidden while typing. */
  dock?: 'auto' | 'hidden';
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const measured = useWidthMode(ref);
  const mode = forced ?? measured ?? 'phone';
  const phone = mode === 'phone';
  // While the on-screen keyboard is up the Dock slides away and gives its space back, so
  // composers and key bars sit right above the keyboard.
  const keyboard = useKeyboardOpen();
  const [space, setSpace] = useState(0);
  const shell = useMemo(() => ({ setSidebarSpace: setSpace }), []);
  const hidden = dock === 'hidden' || keyboard;
  // A tab switch shows the full Dock again (a short page never scrolls to bring it back).
  const minimised = useHideOnScroll(main, { disabled: !phone || hidden, resetKey: nav?.value });
  const lite = useMemo(() => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && !document.documentElement.dataset.glass, []);

  let side = sidebar, bar = tabbar;
  if (nav) {
    bar ??= <Dock items={nav.items} value={nav.value} onChange={nav.onChange} minimised={minimised} hidden={hidden} />;
    side ??= <Sidebar items={nav.items} value={nav.value} onChange={nav.onChange} brand={nav.brand} footer={nav.account} onSettings={nav.settings} settingsActive={nav.settingsActive} search={nav.search} pinned={nav.pinned} onPinnedChange={nav.onPinnedChange} />;
  }
  const dockH = phone && bar && !hidden ? 'calc(var(--spacing-dock) + max(8px, var(--safe-bottom)))' : '0px';

  return (
    <div
      ref={ref}
      data-mode={mode}
      data-glass={phone && lite ? 'lite' : undefined}
      className={cn('ground relative flex h-dvh w-full overflow-hidden [transform:translateZ(0)]', className)}
      style={{
        ['--dock-h' as string]: dockH,
        ['--tabbar-space' as string]: dockH,
        ['--sidebar-space' as string]: !phone && side ? `${space}px` : '0px',
        ...style,
      }}
    >
      {/* Phones keep a calm, still ground: no drifting field behind the reading. */}
      {aurora && !phone && <AuroraField />}
      {/* Reduced motion reaches every motion component inside, not only CSS. */}
      <MotionConfig reducedMotion="user">
        <Surface portal={ref} mode={mode}>
          <ShellProvider value={shell}>
            {!phone && side}
            <main ref={main} className="relative min-w-0 flex-1">{children}</main>
            {phone && bar}
          </ShellProvider>
        </Surface>
      </MotionConfig>
    </div>
  );
}
