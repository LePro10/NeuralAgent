// Platforms and download. Download kinds are the keys of /api/releases/latest -> downloads (never re-parse file names):
// mac, mac-intel, windows, linux, linux-deb, android. Facts: site-audit.md A4 + B11.
import type { Os } from "../ui";
import { Apple, Laptop, Monitor, Smartphone, type LucideIcon } from "./icons";

export interface PlatformLink { kind: string; label: string }
export interface Platform {
  id: Exclude<Os, "other">;
  name: string;
  icon: LucideIcon;
  detail: string;
  links: PlatformLink[];
  /** Plain, honest notes. */
  notes: string[];
}

export const PLATFORMS: Platform[] = [
  {
    id: "mac",
    name: "macOS",
    icon: Apple,
    detail: "Apple silicon and Intel. macOS 12 or later.",
    links: [{ kind: "mac", label: "Apple silicon" }, { kind: "mac-intel", label: "Intel" }],
    notes: [
      "The platform it is used and tested on every day.",
      "Not notarized yet. The Terminal command installs it without the macOS security prompt. With the dmg, open System Settings, Privacy & Security, then Open Anyway, once.",
    ],
  },
  {
    id: "windows",
    name: "Windows",
    icon: Monitor,
    detail: "64-bit setup installer.",
    links: [{ kind: "windows", label: "Installer" }],
    notes: ["Built automatically, not tested by hand yet. There is no code-signing certificate, so SmartScreen asks first: choose More info, then Run anyway."],
  },
  {
    id: "linux",
    name: "Linux",
    icon: Laptop,
    detail: "x86_64. AppImage or .deb.",
    links: [{ kind: "linux", label: "AppImage" }, { kind: "linux-deb", label: ".deb" }],
    notes: ["Built automatically, not tested by hand yet."],
  },
  {
    id: "android",
    name: "Android",
    icon: Smartphone,
    detail: "The remote app for your computer. Android 7.0 or later.",
    links: [{ kind: "android", label: "APK" }],
    notes: ["Home-screen widget, quick-settings tile, push and lock-screen calls. Tested on an emulator; checks on real devices are pending."],
  },
  {
    id: "ios",
    name: "iPhone",
    icon: Smartphone,
    detail: "The web remote, installed from Safari. There is no App Store app.",
    links: [],
    notes: ["Open it in Safari, sign in, then Add to Home Screen. Push notifications need the Home Screen install."],
  },
];

export const REQUIREMENTS = [
  { key: "Agents", value: "The CLIs install separately, one click each. They use your own subscriptions or API keys." },
  { key: "Account", value: "None for the desktop app. Remote access signs in with Google or GitHub, approved on request." },
  { key: "Voice", value: "Local models, about 630 MB, downloaded when you first use them. Verified on macOS only." },
  { key: "Updates", value: "The app checks agent.neuralhub.dev and offers the update. Running agents keep going." },
] as const;
