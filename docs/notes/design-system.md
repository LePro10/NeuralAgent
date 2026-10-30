# Design system: how to build a screen (D45)

`@neuralagent/ui` is the foundation and `packages/app` is built on it. The goal is to feel like a
first-class iOS app on phones and like a calm, polished desktop app on the Mac. This note is the
guide for page authors. The binding rules are in `packages/ui/DESIGN-CONTRACT.md`; this note
overrides it wherever they differ (see D45).

## 1. Modes and themes
- **Layout mode** is set by `AppShell` from its own width: `data-mode="phone|desktop"`. Phone sizes
  (type, controls, icons) come from token overrides under `[data-mode="phone"]`, not from viewport
  media queries. Overlays portal into the shell, so they inherit the mode. In code:
  `useLayoutMode()`.
- **Appearance** is System / Light / Dark (`lib/theme.ts` → `appearance`, Settings → Appearance).
  It resolves to `data-appearance="light|dark"` on `<html>`. Every scheme (Night, Graphite,
  Midnight, Black, Dusk, Forest) has both. An inline script in each `index.html` sets it before
  first paint. `syncThemeColor()` keeps `<meta name=theme-color>` matching the background.
- Never write `white/…` or `black/…`. For translucent ink use `rgb(var(--fg-rgb) / .x)` (in
  packages/ui) or the tokens below. Both appearances must keep AA contrast.

## 2. Tokens (Tailwind utilities)
| Need | Use |
|---|---|
| iOS text roles | `text-large-title` `text-title-1/2/3` `text-headline` `text-body` `text-callout` `text-subhead` `text-footnote` `text-caption` `text-caption-2`. Older names (`text-small`, `text-chip`, …) still work and grow on phones. |
| Inputs | `text-input`: 16 px on phones, which stops iOS from zooming. |
| Touch sizes | `h-tap`/`size-tap` (44 on phones), `h-control-sm/control/control-lg`, `min-h-row` (50), `min-h-row-2` (62, with subtitle), `h-navbar`. |
| Icons | `size-icon-sm` (16), `size-icon` (22), `size-icon-lg` (25), `size-icon-tile` (30), all phone values. |
| Colour | `text-bright/ink/dim/faint`, `bg-bg/card/fill-1..4`, `border-line`, `accent`, `success/warning/danger/info`, `ember`. iOS system colours: `sys-blue/green/orange/red/yellow/purple/pink/teal/indigo/gray`. |
| Materials | `.material` (opaque menus and action sheets), `bg-navbar`, `bg-scrim`, `bg-press`, `bg-lens`, `bg-grabber`, `bg-thumb`, `text-on-color` (on a coloured fill), `text-on-bright` (on `bg-bright`). |
| Safe areas | `var(--safe-top/bottom/left/right)`, each `max(env(), Capacitor var)`. `var(--tabbar-space)` is the bottom room a page leaves for the tab bar. |
| Claude view | `--claude-*` tokens (bg, surface, text, accent, serif, radius-bubble…). |

`pnpm lint:tokens` rejects hex/rgb literals and arbitrary `x-[…]` values in app code. packages/ui
is exempt; mark a deliberate exception with `token-ok`.

## 3. Navigation (phones)
- Tabs: **Neural · Agents · Workspaces · Swarm · More**. Workspaces lists the projects; one opens
  pushed. More holds History, Usage, MCP servers, Remote and Settings. Each tab remembers its
  sub-page; tapping the active tab returns to its root.
- `App.tsx` wraps the body in `<NavPage id depth back>`. A deeper page pushes in from the right,
  a shallower one pops, tab switches cross-fade. Pages with `back` get an edge swipe from the left.
- `<Page title …>` is the iOS screen: a large title that scrolls under a translucent nav bar with
  an inline title. The back button comes from context by itself (`useNavBack()`), so a page never
  wires it. Custom headers use `<BackButton label onBack compact? />`.
