// A change to the playbook the autopilot proposes (or the whole playbook after the setup
// interview): what changes, before and after. Only the user can apply it.
import type { PilotSuggestion } from "@neuralagent/protocol";
import { Button } from "@neuralagent/ui";
import { Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";
import { playbookChanges } from "../../lib/autopilot";
import { useApDo, useAutopilot, useConnectorName } from "./hooks";

export function SuggestionCard({ suggestion }: { suggestion: PilotSuggestion }) {
  const pilot = useAutopilot().pilots.find((p) => p.id === suggestion.pilot_id);
  const name = useConnectorName();
  const run = useApDo();
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);
  const changes = useMemo(() => (pilot ? playbookChanges(pilot.playbook, suggestion.playbook, name) : []), [pilot, suggestion.playbook, name]);
  const decide = async (accept: boolean) => {
    setBusy(accept ? "apply" : "dismiss");
    await run({ op: "suggestion_decide", id: suggestion.id, accept });
    setBusy(null);
  };
  return (
    <section className="flex flex-col gap-3 rounded-list border-hair border-accent/30 bg-accent/[.07] p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-icon-tile shrink-0 place-items-center rounded-tile bg-accent/15 text-accent">
          <Lightbulb className="size-icon-sm" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-headline text-bright">The autopilot suggests a change</h3>
          {suggestion.reason && <p className="mt-0.5 text-subhead text-dim">{suggestion.reason}</p>}
        </div>
      </div>
      {changes.length > 0 && (
        <ul className="flex flex-col gap-3">
          {changes.map((c) => (
            <li key={c.label} className="flex flex-col gap-1.5">
              <div className="text-footnote text-dim uppercase tracking-wide">{c.label}</div>
              <div className="rounded-field bg-fill-2 px-3 py-2 text-footnote break-words whitespace-pre-wrap text-dim line-through decoration-faint">{c.before}</div>
              <div className="rounded-field bg-success/[.1] px-3 py-2 text-footnote break-words whitespace-pre-wrap text-bright">{c.after}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button variant="accent" busy={busy === "apply"} disabled={busy !== null} onClick={() => void decide(true)} className="flex-1">
          Apply
        </Button>
        <Button variant="ghost" busy={busy === "dismiss"} disabled={busy !== null} onClick={() => void decide(false)}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
