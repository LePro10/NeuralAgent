import { toast } from "@neuralagent/ui";
import { useEffect } from "react";
import { checkHostUpdate, installHostUpdate, watchHostUpdate } from "../lib/host";
import { useClient, useDaemon } from "../lib/store";

const DAY = "na.hostVersion";
const EVERY = 6 * 60 * 60 * 1000;

/**
 * Remote clients: offers "update available on <host>" (once per version), follows an install, and
 * reloads this page when the host's service switches to a new version, so the page and the host
 * always match (the web bundle itself comes fresh from the relay).
 */
export function HostUpdateWatcher() {
  const client = useClient();
  const hostName = useDaemon((c) => c.host?.name ?? "the host");

  // The service on the host changed (update finished, host restarted with a new version): reload.
  useEffect(() => {
    let known = client.daemonVersion;
    try {
      const was = sessionStorage.getItem(DAY);
      sessionStorage.removeItem(DAY);
      if (was && known && was !== known) toast(`${hostName} now runs NeuralAgent ${known}`, { tone: "success" });
    } catch {
      /* no storage */
    }
    return client.onHello((v) => {
      if (known && v !== known) {
        try {
          sessionStorage.setItem(DAY, known);
        } catch {
          /* no storage */
        }
        location.reload();
      }
      known = v;
    });
  }, [client, hostName]);

  // Look for a new app version now and every six hours; offer each version once.
  useEffect(() => {
    const offered = new Set<string>();
    const look = async () => {
      const info = await checkHostUpdate(client);
      const v = info?.available;
      if (!info || !v || offered.has(v)) return;
      offered.add(v);
      toast(`NeuralAgent ${v} is available on ${hostName}`, {
        actionLabel: info.app_running ? "Install" : undefined,
        undo: info.app_running ? () => void installHostUpdate(client) : undefined,
        duration: 20000,
      });
    };
    const first = setTimeout(() => void look(), 5000);
    const timer = setInterval(() => void look(), EVERY);
    const off = watchHostUpdate(client);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      off();
    };
  }, [client, hostName]);

  return null;
}
