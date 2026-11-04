# NeuralAgent Browser (Chrome extension)

Lets the NeuralAgent autopilot open and read web pages in **your own Chrome**, with your real
cookies and sign-ins, in a tab group called **NeuralAgent** that you can watch. Manifest V3,
no debugger and no DevTools protocol: it uses `chrome.tabs` and `chrome.scripting` only, so pages
see a normal browser.

## Install (load unpacked)

Until it is in the Chrome Web Store:

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Press **Load unpacked** and choose this folder (`apps/browser-extension`).
3. Pin the extension (puzzle icon, pin) so the popup is one click away.

**Tip: use a second, normal Chrome profile** (profile picture, Add, Continue without an account) just for the
autopilot, and sign in there only to the sites it should use. Then the autopilot can never see your
personal tabs or accounts.

## Pair with the app

1. In NeuralAgent open **Autopilot, Connectors, Browser** and press **Pair**. A code like
   `NA-4455-AB12CD` appears. It works once.
2. Click the extension icon, paste the code, press **Pair**. The dot turns green.
3. **Unpair** in the popup removes the link (the app can also forget the browser).

The extension talks only to the app on this computer: `ws://127.0.0.1:<port>/browser`. It keeps the
connection alive by itself and reconnects when the app restarts.

## What the app can do

`open {url}`, `read {tab}` (visible text, clipped to 40,000 characters), `links {tab}`,
`click {tab, text | selector}`, `type {tab, selector, text, submit?}`, `scroll {tab, to?}`
(`down`, `up`, `top`, `bottom`), `close {tab}`. Only tabs the extension opened itself can be used.
One command at a time per tab, 30 seconds each. Chrome's own pages and the Web Store cannot be read.

The protocol is in `docs/notes/autopilot.md` (Browser). Besides it the extension sends
`{"t":"ping"}` every 20 seconds so the service worker stays awake; the app should ignore it or
answer `{"t":"pong"}`.

## Develop

`node --test apps/browser-extension/` runs the unit tests of the pure helpers (`protocol.js`).
Reload the extension on `chrome://extensions` after a change.
