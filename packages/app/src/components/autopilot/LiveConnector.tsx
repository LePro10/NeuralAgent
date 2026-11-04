// Autopilot → Chat: a live card under a message that is about a connector (the pilot started
// building or setting it up). It follows the connector: build progress, the setup form, the test,
// "Connected" with a button to use it as a source, or the way out of a failed build.
import type { Connector, Pilot } from "@neuralagent/protocol";
import { Button, ConfirmSheet, Disclosure, Shimmer, Spinner } from "@neuralagent/ui";
import { Bot, Check, ChevronRight, RotateCcw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { withSource } from "../../lib/autopilot";
import { useOpenAgent } from "../../lib/openAgent";
import { useDaemon, usePlatform } from "../../lib/store";
import { ConnectorWarnings, StatusMark, connectorIcon } from "./bits";
import { ChangeSheet, ConnectionForm, Guide, StoppedCard, TestChecklist, useConnectorForm } from "./ConnectorDetail";
import { useApDo, useApRequest, useConnector } from "./hooks";

export function LiveConnector({ id, pilot, onOpen }: { id: string; pilot: Pilot; onOpen: (id: string) => void }) {
  const c = useConnector(id);
  if (!c) return null;
  return <Card key={c.id} c={c} pilot={pilot} onOpen={() => onOpen(c.id)} />;
}

const STATE_LABEL = { needs_setup: "Needs your login", building: "Building…", running: "Connected", starting: "Starting…", off: "Off", error: "Problem" } as const;

function Card({ c, pilot, onOpen }: { c: Connector; pilot: Pilot; onOpen: () => void }) {
  const run = useApDo();
  const platform = usePlatform();
  const form = useConnectorForm(c);
  const recoverable = useDaemon((x) => x.status === "open" && x.has("connector_recover"));
  const [changing, setChanging] = useState(false);
  const [resetting, setResetting] = useState(false);
  const Icon = connectorIcon(c);
  const building = c.status === "building";
  const stopped = !c.builtin && !building && c.build_stopped;
  const setup = !building && !stopped && c.status === "needs_setup";
  const attached = pilot.playbook.sources.some((s) => s.connector_id === c.id);
  const mine = !c.builtin;

  return (
    <div className="surface flex flex-col gap-3 rounded-list p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-icon-tile shrink-0 place-items-center rounded-tile bg-fill-3 text-ink">
          <Icon className="size-icon-sm" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-headline text-bright">{c.manifest.name}</div>
          <div className="flex items-center gap-1.5 text-footnote text-dim">
            <StatusMark status={c.status} />
            {STATE_LABEL[c.status]}
          </div>
        </div>
        <Button size="xs" variant="quiet" IconEnd={ChevronRight} onClick={onOpen}>
          Open
        </Button>
      </div>

      <ConnectorWarnings c={c} />

      {building && <Building c={c} pilot={pilot} />}

      {stopped && (
        <StoppedCard
          c={c}
          recoverable={recoverable}
          testing={form.testing}
          onCheck={() => void form.test()}
          onChange={() => setChanging(true)}
          onReset={() => setResetting(true)}
          onOpenFolder={platform.revealPath ? () => void platform.revealPath!(c.path) : undefined}
        />
      )}

      {!building && !stopped && c.status === "error" && c.error && <p className="text-subhead break-words text-danger">{c.error}</p>}

      {setup && (
        <>
          <p className="text-subhead text-dim">One more step: connect it to your account.</p>
          {c.manifest.guide.length > 0 && (
            <div className="surface overflow-hidden rounded-list">
              <Disclosure title="How to connect" detail="Step by step">
                <Guide steps={c.manifest.guide} />
              </Disclosure>
            </div>
          )}
          {c.manifest.setup.length > 0 && <ConnectionForm c={c} form={form} compact />}
        </>
      )}

      {(form.testing || form.result) && <TestChecklist testing={form.testing} result={form.result} />}

      {c.status === "running" && !stopped && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-subhead text-success">
            <Check className="size-icon-sm" strokeWidth={2.2} /> Connected
          </span>
          {attached ? (
            <span className="text-footnote text-dim">Used by this autopilot</span>
          ) : (
            <Button size="sm" variant="accent" onClick={() => void run({ op: "pilot_update", id: pilot.id, playbook: withSource(pilot.playbook, c.id) }, "Added as a source")} className="rounded-full">
              Use as source
            </Button>
          )}
        </div>
      )}

      {c.status === "off" && !building && (
        <Button size="sm" variant="ghost" onClick={() => void run({ op: "connector_enable", id: c.id, enabled: true })} className="self-start rounded-full">
          Turn on
        </Button>
      )}

      {mine && (
        <>
          <ChangeSheet open={changing} onClose={() => setChanging(false)} id={c.id} name={c.manifest.name} initial={c.build_stopped ? c.last_request : undefined} />
          <ConfirmSheet
            open={resetting}
            onClose={() => setResetting(false)}
            title="Reset to the template?"
            message="The code goes back to an empty connector. Your settings and secrets stay. What is in the folder now is set aside in a hidden folder, not deleted."
            confirmLabel="Reset"
            destructive
            Icon={RotateCcw}
            onConfirm={async () => {
              await run({ op: "connector_reset", id: c.id }, "Reset to the template");
            }}
          />
        </>
      )}
    </div>
  );
}

/** While an agent builds: the last log line, the agent's pane, stop. */
function Building({ c, pilot }: { c: Connector; pilot: Pilot }) {
  const req = useApRequest();
  const run = useApDo();
  const openAgent = useOpenAgent();
  const alive = useDaemon((x) => (c.build_session ? !!x.state?.sessions[c.build_session]?.alive : false));
  const [line, setLine] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      req<string[]>({ op: "connector_logs", id: c.id }).then(
        (l) => live && Array.isArray(l) && setLine([...l].reverse().find((x) => x.trim()) ?? ""),
        () => {},
      );
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2 text-subhead text-dim">
        <Spinner size={14} className="mt-1 shrink-0" />
        <Shimmer className="min-w-0 break-words">{alive ? "An agent is building this. It tests the connector when it is done." : "The agent has stopped. Checks run now."}</Shimmer>
      </div>
      {line && <p className="line-clamp-2 font-mono text-caption break-words text-dim">{line}</p>}
      <div className="flex flex-wrap gap-2">
        {c.build_session && alive && (
          <Button size="sm" variant="ghost" Icon={Bot} onClick={() => openAgent(c.build_session!)} className="rounded-full">
            Watch the agent
          </Button>
        )}
        {pilot.status === "working" && (
          <Button size="sm" variant="quiet" Icon={Square} onClick={() => void run({ op: "pilot_stop", id: pilot.id })}>
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
