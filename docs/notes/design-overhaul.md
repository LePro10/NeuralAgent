# Design overhaul: liquid motion and glass background (D40)

## Reusable exports for other surfaces (website etc.), all in `packages/ui`
- Tokens (`ui/styles/tokens.css`, per scheme in `themes.css`): `--aurora-1`, `--aurora-2` (= accent-deep), `--aurora-3`,
  `--aurora-strength`; `--ease-spring` (CSS `linear()` spring curve).
- `AuroraField` (`components/effects/AuroraField.tsx`, CSS `.aurora`, `.aurora-blob`): the colour field behind glass. Compositor-only loop (`.deko`).
- Glass material: `.glass`, `.rim`, `GlassPanel`, `LiquidGlass` (existing) + `data-glass` levels.
- Motion primitives (`lib/motion.ts`): `SPRING.goo` / `SPRING.drag` (jelly springs), `squashFor()`. CSS: `.pressable` (liquid squash press), `.liquid-in`, `.page-in`.
- Menu hover lens: `MenuItems` (shared layoutId lens between rows).

fluid-goo (MIT, (c) 2026 Frech-Dachs) was studied; its spring constants and the aurora/squash ideas are re-implemented here, no code copied wholesale, no dependency added.

## What changed (app)
- Background: `AppShell` renders `AuroraField` (default on); each scheme has its own tint (`themes.css`). All schemes are dark (there is no light scheme in the library; not added). Terminal panes keep their solid `--color-term-bg`.
- Motion: `SPRING.goo` on Segmented pill, Sidebar selection, TabBar lens, CommandPalette active row; menu rows get one gliding hover lens plus blur-in stagger (`MenuList`); Toast springs in with blur; `.pressable` squashes; page body fades/rises on every page change (`.page-in`, App.tsx). Reduced motion: existing CSS/MotionConfig rules cover all of it.
- Sidebar account: `components/AccountRow.tsx` (avatar from `state.remote.account.avatar`, name, email or "Local only", initials fallback; menu: Settings, Remote, Sign out on desktop). `Avatar` falls back to initials if the photo fails. CSP `img-src` now allows Google/GitHub avatar hosts.
- macOS drag: `useWindowDrag` in App.tsx makes the top 40 px draggable (all empty space incl. next to the traffic lights), double click zooms (`internal_toggle_maximize`, permission `core:window:allow-internal-toggle-maximize` added). Workspace header is now 44 px.

## Verification
typecheck, test, lint:tokens green; desktop vite build ok. Screenshots (WebKit, vite :1431): `/tmp/na-dz/{a1-Agents,d1-a,d1-menu,d2-a(phone 390),d3-menu(dusk)}.png`.

## Open / not done
- `fluid-goo` was not added as a dependency (ideas ported instead; MIT notice in code comments).
- Window drag and double-click zoom could not be tested in the real Tauri window here; test on macOS.
- Phone has no account row (Settings stays under "More").
- Disclosure/Sheet/Stack/Switch keep their existing springs (already spring-based); not all restyled.

## Round 2
- One glass recipe: `.glass` + `.rim` (+ `.glass-thick`, same recipe with a fill mixed toward the sheet colour, for reading surfaces). Now used by menus (`MENU_SURFACE`), context menu, toasts, sheets/dialogs/side panel, command palette, TabBar (and its More scrim), sidebar. No other translucent recipes left in `packages/ui`.
- Switch: thumb swells into a glass lens while pressed, stretches towards its travel direction (`SPRING.goo`). Slider: thumb becomes a 1.5x lens while dragged. Disclosure: content blur-in plus rise. Dialog / side panel / palette: scale + blur + goo spring, dialog backdrop gets a faint blur. Bottom sheet: grows from 0.93 to 1 along its y position (works while dragging; drag-to-dismiss spring unchanged). Chips: selected pill is a shared liquid indicator (`layoutId`). No tooltip component exists.
- Phone account: `TabBar` got `moreHeader(close)` (also `nav.moreHeader` on `AppShell`); the app puts `AccountRow plain` there (avatar, name, email, tap = Settings).
- Frames: `/tmp/na-dz/mont-f.png` (motion) and `mont-r.png` (reduced motion: pill/sheet jump to final at once), per-frame files `/tmp/na-dz/m*-f*.png`; phone More sheet `/tmp/na-dz/more.png`.
- Not changed: Stack pages stay opaque `bg-bg` (full-screen pages, spring slide kept).

### For the orchestrator (files I may not touch)
- `Pane.tsx:93` `bg-chrome` pane frame: fine as solid for terminals; chrome around it (header/tab strip of a pane) could use `.glass rim`/`.surface`.
- `SettingsPage.tsx:44-49` theme preview tiles use `bg-bg`/`bg-chrome`/`bg-card-3` on purpose (they preview a scheme).
- `components/CallAudioToggle.tsx:24` (other agent) has `z-[60]`: `pnpm lint:tokens` currently fails on it; use a `--z-*` token.
- `components/claude/**`: not audited for flat surfaces beyond grep (no `bg-bg/chrome/card` found at top level); chat bubbles/cards there should use `.surface`/`.glass`.
