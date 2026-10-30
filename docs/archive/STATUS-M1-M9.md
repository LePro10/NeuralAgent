# Status archive: verification log M1–M9 (until 2026-10-30)

Moved verbatim from `docs/STATUS.md` on 2026-10-30 to keep STATUS short. These are the detailed
checks behind each milestone ("done when" in `docs/PLAN.md`). Paths to `/tmp` test kits in here
are historical; the kits now live in `scripts/dev` (see `scripts/dev/README.md`).

### M9 verified (2026-10-30)
- Themes: six schemes + accents, per device; screenshots desktop/phone; reload keeps them; the
  terminal re-themes live; the voice HUD follows through the storage event.
- Update N-1→N locally (`/tmp/na-upd`): a 0.1.0 app with a running shell session installed
  0.1.1 from a local relay, restarted as 0.1.1; the service (0.1.0, same pid) and the session
  kept running; after the session stopped the app swapped the service to 0.1.1.
- Release v0.1.1 through `release.yml`: all jobs green (macOS arm64 + Intel, Windows, Linux,
  APK, publish). `/api/releases/latest` lists six downloads, all served; `/download` shows them;
  `/api/update/{darwin,windows,linux}/…/0.1.0` offer 0.1.1. The macOS DMG holds 0.1.1 with the
  bundled service; the darwin-aarch64 update verifies against the app's public key.
- Relay release tests (upload, publish, update, prune to three, pre-releases only for testers,
  public links skip pre-releases). The proxy accepts 80 MB uploads.
- 0.1.2: the macOS bundle is ad-hoc signed as a whole (0.1.1 was only linker-signed, so macOS
  called a downloaded copy "damaged"); `install.sh` installs it without the quarantine prompt.
- Not tested by hand: installing on Windows/Linux, the APK update notice on a real phone
  (checklist: *Install the released app*).

### M8 verified (2026-10-30)
- `scripts/e2e-swarm.ts` (CI on Linux/macOS): daemon + four stand-in agents
  (`scripts/fake-agent.mjs`) talking through the real MCP bridge. Own tab with four panes,
  hand-off Coordinator→Scout→Coordinator→Builder→Reviewer→Coordinator→You, the builder's file
  change, every message delivered, exactly one notification (the report), user message to all,
  unknown recipient refused with the team's roles, stop → exited, ended swarm refuses messages,
  remove.
- Real Claude Code (Haiku) team of four on a tiny task (`--name` for a Python script): tasks
  handed on, Builder implemented, Reviewer ran it and passed, Coordinator reported to you after
  24 s; 7 messages, no acks, no false errors, one notification.
- Neural (live NeuralHub): "start a swarm …" → `start_swarm`, team ran, Neural announced the
  report.
- UI screenshots (WebKit): desktop list + conversation, new-swarm sheet, phone list + chat.
  Phones/web remote get the same state and events, so the swarm page is the same there.

### M7 verified (2026-10-30)
- Text, live NeuralHub: "Starte den testbot in Japan Map" → Neural found the workspace, started
  the agent, sent the task; audit log `{"client":"orchestrator","device":"Neural","action":
  "session_start","target":"Japan-Map","ok":true}`. Stop, status and prompting likewise.
- Voice, synthetic caller (macOS `say` clips streamed in real time, release daemon), end of
  speech → first audio on the caller's clock:
  | Clip | First audio | Full answer starts |
  |---|---|---|
  | de-status "Was machen meine Agenten gerade?" | 0.82–1.00 s | 2.3–2.4 s |
  | en-status "What are my agents doing right now?" | 0.80–0.83 s | 2.3 s |
  | mixed-stop (DE with English words) | 0.92–0.95 s | 2.65–3.2 s |
  | de-long (asks for details) | 1.00 s | 2.75 s |
  | barge-in after 2 s of Neural talking | flush, new question answered after 0.91 s | 2.45 s |
  | with noise (2 %) and 15 % echo | 0.80–1.00 s | 2.3–3.2 s |
  The first audio is the acknowledgment; the model's first sentence follows ~1.5 s later
  (Haiku 5.5 via NeuralHub, time to first token ~0.9–1.1 s plus speech synthesis).
- English question → English answer, German → German, in the same call.
- Browser (Chromium, fake microphone from a wav): Call Neural → Listening → Thinking → Speaking →
  Listening, German and English turns, full-screen call above the tab bar.
- Neural speaks news during a call: "Übrigens: Testbot in Japan-Map ist fertig."
- Android emulator: tile intent with the screen off and the lock screen on → screen turns on,
  call over the lock screen, microphone foreground service with *Hang up*; hanging up returns to
  the lock screen. (Emulator has no microphone: audio itself verified in the browser test.)
- Settings → Calls: voice (higher/lower 1–5), pace, spoken preview.

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

- Push: the remote E2E registers a browser for Web Push with a mock push service, checks no
  push while on screen, then decrypts the push like a browser (RFC 8291), verifies the VAPID
  JWT signature and audience, and that the payload is only kind/computer/session; unregistering
  stops pushes; unknown push services are refused. Found and fixed: VAPID `aud` lacked the port.
- Web push in Chromium (`/tmp/na-drive/web-push.mjs`): service worker registers, "Turn on" in
  This device registers with the relay, a failing agent reaches the push service while the page
  is hidden, the worker titles the notification with the agent's name, a tap (worker message)
  and a launch URL `/app/?host&sid` both open that agent's workspace. Live relay reports FCM and
  VAPID ready. Not yet seen: a real push from Apple to an iPhone.
- Android app (`apps/android`, debug APK in the emulator `na36`, Android 16 with Play services,
  against a local relay + daemon over `adb reverse`): test sign-in in a Custom Tab returns via
  `neuralagent://auth`; computer list; live terminal; typing through the phone input line
  arrives exactly (xterm's own soft-keyboard input garbled letters, so phones no longer use it);
  notification permission → "Turn on" registers the FCM token; a failing agent produces a real
  FCM notification ("Terminal — Stopped with an error", computer name as subtext); tapping it
  opens that agent's workspace both with the app running and after the process was killed.
  Quick Settings tile shows "An agent needs you" and opens the app (opening clears it); the
  "Add" button on This device places the widget, which shows the computer and agent summary.
  Dark system bars, NeuralAgent icon and splash. Release APK signed with the release key
  (fingerprint checked with apksigner); `/.well-known/assetlinks.json` served for App Links.
