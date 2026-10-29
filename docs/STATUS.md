# Status

## Your checklist (things only you can do)

Open items first. Everything else keeps going locally until these are done.

- [ ] **NPM proxy host `agent.neuralhub.dev`** (DNS and certificate already work, checked
      2026-10-29: HTTPS answers 502 because the relay is not deployed yet). Please check in
      the existing proxy host:
  1. *Details*: Scheme `http`, Forward Hostname `192.168.30.96`, Port `8080`,
     **Websockets Support ON**, Block Common Exploits ON.
  2. *SSL*: Force SSL ON, HTTP/2 ON, HSTS ON.
  3. *Advanced* → Custom Nginx Configuration:
     ```
     client_max_body_size 400m;
     proxy_read_timeout 3600s;
     proxy_send_timeout 3600s;
     proxy_request_buffering off;
     ```
     (long-lived WebSockets for agents/calls; CI uploads desktop builds of ~100–300 MB).
- [ ] **GHCR read token for .96** (pull deployment). `gh` cannot create personal access
      tokens. Steps: github.com → Settings → Developer settings → Personal access tokens →
      Tokens (classic) → *Generate new token (classic)* → note `neuralagent-96-pull`,
      expiration *No expiration* (or 1 year), scope **only `read:packages`** → copy. Then on
      your Mac run (the token is pasted into the prompt, never into the chat):
      ```
      ssh root@192.168.30.96 'read -s -p "GHCR token: " T; echo; mkdir -p /etc/neuralagent; umask 077; printf "GHCR_USER=LePro10\nGHCR_TOKEN=%s\n" "$T" > /etc/neuralagent/ghcr.env; echo saved'
      ```
      Until then I deploy manually over SSH (`docker save | docker load`).
- [ ] **Backups** (store in your password manager / offline, NOT in the repo). They are created
      during the build and listed here as they appear:
  - Android release keystore + its passwords — *without the same keystore no APK update ever
    installs over the old one.*
  - Tauri updater signing key (private key + password) — without it no desktop update.
  - Relay secrets on .96 (`/etc/neuralagent/relay.env`: JWT key, VAPID keys) and the relay
    database `/var/lib/neuralagent/relay.db` (accounts, devices).
