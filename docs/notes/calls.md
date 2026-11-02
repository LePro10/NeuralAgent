# Calls with Neural: fast and reliable start (D69, D70)

Round of 2026-10-31. The owner: "Sometimes the call does not work reliably and it takes quite
long to connect (web, Android, native app). The call should always be there immediately." While
in a call, other audio should drop to a quiet background and come back afterwards.

## How a call starts

```
tap "Call Neural"
 ├─ client: call_start ───────────────► daemon: call thread, `connecting`
 │                                        ├─ speech models (Parakeet STT + Supertonic TTS +
 │                                        │  6 acknowledgments) – cold: seconds, warm: 0
 │                                        └─ Silero VAD, `listening`
 ├─ getUserMedia (permission prompt the first time)
 ├─ AudioContext, mic worklet (`mic-worklet.js`), resume
 └─ first 40 ms PCM16 frame ──────────► daemon buffers frames while it loads
```
The microphone audio sent while the daemon still loads is not lost: the call thread's channel
holds it and the voice detector catches up once the models are there.

## What was slow or unreliable (measured)

Test daemon (debug build, sherpa-onnx is native either way), Mac with 10 cores (other builds
running, load 7–15), fake LLM for the browser runs, the real Neural model for `call-test.mjs`.
Browser: Chromium with a fake microphone (`call-web.mjs`), phone and desktop size, locally and
through a local relay (test login).

| Step | Before | After |
|---|---|---|
| `call_start` → daemon `listening`, models cold | 3.2–4.8 s (`speech models loaded ms=3758`: STT, then TTS, then 6 acknowledgments 1.7 s) | 1.2–1.3 s (STT and TTS in parallel; acknowledgments afterwards in the background) |
| tap → computer listens, Neural page open ≥ 1.5 s before (warm-up) | same as cold | 5–55 ms |
| tap 1.4 s after opening the Neural page (warm-up still running) | same as cold | 190 ms (relay), 343 ms (local) |
| same, models warm (< 5 min after a call) | 4–18 ms | 5–39 ms |
| tap → mic granted → worklet loaded (browser) | 30–140 ms | same (worklet prefetched) |
| call screen shows the running timer | ~140 ms, **while the daemon was still loading for 3+ s** | only when the computer listens (≤ 25 ms after it) |
| connection drops mid-call | call restarted silently, no notice | "Reconnecting…", back in 0.04–0.6 s (local and relay) |
| end of the caller's sentence → first audio | 948 ms (acknowledgment) | 937 ms (unchanged) |

Under heavy machine load (load average 29 while other agents built) the cold load took 7 s:
the warm-up from the Neural page matters most on a busy computer.

Findings, in order of impact:
1. **Cold speech models** (about 1 GB, freed 5 minutes after a call) took 3–5 s on every first
   call, and the call screen already showed a running timer meanwhile: the caller talked into a
   line that was not listening yet ("does not work", "takes long"). Loading STT and TTS one after
   the other doubled it, and the daemon's 1 s tick blocked on the engines lock during a load.
2. **Over the relay, a message the daemon cannot parse closed the whole remote session**
   (`remote.rs`, "undecryptable or invalid frame"). The web remote is deployed from newer code
   than many computers run, so any new request from it dropped the connection (and the call)
   into a reconnect loop. Locally the same message was only a warning.
3. `call_start` was sent before the connection's hello was answered and again after it: two calls
   started back to back (the first one cancelled).
4. A reconnect during a call restarted it silently; nothing told the caller, and a computer that
   never answered left "Connecting…" forever. Microphone errors showed raw browser text
   ("AbortError", "Unable to load a worklet's module").
5. Android: the call audio mode, earpiece route and the foreground service were set only after
   the microphone and the worklet were ready; `CallAudio.start` could save the WebView's own
   communication mode as "the mode before the call" and restore it afterwards (media stays quiet,
   Bluetooth stays in call quality). Starting the microphone foreground service without the
   permission throws on Android 14 (crash risk). No audio focus: music played on at full volume.
6. On a slow uplink, microphone frames queued up in the socket: the caller's words reached the
   computer seconds late.

## What changed

**Daemon (`crates/na-daemon/src/call.rs`, D69)**
- `call_warm` (`ClientMsg::CallWarm`, feature `"call_warm"`): loads the models in a background
  thread. Sent by the Neural page (`useCallWarm` in `lib/call.ts`): on open, after every
  reconnect and when the page comes back to the front. Ignored when Neural has no model.
- STT and TTS load in parallel; a call and a warm-up share one load (`Calls.loading`), the
  engines lock is never held during a load, a voice change during a load is not kept.
- The six acknowledgments ("Okay.", "Moment.") are synthesized after the load in a background
  thread (`Engines::make_fillers`, one phrase per TTS lock). In the first ~2 s after a cold load a
  slow answer comes without an acknowledgment; nothing waits for them.
- **Lazy and time-bounded, for `perf`:** nothing loads at daemon start or on connect. Models
  stay `KEEP_LOADED` (5 min) after the last call or warm-up, then they are freed (`call_tick`).
  A desktop that keeps the Neural page open does not re-warm on a timer, so it frees the models
  5 minutes after the page was opened or last came to the front. Do not turn this into an
  eager load; shortening `KEEP_LOADED` is fine (the cost is one cold start).

**Protocol (additive)**
- `HelloOk.features` = `na_protocol::DAEMON_FEATURES`. Clients ask `client.has("…")` before
  sending a newer message; older daemons send none. Every new request a new web remote may send
  to an old computer should get a feature name there.
- `remote.rs`: a sealed message the daemon cannot parse is skipped with a warning instead of
  closing the session (like a local connection).

