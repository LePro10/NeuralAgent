# Status

## Your checklist (things only you can do)

Open items first. Everything else keeps going locally until these are done.

- [ ] **Ship the polish round** (after GitHub billing is fixed): re-run the Release workflow for
  v0.2.1 (tag pushed, never published), then release the `[Unreleased]` changelog section and
  deploy the relay/website (skills `release`, `deploy-web`). Live relay still serves 0.2.0.
- [ ] **0.2.0 checks on real devices** (15 min, after installing 0.2.0):
  - macOS: drag the window by the top strip anywhere (also next to the traffic lights),
    double-click it to zoom. Paste a screenshot (Cmd+V) and drop a file into a Claude pane
    and into the Claude view composer.
  - Android: in a Claude session the Claude view opens by default. Copy an image, then paste
    it into the composer (long-press → Paste and via the Gboard clipboard chip); also the
    paste/photo buttons in the key bar. Call Neural: audio comes from the earpiece, the
    speaker button switches, Bluetooth headset wins, screen turns off at the ear.
  - iPhone (home-screen app): open a session, Claude view, paste an image.
  - Remote → Settings → host section: download a voice model, see "Update available on
    <host>", install it, the page reloads by itself afterwards.
- [ ] **Website legal data**: fill in name, postal address and contact on `/imprint`, confirm
  Swiss law / private operator in the terms and the server location if you want it stated
  (`apps/web/src/legal.tsx`). Have `/imprint`, `/privacy`, `/terms` checked before inviting people.

- [ ] **GHCR read token for .96** (pull deployment). `gh` cannot create personal access
      tokens. Steps: github.com → Settings → Developer settings → Personal access tokens →
      Tokens (classic) → *Generate new token (classic)* → note `neuralagent-96-pull`,
      expiration *No expiration* (or 1 year), scope **only `read:packages`** → copy. Then on
      your Mac run (the token is pasted into the prompt, never into the chat):
      ```
      ssh root@192.168.30.96 'read -s -p "GHCR token: " T; echo; mkdir -p /etc/neuralagent; umask 077; printf "GHCR_USER=LePro10\nGHCR_TOKEN=%s\n" "$T" > /etc/neuralagent/ghcr.env; echo saved'
      ```
      Until then I build the image on .96 by hand. After that, every push to `main` that
      touches the relay deploys itself within ~5 minutes (with rollback).
- [ ] **Try remote with your real account** (5 min, after the next app build): NeuralAgent →
      *Remote* (sidebar) → *Continue with GitHub* (or Google). Your address is an admin
      address, so you are approved at once. Then open `https://agent.neuralhub.dev/admin/` and
      sign in the same way (admins are the addresses in `ADMIN_EMAILS`; no passkey, D39).
- [ ] **Phones** (10 min): Android — install the APK from the latest CI run (Actions → CI →
      artifact `neuralagent-android`), sign in with Google, turn on notifications in *This
      device*, let an agent finish while the app is closed, tap the notification. iPhone — open
      `https://agent.neuralhub.dev/app` in Safari, Share → *Add to Home Screen*, open it from
      there, sign in, turn on notifications, same test. Note anything odd in an issue.
- [ ] **Mail check**: ask someone (or use a second Google account) to request access in
      NeuralAgent → you should get "Access request: …" from agent@neuralhub.dev; approve it in
      `/admin` → they get "You're in". Tell me if a mail does not arrive (check spam).
