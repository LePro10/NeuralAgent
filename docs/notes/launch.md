# Launch screen (D49)

One picture from the moment the app opens until it is ready, the same on the desktop (Tauri), in
the browser (`/app/`) and in the Android app.

## Layers, all drawing the same first frame
| Layer | What it shows | Where |
|---|---|---|
| Android splash | ground colour + 64 dp mark (light/dark) | `res/drawable/launch_mark_*.xml`, `values{,-night}/launch.xml`, `styles.xml`; `NativePlugin.launchTheme` picks the app's appearance on Android 13+ |
| Android window / WebView | the same ground colour | `MainActivity` (WebView background), activity theme DayNight |
| Tauri window | dark ground, light ground when macOS is light | `tauri.conf.json` `backgroundColor`, `src-tauri/src/lib.rs` |
| Entry HTML (before JS) | theme script + `#na-launch` | `<!--launch-->` in `apps/desktop/{index,dev}.html`, `apps/web/app/index.html`, replaced by `launchFrame()` (`packages/app/src/lib/launchFrame.ts`) |
| CSS | ground, lights, bloom, mark, phases | `packages/app/src/styles/launch.css` (linked render-blocking) |

## Phases (`lib/launch.ts`, `data-phase` on `#na-launch`)
`still` (first frame) → `play` (lights and accent bloom fade in, the panes pulse once) → `wait`
(the accent pane breathes) → `out` (the layer fades, the mark grows a little) → `gone`.
The motion runs at least `MIN_MS` (640 ms); `launch.done()` lifts it after that. On Android the
motion starts only when the native splash is gone (`MainActivity` fires `na-splash-gone`; the page
knows it is in the shell from the `NeuralAgentLaunch/` user-agent mark, older APKs start at once).

## Rules for screens
- While the launch screen is up and not late (`useLaunch().settling`), render nothing instead of
  "Connecting…", spinners, empty lists or "offline".
- After `GRACE_MS` (7 s) show what is wrong with `LaunchNote` (text under the mark, Try again).
- Call `launch.done()` (or render `LaunchScreen ready`) when real content is there; the web
  remote's sign-in does it as soon as the providers are loaded.
- Reduced motion: no pulse or breathing, short fades only.

## Constraints
- No inline `<style>` or `style=`: Tauri adds a CSP nonce to inline styles, which turns off
  `unsafe-inline` for the whole page. A test checks the markup.
- Panes are HTML elements, not SVG, so their transforms run on the compositor while the bundle is
  still starting. Their positions in `launch.css` are checked against `MARK_PANES` by a test.
- Only one fading layer; inside it only transforms (Android WebView composited nested opacity
  animations wrongly).

## Checking it
`node scripts/dev/launch.mjs` (desktop WebKit, phone Chromium, web remote signed out/in; `--slow`)
and, for Android, a `screenrecord` of a cold start on the emulator. Frames and montages:
`research-local/polish/launch-shots/`.
