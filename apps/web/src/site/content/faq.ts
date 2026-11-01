// FAQ data. The accordion AND the FAQPage JSON-LD (static, in index.html) come from this one array. After editing it run
// `node --experimental-strip-types apps/web/src/site/content/sync-static.ts` (the test in static.test.ts fails when they drift).
// Markup in answers: `code` and [text](href). Facts only (site-audit.md Part B, the privacy page).
export interface Faq { q: string; a: string }

export const FAQ: Faq[] = [
  {
    q: "Does NeuralAgent upload my code?",
    a: "No. Agents, terminals and files stay on your computer, in a background service that keeps running when you close the window, and NeuralAgent keeps no cloud copy. The agents you run still talk to their own providers, as they do in any terminal, and Neural sends its conversation to the model provider you choose. Remote access goes through a relay that only passes end-to-end encrypted messages between your own devices.",
  },
  {
    q: "Which agents does it run?",
    a: "Thirteen command-line agents: Claude Code, Codex, Gemini CLI, Antigravity CLI, Cursor Agent, Copilot CLI, OpenCode, Grok Build, Amp, Droid, Kimi Code, Qwen Code and Aider. Any other terminal program runs as a plain shell pane. You bring your own subscriptions and keys.",
  },
  {
    q: "What does it cost?",
    a: "NeuralAgent is free and open source under the AGPL-3.0. The agent CLIs and Neural's model provider bill you separately, through your own subscriptions or keys.",
  },
  {
    q: "Can I try it without installing?",
    a: "Yes. The [live demo](/demo/) runs the real app against a simulated computer in your browser. No account, no model calls, nothing is installed.",
  },
  {
    q: "Do I need an account?",
    a: "Not for the desktop app. An account is only needed for remote access from a phone or browser: you sign in with Google or GitHub, and access is approved on request.",
  },
  {
    q: "What can the relay see?",
    a: "The relay sees who is connected and when: your account, device names and public keys, connection times and how much data moves. It never sees what your agents show or do, that is ciphertext. A push notification also tells Google, Apple or Mozilla that an event happened, such as an agent needing you. Two limits are worth knowing: a phone added by signing in trusts the relay's key directory the first time (QR pairing avoids that), and the relay also serves the web app, so encryption does not help against a compromised server shipping malicious web code. [The details are above.](#security)",
  },
  {
    q: "How does Neural work, and what does it need?",
    a: "Neural is the voice orchestrator. Wake word, dictation and speech output run on your computer after a one-time download of about 630 MB; the local speech models are verified on macOS only. The thinking is done by a model provider you choose and pay for, for example NeuralHub, Anthropic, an OpenAI-compatible API or a local Ollama. The key stays in your system keychain.",
  },
  {
    q: "What happens when I update the app?",
    a: "It updates itself. The service that holds your agents is started from a copy outside the app, so a running agent keeps going while the window is replaced.",
  },
  {
    q: "Is the macOS app notarized?",
    a: "Not yet. It is signed with a stable self-signed identity. The Terminal command installs it without the macOS security prompt. With the dmg, open System Settings, Privacy & Security, then Open Anyway, once.",
  },
  {
    q: "Do Windows and Linux work?",
    a: "Builds exist for both and are produced automatically. They have not been tested by hand yet, so macOS is the safe choice today. On Windows, SmartScreen may ask you to choose More info, then Run anyway, because there is no code-signing certificate.",
  },
  {
    q: "What about my iPhone?",
    a: "There is no App Store app. Open the [web remote](/app/) in Safari, sign in, then Add to Home Screen. Push notifications need that install. On Android there is an app with a widget, a quick-settings tile, push and lock-screen calls.",
  },
  {
    q: "What can my phone see on my computer?",
    a: "Projects added from a phone are approved at once. The home folder is read-only if you allow it, and .ssh, .aws, .config, Desktop, Documents, Downloads and Library stay closed to phones.",
  },
  {
    q: "Does NeuralAgent track me?",
    a: "The website sets no cookies and uses no analytics or ads. The desktop app needs no account and only asks agent.neuralhub.dev for new versions, which sends your system, architecture and app version. If you use remote access, the relay stores the small set of account and device data listed in the [privacy policy](/privacy/).",
  },
  {
    q: "Is it open source?",
    a: "Yes. The code is public on [GitHub](https://github.com/LePro10/NeuralAgent) under the AGPL-3.0.",
  },
];

/** Plain text for JSON-LD: markup removed. */
export const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`/g, "");
