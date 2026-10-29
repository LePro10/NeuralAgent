# Status

## Your checklist (things only you can do)

Open items first. Everything else keeps going locally until these are done.

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
      address, so you are approved at once. Then open `https://agent.neuralhub.dev/admin/` —
      it asks you to register a **passkey** (Touch ID / iCloud Keychain) on first visit; that
      passkey is the second factor for the admin area from then on.
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

## Progress

| Milestone | State |
|---|---|
| Phase 0 (reverse engineering, feature matrix) | done (2026-10-29) |
| Server .96 base (Ubuntu 26.04.1 LTS, SSH key-only, unattended-upgrades, Docker 29.9, ufw) | done (2026-10-29) |
| M0 repo, docs, CI, design library, brand | done (2026-10-29) — CI on 3 OS, secret scan, token check, logo C |
| M1 desktop shell, daemon, pane grid | done (2026-10-29) — CI green on Linux/macOS, Windows fix (ConPTY cursor answer) pending CI |
| M2 agent CLIs: catalog, install, hooks, dashboard | done except a real Codex turn (needs `codex login`) |
| M3 voice: local STT/TTS, push-to-talk, wake word | done on macOS (your own voice still to try, checklist) |
| M4 git, browser, MCP, usage, sessions, tray, keep-awake, Discord | done — see below (Discord live check on your list) |
| M5 relay, accounts, pairing, E2E, remote in the daemon | done: relay, admin `/admin/`, landing, desktop side; real OAuth + mail on your list |
| M6 web remote, phone layout, Android | web remote live at `/app` with phone layout; Android (Capacitor, push, widget, tile) next |

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

### M4 verified
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
- Menu bar icon (tray on Windows/Linux): the NeuralAgent mark with a menu that shows
  "N agents · M working / K need you" (checked: "No agents running" → "1 agent running" when a
  Claude session started), "Open NeuralAgent", "Quit (agents keep running)" (checked: app gone,
  daemon and the Claude process still running) and "Quit and stop all agents". On macOS the
  count of agents waiting for you is shown next to the icon. Closing the window now keeps the
  app in the menu bar (checked: Cmd+W → window hidden, reopened from the menu), so dictation and
  the wake word keep working.
- Git + worktrees (on a clone of this repository): the workspace bar shows branch and number
  of changed files and opens a Changes sheet (file list, diff per file). With "Own worktree
  per agent" a new Claude Code started in its own branch and folder (checked: its trust prompt
  named the worktree path; `git status` of the main checkout stayed clean). After files were
  changed in the worktree (by hand, to save your Claude quota), the sheet showed both files and
  the diff; "Merge into main" committed, merged, removed worktree and branch and closed the
  agent ("Merged 1 commit into main"). Discard and closing an unchanged agent remove the
  worktree too; a conflicting merge changes nothing (unit test).
- Browser preview: the daemon notices a dev server address in a terminal's output (checked with
  Vite on port 5199, whose port is printed in colour); the pane gets a globe button that opens a
  browser pane next to it with that page (checked: page loaded in the pane). Empty panes also
  offer "Browser". The page is sandboxed (cannot navigate the NeuralAgent window). On phones a
  local address is not loaded yet (needs the remote preview tunnel, M5).
- MCP servers (sidebar → MCP): one list for all agents; add a command or HTTP server with
  secret environment variables / headers, switch it off, or import the servers already set up
  in Claude Code (`~/.claude.json`) and Codex (`config.toml`). Each Claude Code, Codex and
  OpenCode started afterwards gets them. Checked with a small test server: Claude Code's
  `/mcp` listed it as connected with its tool, and the server saw its secret; Codex accepted
  the generated options (`codex mcp list/get` showed command, env var and HTTP header).
  Secret values are only in a private file (`mcp-secrets.json`, mode 600) and reach an agent
  only through its environment — never in the app state, the command line or the browser
  (checked: saved through the UI, value absent from state.json, gone after delete).
- Usage & cost: the daemon reads the token counts from Claude Code's and Codex's own
  transcripts (only new lines each time; subagents count to their conversation; repeated
  messages are counted once) and prices them at API list prices (unknown models get no price
  rather than a wrong one). Checked on this Mac: 7 days = ~9,950 Claude calls, first read
  17.7 s (debug build, in the background), afterwards 13 ms. A running agent shows its own
  tokens and cost (checked on a resumed conversation: 20k tokens, $0.161, matching the 1-hour
  cache price by hand). Agent working time per day is recorded. Subscription limits: Claude Code
  reports them to its statusline command; NeuralAgent now registers its own statusline command,
  records the limits and then runs your own statusline unchanged (checked: your
  `statusline.py` output still appears; a test input with 5h/7d limits arrived in the app).
  Your Claude Code here uses API billing through `ANTHROPIC_BASE_URL`, so it reports no limits;
  Codex limits come from its transcripts (not logged in here, so unit test only).
- Fixed on the way: a session busy from its first second stayed "Starting" forever; a closed
  session's process was left as a zombie (the daemon now always reaps it, checked); the Windows
  terminal test (cursor-position answer is now one write); session variables of a Claude Code
  that started NeuralAgent (e.g. its messaging token) no longer leak into agents.

### M5 verified so far (2026-10-30)
- Relay live: `https://agent.neuralhub.dev/api/health` → ok; Google + GitHub configured, mail
  configured; WebSockets through the proxy; GitHub sign-in redirects correctly. Container
  health check, update timer installed (waits for the GHCR token).
- `na-crypto`: Rust and WebCrypto produce identical handshakes and frames (shared vectors).
- Relay account flow test (`cargo test -p na-relay --features test-login`): pending users
  can't pair or route, one admin mail per request, approve unlocks live and mails, pairing
  code works once and only for the same account, other accounts' devices are unreachable and
  invisible, refresh-token reuse signs out, blocking cuts WebSockets and tokens at once,
  passkeys (software authenticator: wrong origin/rp/challenge/signature rejected).
- `scripts/e2e-remote.ts` (also in CI): real relay + daemon + simulated phone. Sign-in through
  the browser flow, QR pairing with fingerprint check, foreign-key handshake refused,
  end-to-end session, phone claiming to be the desktop is treated as a phone, no agents outside
  approved workspaces, shell started and typed into from the phone with output streamed back,
  relay sees only ciphertext, emergency switch-off from the phone, revoke, sign out.
- Desktop Remote page checked in WebKit (signed out, waiting for approval, online with QR and a
  phone in the device list).
- `apps/web` live (`/`, `/admin/`, `/app/`, `/imprint/` … → 200). Admin checked in Chromium with
  a virtual authenticator against a test relay: test sign-in, passkey create + unlock, approve
  a request, users with devices and remote switch, stats, sign out.

### M6 verified so far (2026-10-30)
- `@neuralagent/remote` (account, pairing, relay link, sealed transport): the remote E2E drives
  a real `DaemonClient` through the relay — wrong QR fingerprint refused, pairing pins the key,
  state sync, a browser is treated as a phone, typing into a shell, sign-in by PKCE without QR
  (key trusted on first use), sign out.
- Web remote in WebKit against a local relay + daemon (`/tmp/na-drive/web-remote.mjs`): phone
  size sign-in → computer list → agent UI with a tab bar and More menu; the terminal key bar
  answers a prompt (`read` → `got-yes`); a second browser paired by QR link at desktop size sees
  the same session; "This device" page (switch computer, Disconnect remote, sign out).

## Known gaps

- No Xcode on this Mac → no iOS simulator. The iOS PWA is tested with Safari responsive mode;
  everything that needs a real iPhone is marked as such.
- Windows/Linux: built by CI, not manually tested.
