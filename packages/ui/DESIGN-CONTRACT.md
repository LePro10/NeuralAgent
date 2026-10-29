# AGENTS.md — NeuralHub Design Library

You are implementing a product in the **NeuralHub design**. This file is the
contract. Read it fully before writing UI. `CLAUDE.md` points here.

The library is **copy-in** (like shadcn/ui): you copy `ui/` (or the files a
component needs) into the target project and use them as source. Every file
says *why* it is built the way it is — keep those decisions.

Live showcase with every component, knobs and code:
`https://ui.neuralhub.dev/` (also `pnpm dev` here).

---

## 1. The design in five sentences

1. **Quiet dark, lit from above.** Near-black ground `#080909`, grey-green ink, small light type. Depth comes from light, not lines: surfaces have an edge lit at the top, fields are sunk wells, the one primary action is a lit bead. Corners are continuous (superellipse) and concentric. Nothing shouts; nothing is bold.
2. **One colour per place.** Each place (tab) owns a signal colour. It appears in exactly three spots: the light at the top, the one hero figure, the active tab. Never a surface, never gradient text, never a glow on a button.
3. **Minimal, perfect motion.** Springs you can interrupt, short and without wobble; a haptic on every choice; exits faster than entrances; loops only on the compositor. Heroes get one orchestrated moment (title rising out of a mask, rolling number), the rest stays still.
4. **Phone first, desktop equal.** Menus pull down from the button you tapped, choices expand inline, panels only for long tasks. The pointer gets the same features.
5. **States are features.** Loading, empty, error, offline and live are designed, never patched.

Voices: **DM Sans** (300 for display, 400 for reading, 460 as "medium" — never heavier)
and **IBM Plex Mono** (9px uppercase `.eyebrow` for section labels only; field labels are quiet sans).

---

## 2. Setup in a target project (React 18/19 + Tailwind v4)

```bash
pnpm add motion lucide-react @fontsource-variable/dm-sans @fontsource/ibm-plex-mono
pnpm add -D tailwindcss @tailwindcss/vite        # Next.js: @tailwindcss/postcss
cp -r <this repo>/ui ./src/ui                    # or only the files from registry.json
```

```css
/* src/index.css (Next.js: app/globals.css) */
@import "tailwindcss";
@import "./ui/styles/index.css";
```

```ts
// entry (main.tsx / app/layout.tsx)
import '@fontsource-variable/dm-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
```

```html
<html lang="en" data-accent="ice" data-glass="default">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#080909">
```

- Imports inside `ui/` are **relative**, so the folder works anywhere. No path alias needed.
- `"use client"`: in Next.js App Router, every component file that uses hooks/motion needs it at the top. Add it when copying (the library is framework-agnostic and does not ship it).
- Copying only some components: look the file up in **`registry.json`** → `copy` is the exact list of files to copy, `allPackages` the npm packages. Always copy `ui/styles/` too.

---

## 3. Hard rules (never break these)

**Colour & type**
- Use tokens: `bg-card`, `text-bright`, `border-line`, `bg-fill-2`, `text-accent` … or `var(--color-…)` in inline styles/SVG. **No raw hex, no rgba, no Tailwind palettes** (`zinc-800`, `emerald-400`) in app code.
- Translucent white steps are only `fill-1…4` (3/5/8/12%) and `line`/`line-2` (7/12%).
- Text sizes only from the scale: `text-micro 9 · tiny 10 · meta 11.5 · detail 12 · small 12.5 · chip 13 · button 13.5 · body 14.5 · input 16 · lead 16 · title 18 · headline 22 · display 28 · display-lg 42 · hero 52`. No `text-[13.5px]`. (A few library internals use in-between sizes for micro-layout — app code does not.)
- Weights: `font-light` (300) for display, normal (400) for text, `font-medium` (460) for buttons and emphasis. **No `font-semibold`, no `font-bold`.**
- Radii by role: `rounded-xs 5 · chip 6 · tile 8 · item 9 · field 10 · menu 13 · stat 14 · list 16 · card 18 · dialog 20 · sheet 24 · full`. No `rounded-[18px]`. Where `corner-shape` exists they draw as superellipses ×1.3 automatically (opt out: `data-corners="round"` on `<html>`). **Nested corners are concentric:** inner = outer − gap (menu 13 with 4px padding → items `rounded-item`).
- **Depth = five levels, lit from above** — pick the level, never draw a box:
  `well` (−1: fields, tracks) · ground (0: `bg`) · `surface` / `.card` (+1: lists, cards, tiles) · `raised` (+2: thumb, knob, active segment) · `glass` + `shadow-menu/float` (+3: menus, bars, toasts). Shadow tokens: `shadow-edge` (lit edge), `shadow-raise`, `shadow-well`, `shadow-lit` (the one bright bead), `shadow-lip` (tinted fills), `shadow-key` (kbd).