- [ ] **Voice with your own voice** (5 min, when you are back at the Mac): Settings (gear at
      the bottom of the sidebar) → Voice models → download Parakeet, Wake word spotter, Silero.
      Hold ⌥ Space in any app, speak, let go → text appears. macOS asks once for
      *Microphone* and *Accessibility* for NeuralAgent: please allow. Then turn on
      "Listen for Hey Neural", say "Hey Neural, what are my agents doing?"; if it does not react,
      press *Learn my voice → Record* 3× and say "Hey Neural". Tell me what did not work.
      (A macOS dialog "Terminal wants to control TextEdit" may be open from a test: click
      *Don't Allow*, it is not needed.)
- [ ] **Legal pages**: fill in name, address, contact on `/imprint`, `/privacy`, `/terms` and
      have them reviewed before inviting people (drafts will be in `apps/web/legal/`).
- [ ] **Logo uploads** (after the logo is chosen; files in `docs/brand/export/`): Discord
      Developer Portal (app `1563621751861153933` → App Icon), GitHub OAuth App (logo),
      Firebase project settings. **Not** at Google (would trigger a verification review).
      For Discord also: Rich Presence → Art Assets → upload the logo with the name `logo`.
- [ ] **Discord presence check** (1 min, Discord was not running while I built it): open
      Discord, start any agent in NeuralAgent → your Discord profile shows "NeuralAgent ·
      Working with AI agents" within ~20 s. Or run
      `cargo test -p na-daemon shows_in_discord -- --ignored --nocapture` with Discord open.

## Done on your side (verified)

- DNS `agent.neuralhub.dev` → 89.217.203.85, certificate valid.
- `~/.neuralagent-secrets/`: server.env (all keys filled), google-services.json (package
  `dev.neuralhub.neuralagent`), firebase-service-account.json.
- NeuralHub key in keychain (`neuralagent-llm`).

## Orchestrator test budget (NeuralHub key, $100, stop at $80)

| Date | Spent (cumulative) | What |
|---|---|---|
| 2026-10-29 | $0.00 | model list only |
| 2026-10-29 | < $0.05 | 2 Codex test calls (Claude Haiku via NeuralHub, failed) |

## Progress

| Milestone | State |
|---|---|
| Phase 0 (reverse engineering, feature matrix) | done (2026-10-29) |
| Server .96 base (Ubuntu 26.04.1 LTS, SSH key-only, unattended-upgrades, Docker 29.9, ufw) | done (2026-10-29) |
| M0 repo, docs, CI, design library, brand | done (2026-10-29) — CI on 3 OS, secret scan, token check, logo C |
| M1 desktop shell, daemon, pane grid | done (2026-10-29) — CI green on Linux/macOS, Windows fix (ConPTY cursor answer) pending CI |
| M2 agent CLIs: catalog, install, hooks, dashboard | done except a real Codex turn (needs `codex login`) |
| M3 voice: local STT/TTS, push-to-talk, wake word | done on macOS (your own voice still to try, checklist) |
| M4 git, browser, MCP, usage, sessions, tray, keep-awake, Discord | in progress — see below |

### M1 verified so far (2026-10-29)
- Tauri app starts the daemon, connects, welcome screen; workspace with 4 → 16 panes.
- Split (button, ⌘D / ⌘\), presets 1–16, zoom (⌘↩), divider drag persists in `state.json`.
- 16 shells with continuous output at once: smooth, daemon ~12 % CPU.
- App restart (quit + reopen): shells keep running, screens come back intact.

### M2 verified so far (2026-10-29)
- Catalog of 13 CLIs; detection shows Claude Code 2.1.312, Codex 0.166.0, OpenCode 2.0.25.
- One-click install of Codex in a pane: vendor installer ran, catalog shows it afterwards.
- Claude Code live (Haiku): idle → working → waiting ("Wants to use Bash") → approve → working
  → done with the last message; notification-ready attention events; no false error after done.
- Codex status via notify (simulated call, see D17): done + thread id + last message.
- Launcher and "New agent" offer only installed CLIs plus "Install agents…"; catalog sheet with
  versions, install command, docs; Agents dashboard across workspaces.
- Profile editor (catalog sheet → Profiles): create with name, CLI, extra args (quotes kept),
  edit, delete; shows up in launchers.
- Notifications: permission granted, sent when the window is in the background. In `tauri dev`
  macOS shows no banner (unbundled binary); to check again with a bundled build.
- Open: resume from dashboard/session search, real Codex turn (needs login).

### M3 verified so far (2026-10-29)
- Benchmarks in D19 (STT: Parakeet chosen), D20 (wake word), D21 (TTS: Supertonic 3).
- Desktop dictation end to end (real app, real hotkey events, test audio as microphone):
  hold ⌥ Space → "Start codex in the website folder and fix the failing tests." typed into
  another app's text field. Shortcut switch to F5 in Settings works immediately.
- Wake word end to end: 4 of 4 "Hey Neural, …" clips woke it, 0 false wakes; commands came out
  as "read me the last message from Claude." / "start Claude." (shown as a toast until the
  orchestrator exists).
- Settings → Voice models: download with progress, SHA-256 check (wrong checksum is rejected,
  test), unpack, installed state.
- Listening pill: while dictating or after "Hey Neural" a small "Listening…" pill shows at the
  bottom of the screen, on top of other apps, without taking focus (checked: text still lands
  in the other app).
- Open: your real voice and microphone (checklist), learn-my-voice with a real recording,
  Windows/Linux voice test.

### M4 verified so far
- Keep awake: a busy shell session makes the daemon hold a macOS "prevent idle sleep" assertion
  (`pmset -g assertions` shows "Agents are working"); it is released a few seconds after the
  work stops, and never taken with the setting Off. "On power" asks the OS once a minute.
- Discord presence: unit test for what is shown (General: only "Working with AI agents";
  Detailed: workspace + agent count; plain shells do not count; nothing while no agent runs).
  Live check with Discord is on your checklist (Discord was closed).
- Resume after a restart: a running session is started again in the same pane when the daemon
  restarts (checked: alive again, accepts input); with the setting off it stays stopped. Agents
  with a known conversation id get their CLI's resume argument (Claude `--resume <id>`).
  Exits caused by the shutdown itself are no longer saved, so the next start knows what ran.
- Session search + resume: sidebar → History lists past Claude Code and Codex conversations
  on this computer (titles and your own prompts only; tool output and answers are not read).
  Measured on 1.9 GB of real transcripts: first search 5.9 s (debug build), then 2–3 ms.
  Resume opens the CLI with its resume argument in the conversation's original folder
  (checked: `codex resume <id>` in /private/tmp/na-codex-test, workspace created for it).
  Phones/orchestrator will only see conversations from approved workspaces.
- Fixed on the way: a session busy from its first second stayed "Starting" forever.

## Known gaps

- No Xcode on this Mac → no iOS simulator. The iOS PWA is tested with Safari responsive mode;
  everything that needs a real iPhone is marked as such.
- Windows/Linux: built by CI, not manually tested.
