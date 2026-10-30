// Content for the landing page. Only things the product really does (see docs/PLAN.md, STATUS.md).
import { useEffect, useState } from "react";

export const SITE = "https://agent.neuralhub.dev";
export const MAIL = "agent@neuralhub.dev";
export const INSTALL_CMD = "curl -fsSL https://agent.neuralhub.dev/install.sh | sh";

export const AGENTS = [
  "Claude Code", "Codex", "Gemini CLI", "Antigravity CLI", "Cursor Agent", "Copilot CLI", "OpenCode",
  "Grok Build", "Amp", "Droid", "Kimi Code", "Qwen Code", "Aider",
];

export const NAV = [
  { id: "story", label: "Why" },
  { id: "features", label: "Features" },
  { id: "demo", label: "Live demo" },
  { id: "security", label: "Security" },
  { id: "platforms", label: "Platforms" },
  { id: "faq", label: "FAQ" },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Does my code leave my computer?",
    a: "No. Agents, terminals and files live on your machine, in a background service that keeps running when you close the window. For phone and web access the relay only passes end-to-end encrypted messages between your own devices and cannot read them.",
  },
  {
    q: "Which agents does it run?",
    a: "Thirteen command-line agents out of the box: Claude Code, Codex, Gemini CLI, Antigravity CLI, Cursor Agent, Copilot CLI, OpenCode, Grok Build, Amp, Droid, Kimi Code, Qwen Code and Aider. Any other terminal program runs as a plain shell pane. You bring your own subscriptions and keys.",
  },
  {
    q: "Do I need an account?",
    a: "Not for the desktop app. An account is only needed for remote access from phone or browser: you sign in with Google or GitHub, and access is approved on request so the relay stays small and safe.",
  },
  {
    q: "How does Neural work, and what does it need?",
    a: "Neural is the voice orchestrator. Wake word, dictation and speech output run on your computer after a one-time model download of roughly 630 MB. The thinking is done by a model provider you choose and pay yourself: an OpenAI-compatible API, Anthropic or a local Ollama. The key stays in your system keychain.",
  },
  {
    q: "What happens when I update the app?",
    a: "It updates itself. The service that holds your agents is started separately from the app bundle, so a running agent keeps going while the window is replaced.",
  },
  {
    q: "Is the macOS app notarized?",
    a: "Not yet. The Terminal command installs it without the macOS security prompt. If you use the DMG, open System Settings, Privacy & Security, then Open Anyway, once. On Windows, SmartScreen may ask you to choose More info, Run anyway.",
  },
  {
    q: "Does the site or the app track me?",
    a: "No analytics, no advertising and no cookies on this site. The relay keeps the small set of data it needs to run, listed in the privacy policy.",
  },
];

export interface Latest {
  version: string;
  pub_date: string;
  downloads: Record<string, string>;
}

export type Os = "mac" | "windows" | "linux" | "android" | "ios" | "other";

export function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "other";
}

export const OS_LABEL: Record<Os, string> = {
  mac: "macOS", windows: "Windows", linux: "Linux", android: "Android", ios: "iPhone", other: "your computer",
};

const KIND: Record<Os, string> = { mac: "mac", windows: "windows", linux: "linux", android: "android", ios: "", other: "" };

/** Latest release manifest (null while loading or when there is none) and the detected system. */
export function useRelease() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [os] = useState<Os>(detectOs);
  useEffect(() => {
    fetch("/api/releases/latest")
      .then((r) => (r.ok ? (r.json() as Promise<Latest>) : null))
      .then(setLatest, () => setLatest(null));
  }, []);
  const direct = latest?.downloads[KIND[os]];
  // iPhone has no store build: the web remote installs as an app from Safari.
  const cta =
    os === "ios"
      ? { href: "/app/", label: "Open on iPhone" }
      : { href: direct ?? "/download", label: os === "other" ? "Download" : `Download for ${OS_LABEL[os]}` };
  return { latest, os, cta };
}
