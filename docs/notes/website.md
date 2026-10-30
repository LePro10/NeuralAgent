# Website redesign (agent.neuralhub.dev)

## Structure (`apps/web`)
- `index.html`: meta, OG/Twitter, JSON-LD, favicon (`public/favicon.svg`), `public/og.png`, `robots.txt`, `sitemap.xml`.
- `src/landing.tsx`: assembles the page. `src/site/` holds everything site-specific, `site.css` all styles (tokens only).
  - `hooks.ts`: `startScroll()` (one scroll listener sets `--page`, per element `--p`/`--v`/`--t`; IntersectionObserver `data-reveal`), `useSeen/useVisible/useMedia/useCopy`.
  - `data.ts`: copy (FAQ, agent list), OS detection, `useRelease()` (reads `/api/releases/latest`, falls back to `/download`; iPhone gets the web remote).
  - `parts.tsx`: typed terminal (`useTypist`, `Term`, `AutoPane`), `Win` window frame, `Wave`, `Orb`, `CopyCmd`, own `Btn`, `Aurora` (same CSS as the library's AuroraField). The landing does not import `@neuralagent/ui` (keeps the bundle small: page JS 38 kB + shared react).
  - `Nav` (glass island, section highlight, mobile sheet, progress bar), `Hero` (title mask-rise, parallax aurora, tilting window with 4 typing agents), `Story` (pinned 4-chapter scroll story on desktop, stacked on phone), `Showcase` (8 ARIA tabs: agents, Neural, swarms, remote, alerts, usage, MCP, themes with live scheme switcher; plus 6 detail cards), `Demo` (lazy chunk: desktop panes with approve/deny, scripted Neural call with waveform, phone view sharing state; pure front-end), `Sections` (numbers, security diagram, platforms, FAQ, final CTA, footer).
- Legal pages `src/legal.tsx`: placeholders and draft banner removed; text matches the relay code (Google/GitHub sign-in, FCM, Web Push, Brevo mail, no cookies/analytics, IP only in memory for rate limit, update check).
- Reduced motion: reveals/animations off, pages stay complete. No horizontal scroll at 390 px (checked).

## Verification
- `pnpm --filter @neuralagent/web build`, `tsc -p apps/web`, `pnpm lint:tokens`: green.
- Built dist via `vite preview`: `/`, `/download/`, `/privacy/`, `/imprint/`, `/terms/`, `/app/`, `/admin/`, `/session/` load, no JS errors, no horizontal scroll at 390.
- First load of `/` about 170 kB transferred (uncompressed preview).
- Screenshots: `/tmp/na-shots/website (not in the repo)/` (desktop-*.png 1440, phone-montage-*.png 390, demo-*.png).
- Scratch scripts: `/tmp/na-site-shots/*.mjs`.

## Not done / notes
- No real app screenshots (design in flux); the demo is a simulation.
- Lighthouse not run (no tool available offline); structure is static, lazy demo, no web fonts beyond the existing two.
- Reference site bridgemind.ai was behind a Cloudflare check, so no screenshot; structure follows the brief.
