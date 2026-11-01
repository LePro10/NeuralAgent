// The one-time notice that NeuralAgent shares anonymous usage statistics (docs/notes/insights.md).
// Usage stats are on unless turned off, so the user is told once, shortly after the first start
// with a daemon that knows the setting, with a way straight to Settings → Privacy and support.
import { toast } from "@neuralagent/ui";
import { useEffect } from "react";
import { requestSettingsSection } from "./settingsRoute";
import { useDaemon, usePlatform } from "./store";

const KEY = "na-usage-notice";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // no storage: do not nag on every start
  }
}

export function useUsageNotice() {
  const settings = useDaemon((c) => c.state?.settings);
  // Shown on the computer itself; phones reach the same setting in Settings.
  const desktop = usePlatform().kind === "desktop";
  const known = settings !== undefined;
  const on = settings?.usage_stats !== false;
  useEffect(() => {
    if (!desktop || !known || !on || seen()) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* ignore */
      }
      toast("NeuralAgent shares anonymous usage statistics: no prompts, code or names.", {
        actionLabel: "Settings",
        undo: () => requestSettingsSection("privacy"),
        duration: 12_000,
      });
    }, 8000);
    return () => window.clearTimeout(t);
  }, [desktop, known, on]);
}
