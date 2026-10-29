# NeuralAgent — Plan

Architecture, interfaces, milestones and done-criteria. Product behaviour is specified in
[`SPEC.md`](SPEC.md); decisions and benchmarks live in [`DECISIONS.md`](DECISIONS.md); progress in
[`STATUS.md`](STATUS.md).

## 1. Components

```
 ┌──────────────── Desktop (macOS / Windows / Linux) ────────────────┐
 │  NeuralAgent.app (Tauri 2)            neuralagentd (daemon)        │
 │  ─ React UI (packages/app)  ◄─ws──►   ─ PTY host (portable-pty)    │
 │  ─ tray / menu bar                    ─ agents, hooks, status      │
 │  ─ global hotkey, mic capture         ─ workspaces, layout, git    │
 │  ─ browser preview pane               ─ usage, session index, MCP  │
 │  ─ Discord presence, keep-awake       ─ swarm bus, orchestrator    │
 │                                       ─ voice engine (STT/TTS/VAD) │
 │                                       ─ relay client (E2E)         │
 └───────────────────────────────────────────────┬────────────────────┘
                                                 │ wss (outbound), E2E envelopes
                                   ┌─────────────▼─────────────┐
                                   │ relay (agent.neuralhub.dev)│  one port: 8080
                                   │ /ws  /api  /auth  /admin   │  Rust/axum + SQLite
                                   │ /app (web remote, PWA)     │  FCM + Web Push + SMTP
                                   │ /  /download  /privacy …   │
                                   └─────────────▲─────────────┘
                         wss, E2E (WebCrypto)    │
              ┌──────────────────────────────────┴───────────────┐
              │ Web remote (browser / iOS PWA)   Android APK      │
              │ same React app, /app            Capacitor shell + │
              │                                 native plugins    │
              └───────────────────────────────────────────────────┘
```

* **Desktop is the source of truth.** All agent state lives in `neuralagentd`. The desktop UI
  is just one more client — it speaks exactly the same protocol as the remote, only over a
  local socket instead of the relay. That makes "remote feels like the app" automatic.
* **The daemon outlives the UI.** Closing, quitting or updating the app never touches the
  agents. The daemon is started detached from a versioned copy outside the app bundle, so an
  app update can replace the bundle while the old daemon keeps running.
* **One React app, three shells.** `packages/app` is rendered by the Tauri window, by the
  relay at `/app` (browser + PWA), and by the Capacitor APK (loads `/app` live).

## 2. Repository layout

```
Cargo.toml                 Rust workspace
package.json, pnpm-workspace.yaml
crates/
  na-protocol/             wire types (serde) + ts-rs export → packages/protocol
  na-crypto/               E2E envelope (X25519, HKDF-SHA256, AES-256-GCM), test vectors
  na-daemon/               neuralagentd binary
  na-voice/                STT / TTS / VAD / wake-word engines
  na-relay/                relay server binary
apps/
  desktop/                 Tauri 2 shell (src-tauri) + Vite entry
  web/                     Vite entry for /app (PWA), landing, admin, legal pages
  android/                 Capacitor shell + native plugins (Kotlin)
packages/
  ui/                      NeuralHub design library (copy-in)
  app/                     shared React application (screens, stores, layouts)
  protocol/                generated TS types + client (local ws / relay+E2E transports)
  crypto/                  WebCrypto implementation of na-crypto (same test vectors)
docs/                      SPEC, PLAN, DECISIONS, STATUS, HANDOFF, brand/
.github/workflows/         CI: test, build desktop (mac/win/linux), APK, relay image, secret scan
deploy/                    docker-compose + pull-deploy units for the relay host
```

## 3. Interfaces

### 3.1 Client ↔ daemon protocol (`na-protocol`)

JSON messages over WebSocket. Locally: `ws://127.0.0.1:<port>` with a 256-bit token from
`<data_dir>/daemon.json` (0600) and an Origin check. Remotely: the same JSON, sealed in E2E
envelopes and routed by the relay.

```jsonc
{"t":"hello","v":1,"client":{"kind":"desktop|web|android","device":"…"}}
{"t":"req","id":7,"m":"agent.start","p":{…}}      // request
{"t":"res","id":7,"ok":true,"r":{…}}              // response (or ok:false, err:{code,msg})
{"t":"sub","topics":["state","term:<sid>"]}       // subscribe
{"t":"ev","topic":"state","seq":1042,"patch":[…]} // state patches (JSON-patch-like)
{"t":"term","sid":"…","seq":88123,"d":"<base64>"} // terminal output chunk
```

* **State sync:** the daemon keeps a versioned state tree (workspaces, layouts, agents,
  statuses, approvals, swarm messages, devices). `sub state` returns a snapshot + `seq`;
  afterwards only patches. A client that reconnects with `since=<seq>` gets the missing
  patches (ring buffer) or a fresh snapshot. → no flicker, no data loss, many viewers.
* **Terminals:** each PTY has a headless VT emulator (`vt100`) in the daemon. `term.attach`
  returns a formatted snapshot (scrollback + screen + modes) and then streams raw output with
  sequence numbers. Input: `term.write`, `term.resize` (size owner = focused client;
  others render scaled).