- **No outlined boxes.** `border border-white/10` around a card is a wireframe. Hairlines (`border-hair`, `divide-hair`, 0.5px on retina) only where two things meet: list separators, table rules, a section rule.
- Places: wrap a screen in `<Page place="plan">` (or set `data-signal="amber"`); inside, the place colour is `text-tab` / `bg-tab` / Button `tint`. Twelve signals in `SIGNALS`, NeuralHub's mapping in `PLACES` (`ui/lib/tokens.ts`).
- No grain, no noise textures, no gradient text, no glowing buttons. The ambient light is the SVG `Ambient` (≈1 KB) — never WebGL, never an image per seed.
- "The app's accent" = `accent` / `accent-deep` (themeable). Fixed glow colours (`ice`, `ember`, `mint`, `live` …) only where the meaning is fixed (ember = badge/over limit/now, mint = success, live = live right now, danger = destructive, warning = caution).
- Titles are `display` (weight 300), never bold. Section labels are `.eyebrow`.

**Layout & mobile**
- One breakpoint: **900px**. Below: tab bar, menus that pull down from their trigger, choices that expand inline, floating fitted cards (Sheet) only for tasks. Above: sidebar island, popovers, side panels (centred dialogs only for confirming the irreversible).
- **Navigation is one list of places:** `<AppShell nav={{ items, value, onChange }}>`. The shell puts the first four in the tab bar and the rest behind its last cell (the glass grows up into a grid; the cell becomes the place you are in), and lists all of them, grouped, in the sidebar island. Never a "More" sheet, never two hand-kept lists.
- Wrap the app in `AppShell` — it measures its own width and tells everything inside (`Surface`). Inside pages use **container queries** (`@min-[700px]:`), not viewport breakpoints, in anything that may sit in a narrow pane.
- **Exactly one owner per space.** `AppShell` owns height and nav; `Page` owns all page padding (safe area + 44px top, 16/32px sides, max width 920/1200, left `var(--sidebar-space)`, bottom `var(--tabbar-space) + 24px`); content owns only itself. No negative margins to cancel padding, no `calc(100vh − …)`, no guessed `pb-[88px]` — use `var(--tabbar-space)`.
- `h-dvh`, never `vh`. Safe areas only via `var(--safe-top/bottom)`, never `env()` in components.
- Touch targets ≥ 44×44 (small visuals extend their hit area, see `IconButton size="sm"`).
- Inputs: 16px text on phones (`text-input` / `inputClass`), so the browser never zooms.
- **No native `<select>`** — use `Menu` (a small translucent pull-down anchored to its trigger, on phone and desktop). **No bottom sheet for a choice** — that is a `Menu` or an inline picker.
- Horizontal drags inside a swipeable area carry `data-no-swipe`.
- Desktop and phone can do the same things. Building a feature on one = checking the other.

**Overlays**
- Every overlay (sheet, menu, context menu, search, lightbox, custom) registers with `useLayer(open, close)`: Escape closes only the topmost, the browser/Android back gesture closes it instead of leaving the page.
- And `useFocusTrap(open, ref)`: Tab stays inside, focus returns to the trigger on close.
- Portal into `usePortalTarget()` (not `document.body` directly), so overlays stay inside the AppShell / previews.

**Motion & performance**
- Springs only from `SPRING` (`snap toggle sheet pop soft grow bouncy`), easings from the tokens (`ease-out-soft` default). Don't type new stiffness/damping pairs.
- Motion grammar: entrances rise 4–8px + fade (0.3–0.6s, ease-out-soft) or spring from the trigger; exits 120–160ms, no overshoot; lists stagger 18–30ms; nothing wobbles. Wrap apps in `AppShell` (it sets `MotionConfig reducedMotion="user"`).
- Loops animate only `transform`/`opacity`. Never a blur on a moving element.
- Decorative loops get `.deko` (they pause in rest mode, on `[inert]` pages, with reduced motion).
- JS animations ask `prefersReducedMotion()` and jump to the end.
- Canvas/WebGL: cap idle at 30fps, stop off-screen and in hidden tabs. Mesh gradients are rendered once (still image).
- Invisible backdrop blurs still cost every frame — mount them only while visible.

