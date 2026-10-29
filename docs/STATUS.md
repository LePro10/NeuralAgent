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
- [ ] **Legal pages**: fill in name, address, contact on `/imprint`, `/privacy`, `/terms` and
      have them reviewed before inviting people (drafts will be in `apps/web/legal/`).
- [ ] **Logo uploads** (after the logo is chosen; files in `docs/brand/export/`): Discord
      Developer Portal (app `1563621751861153933` → App Icon), GitHub OAuth App (logo),
      Firebase project settings. **Not** at Google (would trigger a verification review).

## Done on your side (verified)

- DNS `agent.neuralhub.dev` → 89.217.203.85, certificate valid.
- `~/.neuralagent-secrets/`: server.env (all keys filled), google-services.json (package
  `dev.neuralhub.neuralagent`), firebase-service-account.json.
- NeuralHub key in keychain (`neuralagent-llm`).

## Orchestrator test budget (NeuralHub key, $100, stop at $80)

| Date | Spent (cumulative) | What |
|---|---|---|
| 2026-10-29 | $0.00 | model list only |

## Progress

| Milestone | State |
|---|---|
| Phase 0 (reverse engineering, feature matrix) | done (2026-10-29) |
| Server .96 base (Ubuntu 26.04.1 LTS, SSH key-only, unattended-upgrades, Docker 29.9, ufw) | done (2026-10-29) |
| M0 repo, docs, CI, design library, brand | in progress |

## Known gaps

- No Xcode on this Mac → no iOS simulator. The iOS PWA is tested with Safari responsive mode;
  everything that needs a real iPhone is marked as such.
- Windows/Linux: built by CI, not manually tested.
