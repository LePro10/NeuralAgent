# Releasing NeuralAgent

The release runbook. Short version: `AGENTS.md` → "Release checklist". Agents can follow the
`release` skill (`.claude/skills/release/SKILL.md`). Background: D38 (updates and releases), D43.

## How a release flows
1. `CHANGELOG.md` gets a section `## [X.Y.Z] - YYYY-MM-DD` (from `## [Unreleased]`).
2. `scripts/set-version.mjs X.Y.Z` writes the version into the Cargo workspace (daemon, desktop
   app, relay; Tauri reads it from the crate) and the Android app, then refreshes `Cargo.lock`.
3. Tag `vX.Y.Z` → `.github/workflows/release.yml`:
   - `version`: the tag must match the version, and `CHANGELOG.md` must have a non-empty section
     for it (`node scripts/changelog.mjs check X.Y.Z`).
   - `desktop`: macOS (aarch64 + x86_64), Windows and Linux bundles with the daemon as a sidecar
     (`stage-daemon.mjs`), signed for the Tauri updater; `release-collect.mjs` writes a
     `part-*.json` per platform.
   - `android`: a signed APK.
   - `publish`: `release-publish.mjs` uploads everything to agent.neuralhub.dev and publishes the
     merged manifest. The notes are this version's changelog section (`releaseMarkdown`). For
     tags cut before `CHANGELOG.md` existed (up to 0.2.1) it falls back to the commit message
     (`RELEASE_NOTES`). The relay keeps the newest three releases.
4. Installed apps find the release through `/api/update/{target}/{arch}/{current}` (204 when
   current, cached for a minute). They check a few seconds after start, on focus (at most once a
   minute) and every 5 minutes. On the first check after start they show the update dialog once
   per version, with the changelog between the two versions (the app fetches
   `<relay>/changelog.json`).
5. Installing restarts only the app window. The daemon keeps every agent running. The app moves
   it to the new version (`daemon_upgrade`) once no session is alive. If that fails, it shows a
   toast with Retry, and so do the dialog and Settings → Updates.

## Writing the changelog
- Format: [Keep a Changelog](https://keepachangelog.com). Groups are only `### New`,
  `### Improved` and `### Fixed`. An optional one-line summary goes under the heading.
- Write for users: what they notice, not how it was done. One line per change, present tense,
  no commit hashes, no internal names (D-numbers, file names). `**bold**` for feature names,
  `` `code` `` and `[links](…)` are rendered.
- Collect material with `git log --no-merges --format='%s%n%b' vLAST..HEAD` and
  `docs/notes/*.md`. Leave out pure refactors, CI and doc changes.
- Add lines under `## [Unreleased]` as you go (every user-visible change).
- Tools: `node scripts/changelog.mjs json` (parsed), `notes X.Y.Z` (the markdown that becomes
  the release notes), `check X.Y.Z`, `cut X.Y.Z [date]` (what set-version does).
- The same file feeds the website (`/changelog`, built from `virtual:changelog`), the relay's
  `/changelog.json` and the in-app dialog. So the website, the web remote and the dialog only
  show new notes after the relay is deployed with a fresh `apps/web` build.

## Step by step
```
git switch main && git pull
git describe --tags --abbrev=0                 # last tag, e.g. v0.2.1
git log --no-merges --oneline v0.2.1..HEAD     # what changed
$EDITOR CHANGELOG.md                           # fill ## [Unreleased]
node scripts/set-version.mjs 0.3.0             # cuts the section with today's date, bumps versions
node scripts/changelog.mjs notes 0.3.0         # read it once more
pnpm typecheck && pnpm test && pnpm lint:tokens && cargo test --workspace
pnpm --filter @neuralagent/web build
git commit -am "Release 0.3.0"
git tag v0.3.0 && git push && git push origin v0.3.0
```
Then watch the Release workflow (`gh run watch`), deploy the relay (below), and check:
- `curl -s https://agent.neuralhub.dev/api/releases/latest` shows the version and notes.
- `curl -sI https://agent.neuralhub.dev/api/update/darwin/aarch64/<previous>` returns 200.
- `https://agent.neuralhub.dev/changelog` shows the section.
- `/download` lists the new files.
- An installed previous version shows the update dialog after a restart.

`set-version` refuses when `## [Unreleased]` is empty and the version has no section yet, or when
the version's section exists but is empty.

## Deploying the relay and website (by hand)
CI pushes the relay image to GHCR, but the relay host cannot pull it yet (no read token). So deploy
by hand from the repo root. The Dockerfile builds `apps/web` inside the image; build it locally
first anyway as a check. Agents: skill `deploy-web` (checks, rollback tag, verification).
```
git ls-files -z | rsync -a --from0 --files-from=- ./ root@192.168.30.96:/opt/neuralagent/src/
ssh root@192.168.30.96 'cd /opt/neuralagent/src && docker build -f deploy/relay/Dockerfile -t ghcr.io/lepro10/neuralagent-relay:latest . && cd /opt/neuralagent && docker compose up -d'
```
Container `neuralagent-relay`, env in `/etc/neuralagent/relay.env`: never print it. Static files
are served with `no-cache` (revalidate), and hashed `/assets/*` are immutable. So a deploy is live
immediately, and open web remotes / Android apps show "Update → Reload" within a few minutes
(they compare `/version.json` with their own build).

## While GitHub Actions is blocked (billing / spending limit)
State on 2026-10-30: tag `v0.2.1` is pushed, but Actions refused to start. 0.2.1 is **not
published** on agent.neuralhub.dev (no Windows/Linux/Android builds, and the updater still offers
nothing beyond 0.2.0). The user's Mac runs a locally built 0.2.1.
- **Mac only, for the user's own machine**: build without updater artifacts (the signing key
  lives only in GitHub secrets). Use a copy of `tauri.conf.json` with
  `"bundle": { "createUpdaterArtifacts": false }`:
  ```
  pnpm --filter @neuralagent/desktop tauri build --target aarch64-apple-darwin --bundles app --config <no-updater conf>
  ```
  Then install with `scripts/dev/install-local.sh <path to NeuralAgent.app>` (log
  `/tmp/na-install.log`). It quits the app, stops the daemon, replaces
  `/Applications/NeuralAgent.app`, unregisters the build copies from Launch Services and starts the
  app again. **Only when the user asks.** An agent session running inside NeuralAgent dies with
  it: start it detached (`nohup … >/dev/null 2>&1 &`) as the very last action of the turn.