**Behaviour**
- No success message without a verified effect. Optimistic UI must roll back visibly.
- Loading, empty and error states are part of every feature (`Skeleton*`, `Empty`, `Callout`, `Spinner`, `Shimmer`).
- No UI flicker or wrong intermediate states; skeletons have the final shape.
- Typed text is never lost: drafts survive navigation, reload and failed saves.
- Scroll and focus follow navigation: new content starts at the top, Back restores the position, a jumped-to item is in view.
- No placeholder numbers in the UI ("3 open tasks") — real data or a description.
- Buttons default to `type="button"`.

---

## 4. Which component for which job

Files are under `ui/components/<folder>/`. Showcase page in brackets.

| Job | Use | Notes |
|---|---|---|
| The one main action | `Button` (primary) | max one per view; `busy` while saving |
| An action in the place's colour | `Button variant="tint"` / `IconButton variant="tint"` | soft, inside a place |
| Secondary / tertiary / destructive | `Button` ghost / quiet / danger | `glass` only over light, images, video |
| Icon action | `IconButton` | sm draws 32 but hits 44 |
| 2–5 views of the same data | `Segmented` | `sm` for secondary switches inside cards |
| Filter with many options or counts | `Chips` (+ `ToggleChip` in `lead`) | scrolls sideways on phones |
| Static status label | `Pill` | tones: neutral accent success warning danger live ember |
| Setting that applies immediately | `Switch` in a `Row` | |
| Task done / multi-select | `Check` (`square`, `indeterminate`) | |
| Continuous value | `Slider` | haptic per step, value bubble |
| Text input | `Field` + `Input` / `TextArea` / `inputClass` | `SearchField` for search |
| Settings / any list | `List` + `Row` | 46px rows, quiet icon tiles (`tint` for the place colour), separators start at the text |
| Figures | `Stat`, `Trend`, big numbers with `display tabular text-hero` | |
| People / accounts | `Avatar`, `AvatarStack` | `color` → glossy bead |
| Loading | `SkeletonRow`, `SkeletonText`, `Skeleton`, `Spinner`, `Shimmer` | delay ~400ms |
| Nothing there | `Empty` | icon, one line, one detail, one action |
| Error / hint | `Callout` | keeps input, offers retry |
| Status | `StatusDot` (`glow`, `pulse`) | |
| App frame | `AppShell nav={…}` (builds `TabBar` + `Sidebar`) | 4 in the bar, the rest grow out of it; sidebar island: compact while collapsed, opens after 600 ms rest (never on click), pins with ⌘\ |
| A screen | `Page` (+ `Section`) | large title, ambient light by place |
| Hero light | `Ambient` (SVG) — comes with `Page place` | palettes in `AMBIENT`, pose in `AMBIENT_POSE`, optional `motion` breathe/drift |
| A title that arrives | `RevealText` (Page titles do it by themselves) | lines rise out of a mask |
| "Working on it" | `LogoLoader` | the mark at work instead of a glowing orb |
| Brand mark | `LogoMark`, `Wordmark` | template for any product mark |
| Options / sort / “more” / any select | `Menu` (`overlays/`) | small translucent pull-down from the trigger, phone and desktop; radio/check, sections, shortcuts |
| A choice inside a form or settings | `InlinePicker` / `Disclosure` | expands under its row; never a sheet |
| Confirm a reversible-but-careful action | `ConfirmButton` | two taps, reverts after 3 s, optional Undo |
| A task (add an event, write a mail, pick files) | `Sheet` (`action` top right) | floating card that fits its content on phones, glass side panel from the right on desktop (no centred dialogs except `desktop="dialog"` for special cases); compact header: close · title · action |
| Confirm something irreversible or external | `ConfirmSheet` | rare; reversible things get a toast with Undo |
| Long-press / right-click actions | `ContextMenu` | lifts the item over a blurred backdrop; tap never fires too |
| Confirmation with undo | `toast()` + one `<Toaster/>` | max 3, sits above the tab bar; `toast.loading → update` |
| Swipe actions in lists | `SwipeRow` | trailing/leading actions, full-swipe destructive |
| Drill-down inside a tab | `useStack` + `Stack` | shared-axis push/pop, levels keep scroll, swipe-back |
| Search everything / commands | `CommandPalette` + `useCommandShortcut` | ⌘K, fuzzy, recent, full screen on phones |
| Glass surface | `.glass`, `GlassPanel`, `LiquidGlass` (`effects/`) | levels via `data-glass` |
| "This is happening now" card | `LightBorder` | one per screen |
| Pointer light on cards | `Spotlight` | no re-render on move |
| Listening / AI presence | `VoiceOrb` (button, small), `ParticleOrb` (hero, voice mode) | themed by accent |
| Working… label | `Shimmer` | compositor only |
| Rolling number / decode text | `Odometer`, `TextScramble` | digits roll on springs, unchanged digits stay still |
| A task being done | `TaskCheck` | fill → tick → strike, 520 ms |
| Playful pull on a CTA | `Magnetic` | pointer devices only |
| App start / brand moment | `LogoIntro` | skippable, reduced-motion crossfade |
| Progress toward a goal | `Ring` (round), `Meter` (bar, thresholds 80/100%) (`data/`) | one implementation each |
| A goal as an instrument | `TickRing` | 60 ticks light up, readout counts along |
| Values over time (bars) | `BarChart` | scrub with finger, tap pins, average line, stacked |
| Trend line / inline trend | `LineChart`, `Sparkline` | target band, gaps |
| Activity over a year / week | `CalendarHeatmap`, `GridHeatmap` | |
| Share of a whole | `Donut` | gaps, sequential draw, legend |
| Chat input | `Composer` (+ `ComposerDock` above tab bar / keyboard) (`ai/`) | grows to 5 lines, attachments, mic → send → stop; Enter sends only with a real keyboard |
| Send / stop | `SendButton` | arrow flies up, stop springs in, ring shows the running answer |
| User message / assistant answer | `UserBubble`, `AssistantMessage`, `MessageActions` | assistant has no bubble; actions 32px drawn, 44px hit |
| Streaming answer | `StreamingText` + `useSmoothText` | words fade in by colour, caret, no layout shift, `[n]` citations |
| What the agent is doing | `AgentTrace` / `StatusLine` + `traceLabel()` | labels from real events, held ≥ 650ms; timeline of tool steps |
| Waiting | `ThinkingIndicator` (`mark` default: the logo at work; shimmer, dots, orb, pulse) | |
| A tool call | `ToolCallCard` | announce → running → done (result inline) / error (retry) |
| Sources | `Citation`, `SourceCards`, `SourceStack` | letter tiles, no favicon requests |
| Ask the user | `QuestionCard` | wizard, single/multi, free text |
| Approve an action | `ConfirmCard` | collapses to one line when decided |
| Show a change | `DiffCard` (`diffLines`), `ChangePills` (undo) | inline / split |
| Empty chat | `EmptyChatHero`, `SuggestionGrid` | |
| Model choice | `ModelPill` | warning dot when a fallback answers |
| Voice | `AssistantOrb`, `Waveform` (+ `requestMic`), `VoiceOverlay` | real mic via WebAudio or simulated |