- Desktop: the sidebar. ⌘1–9 switch, **⌘K opens the CommandPalette** (workspaces, pages, actions).

## 4. Components to reach for
| Moment | Component |
|---|---|
| Settings-like content | `<List label footer>` + `<Row Icon title detail value tile="blue" chevron onClick activity>`. `IconTile` for a coloured tile anywhere. Swipe actions: `SwipeRow`. |
| Loading | `SkeletonList rows lead` (lists), `Skeleton`, `Spinner` only for small inline waits. |
| Nothing there | `<Empty Icon title detail action>`. |
| A choice ("which one?") | `Menu`. It is a pull-down on desktop and turns into an **ActionSheet** on phones by itself. `ActionSheet` directly for "what to do with this". |
| A task with fields | `Sheet` (grabber, detents, stays below the status bar, lifts above the keyboard, Escape/back close). |
| Confirm a destructive step | `ConfirmSheet`. |
| Short feedback | `toast()`. |
| Lost connection | `ConnectionPill show` (App shows it after 2.5 s offline). |
| Controls | `Button` (`primary`, `accent`, `secondary`, `ghost`, `danger`; `sm/md/lg`), `IconButton` (≥44 px on phones), `Segmented`, `Switch` (51×31 on phones), `Field`/`SearchField`, `Chips`. |

## 5. Activity marks (agents working, waiting, done)
One vocabulary for what the agents behind a sidebar item, tab or row are doing:
| Activity | Mark |
|---|---|
| `working` | A thin accent light runs around the icon (a conic ring; only `transform` animates). With reduced motion it is a static ring. |
| `waiting` | A pulsing **accent** dot: it needs your input. |
| `done` | An **ember** (orange) dot: an agent finished and you have not looked yet. Ember means only this. |
| `error` | A red dot. |

API: `NavItem.activity` / `TabItem.activity` (Sidebar, TabBar; the More cell inherits the top
activity of what it holds), `Row activity`, `IconTile activity`, or `<ActivityMark activity
shape edge>` inside any `relative` icon wrapper. When several agents disagree, `topActivity()`
picks one: waiting > error > working > done. App code maps agent statuses with
`activityOf(statuses)` (`lib/status.ts`). The open workspace never shows `done`. `badge` still
exists as a generic red dot for non-agent things; prefer `activity`.

## 6. Motion
Springs live in `lib/motion` (`SPRING.snap/pop/sheet/goo`, `PUSH` for navigation). Press feedback:
`.pressable` (scale .965) for buttons, `.press-row` (background) for rows. Animate only
`transform` and `opacity`, and respect reduced motion (`prefersReducedMotion()`;
`useReducedMotion()` in motion/react). The launch screen (`LaunchScreen`) assembles the mark in
≤1.2 s. It never blocks: it lifts the moment the daemon state arrives, and only after 1.2 s does
it say "Connecting…".

## 7. Checklist for a page
1. `<Page title>` (or a full-bleed view that pads `var(--safe-top)` and `var(--tabbar-space)`).
2. Content in `List`/`Row` with tiles; empty → `Empty`; loading → `SkeletonList`.
3. Choices via `Menu`, tasks via `Sheet`, no custom overlays.
4. Check at 390×844 and 360×780 (touch, light and dark), at 1440×900, and a sheet with the
   keyboard open (height ~450). Then run `pnpm typecheck && pnpm lint:tokens`.

## Known gaps
- iOS PWA status bar text stays white in light mode (`apple-mobile-web-app-status-bar-style`
  cannot change at runtime). The Capacitor status bar style is not synced yet.
- Desktop CSP (`script-src 'self'`) may block the inline pre-paint appearance script. Then
  `startTheme()` sets it a frame later.
- Some decorative ui components (charts, orbs, Glass, Slider, Composer) still use white-based
  translucency tuned for dark. They work in light mode but look flatter.
