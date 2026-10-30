# AGENTS.md: start here

The single entry point for anyone (human or agent) working in this repo. Read this, then
[`docs/HANDOFF.md`](docs/HANDOFF.md) (current state), then look files up in
[`docs/CODEMAP.md`](docs/CODEMAP.md) instead of scanning the tree. `CLAUDE.md` only points here.

## The project
NeuralAgent is a desktop app for running many AI coding agents side by side (Claude Code, Codex,
Gemini and more in a grid of persistent terminals). It has a dashboard, local voice control, an
orchestrator called **Neural**, a Claude view over the real CLI, swarms, and a phone remote (web +
Android) that reaches the computer end-to-end encrypted through a relay at
`agent.neuralhub.dev`. Closed source, © Leandro Probst. The owner works only through AI agents.

## Repo map
| Path | What |
|---|---|
| `crates/na-daemon` | `neuralagentd`, the background service: PTYs, sessions, Neural, swarm, voice, remote link. Keeps agents running while the app window restarts. |
| `crates/na-protocol` | Shared message types (generates `packages/protocol/src/gen/*.ts` on `cargo test`). |
| `crates/na-relay` | Relay on agent.neuralhub.dev: accounts, sealed tunnel, push, releases/updates, serves `apps/web/dist`. |
| `crates/na-crypto`, `crates/na-voice` | E2E crypto; speech (STT/TTS/wake word). |
| `apps/desktop` | Tauri 2 app (`src-tauri/`: updater, daemon start/upgrade; `src/main.tsx`: platform glue; `src/dev-browser.tsx`: the UI in a normal browser). |
| `apps/web` | Website (landing, `/download`, `/changelog`, legal), `/admin/`, `/app/` web remote (`src/remote/`). |
| `apps/android` | Capacitor shell that loads `/app/` from the relay, plus native code (push, widget, calls). |
| `packages/app` | The shared React app (desktop, web remote, Android). Platform abstraction in `src/lib/platform.ts`. |
| `packages/ui` | Design system `@neuralagent/ui`: components and tokens. |
| `packages/protocol`, `packages/remote`, `packages/crypto` | TS client for the daemon; remote account/relay link/transport; crypto. |
| `scripts/` | Release (`set-version`, `changelog`, `stage-daemon`, `release-*`), token lint, docs guard, codemap, CI E2E/smoke tests. |
| `scripts/dev/` | Interactive test tools: test daemon + UI in a browser, screenshots, web remote, Neural/call/swarm kits. [README](scripts/dev/README.md). |
| `deploy/relay` | Relay Dockerfile and compose. |
| `.claude/skills/` | Project skills: `release`, `deploy-web`, `ui-check`. |
| `research-local/` | Git-ignored scratch: briefs, screenshots, reports. Never commit it. |

## Where state and docs live
Index: [`docs/README.md`](docs/README.md). Do not move these files.
- `docs/HANDOFF.md`: current state, next steps, open issues. Short; rewrite it at session end.
- `docs/STATUS.md`: milestone table, the owner's checklist, budget. `docs/PLAN.md`: milestones (current: M10).
- `docs/DECISIONS.md`: numbered decisions (D1…). `docs/notes/*.md`: design notes per feature round.
- `docs/CODEMAP.md`: generated file map (`pnpm codemap`). `docs/archive/`: old state, history only.
- `docs/RELEASING.md` + `CHANGELOG.md`: release runbook and user-facing notes.
- `docs/ADMIN-HANDBUCH.md`: operator handbook (German).

## Per-change routine
1. **Find**: grep `docs/CODEMAP.md` for the area, read only the files you need (offset/limit for big ones).
2. **Work**: new logic in new files; edits to shared files (`packages/app/src/App.tsx`,
   `apps/web/src/remote/Remote.tsx`, sidebar/tab bar) stay small.
3. **Test**: `pnpm typecheck && pnpm test && pnpm lint:tokens`, `cargo test --workspace` when Rust
   or protocol changed. Add a test for new logic. Filter long output (`| tail -40`).
4. **Look at it** (UI changes): `node scripts/dev/env.mjs up --seed`, then
   `node scripts/dev/shot.mjs pages --montage` (phone + desk, light + dark), review against
   [`docs/notes/design-system.md`](docs/notes/design-system.md) → "Checklist for a page",
   `env.mjs down`. Skill `ui-check` does this.
5. **CHANGELOG**: one line in user words under `## [Unreleased]` in `CHANGELOG.md` (New /
   Improved / Fixed) for every user-visible change.
6. **DECISIONS**: an entry `## Dnn — …` for every lasting design choice (why, alternatives).
7. **Notes**: a feature round gets or extends a `docs/notes/<topic>.md` (link it in `docs/README.md`).
8. **Session end**: rewrite `docs/HANDOFF.md` (done / next / open issues); tick STATUS items;
   `pnpm codemap` if files were added or renamed; `pnpm check:docs` must pass.

