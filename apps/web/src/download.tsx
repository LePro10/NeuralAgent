import "./styles.css";
import { Button, Callout, Spinner } from "@neuralagent/ui";
import { Download, Laptop, Monitor, Smartphone, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Brand, Footer } from "./brand";

interface Latest {
  version: string;
  pub_date: string;
  downloads: Record<string, string>;
}

// Download kinds as the release manifest names them (scripts/release-collect.mjs).
const KINDS: { kind: string; Icon: LucideIcon; title: string; detail: string; os: RegExp }[] = [
  { kind: "mac", Icon: Laptop, title: "macOS", detail: "Apple silicon · .dmg", os: /Mac/ },
  { kind: "mac-intel", Icon: Laptop, title: "macOS (Intel)", detail: ".dmg", os: /^$/ },
  { kind: "windows", Icon: Monitor, title: "Windows", detail: "64-bit installer", os: /Win/ },
  { kind: "linux", Icon: Terminal, title: "Linux", detail: "AppImage", os: /Linux(?!.*Android)/ },
  { kind: "linux-deb", Icon: Terminal, title: "Linux (Debian, Ubuntu)", detail: ".deb", os: /^$/ },
  { kind: "android", Icon: Smartphone, title: "Android", detail: "APK", os: /Android/ },
];

const INSTALL = `curl -fsSL ${location.origin}/install.sh | sh`;

function DownloadPage() {
  const [latest, setLatest] = useState<Latest | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/releases/latest")
      .then((r) => (r.ok ? (r.json() as Promise<Latest>) : null))
      .then(setLatest, () => setLatest(null));
  }, []);
  const ua = navigator.userAgent;
  const kinds = KINDS.filter((k) => latest?.downloads[k.kind]);
  const mine = kinds.find((k) => k.os.test(ua));

  return (
    <>
      <main className="mx-auto w-full max-w-3xl px-4">
        <header className="py-5"><Brand /></header>
        <h1 className="display mt-8 text-display sm:text-display-lg">Download</h1>
        {latest === undefined ? (
          <div className="mt-8"><Spinner /></div>
        ) : !latest || kinds.length === 0 ? (
          <Callout className="mt-6" title="The first release is on its way">
            Builds appear here as soon as they are published. Meanwhile the web remote works in any browser.
          </Callout>
        ) : (
          <>
            <p className="mt-2 text-body text-dim">
              Version {latest.version} · {new Date(latest.pub_date).toLocaleDateString()} · The app updates itself; your agents keep running.{" "}
              <a href={`/changelog#${latest.version}`} className="text-ink underline decoration-line-2 underline-offset-4 hover:text-bright">What's new</a>
            </p>
            {mine && (
              <div className="mt-6">
                <Button href={latest.downloads[mine.kind]} Icon={Download}>Download for {mine.title}</Button>
              </div>
            )}
            {(mine?.kind === "mac" || mine?.kind === "mac-intel") && (
              <div className="mt-4">
                <p className="text-small text-dim">Or install from Terminal, without the macOS security prompt:</p>
                <code className="card !rounded-list mt-2 block select-all overflow-x-auto whitespace-nowrap p-3 font-mono text-small text-bright">{INSTALL}</code>
              </div>
            )}
            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {kinds.map(({ kind, Icon, title, detail }) => (
                <a key={kind} href={latest.downloads[kind]} className="card !rounded-list flex items-center gap-3 p-4 hover:bg-fill-2">
                  <span className="grid h-8 w-8 place-items-center rounded-tile bg-fill-3 text-bright">
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-title text-bright">{title}</span>
                    <span className="block text-small text-dim">{detail}</span>
                  </span>
                  <Download size={16} className="text-dim" />
                </a>
              ))}
            </div>
            <h2 className="mt-10 text-title text-bright">First start</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-dim">
              <li>macOS: the app is not notarized yet. Use the Terminal command above, or after the DMG open System Settings → Privacy & Security → Open Anyway once.</li>
              <li>Windows: if SmartScreen warns, choose More info → Run anyway.</li>
              <li>Linux: make the AppImage executable (chmod +x) and start it.</li>
              <li>Android: allow installs from your browser when asked. The app tells you when a newer APK is out.</li>
            </ul>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DownloadPage />
  </StrictMode>,
);
