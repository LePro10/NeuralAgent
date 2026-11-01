# Website and live demo (agent.neuralhub.dev, D79)

The 0.4.0 rebuild replaced the aurora/glass landing with a "calm control room" site whose centre is
the real app running live in the page. Brief, research and review reports (not in git):
`research-local/site-overhaul/` (`BRIEF.md`, `site-audit.md` with the product fact sheet,
`review/*`).

## Look
- Pane grid: hairline rails, crosshairs and mono pane title bars (`Section`, `PaneTitle`) instead
  of cards and glows. Dark only. DM Sans Variable (opsz) + IBM Plex Mono, self-hosted in
  `src/site/fonts` with metric-matched fallbacks (no font preloads, see the comment in `index.html`).
- One accent (ice); ember means "done", as in the app (activity marks: working ring, waiting pulse,
  done ember, error red). Icons: lucide (`site/ui/icons.ts`, `site/content/icons.ts`).
- Motion is scroll-linked through CSS variables written by one rAF loop (`site/ui/hooks.ts`,
  `site/stage/useStageScroll.ts`); only transform/opacity animate. Reduced motion gives complete
  static layouts. `PaneField` is a faint canvas that pauses offscreen.
- Tokens only (`pnpm lint:tokens`); canvas code reads colours from CSS custom properties.

## Pages (`apps/web`, Vite multi-page)
- `/` (`src/landing.tsx`, sections in `src/site/sections/`): Hero (per-OS CTA and install command,
  13-agent row, live roster) → Stage (six chapters) → Spec (7 groups, tablist on desktop, folds on
  phones) → Security (scroll sequence computer → relay → phone with a real AES-256-GCM ciphertext,
  exact algorithms, honest limits) → Agents (13 CLIs from the catalog + shell, install lines) →
  Platforms (`#download`, links from `/api/releases/latest` keys) → FAQ (13, FAQPage JSON-LD) →
  Final (the mark assembles from five panes). Facts and links: `src/site/content.ts`,
  `src/site/content/*`.
- `/download/`, `/changelog/` (timeline from `virtual:changelog`), `/imprint/`, `/privacy/`,
  `/terms/` (noindex), `/404.html`: `src/site/pages/**` with shared `Nav`/`Footer`.
- Marketing pages import `site/base.css` + `site/foundation.css`, never `styles.css` (that stays for
  the web remote and admin). Static fallbacks: the FAQ JSON-LD and a `<noscript>` copy in
  `index.html` are generated from `content/faq.ts` by `content/sync-static.ts` (`--check` in
  `static.test.ts`).
- Links use the trailing-slash form (`/download/`); the relay redirects the bare form with a 307.

## Live demo (`/demo/`, `src/demo/**`)
- The real `@neuralagent/app` runs in iframes (`/demo/?embed=1&view=desk|phone`) against a fake
  daemon in TypeScript that speaks the real protocol (hello, sub, snapshot, req/res, ordered `ev`,
  base64 terminal streams, Claude view events) and answers every request. The daemon is a lazy
  chunk; the landing imports only `src/demo/api.ts`.
- One world per page (`window.__naDemo`, created before any iframe gets a `src`), so desk and phone
  frames share state: answering a permission on the phone continues the desktop agent.
  `window.__naDemoFrame` per frame: `ready`, `navigate(route)`, `setLook(look)`.
- Synthetic host "Studio" (`/Users/demo`, projects billing-api, web-shop, docs-site); a virtual
  clock, seeded RNG, in-memory files and git, a tiny shell. Scenes: grid, permission, phone,
  neural, team, files, agents, idle (`src/demo/SCENES.md`).
- Claude view: an intent matcher plays skills (explain real files, run tests with Allow/Deny, write
  tests, plan mode, subagents, queueing, 12 slash commands, `!cmd`); unknown input gets an honest
  in-character answer. Neural: status, start/stop, summarise, tests, approve/deny, remember, tasks,
  observations, "While you were away". Teams: one scripted race and one build + review.
- `isolate.ts` keeps the visitor's real storage untouched (in-memory storage and history), hides
  calls, mutes alerts; xterm gets no WebGL 2 context (one context per pane stalled scene switches),
  so it uses its DOM renderer.
- `/demo/` itself is a stage page with a toolbar (view, scene, look, Reset, Get it); compact layout
  on phones and short landscape.

## Landing stage (`src/site/sections/Stage*.tsx`, `src/site/stage/**`)
- From 900 px with a mouse: a sticky stage. The site-drawn window shows the live app at 960 px
  wide (scale about 1.0 at 1440+), the phone (390x844) slides in for the phone chapters, each
  chapter plays a scene and shows readout lines from the shared world. The iframe is `inert` until
  the visitor arms it ("Type in the app", mouse rest, tap); Escape gives focus back.
- Phones, tablets, touch: no inline iframe; a swipeable deck of poster devices that open
  `/demo/?view=phone&scene=…`. Posters show first everywhere and cross-fade to the live frame.

## Generated assets
- Posters `public/demo/{desk,phone}-*.webp`: `node scripts/dev/site-posters.mjs <dev url>` (fixed
  clock, seed 7; each under 120 KB). Rerun after visible demo changes.
- Share cards `public/og.png`, `public/og/*.png`: `node scripts/dev/site-og.mjs` (from the posters).
  `docs/brand/build-web-icons.mjs` makes only the icons now.

## Checks
- `pnpm --filter @neuralagent/web test` (demo daemon, Claude/Neural skills, static copy),
  `typecheck`, `pnpm lint:tokens`, `vite build`.
- Reviewed in Chromium and WebKit at 320-1920 px (phones with touch emulation): no horizontal
  overflow, no console errors, axe clean, keyboard path (skip link, tabs, FAQ, menu, stage), hash
  jumps land under the nav.

## Open points
- Not tried on real iOS Safari, a real Android phone or Firefox (WebKit/Chromium emulation only).
- Imprint postal address and the Windows minimum version are missing (not invented).
- Relay: unknown paths return 200 with the 404 page (soft 404); bare directories 307 instead of 301.
- lucide icons end up in many small shared chunks (one request each); a manual icons chunk would
  also pull in the web remote's icons, so it was left.
- 900-1179 px mouse windows dock the stage window at 0.55-0.80 scale.
- `packages/app`: `useDaemon((c) => c.state?.swarms ?? [])` re-renders forever while state is empty
  (the demo opens `#/swarms` only after the first state); TerminalView makes one WebGL context per
  pane; the app still says "New swarm" in places where the site says Teams.
- Demo limits: free-form work requests get a scripted answer, not a solution; races and build +
  review exist for one goal each; voice, calls and pairing are not simulated.