## Run and test
Requirements: Rust stable, Node 22+, pnpm 12.
```
pnpm install
pnpm dev                      # desktop app (Tauri); set NEURALAGENT_HOME=/tmp/na-dev for test state
pnpm dev:web                  # website + web remote (http://localhost:5173/app)
pnpm typecheck && pnpm test && pnpm lint:tokens && pnpm check:docs
cargo test --workspace        # also regenerates the protocol TS types
pnpm --filter @neuralagent/web build
```
Everything interactive (test daemon, screenshots, web remote, push, Neural, calls, swarm,
Android WebView, update test): [`scripts/dev/README.md`](scripts/dev/README.md). Android emulator
recipe: `docs/HANDOFF.md` → "How to run".

## Conventions
- **Language**: code, comments, commits and docs in English (except `docs/ADMIN-HANDBUCH.md`).
  User-facing text is plain, short English. **Answers to the owner: short, simple German.**
- UI: `@neuralagent/ui` components and tokens only; read
  [`docs/notes/design-system.md`](docs/notes/design-system.md) before building a screen.
  `pnpm lint:tokens` rejects raw hex colours and arbitrary Tailwind values.
- Protocol changes: edit `crates/na-protocol`, then `cargo test` regenerates the TS types.
- `cargo fmt` for Rust (`rustfmt.toml`).
- Do not commit unless asked. The owner decides when to commit.

## Several agents at once
- **Ownership**: the brief says which paths you own. Edit only those; anything else, report it.
  Typical split: app code (`packages/*`, `apps/*`, `crates/*`) vs docs/workflow (`AGENTS.md`,
  `docs/**`, `.claude/**`, `scripts/`). `docs/notes/*` belongs to the feature agent that wrote it.
- **Re-read right before every edit**: another agent may have changed the file since you read it.
  Edit with exact, small replacements, never by rewriting a whole shared file.
- **Never revert, reformat or "fix" someone else's change**, even if it looks wrong: report it.
- **Shared resources**: pick your own `NEURALAGENT_HOME`, Vite port and relay port (others may
  run `/tmp/na-ui` on :1451 or a relay on :8093–:8098). Stop only PIDs you started.
- **At most 2–3 parallel subagents**, never two on the same files.
- **Briefing a subagent**: goal, the exact files/paths it owns, what is already known or ruled
  out, how to verify, and "answer in ≤ 40 lines; details into `research-local/<file>`". It knows
  nothing else. Cheap model (Haiku) for search/summaries, Sonnet for mechanical work.

## Safety
- **Never restart, kill or upgrade the owner's installed NeuralAgent app or daemon.** Agent
  sessions usually run inside it, so you would kill yourself mid-task. Use your own daemon with
  `NEURALAGENT_HOME=/tmp/<something>` (the `scripts/dev` tools refuse the real data dir).
- If the owner asks you to install a build on their Mac: `scripts/dev/install-local.sh`, started
  detached (`nohup … &`) as the **last** action of the turn, after the final answer.
- Careful with `ps`: full command lines and environments can contain tokens. Use
  `ps -o pid,comm` or filter, and never paste daemon tokens, URLs with `token=` or env dumps.
- Do not deploy the relay or publish a release unless asked. Deploy steps: skill `deploy-web`
  ([`docs/RELEASING.md`](docs/RELEASING.md) → "Deploying the relay and website").
- No push notifications, emails or social posts to real accounts. Write drafts instead.

## Secrets
- Never write passwords, API keys or tokens into commands, files, logs or answers. Never print
  `/etc/neuralagent/relay.env`, `daemon.json` or `remote-credentials.json`.
- Where they live: macOS keychain (`neuralagent-llm`, `neuralagent-android-keystore`, …),
  `~/.neuralagent-secrets/`, GitHub Actions secrets (signing keys, upload token),
  `/etc/neuralagent/` on the relay host. Use them inline:
  `"$(security find-generic-password -s <name> -w)"`, never echo them.
- `.gitignore` excludes `.env*`, keys, keystores, `google-services.json` and `research-local/`.
- If someone pastes a secret in chat, tell them to rotate it.

## Releases
Runbook: [`docs/RELEASING.md`](docs/RELEASING.md); skill `release`
([`.claude/skills/release/SKILL.md`](.claude/skills/release/SKILL.md)). In short: notes under
`[Unreleased]` → `node scripts/set-version.mjs X.Y.Z` → verify → commit, tag `vX.Y.Z`, push → CI
publishes → deploy relay/website (skill `deploy-web`) → check `/api/releases/latest`.
`set-version` leaves a new empty `## [Unreleased]` on top; keep it (`pnpm check:docs` fails without it).
