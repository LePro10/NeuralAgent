# AGENTS.md: start here

The single entry point for anyone (human or agent) working in this repo. Read this first, then
`docs/HANDOFF.md` for the current state. `CLAUDE.md` only points here.

## The project
NeuralAgent is a desktop app for running many AI coding agents side by side (Claude Code, Codex,
Gemini and more in a grid of persistent terminals). It has a dashboard, local voice control, an
orchestrator called **Neural**, a Claude view over the real CLI, and a phone remote (web +
Android) that reaches your computer end-to-end encrypted through a relay at
`agent.neuralhub.dev`. Closed source, © Leandro Probst. Product site: `apps/web`.

## Repo map
| Path | What |
|---|---|
| `crates/na-daemon` | `neuralagentd`, the background service: PTYs, sessions, Neural, swarm, voice, remote link. Keeps agents running while the app window restarts. |
| `crates/na-protocol` | Shared message types (generates `packages/protocol/src/gen/*.ts` on `cargo test`). |
| `crates/na-relay` | Relay on agent.neuralhub.dev: accounts, sealed tunnel, push, releases/updates, serves `apps/web/dist`. |
| `crates/na-crypto`, `crates/na-voice` | E2E crypto; speech (STT/TTS/wake word). |
| `apps/desktop` | Tauri 2 app (`src-tauri/`: updater, daemon start/upgrade; `src/main.tsx`: platform glue). |
| `apps/web` | Website (landing, `/download`, `/changelog`, legal), `/admin/`, `/app/` web remote (`src/remote/`). |
| `apps/android` | Capacitor shell that loads `/app/` from the relay, plus native code (push, widget, calls). |
| `packages/app` | The shared React app (desktop, web remote, Android). Platform abstraction in `src/lib/platform.ts`. |
| `packages/ui` | Design system `@neuralagent/ui`: components and tokens. |
| `packages/protocol`, `packages/remote`, `packages/crypto` | TS client for the daemon; remote account/relay link/transport; crypto. |
| `scripts/` | Release (`set-version`, `changelog`, `stage-daemon`, `release-collect`, `release-publish`), token lint, E2E and smoke tests. |
| `deploy/relay` | Relay Dockerfile and compose. |
| `research-local/` | Git-ignored scratch: briefs, screenshots, reports, tools. Never commit it. |

## Where state and docs live
Index: [`docs/README.md`](docs/README.md). Do not move these files.
- `docs/HANDOFF.md`: current state, next steps, how to run things, test kits. Keep it current.
- `docs/STATUS.md`: detailed progress per milestone. `docs/PLAN.md`: milestones (M0–M10).
- `docs/DECISIONS.md`: numbered decisions (D1…); add one for every lasting design choice.
- `docs/notes/*.md`: design notes per feature round. `docs/brand/`: logo and icon sources.
- `docs/ADMIN-HANDBUCH.md`: operator handbook (German).
- `docs/RELEASING.md`: the release runbook. `CHANGELOG.md`: user-facing release notes.

## Run and test
Requirements: Rust stable, Node 22+, pnpm 12.
```
pnpm install
pnpm dev                      # desktop app (Tauri); set NEURALAGENT_HOME=/tmp/na-dev for test state
pnpm dev:web                  # website + web remote (http://localhost:5173/app)
pnpm typecheck && pnpm test && pnpm lint:tokens
cargo test --workspace        # also regenerates the protocol TS types
pnpm --filter @neuralagent/web build
```
- Browser UI against a test daemon: `apps/desktop/src/dev-browser.tsx` (`dev.html#port=…&token=…`
  from `$NEURALAGENT_HOME/daemon.json`; its header lists fake-update params). Screenshots with
  playwright-core from a scratch folder (`/tmp/na-drive`), not a repo dependency.
- More recipes (remote E2E, Android emulator, voice, swarm, Neural): `docs/HANDOFF.md` → "How to run".

## Conventions
- UI: use `@neuralagent/ui` components and tokens. Before building or changing a screen, read
  [`docs/notes/design-system.md`](docs/notes/design-system.md): tokens, phone navigation, which
  overlay to use, activity marks, and the screenshot checklist. `pnpm lint:tokens` rejects raw hex
  colours and arbitrary Tailwind values.
- New logic goes in new files. Edits to shared files (`packages/app/src/App.tsx`,
  `apps/web/src/remote/Remote.tsx`, sidebar/tab bar) stay small. Re-read a file right before
  editing it, because other agents may be working in parallel. Never revert someone else's change.
- Code comments and docs are in English (except `ADMIN-HANDBUCH.md`). User-facing text is plain,
  short English.
- Protocol changes: edit `crates/na-protocol`, then run `cargo test` to regenerate the TS types.
- Every user-visible change gets a line under `## [Unreleased]` in `CHANGELOG.md`.
- `cargo fmt` for Rust (`rustfmt.toml`).
- Do not commit unless asked. The user commits.

## Safety
- **Never restart, kill or upgrade the user's installed NeuralAgent app or daemon.** Agent
  sessions often run inside it. Use your own daemon with `NEURALAGENT_HOME=/tmp/<something>` and
  stop only processes you started.
- Do not deploy the relay or publish a release unless the user asks.
- Do not send push notifications, emails or social posts to real accounts. Write drafts instead.

## Secrets
- Never write passwords, API keys or tokens into commands, files, logs or answers. Never print
  `/etc/neuralagent/relay.env` or a daemon token.
- Where they live: macOS keychain (`neuralagent-llm`, `neuralagent-android-keystore`, …),
  `~/.neuralagent-secrets/` (Android keystore), GitHub Actions secrets (signing keys, upload
  token), `/etc/neuralagent/` on the relay host. Read them with
  `"$(security find-generic-password -s <name> -w)"` inside the command, never echo them.
- `.gitignore` excludes `.env*`, keys, keystores, `google-services.json` and `research-local/`.
- If someone pastes a secret in chat, tell them to rotate it.

## Release checklist
Full runbook: [`docs/RELEASING.md`](docs/RELEASING.md). Agents can use the `release` skill
(`.claude/skills/release/SKILL.md`).
1. **Changelog**: write the changes since the last tag (`git log vX.Y.Z..HEAD`) under
   `## [Unreleased]` in `CHANGELOG.md`, in user words, grouped New / Improved / Fixed.
2. **Version**: `node scripts/set-version.mjs X.Y.Z`. This turns Unreleased into
   `## [X.Y.Z] - <today>` and refuses to run without notes. Check with
   `node scripts/changelog.mjs check X.Y.Z`.
3. **Verify**: typecheck, test, lint:tokens, `cargo test --workspace`, web build.
4. **Tag**: commit "Release X.Y.Z", `git tag vX.Y.Z`, `git push && git push origin vX.Y.Z`.
5. **CI**: `.github/workflows/release.yml` builds macOS/Windows/Linux/Android, then publishes on
   agent.neuralhub.dev with the changelog section as the notes.
6. **Relay/website**: deploy by hand (rsync + docker build on the host; see RELEASING.md). This
   ships the new `/changelog` and `/app/`; open web remotes then offer "Reload to update".
7. Check `https://agent.neuralhub.dev/api/releases/latest` and an update from the previous version.