* **Methods** (namespaces): `workspace.*`, `layout.*`, `agent.*` (start/prompt/stop/
  resume/list), `term.*`, `profile.*`, `catalog.*` (detect/install), `git.*`, `worktree.*`,
  `mcp.*`, `usage.*`, `sessions.*` (search/resume), `swarm.*`, `orch.*` (chat/call),
  `voice.*`, `fs.*` (remote file browser, read-only), `approval.*`, `audit.*`,
  `settings.*`, `tunnel.*` (dev-server preview).
* TS types are generated from the Rust types (`ts-rs`), so UI and daemon cannot drift.

### 3.2 Agent hooks

Per agent process the daemon writes a hook config and passes it per process (e.g.
`claude --settings <file>`, `codex -c …`), never editing the user's own config. The hook
command is the daemon binary itself: `neuralagentd hook` reads the event JSON from stdin and
forwards it over the local socket with the session token from the environment
(`NEURALAGENT_SESSION`, `NEURALAGENT_HOOK_TOKEN`). Fire-and-forget, < 50 ms, never blocks
the agent. CLIs without hooks: status from output activity, OSC 133 marks and prompt
patterns. Details per CLI in `DECISIONS.md`.

### 3.3 Relay

* `POST /api/…` REST (JSON) for accounts, devices, access requests, pairing (QR), push
  registration, admin; `GET /api/health`.
* `GET /ws` WebSocket, authenticated with a short-lived access token. Frames:
  `route{to,dev,env}` (opaque E2E envelope), `presence`, `push.request` (minimal text),
  `revoked` (server-initiated close). The relay routes only between devices of the same
  account and never parses envelopes.
* Auth: Google (OIDC: state, nonce, PKCE) and GitHub (OAuth: state, PKCE). Access token
  (JWT, 15 min) + rotating refresh token per device (hashed in DB). Desktop & APK return via
  `neuralagent://auth?code=…` (one-time code exchanged with PKCE verifier); browser/PWA via
  same-origin redirect + HttpOnly cookie.
* Admin: `/admin`, admins from `ADMIN_EMAILS`, WebAuthn passkey as second factor.

### 3.4 E2E (`na-crypto` / `packages/crypto`)

Each device holds an X25519 identity key (OS keychain / Android Keystore-wrapped /
IndexedDB non-extractable). Session: client ephemeral + static keys × host static key →
HKDF-SHA256 → two AES-256-GCM keys, 96-bit counter nonces, replay window. Host checks the
client's static key against the account's device list. QR pairing additionally pins the
host key fingerprint. Honest limits in `SPEC.md` (server ships the web code; protects
against passive reading, not against a compromised server).

## 4. Milestones

Each milestone: build → use it myself (screenshots) → core-logic tests → compare with the
feature matrix → polish → update STATUS → commit + push.

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo, docs, CI skeleton, design library, brand (3 logos → pick) | `pnpm i && cargo build` green, CI green on 3 OS, logo + icon set generated |
| M1 | Daemon PTY host + workspaces + split grid + tabs | agents survive app quit/reopen with intact screen; 16 panes smooth; layout persisted |
| M2 | Catalog, detection, one-click install, profiles, hooks/status, dashboard, notifications | Claude/Codex status via hooks verified live; install of a missing CLI works in a pane |
| M3 | Voice: STT engine + system-wide push-to-talk + wake word "Hey Neural"; STT/TTS benchmark | dictation types into any app; wake word triggers; numbers in DECISIONS |
| M4 | Git + worktrees, browser preview, MCP, usage & cost, session search + resume, tray, keep-awake, Discord | each feature used on a real project |
| M5 | Relay + accounts + access requests + admin + E2E + pairing + pull deploy on .96 | second test user isolated (tests), approve flow incl. mails, live unlock |
| M6 | Web remote/PWA + APK (Capacitor) + push + widget + tile + mobile layout | APK in emulator controls agents live, push tap opens the agent |
| M7 | Orchestrator: chat + live call (local STT/TTS, barge-in, AEC), lock-screen call on Android | end-to-end test by text and by voice passes, < 1 s latency logged |
| M8 | Swarm | team of 4 hands off tasks, messages visible on desktop + phone |
| M9 | Themes, auto-update, CI release builds, releases on agent.neuralhub.dev | update from N-1 to N keeps agents running |
| M10 | Own ideas, polish, final report | everything in "Fertig, wenn" ticked |

## 5. Global done-criteria (from the brief)

* Feature matrix complete; every in-scope feature built and verified.
* macOS app runs; Windows/Linux builds green in CI (marked "built, not manually tested").
* Releases on `agent.neuralhub.dev`, auto-update works.
* APK in emulator: paired, live control, orchestrator chat + call, push, widget, tile.
* Relay on .96 with pull deployment.
* E2E test (text + voice) passes: orchestrator starts an agent in folder X with prompt Y, pane
  appears on desktop and in the APK, output + done status + push come back.
* Account flow fully tested with a second user; isolation proven by tests.
* STT (system-wide + wake word) and TTS run locally.
* README, SPEC, PLAN, DECISIONS, STATUS current; everything pushed.