- **Do not** upload a hand-built release to the relay. Updater signatures and the APK keystore
  belong to CI.
- **When billing works again**: re-run the Release workflow for the existing tag (GitHub →
  Actions → Release → the v0.2.1 run → "Re-run all jobs", or `gh run rerun <id>`). Do not move
  or re-create the tag. If a newer version is due anyway, just release it. The updater jumps
  straight to the newest version, and the dialog shows all notes in between.
- The website and changelog can still be deployed by hand at any time (section above).

## macOS signing (stable self-signed identity)

The Mac app is signed with our own self-signed certificate "NeuralAgent Code Signing" (not an
Apple Developer ID, so no notarization; first launch still needs right-click → Open). macOS keeps
permissions such as Accessibility and the microphone per signing identity: with ad hoc signing
every build was a new app and lost them, with the fixed certificate they survive updates.

- CI: secrets (environment `release`) `MACOS_SIGNING_P12` (base64 PKCS#12) and `MACOS_SIGNING_P12_PASSWORD`; the
  workflow imports it into a temporary keychain and passes `signingIdentity` to `tauri build`.
  Without the secrets a fork falls back to ad hoc; an official tag fails instead. The log prints the designated requirement
  (`certificate root = H"…"`): it must stay the same from release to release.
- Backup: `~/.config/neuralagent-signing/cert.p12` on the owner's Mac, its password in the
  login keychain (service "NeuralAgent code signing p12 password"). Valid until 2046. Losing
  or replacing it makes every user grant the permissions once more.
- Switching identity (ad hoc → this one, or later to a Developer ID) costs one re-grant.

## Testing updates locally
- UI without a release: `apps/desktop/src/dev-browser.tsx` fakes updates through hash params,
  for example `#port=…&token=…&update=0.3.0&service=0.2.0&serviceError=1`, or `&web=1` for the web
  remote. Its header lists all params.
- Real N-1 → N update: `scripts/dev/README.md` → "Update test" (`scripts/dev/update/test.conf.json`
  allows http, `daemon.mjs tick` proves sessions survive). `NEURALAGENT_UPDATE_URL` points the
  app at a local relay. Run the apps from
  `/private/tmp/…`, because the updater refuses the `/tmp` symlink. Always use a test
  `NEURALAGENT_HOME`.

## Release secrets
All release secrets live in the GitHub environment `release` (not as repository secrets), which
only `v*` tags and `main` may use, so branches and pull requests never see them (D51):
`TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`, `MACOS_SIGNING_P12(_PASSWORD)`, `ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `GOOGLE_SERVICES_JSON`, `RELEASE_UPLOAD_TOKEN`. After changing one:
`gh secret set NAME -e release < file`, then `gh workflow run release-secrets.yml` checks that
all are present and open (nothing is built or published).
