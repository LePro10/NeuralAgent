# Memory and performance (D74, D75)

What uses memory on the Mac, what we changed, and how to measure it. Activity Monitor's
"Memory" column is the process's `phys_footprint` (includes compressed and swapped pages).

## Where the memory went (0.3.4, measured 2026-10-31)

| Process | Footprint | Why |
| --- | --- | --- |
| `neuralagent` (app) | 1.35 GB | Parakeet dictation model loaded on first dictation / wake word and kept for good (Malloc Large 1.07 GB + small 0.25 GB). |
| WebKit WebContent (main window) | 310-340 MB | The UI; stable, no leak over a long session. |
| WebKit GPU | 140-155 MB | Compositing (P8, open). |
| WebKit WebContent (HUD pill) | 75-80 MB | Hidden listening pill loaded the whole app bundle. |
| `neuralagentd` | 60-70 MB idle | Up to about 1 GB more during a call (Parakeet + TTS), D69/D78. |
| `claude` CLIs | about 120 MB each | The agents themselves; not ours to shrink. |

Parakeet TDT 0.6b int8 is about 1 GB loaded; the ONNX Runtime CPU arena grows with utterance
length (a 78 s utterance adds about 520 MB) and keeps that until the model is dropped.

## What changed

- **App dictation model unloads after 5 idle minutes** (`apps/desktop/src-tauri/src/voice.rs`,
  `STT_KEEP`, `unload_idle`; checked every 15 s by the `voice-unload` thread, never while
  listening, transcribing or recording). It is warmed on the hotkey press and right after
  "Hey Neural". The wake-word detector stays loaded.
- **One Parakeet per daemon** (`crates/na-daemon/src/speech.rs`): calls and Claude-view dictation
  share the instance while either holds it. Each keeps its own keep-alive (calls: D69/D78);
  the registry holds only a weak reference.
- **`MallocSpaceEfficient=1`** for our own processes: set by the host when it starts the daemon
  (`daemon::lean`), by `LSEnvironment` in `Info.plist` for the app, and removed by the daemon
  at the start of `main` so agents and their tools never see it.
- **`ProcessType Interactive`** on the login and boot host LaunchAgent/Daemon (`autostart.rs`), so
  launchd does not throttle the service and its agents (agents never sleep).
- **Lean HUD bundle**: `apps/desktop/src/hud.tsx` imports `@neuralagent/app/hud`
  (`packages/app/src/hud.ts`), so the hidden pill loads a 542 KB chunk instead of 1.6 MB.

## Results (debug builds, own test homes)

| Case | Before | After |
| --- | --- | --- |
| App, dictation model loaded | 1350 MB (owner) | 754 MB |
| App, 5 min after last use | 1350 MB (forever) | 64 MB |
| Daemon, call + Claude-view dictation | about 2 GB (estimate: two copies) | 952 MB (one copy, no second load) |
| Daemon after unload | 127-399 MB | 27 MB |
| HUD pill WebContent | 33-34 MB (test) / 75-81 MB (owner) | 24 MB (test) |

Latency and CPU in A/B runs were within noise (short dictation 230-530 ms, 78 s utterance
6.7-10.7 s, PTY flood CPU the same).

## How to measure

- `footprint <pid>` and `vmmap --summary <pid>` on processes you own; `ps -o pid,rss,comm`
  (never full command lines: tokens).
- Test daemon: `NEURALAGENT_HOME=/tmp/na-<tag>`; never measure by restarting the installed app.
- To check the variable reached a process, look at its footprint after an unload (a few tens
  of MB with it, hundreds without).

## Open points

- P4: cut very long dictations at pauses so the ONNX arena stays small.
- P5: app dictation through the daemon (one model per Mac instead of one per process).
- P7: PTY scrollback compaction (vt100 keeps 32 B per cell, about 16 MB per full session).
- P8: WebKit GPU/WebContent of the main window.
- `LSEnvironment` was proven with a scratch bundle, not yet with a signed release build.
