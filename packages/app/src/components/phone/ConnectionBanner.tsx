// Phones: when the computer has been out of reach for a few seconds, one calm pill under the
// status bar says why ("No internet", "Can't reach Mac mini") with Retry. Short drops (the phone
// waking up) never show it.
import { haptic } from "@neuralagent/ui";
import { RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useClient, useDaemon } from "../../lib/store";

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function ConnectionBanner({ show }: { show: boolean }) {
  const client = useClient();
  const host = useDaemon((c) => c.host?.name);
  const status = useDaemon((c) => c.status);
  const online = useOnline();
  const reason = !online ? "No internet connection" : status === "connecting" ? `Connecting to ${host ?? "your computer"}…` : `Can't reach ${host ?? "your computer"}`;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="conn"
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
          style={{ top: "calc(var(--safe-top) + 6px)", zIndex: "var(--z-toast)" }}
          initial={{ opacity: 0, y: -16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
        >
          <span className="material pointer-events-auto flex min-h-control max-w-full items-center gap-2 rounded-full py-1 pr-1 pl-3.5 text-footnote text-ink">
            <span className="truncate">{reason}</span>
            <button
              type="button"
              onClick={() => {
                haptic("select");
                client.poke();
              }}
              className="pressable flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-footnote text-bright"
            >
              <RotateCw className="size-3.5" strokeWidth={2.2} />
              Retry
            </button>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
