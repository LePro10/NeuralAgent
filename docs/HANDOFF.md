# Handoff

Current state for a fresh session. Start with [../AGENTS.md](../AGENTS.md) (rules, routine), then
[CODEMAP.md](CODEMAP.md) to find files. Progress and the owner's checklist: [STATUS.md](STATUS.md);
plan: [PLAN.md](PLAN.md); decisions: [DECISIONS.md](DECISIONS.md). The longer previous handoff
(module pointers per milestone): [archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md).

## Where we are (2026-10-30)
- M0–M9 done; **M10 (own ideas, polish, final report) is current**.
- Released: 0.2.0 (design + remote round, D40–D42), installed and deployed.
- 0.2.1 (fix, D43: remote access died after start): tag `v0.2.1` pushed, never built.
- **0.3.0** (mobile-first polish round: design system D45, light mode, Claude view rebuilt,
  update UX + changelog D44, connection fixes): **released and published** 2026-10-30 (all
  platforms, `/api/releases/latest` = 0.3.0, the Mac updater offers it to 0.2.1). Relay + website
  deployed with 0.3.0. GitHub Actions minutes for the private repo were used up (macOS = 10×);
  workaround used: repo made public for the release run, then private again (gitleaks scan of
  the full history was clean). The owner's Mac still runs 0.2.1 and tests the auto-update.
- **0.3.1** released, published and deployed 2026-10-30 (same public-for-the-run workaround,
  repo private again): sidebar collapses vertically again, update pill above the account,
  avatar opens Settings, Remote + MCP inside Settings (D47), quiet agent tiles and one global
  Chat/Terminal switch (D46), accent/theme "ground" gradients behind every page, terminal
  repaint after resize, collapsible website changelog.
- **0.3.2** and **0.3.3** released, published and deployed 2026-10-30 (public-for-the-run
  workaround, repo private again). 0.3.2: images in the Claude view (D50), one launch motion on
  all platforms (D49, new APK), Swarm redesign (D48), Settings like the other pages, quicker
  sidebar peek, desktop interface size, calls fixed (mic worklet was inlined as data: URL and
  blocked by the CSP), "Hey Neural" sends to Neural. 0.3.3: dictation pastes on macOS (synthetic
  typing dropped characters in terminals), voice pill follows the mic level.
- macOS app is ad-hoc signed: every update loses the Accessibility permission (owner must remove
  and re-add NeuralAgent). Fix offered to the owner: a stable self-signed signing identity in CI
  (free) or an Apple Developer ID. Not decided yet.
- Docs/workflow round done: test tools in `scripts/dev/`, `docs/CODEMAP.md` + `pnpm codemap`,
  `pnpm check:docs`, skills `release`, `deploy-web`, `ui-check`, history in `docs/archive/`.

## Next
1. Next release when the owner says so. Actions minutes reset monthly; for a release
   run without minutes, the owner agreed to make the repo public just for the run (scan first).
2. Owner checks on real devices (STATUS checklist), then M10 final report.
3. Small leftovers: leading zero in the "checked at" time, folder-browser chip fade, Android
   status bar colour in light mode (needs a new APK), iOS PWA status text stays white in light
   mode, "done, not seen" is not persisted by the daemon.

## Open issues
- "Last seen" for a device that never connected shows its creation date.
- Agents page says "No agents running" while only a plain shell runs.
- Design-system gaps listed at the end of `docs/notes/design-system.md`.
- Relay on .96 is deployed by hand until the GHCR read token exists (STATUS checklist).
- Only one daemon may use a copy of `remote-credentials.json` (D43): a second one rotates the
  refresh token away. Test daemons use their own `/tmp` home and the relay test login.

## How to run
- Everything for interactive checks (test daemon + UI in a browser, screenshots, web remote,
  Neural/call/swarm kits, Android WebView, macOS input helpers, update test):
  [../scripts/dev/README.md](../scripts/dev/README.md).
- Tests: `cargo test --workspace`; `pnpm typecheck && pnpm test && pnpm lint:tokens && pnpm check:docs`.
  Remote E2E: `cargo build -p na-daemon && cargo build -p na-relay --features test-login &&
  node --experimental-strip-types scripts/e2e-remote.ts`.
- `pnpm dev` (Tauri dev; set `NEURALAGENT_HOME=/tmp/na-dev` to keep test state separate).
- Android emulator: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21
  ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`; start AVD `na36` headless
  (`$ANDROID_HOME/emulator/emulator -avd na36 -no-window -gpu swiftshader_indirect`); local relay
  (test login, FCM) + daemon via `scripts/android-dev.sh` (relay on :8095); `adb reverse tcp:8095
  tcp:8095` (WebCrypto needs localhost, not 10.0.2.2); build with
  `cd apps/android && NA_REMOTE_URL=http://localhost:8095/app/ npx cap sync android && cd android
  && ./gradlew assembleDebug`, then `adb install -r`. Run `npx cap sync android` again without
  the variable afterwards.
- Release: [RELEASING.md](RELEASING.md). Relay/website deploy: skill `deploy-web`.
