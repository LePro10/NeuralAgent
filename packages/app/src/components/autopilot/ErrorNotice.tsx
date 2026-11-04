// Autopilot: a pilot error in words. The raw daemon text hides behind "Details"; when a connector
// is probably to blame, the notice links to it.
import type { Pilot } from "@neuralagent/protocol";
import { Button } from "@neuralagent/ui";
import { OctagonAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { friendlyError } from "../../lib/autopilot";
import { useAutopilot } from "./hooks";

export function ErrorNotice({ pilot, onOpenConnector }: { pilot: Pilot; onOpenConnector: (id: string) => void }) {
  const { connectors } = useAutopilot();
  const [details, setDetails] = useState(false);
  const err = useMemo(() => friendlyError(pilot.activity ?? "", connectors), [pilot.activity, connectors]);
  const blamed = connectors.find((c) => c.id === err.connectorId);
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-field bg-danger/[.1] px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <OctagonAlert className="mt-0.5 size-icon-sm shrink-0 text-danger" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-subhead font-medium text-bright">{err.title}</p>
          <p className="text-footnote text-dim">{err.hint}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        {blamed && (
          <Button size="xs" variant="accent" onClick={() => onOpenConnector(blamed.id)}>
            Open {blamed.manifest.name}
          </Button>
        )}
        <Button size="xs" variant="quiet" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          {details ? "Hide details" : "Details"}
        </Button>
      </div>
      {details && <pre className="selectable ml-6 max-h-40 overflow-auto font-mono text-caption break-words whitespace-pre-wrap text-dim">{err.raw}</pre>}
    </div>
  );
}
