// Settings → Updates. Desktop: app and background-service versions, the service switch after an
// update, check / install, what's new. Web remote and Android: this page's version, reload when a
// newer build is deployed. State and checks: lib/updates.ts (the same as the sidebar's Update button).
import { Button, List, Meter, Pill, Row } from "@neuralagent/ui";
import { ArrowUpCircle, ExternalLink, RefreshCw, ScrollText } from "lucide-react";
import { usePlatform } from "../lib/store";
import { applyUpdate, checkNow, openUpdateDialog, useUpdates } from "../lib/updates";
import { CHANGELOG_URL } from "./ReleaseNotes";

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function CheckRow() {
  const u = useUpdates();
  const web = u.kind === "web";
  if (u.offer) {
    return (
      <Row
        Icon={ArrowUpCircle}
        title={web ? "A newer version of this page is ready" : `Version ${u.offer.version} is available`}
        detail={web ? "Reloading loads it; agents keep running." : "Agents keep running while the app updates."}
        trailing={
          u.installing ? (
            <Meter value={u.progress ?? 0} size="sm" variant="mono" className="w-24" label={(u.progress ?? 0) >= 1 ? "Restarting" : `${Math.round((u.progress ?? 0) * 100)} %`} />
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => openUpdateDialog("offer")}>
                What's new
              </Button>
              <Button size="sm" variant="tint" onClick={() => void applyUpdate()}>
                {web ? "Reload" : "Install"}
              </Button>
            </div>
          )
        }
      />
    );
  }
  return (
    <Row
      Icon={RefreshCw}
      title={u.checkedAt && !u.error ? "Up to date" : "Check for updates"}
      detail={u.error ? `Could not check: ${u.error}` : u.checkedAt ? `Checked at ${time(u.checkedAt)}; checks again by itself every few minutes.` : "Checks by itself a few seconds after start and every few minutes."}
      trailing={
        <Button size="sm" variant="tint" busy={u.checking} onClick={() => void checkNow()}>
          Check
        </Button>
      }
    />
  );
}

function NotesRows() {
  const platform = usePlatform();
  const u = useUpdates();
  return (
    <>
      <Row Icon={ScrollText} title={`What's new in ${u.current}`} onClick={() => openUpdateDialog("current")} />
      <Row Icon={ExternalLink} title="Full changelog" detail="agent.neuralhub.dev/changelog" onClick={() => platform.openExternal(CHANGELOG_URL)} />
    </>
  );
}

/** Desktop: the app updates itself (Tauri updater); the service follows once no agent runs. */
export function LocalUpdates() {
  const platform = usePlatform();
  const u = useUpdates();
  const svc = u.service;
  const behind = !!svc?.version && !!u.current && svc.version !== u.current;
  const status = !svc?.version ? null : svc.error ? (
    <Pill tone="danger">Switch failed</Pill>
  ) : svc.switching ? (
    <Pill tone="accent">Switching…</Pill>
  ) : behind ? (
    <Pill tone="warning">Switches when agents are idle</Pill>
  ) : (
    <Pill tone="success">Current</Pill>
  );
  return (
    <List
      label="Updates"
      footer={
        behind
          ? `The background service still runs ${svc!.version}. It keeps your agents running and switches to ${u.current} by itself as soon as no agent or terminal is running.`
          : "Installing an update restarts the app window only: the background service and every agent keep running."
      }
    >
      <Row title="App" trailing={<span className="text-small text-dim">{u.current || "…"}</span>} />
      <Row
        title="Background service"
        detail={svc?.error ?? undefined}
        trailing={
          <div className="flex items-center gap-2">
            <span className="text-small text-dim">{svc?.version || "…"}</span>
            {status}
            {svc?.error && (
              <Button size="sm" variant="ghost" busy={svc.switching} onClick={() => platform.updates?.service?.retry()}>
                Retry
              </Button>
            )}
          </div>
        }
        wrap
      />
      <CheckRow />
      <NotesRows />
    </List>
  );
}

/** Web remote / Android: the page's own version (the host's updates are in HostUpdates). */
export function WebVersion() {
  const u = useUpdates();
  if (u.kind !== "web") return null;
  return (
    <List label="NeuralAgent on this device" footer="This page comes from agent.neuralhub.dev; a newer version is offered here and in the More menu as soon as it is out.">
      <Row title="Version" trailing={<span className="text-small text-dim" title={u.build ?? undefined}>{u.current}</span>} />
      <CheckRow />
      <NotesRows />
    </List>
  );
}