- [ ] **Tray "Disconnect remote"** (10 s, once signed in): menu bar icon → *Disconnect remote*
      → the Remote page shows the switch off; again → *Reconnect remote*. (Built and the
      handler is tested in the UI, but I can't click the real menu bar here.)
- [ ] **Backups** (store in your password manager / offline, NOT in the repo). They are created
      during the build and listed here as they appear:
  - Android release keystore + its passwords — *without the same keystore no APK update ever
    installs over the old one.*
  - Tauri updater signing key (private key + password) — without it no desktop update.
  - Relay secrets on .96 (`/etc/neuralagent/relay.env`: OAuth and mail secrets) and the relay
    database `/var/lib/neuralagent/relay.db` (accounts, devices).
- [ ] **Voice with your own voice** (5 min, when you are back at the Mac): Settings (gear at
      the bottom of the sidebar) → Voice models → download Parakeet, Wake word spotter, Silero.
      Hold ⌥ Space in any app, speak, let go → text appears. macOS asks once for
      *Microphone* and *Accessibility* for NeuralAgent: please allow. Then turn on
      "Listen for Hey Neural", say "Hey Neural, what are my agents doing?"; if it does not react,
      press *Learn my voice → Record* 3× and say "Hey Neural". Tell me what did not work.
      (A macOS dialog "Terminal wants to control TextEdit" may be open from a test: click
      *Don't Allow*, it is not needed.)
- [ ] **Call Neural** (5 min): Settings → *Neural* is already set up with the NeuralHub key? If
      not, paste a key there. Then Neural (first item in the sidebar) → phone icon → talk.
      macOS asks once for the microphone: please allow. On Android (new APK from CI): *Call
      Neural* button, or add the *Call Neural* quick-settings tile and try it from the lock
      screen. Tell me how fast and natural it feels, and if Neural hears itself (echo).
- [ ] **Logo uploads** (after the logo is chosen; files in `docs/brand/export/`): Discord
      Developer Portal (app `1563621751861153933` → App Icon), GitHub OAuth App (logo),
      Firebase project settings. **Not** at Google (would trigger a verification review).
      For Discord also: Rich Presence → Art Assets → upload the logo with the name `logo`.
- [ ] **Discord presence check** (1 min, Discord was not running while I built it): open
      Discord, start any agent in NeuralAgent → your Discord profile shows "NeuralAgent ·
      Working with AI agents" within ~20 s. Or run
      `cargo test -p na-daemon shows_in_discord -- --ignored --nocapture` with Discord open.

- [ ] **Install the released app** (5 min). macOS, without any prompt: in Terminal
  `curl -fsSL https://agent.neuralhub.dev/install.sh | sh`. Other platforms (or the DMG):
  `https://agent.neuralhub.dev/download`; a downloaded DMG is not notarized, so open it once via
  System Settings → Privacy & Security → *Open Anyway*. From then on it updates itself
  (toast "NeuralAgent X is ready" → *Install*, or Settings → *Updates*); running agents keep
  going. Android: install the APK from the same page over the CI one (same key).
- [ ] **Optional — signed builds**: an Apple Developer ID ($99/year) would let CI notarize the
  macOS app (no right-click on first start); a Windows code-signing certificate would silence
  SmartScreen. Tell me if you get either; CI only needs the secrets.

- [ ] **Try a swarm** (5 min, optional): sidebar → *Swarm* → *New swarm*, pick a project and a
  small goal, keep the default team (Claude). Watch the messages; Stop when done. Uses your
  Claude quota (pick a Haiku profile to keep it cheap).

## Done on your side (verified)

- NPM proxy host `agent.neuralhub.dev` → .96:8080: HTTPS and WebSockets work (checked
  2026-10-30 with the deployed relay).
- DNS `agent.neuralhub.dev` → 89.217.203.85, certificate valid.
- `~/.neuralagent-secrets/`: server.env (all keys filled), google-services.json (package
  `dev.neuralhub.neuralagent`), firebase-service-account.json.
- NeuralHub key in keychain (`neuralagent-llm`).

## Orchestrator test budget (NeuralHub key, $100, stop at $80)

| Date | Spent (cumulative) | What |
|---|---|---|
| 2026-10-29 | $0.00 | model list only |
| 2026-10-29 | < $0.05 | 2 Codex test calls (Claude Haiku via NeuralHub, failed) |
| 2026-10-30 | < $3 (estimate) | M7: ~120 Neural turns (Sonnet 5.5 chat, Haiku 5.5 calls), latency probes |
| 2026-10-30 | < $3.5 (estimate) | M8: a few Neural turns for start_swarm (swarm members run on Claude Code, not this key) |

## Progress

| Milestone | State |
|---|---|
| Phase 0 (reverse engineering, feature matrix) | done (2026-10-29) |
| Server .96 base (Ubuntu 26.04.1 LTS, SSH key-only, unattended-upgrades, Docker 29.9, ufw) | done (2026-10-29) |
| M0 repo, docs, CI, design library, brand | done (2026-10-29) — CI on 3 OS, secret scan, token check, logo C |
| M1 desktop shell, daemon, pane grid | done (2026-10-29) — CI green on Linux/macOS, Windows fix (ConPTY cursor answer) pending CI |
| M2 agent CLIs: catalog, install, hooks, dashboard | done except a real Codex turn (needs `codex login`) |
| M3 voice: local STT/TTS, push-to-talk, wake word | done on macOS (your own voice still to try, checklist) |
| M4 git, browser, MCP, usage, sessions, tray, keep-awake, Discord | done (Discord live check on your list) |
| M5 relay, accounts, pairing, E2E, remote in the daemon | done: relay, admin `/admin/`, landing, desktop side; real OAuth + mail on your list |
| M6 web remote, phone layout, Android | done (2026-10-30) — web remote at `/app` with Web Push; Android app (FCM, widget, tile) verified in the emulator; real iPhone on your list |
| M7 Neural: chat + live call, lock-screen call on Android | done (2026-10-30) — details in the archive; your own voice on a real phone on your list |
| M8 swarm: agent teams with visible hand-offs | done (2026-10-30) |
| M9 themes, auto-update, release CI, downloads | done (2026-10-30) — v0.1.1 and v0.1.2 released through CI |
| M10 own ideas, polish, final report | **current** — done: admin handbook `docs/ADMIN-HANDBUCH.md`, session report `apps/web/public/session/index.html`, 0.2.0/0.2.1, mobile-first polish round (D44, D45; not released yet), dev tooling `scripts/dev/`, docs guard. Open: ship, final report |


Verification details per milestone (what was tested and how, M1–M9):
[archive/STATUS-M1-M9.md](archive/STATUS-M1-M9.md).

## Known gaps

- No Xcode on this Mac → no iOS simulator. The iOS PWA is tested with Safari responsive mode;
  everything that needs a real iPhone is marked as such.
- Windows/Linux: built by CI, not manually tested.
