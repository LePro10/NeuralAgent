# Mobile-first polish round (2026-10-30)

Goal (user, verbatim intent): the Android app / phone layout must feel *built for phones* —
iOS-quality, production-ready, not a prototype. Every menu, every animation, every screen.
Desktop and the web remote (`/app/`) too. The Claude view must look like Claude's own UI
(claude.ai / Claude mobile apps / Claude desktop). Nice launch motion when the app opens
(desktop and phone). No tiny icons. People must find their way around (clear navigation).
Neural page currently looks "black and white" and unattractive.
The phone Agents dashboard is the best current screen: use it as a starting point for style.

User screenshots (Android, Capacitor shell that loads the hosted web remote):
`research-local/polish/user-shots/*.jpg` (the `1793361431…`–`1793361455…` set).

## Problems seen in the screenshots
1. "Reconnecting to the daemon…" shows constantly; host log shows the phone's E2E session
   reconnecting every 1–2 min while in the foreground (`daemon.log` 11:45–11:53 UTC).
2. Content sits under the Android status bar: Claude pane tab strip ("Tab 2 / Tab / main /
   New agent") overlaps the clock and status icons; the reconnect callout overlaps too.
   No `safe-area-inset-top` handling.
3. Claude view model popup opens clipped off the left edge of the screen.
4. Effort cannot be chosen (Claude Code has `/effort low|medium|high|xhigh|max`).
5. Pane header has 6 tiny icon buttons crammed in one row; "Cogitated f…" status truncated.
6. Image uploads from the phone all show "Failed" (7 photos at once).
7. Swarm "new swarm" sheet: title/description cut off at the top when the keyboard opens,
   empty dark area between sheet and keyboard; selects are cramped.
8. Usage page renders at a different (smaller) scale than other pages; reconnect banner on top.
9. Neural page: attention notifications are a plain wall of grey text with bell icons;
   the workspace chip row is clipped on the right; flat black/white look.
10. Bottom tab bar: workspace name ("NeuralAgent") squeezed into a tab; icons + labels small.

## Plan
- Phase 1 (parallel): Claude UI research → `research-local/polish/claude-ui.md`;
  connection/upload/effort fixes; full visual audit (phone + desktop screenshots) →
  `research-local/polish/audit.md`.
- Phase 2: design system + app shell (packages/ui) → then Claude view and all pages in parallel.
- Phase 3: screenshot verification loop, typecheck/tests, deploy relay (web remote = Android
  app), local Mac build + install (daemon restart last, detached).

## Owner decisions (2026-10-30)
- Colours: keep roughly the current brand look, but optimise: better gradients, tinted surfaces,
  coloured accents instead of flat black/white; accent selectable (existing themes).
- Add a light mode next to dark, following the system by default, switchable in Settings.
- Discord: the Rich Presence had no image (asset key "logo" never uploaded). The daemon now uses
  external URLs `https://agent.neuralhub.dev/discord/{logo-512,small-working,small-waiting,small-idle}.png`
  (`crates/na-daemon/src/discord.rs`); the files live in `apps/web/public/discord/`.
- Updates: version label above the account row, noticeable (calm) "Update" button when one is
  available, dialog on start, changelog (CHANGELOG.md → manifest + /changelog page), same for
  the web remote (reload when a newer web build is deployed). AGENTS.md + docs/RELEASING.md.
- PWA notch: installed PWA (Android/iOS) shows a black bar at the status bar. Head/manifest fixed
  by the icons agent (black-translucent on iOS, theme/background colour); the app shell must pad
  with `env(safe-area-inset-top)` everywhere and set `<meta name="theme-color">` at runtime to the
  current top background (theme + light/dark), so Android's status bar blends in.
- Status indicators (owner, 14:06): orange dot only for "agent finished"; working = animated light
  running around the item/icon (LightBorder-style); waiting and error get distinct signals.
  (Sent to the design-system agent: NavItem `activity`.)
- Neural page call button: the phone icon is off-centre inside its round button (older screenshot
  09:21) — pages agent must fix and check icon centring in all round icon buttons.
- Final step before shipping (owner asked): a docs/workflow agent — move the useful test drivers
  from /tmp/na-drive and other /tmp kits into the repo (scripts/ui/ …), tidy STATUS/HANDOFF/PLAN,
  generate docs/CODEMAP.md, write the per-change workflow (CHANGELOG Unreleased, HANDOFF,
  DECISIONS, screenshot verification) into AGENTS.md, check all doc pointers.
