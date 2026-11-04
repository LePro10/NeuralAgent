// The Browser connector: pair the Chrome extension. The app shows a one-time code, the user
// pastes it into the extension; a connected extension shows its browser and can be unpaired.
import { Button, Callout, toast } from "@neuralagent/ui";
import { Compass, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { writeClipboard } from "../../lib/clipboard";
import { usePlatform } from "../../lib/store";
import { useApDo, useApRequest, useAutopilot } from "./hooks";

/** The code is valid for 10 minutes; the card says so and drops it after that. */
const CODE_MS = 10 * 60 * 1000;

export function BrowserPair() {
  const link = useAutopilot().browser;
  const req = useApRequest();
  const run = useApDo();
  const platform = usePlatform();
  const [code, setCode] = useState<{ value: string; at: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // A paired extension makes the code useless.
  useEffect(() => {
    if (link.connected) setCode(null);
  }, [link.connected]);
  useEffect(() => {
    if (!code) return;
    const t = setTimeout(() => setCode(null), Math.max(0, code.at + CODE_MS - Date.now()));
    return () => clearTimeout(t);
  }, [code]);

  const pair = async () => {
    setBusy(true);
    try {
      setCode({ value: await req<string>({ op: "browser_pair" }), at: Date.now() });
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  if (link.connected) {
    return (
      <Callout tone="success" Icon={Compass} title="Your browser is connected" action={<Button size="sm" variant="ghost" onClick={() => void run({ op: "browser_unpair" }, "Browser disconnected")}>Disconnect</Button>}>
        {link.browser ? `${link.browser} is paired.` : "The extension is paired."} The autopilot opens pages in its own tab group named “NeuralAgent”, using your real logins.
      </Callout>
    );
  }
  return (
    <section>
      <h2 className="mb-2 px-1 text-footnote text-dim uppercase tracking-wide">Connect your browser</h2>
      <div className="surface flex flex-col gap-4 rounded-list p-4">
        <ol className="flex flex-col gap-3">
          {[
            "Open Chrome (best in a second Chrome profile just for this) and go to chrome://extensions. Switch on Developer mode.",
            "Choose “Load unpacked” and pick the folder apps/browser-extension from the NeuralAgent project.",
            "Press the button below, then paste the code into the extension’s popup.",
          ].map((t, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-fill-3 text-footnote text-ink tabular">{i + 1}</span>
              <span className="min-w-0 flex-1 text-subhead text-ink">{t}</span>
            </li>
          ))}
        </ol>
        {code ? (
          <div className="flex flex-col items-center gap-2 rounded-field bg-fill-2 px-4 py-4">
            <div className="selectable font-mono text-title-2 tracking-wider break-all text-bright">{code.value}</div>
            <p className="text-footnote text-dim">Valid for 10 minutes. Waiting for the extension…</p>
            <Button
              size="sm"
              variant="ghost"
              Icon={Copy}
              onClick={() => void writeClipboard(code.value, platform).then((ok) => toast(ok ? "Code copied" : "Could not copy", ok ? undefined : { tone: "danger" }))}
            >
              Copy code
            </Button>
          </div>
        ) : (
          <Button variant="accent" busy={busy} onClick={() => void pair()}>
            Get a pairing code
          </Button>
        )}
        <p className="text-footnote text-dim">The extension only works in its own tab group. You can disconnect it here at any time.</p>
      </div>
    </section>
  );
}
