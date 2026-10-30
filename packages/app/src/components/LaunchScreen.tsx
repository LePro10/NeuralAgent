// The app's side of the launch screen (lib/launch.ts): it lifts the moment the daemon state is
// there. A slow start keeps the launch screen calm (the mark breathes, no text); only after the
// grace time, when the computer still does not answer, it says so under the mark with a retry.
import { Button } from "@neuralagent/ui";
import { RefreshCw } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { launch, useLaunch } from "../lib/launch";
import { useClient, usePlatform } from "../lib/store";

export function LaunchScreen({ ready, offline }: { ready: boolean; offline: boolean }) {
  const client = useClient();
  const platform = usePlatform();
  const { late } = useLaunch();
  // Mounted without a launch screen (the web remote opened another computer): show it again.
  useEffect(() => {
    if (!ready) launch.show();
  }, []);
  useEffect(() => {
    if (ready) launch.done();
  }, [ready]);
  if (ready || !late) return null;
  const local = platform.kind === "desktop";
  return (
    <LaunchNote
      title={local ? "NeuralAgent is not answering yet" : "Your computer is not answering yet"}
      detail={
        local
          ? offline
            ? "The background service is starting or stuck. It keeps trying by itself."
            : "Still starting. This can take a moment after an update."
          : "It may be asleep or offline. This keeps trying by itself."
      }
    >
      <Button variant="glass" Icon={RefreshCw} onClick={() => client.poke()}>
        Try again
      </Button>
      <Button variant="ghost" onClick={() => launch.done()}>
        Continue anyway
      </Button>
    </LaunchNote>
  );
}

/**
 * Text (and actions) under the launch screen's mark, for a start that takes too long. Shows the
 * launch screen if it is gone, so a waiting state always looks the same.
 */
export function LaunchNote({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  const { phase } = useLaunch();
  const host = phase === "gone" ? null : launch.element;
  useEffect(() => launch.show(), []);
  // The launch screen is hidden from screen readers while it is only decoration.
  useEffect(() => {
    host?.removeAttribute("aria-hidden");
    return () => host?.setAttribute("aria-hidden", "true");
  }, [host]);
  if (!host) return null;
  return createPortal(
    <div className="nl-note" role="status" aria-live="polite">
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-headline text-bright">{title}</p>
        {detail && <p className="text-subhead text-dim">{detail}</p>}
      </div>
      {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
    </div>,
    host,
  );
}
