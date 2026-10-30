// "NeuralAgent X is available": what changed since this version and Install now / Later (desktop),
// Reload (web remote, Android shell). Also "What's new" for the running version. State: lib/updates.ts.
import { Button, Callout, Meter, Sheet } from "@neuralagent/ui";
import { ArrowDownToLine, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChangelogEntry } from "../lib/platform";
import { usePlatform } from "../lib/store";
import { applyUpdate, checkNow, closeUpdateDialog, loadChangelog, notesFor, useUpdates } from "../lib/updates";
import { CHANGELOG_URL, ReleaseNotes } from "./ReleaseNotes";

/** Notes for the dialog: the versions between this one and the offer, or this version's own. */
function useDialogNotes(): ChangelogEntry[] | null {
  const { dialog, offer, current } = useUpdates();
  const [notes, setNotes] = useState<ChangelogEntry[] | null>(null);
  useEffect(() => {
    if (!dialog) return;
    let live = true;
    setNotes(null);
    const load =
      dialog === "offer" && offer
        ? notesFor(current, offer.version, offer.notes)
        : loadChangelog().then((all) => all.filter((e) => e.version === current));
    void load.then((n) => live && setNotes(n));
    return () => {
      live = false;
    };
  }, [dialog, offer, current]);
  return notes;
}

export function UpdateDialog() {
  const platform = usePlatform();
  const u = useUpdates();
  const notes = useDialogNotes();
  const web = u.kind === "web";
  const offer = u.dialog === "offer" ? u.offer : null;
  const sameVersion = !!offer && offer.version === u.current;
  const svc = u.service;
  const serviceBehind = !!svc?.version && !!u.current && svc.version !== u.current;

  const title = offer
    ? sameVersion
      ? "A new version is ready"
      : `NeuralAgent ${offer.version} is available`
    : `What's new in ${u.current || "NeuralAgent"}`;

  const actions = offer ? (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={closeUpdateDialog} className="flex-1">
        Later
      </Button>
      {u.installing ? (
        <Meter value={u.progress ?? 0} size="sm" className="flex-1" label={(u.progress ?? 0) >= 1 ? "Restarting…" : `Downloading ${Math.round((u.progress ?? 0) * 100)} %`} />
      ) : (
        <Button Icon={web ? RefreshCw : ArrowDownToLine} onClick={() => void applyUpdate()} className="flex-1">
          {web ? "Reload now" : "Install now"}
        </Button>
      )}
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <Button variant="ghost" Icon={ExternalLink} onClick={() => platform.openExternal(CHANGELOG_URL)} className="flex-1">
        Full changelog
      </Button>
      <Button variant="ghost" Icon={RefreshCw} busy={u.checking} onClick={() => void checkNow()} className="flex-1">
        Check for updates
      </Button>
    </div>
  );

  return (
    <Sheet open={!!u.dialog} onClose={closeUpdateDialog} desktop="dialog" size="md" eyebrow={offer ? "Update" : "NeuralAgent"} title={title} footer={actions}>
      <div className="flex flex-col gap-5 pb-1">
        <p className="text-small text-dim">
          {offer
            ? sameVersion
              ? `Improvements to the web app since this page was loaded (version ${u.current}).`
              : `You have ${u.current || "an older version"}. ${notes && notes.length > 1 ? `Changes in the ${notes.length} versions since then:` : "What changes:"}`
            : u.offer
              ? `Version ${u.offer.version} is available.`
              : u.checkedAt && !u.error
                ? "You have the newest version."
                : "Release notes for the version you are running."}
        </p>

        {/* What changes comes right under its heading line; the reassurance follows. */}
        {!(sameVersion && notes?.length === 0) && <ReleaseNotes entries={notes} heading={!!offer || (notes?.length ?? 0) > 1} />}
        {offer && !web && (
          <Callout title="Your agents keep running">
            Installing restarts only the app window (a few seconds). The background service keeps every agent and terminal running and
            moves to the new version by itself once none is running.
          </Callout>
        )}
        {offer && web && (
          <Callout title="Nothing is interrupted">
            Reloading loads the new version of this page. Your agents run on your computer and keep running.
          </Callout>
        )}

        {!offer && serviceBehind && svc && (
          <Callout
            tone={svc.error ? "danger" : "neutral"}
            title={svc.error ? "The background service did not switch" : `The background service still runs ${svc.version}`}
            action={
              svc.error ? (
                <Button size="sm" variant="ghost" busy={svc.switching} onClick={() => platform.updates?.service?.retry()}>
                  Retry
                </Button>
              ) : undefined
            }
          >
            {svc.error ?? "It switches to this version by itself as soon as no agent or terminal is running."}
          </Callout>
        )}
        {u.error && u.installing === false && offer && <p className="text-small text-danger">Last attempt failed: {u.error}</p>}
      </div>
    </Sheet>
  );
}
