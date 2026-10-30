# Host control from remotes, earpiece mode, host folder browser (D42)

## Daemon (`crates/na-daemon/src/host.rs`, `fsbrowse.rs`, `policy.rs`)
- Requests: `host_models`, `host_model_download`, `host_model_delete`, `host_update_check`, `host_ui`,
  `host_notice`, `fs_roots`, `fs_mkdir`. Client messages `host_ui_register`, `host_ui_reply`; server
  message `host_call`; event `host_notice` (not stored in state, not in the replay-dirty flag).
- Voice model code moved to `crates/na-voice/src/download.rs` (desktop `models.rs` re-exports it).
- Policy: remote kinds may do host_*, settings, keys, workspace rename/approve/remove; Orchestrator may not.
- Tests: `host.rs` (forwarding, policy), `fsbrowse.rs`; `scripts/e2e-remote.ts` extended (models
  download/delete from a remote, update check without the app, install via the app, notices, forged
  notice refused, folder browse/mkdir, workspace rename/approve/remove). All green.

## UI (`packages/app`)
- `lib/host.ts`, `components/HostSettings.tsx`, `HostWatcher.tsx` (toast + reload on version change),
  `FolderBrowser.tsx` (sheet; App.tsx uses it when `platform.pickFolder` is missing),
  `lib/callaudio.ts`, `components/CallAudioToggle.tsx`; Settings split "This device" / host name.
- Desktop (`apps/desktop/src/main.tsx`) registers as host UI and forwards voice/update progress.
- Web/Android: `Remote.tsx` mounts `HostUpdateWatcher`, passes `call.audio`; `native.ts` has `callRoute`.

## Android
`CallAudio.java` (mode, communication device, SCO fallback, proximity wake lock, route stored in
SharedPreferences), used by `CallService` and `NativePlugin.callActive/callRoute`. Compiles
(`compileDebugJavaWithJavac`). Not run on a device/emulator.

## Verified
cargo test (daemon, protocol), pnpm typecheck/test/lint:tokens, e2e-remote, Chromium drive
(`/tmp/na-drive/host-remote.mjs`, `ws-remote.mjs`): update toast, host sections, install progress to
"up to date", model rows, "app closed" notice, folder sheet. WebKit playwright hung in this
environment (page load stalls, also for the old web-remote.mjs), so Chromium was used.

## Not verified / needs the user
- Real update install end to end through `/tmp/na-upd` and the auto-reload after the host restarts
  (reload code path is simple: hello with a different daemon version -> `location.reload()`).
- Android earpiece/proximity on a real phone; Bluetooth headset; iPhone PWA (cannot choose output).

## Desktop-only features audited
Enabled on remotes: add workspace (host folder sheet), rename/remove/approve, Neural + call voice,
voice models, dictation/wake word (through the app), updates, general settings.
Skipped: native folder dialog (replaced), tray/menu bar, window drag, Tauri notifications (remotes use
Web/FCM push), sign out/in of the remote account (`remote_*` stays desktop-only for safety; remotes
have their own device page), "Learn my voice"/dictation record on the phone's own mic (they use the
host's microphone by nature), restarting the service (`daemon_upgrade`, host-local).
For the design agent: `NeuralPage.tsx:115` text and `onSettings` (App.tsx:261) are still desktop-only;
remotes can open Settings -> Neural now.