---

## 5. Building a new screen — checklist

1. `AppShell` → `Page title=… ambient=…` → sections with `.eyebrow` labels.
2. Compose from existing components; if something is missing, build it **from the tokens and recipes** (`.surface`/`.card`, `.well`, `.raised`, `.glass`, shadow tokens, `SPRING`) and give it the same states.
3. Phone: actions in the top bar, primary action reachable by thumb, nothing under the tab bar at the end of the scroll, sheets instead of popovers.
4. Desktop: same features, hover states only on fine pointers (`.hoverable`), shortcuts where they help.
5. Loading / empty / error / offline for every data view.
6. One glow per screen.

## 6. Migrating an existing app

1. Add the setup (section 2). Map existing colours to tokens (backgrounds → `bg`/`card`/`sheet`, borders → `line`, greys → `ink`/`dim`/`faint`, brand colour → `data-accent` theme or `accent`).
2. Replace primitives: buttons, inputs, dialogs (→ `Sheet`), selects (→ `Menu`), toasts, lists.
3. Wrap in `AppShell`, move per-page padding into `Page`, delete the old paddings (one owner!).
4. Screen by screen; keep behaviour, change only presentation.

## 7. Verify before you say "done"

- Typecheck + build pass.
- **Look at it** at 390px and at desktop width: scroll to the very end (nothing under the tab bar), open every overlay with the keyboard (Tab, Escape, Back).
- Reduced motion on: nothing essential disappears.
- Grep your diff for `#[0-9a-f]{3,6}`, `rgba(`, `text-[`, `rounded-[`, `border-line-2` on a box, `vh`, `<select` — each hit needs a reason.

## 8. Working on this repository itself

- `pnpm dev` (showcase), `pnpm typecheck`, `pnpm build`, `pnpm registry` (regenerate `registry.json` after adding/removing imports; CI checks it).
- New component → `ui/components/<family>/X.tsx` with a header comment (what + why), export from the family `index.ts`, a showcase page in `site/pages/<family>/` registered in that folder's `index.ts`, then `pnpm registry`.
- Showcase pages use the kit in `site/kit/` (`Doc`, `DocSection`, `Demo` with controls, `Rules`, `Why`, `Props`, `Phone`, `Browser`).
- Code and comments in English; `README.md` and `docs/` in German.