**Client (`lib/call.ts`, `lib/callState.ts`, `CallScreen.tsx`, D70)**
- `call_start` goes out only on a live connection (and again after every reconnect).
- "Connecting…" until the microphone is open **and** the computer listens; then the timer.
  "Reconnecting…" while the connection is gone (the client re-sends `call_start` and the call
  resumes); after 45 s offline the call ends with "Lost the connection to your computer.".
  No answer from the computer within 15 s ends the call with a reason.
- Clear words for microphone failures (`micErrorText`): denied (browser vs Android settings),
  missing, busy, no https, worklet failed.
- The worklet hangs on a silent gain node to the output (so every engine pulls it); a microphone
  that stops (headset unplugged, OS revoked it) is reopened once; audio output that is suspended
  (no gesture yet, the OS took it) resumes by itself or on the next tap ("Tap to turn the sound on").
- A start timeline goes to the console (`call: connected (ms after tap: mic 28, worklet 37, …)`):
  on Android readable with `scripts/dev/wv.mjs`.
- `DaemonClient.callAudio` drops microphone frames while more than 64 KB wait in the socket.

**Android (`CallAudio.java`, `CallService.java`, `NativePlugin.callActive`; APK needed)**
- `platform.call.active(true)` already at the tap (App.tsx), again when the microphone is open.
  The first sets the call audio mode, the route and audio focus; the foreground service starts
  only once `RECORD_AUDIO` is granted, and a refused service start no longer crashes the app.
- Audio focus `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` with `USAGE_ASSISTANT` / speech: Android
  lowers other apps' audio for the call (about −14 dB, the system's ducking level) and brings it
  back when the focus is abandoned at the end. Apps that prefer pausing (some podcast players)
  pause and resume. A voice-communication focus was avoided: the system may mute media for a
  "call" instead of ducking it.
- The mode before the call is never the WebView's own `MODE_IN_COMMUNICATION`; 1.5 s after the
  call the mode is set back once more in case the WebView restored its saved mode late.

**Review fixes (review3, D78)**
- Warm-ups are bounded: within a stretch of warm-ups without a call they load or keep the
  models for at most `WARM_MAX` (15 min); later ones are ignored until a call or a 10 min pause
  (`warm_step`). Worst case for a phone left on the Neural page: about 20 min of 1 GB.
- A call hung up while its models still loaded sends nothing afterwards (no late `listening`);
  a call replaced by a newer one on the same connection sends no `ended` (it would end the new
  call on the client); replaced from another device it ends with "The call continues on another
  device.". The client also ignores an `ended` that comes before this call's first state.
- The computer took the call but does not listen 45 s after the tap (`READY_TIMEOUT_MS`): the
  call ends with a reason instead of "Connecting…" for good.
- Android: the page reloading, the activity closing, the task being swiped away and "Hang up"
  in the notification all release the call audio (mode, route, focus, service); a headset
  connected or removed during the call re-routes (`AudioDeviceCallback`).
- Remote: a skipped (not understood) message is logged by its type only (serde's error text can
  quote field values). It is skipped only after the end-to-end frame was opened, so only an
  authenticated device can send one.

## Other audio during a call (ducking), per platform
- **Android app**: ducked by audio focus (above), automatic, no setting.
- **Web remote in a browser**: a web page cannot lower other apps' audio. Safari (iOS 17+/macOS)
  takes the Audio Session API: the call sets `navigator.audioSession.type = "play-and-record"`,
  and iOS then lowers or pauses other audio itself; back to `"auto"` after the call. Chrome on
  Android and desktop browsers: no control; other audio keeps playing.
- **Desktop app**: agent `duck` (D73, [ducking.md](ducking.md)) watches `useCall().on`.

## Not done / open
- Not measured on a real Android device: no emulator is installed. The debug APK builds
  (`./gradlew assembleDebug` with Homebrew `openjdk@21` as `JAVA_HOME`); ducking, the early call
  mode and the mode restore need a check on a phone (music playing → call → quieter → hang up →
  back to full volume; then a YouTube video plays at normal volume, not in call quality).
- The phone app loads the web remote from the relay: its page-side changes (warm-up, honest
  states, reconnect) arrive with the next web deploy; the Java side needs the next APK.
- A call dialled from the quick tile on a cold app still pays the app start + relay connect +
  (if cold) the model load; the daemon cannot know earlier.

## "Hey Neural" calls, end of speech (D84, 2026-11-02)
- The desktop wake word starts this same call (`startCall(client, { wake: true, preroll })`): the
  audio from 1.5 s before the spotter fired goes first, the daemon strips the wake word from the
  text, the call hangs up after `WAKE_IDLE_MS` (20 s) of quiet. The spotter rests during any call.
- `END_OF_TURN` 0.8 s; unfinished sentences ("und", "ähm", comma) wait up to `HOLD` 1.8 s more.
- The desktop window is never throttled in the background (`backgroundThrottling: "disabled"`).

## Test tools
- `scripts/dev/call-test.mjs`: synthetic call; now prints the connect timeline
  (`connect: connecting 1 ms, listening 3765 ms`). With no clips it only measures the connect.
- `scripts/dev/call-web.mjs`: the browser timeline per call (tap → mic → worklet → daemon
  states → first frame → screen connected). `--strict` keeps Chromium's autoplay rules,
  `--no-gesture` starts the call from script like the quick tile, `--warm` waits on the Neural page,
  `--drop` closes the daemon connection mid-call and times the recovery, `--relay <url>` goes
  through a local relay built with `--features test-login`.
- `call-test.mjs` with `WARM=<ms>` sends `call_warm` first and starts the call that much later.
