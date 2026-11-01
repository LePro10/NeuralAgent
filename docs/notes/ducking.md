# Lowering other audio while the user talks (D73)

The owner: "When I dictate or am on a call with Neural, music should drop to a quiet background
level, not keep playing at full volume." This round adds that to the desktop app.

## What the user gets
- Hold the dictation hotkey, or say "Hey Neural": music and videos fade down (300 ms) to the
  chosen level (default 20 % of where they were) and keep playing. 0.8 s after the user is done
  they fade back up (600 ms) to exactly where they were. The short hold means quick re-presses or
  "Hey Neural" → command → done do not pump the music up and down.
- A call with Neural in the desktop app lowers other apps for the whole call (Neural's own voice
  stays loud; details per OS below). Dictating inside a call nests: the call keeps its duck when
  the dictation ends.
- Settings → Voice → **Other audio**: "Lower other audio while I talk" (on by default) and
  "Down to" 10 / 20 / 35 %. On a Mac, on that Mac only: "Music and Spotify in calls" with an
  Allow button. Remote devices see and change the switch and level of the host, never the
  permission button.

## How, per OS
| | Dictation, "Hey Neural" | Call in the desktop app |
|---|---|---|
| macOS | System output volume (Core Audio `VirtualMainVolume` of the default output) | Music and Spotify's own `sound volume` via Apple Events, only after the user allowed it |
| Windows | Every other app's WASAPI session volume (`ISimpleAudioVolume`, what the Volume Mixer shows) | same |
| Linux | Every other stream's volume via `pactl` (PulseAudio or PipeWire-Pulse, `pactl` 16+ for JSON) | same |

Windows and Linux skip this app's own process tree (the WebView2 / WebKitGTK children), so the
call's speech stays loud. On macOS the system volume would make Neural quieter too, hence the
split: the app is silent while dictating, so the system volume is fine there.

### Why not something else on macOS
macOS has no public "duck others" API.
- **Apple Events to each player** (chosen for calls): works for Music and Spotify, needs the
  Automation permission once per player. Browsers have no scriptable volume. Before every use the
  code asks `AEDeterminePermissionToAutomateTarget` *without* prompting; scripts are wrapped in
  `if application id … is running` so a player is never launched. The prompt only appears when
  the user presses Allow in Settings on the Mac itself (never from a remote, never on its own).
- **System output volume** (chosen for dictation): no prompt, covers everything incl. browsers.
  In a call it would lower Neural with the music; making up for that with gain in the web view
  would clip.
- **Core Audio process taps** (macOS 14.2+, `CATapDescription` with "muted when tapped" plus an
  aggregate device that re-plays all other audio at a lower gain): true per-app ducking incl.
  browsers, but it needs the "System Audio Recording" permission (a scary prompt), a real-time
  audio path in our process for all system sound, and our WebKit GPU process has to be told
  apart from Safari's. Worth a look only if the owner wants browsers lowered in calls.
- **Voice-processing I/O ducking** (`kAUVoiceIOProperty_OtherAudioDuckingConfiguration`): ducks
  everything outside the unit, which includes the web view's own call audio; only 4 fixed levels.

## Safety
- Before the first volume changes, `<data>/duck.json` holds the originals (route, id, original,
  fully lowered value). It is removed once everything is back. On the next start the app puts
  back any saved volume that is still in the lowered range (a crash or kill while ducked);
  anything the user changed since is left alone.
- Quitting (`RunEvent::Exit`) restores at once (the worker gets `Stop` and answers within 0.5 s).
- A volume that moves while lowered (volume keys, the player's slider) belongs to the user: it is
  dropped from the duck, not restored over, and not lowered again until the duck ends. Device
  rounding is not mistaken for the user: the value read back after each set is the reference.
- Nothing playing, nothing touched (macOS: `DeviceIsRunningSomewhere` on the output; Windows:
  session state Active; Linux: not corked / muted; players: `player state is playing`). Audio that
  starts during a duck is picked up within a second.
- Muted outputs and outputs without a volume slider (HDMI, some USB DACs) are skipped.
- Known limit: two NeuralAgent apps on one Mac (a dev build next to the installed one) ducking at
  the same time can end with the volume left at the inner duck's original. Not a real-life case.

## Code
- `apps/desktop/src-tauri/src/duck.rs`: reasons → routes (`wanted`), the fade per route (`Duck`),
  the worker thread (`Worker`), crash file, Tauri commands `duck_call`, `duck_apps`,
  `duck_allow_apps`. Unit tests with a fake backend: nesting a dictation in a call, exact restore,
  user change, nothing playing, rounding devices, crash repair, exit, the real thread.
- `duck/mac.rs` (Core Audio + Apple Events FFI), `duck/win.rs` (WASAPI), `duck/linux.rs` (`pactl`).
- Hooks: `voice.rs` `set_activity`/`fail` → `duck::voice`, `apply` → `duck::configure`
  (`VoiceConfig.duck`, `duck_level`); `lib.rs` manages `Ducking` before voice and restores on exit;
  `apps/desktop/src/main.tsx` maps `platform.call.active(on)` (called by `App.tsx` at call start
  and end) to `duck_call`; `Info.plist` `NSAppleEventsUsageDescription` and the entitlement
  `com.apple.security.automation.apple-events`.
- UI: `OtherAudio` / `CallPlayers` in `packages/app/src/components/HostSettings.tsx`.

## Checking by hand
- `cargo test -p neuralagent-desktop duck` (unit tests).
- macOS, touches the real output and restores the exact value:
  `cargo test -p neuralagent-desktop -- --ignored system_volume_round_trip real_fade`.
  Compare `osascript -e 'output volume of (get volume settings)'` before and after.
- Windows code was type-checked from macOS with
  `RUSTC_BOOTSTRAP=1 cargo check -Zbuild-std=std,panic_abort --target x86_64-pc-windows-msvc` in
  a scratch crate that includes `duck/win.rs`; CI builds it for real.
