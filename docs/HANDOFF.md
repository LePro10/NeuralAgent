# Handoff

Current state for a fresh session. Start with [../AGENTS.md](../AGENTS.md) (rules, routine), then
[CODEMAP.md](CODEMAP.md) to find files. Progress and the owner's checklist: [STATUS.md](STATUS.md);
plan: [PLAN.md](PLAN.md); decisions: [DECISIONS.md](DECISIONS.md). The longer previous handoff
(module pointers per milestone): [archive/HANDOFF-2026-10-30.md](archive/HANDOFF-2026-10-30.md).

## Where we are (2026-10-30)
- M0–M9 done; **M10 (own ideas, polish, final report) is current**.
- Released: 0.2.0 (design + remote round, D40–D42), installed and deployed.
- 0.2.1 (fix, D43: remote access died after start): tag `v0.2.1` pushed, but GitHub Actions
  refuse to run (billing/spending limit). Not published on agent.neuralhub.dev, no
  Windows/Linux/Android builds. The owner's Mac runs a locally built 0.2.1.
- Mobile-first polish round, committed (7534a41), **not released or deployed**: design system
  (D45, `docs/notes/design-system.md`, `docs/notes/mobile-polish.md`), Claude view rebuilt
  (`docs/notes/claude-view.md`), all pages, connection fixes (heartbeats, fast reconnect,
  photo uploads), update UX + `CHANGELOG.md` → dialog, `/changelog`, release notes (D44).
  Changes are listed in `CHANGELOG.md` under `[Unreleased]`.
- Docs/workflow round (uncommitted at the time of writing): test tools moved from `/tmp` into
  `scripts/dev/` (README there), `docs/CODEMAP.md` + `pnpm codemap`, docs guard
  `pnpm check:docs` (also in CI), skills `deploy-web` and `ui-check`, history moved to
  `docs/archive/`. `playwright-core` is a pinned root devDependency now.

## Next
1. When GitHub billing is fixed: re-run the Release workflow for v0.2.1, check
   `/api/releases/latest`.
2. Release the `[Unreleased]` section as the next version (skill `release`), then deploy the
   relay/website (skill `deploy-web`). Today the live relay serves 0.2.0 and `/version.json`
   is a 404, so the website changelog is not live yet.
3. Owner checks on real devices (STATUS checklist), then M10 final report.

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
