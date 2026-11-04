// Which installed agent builds a connector (the same agents the app starts in a pane). Renders
// nothing when only one is installed.
import { InlinePicker } from "@neuralagent/ui";
import { useMemo } from "react";
import { builderAgents } from "../../lib/autopilot";
import { useDaemon } from "../../lib/store";

/** The chosen profile id ("" = the default) and the picker state of a sheet. */
export function useBuilderAgents() {
  const profiles = useDaemon((c) => c.state?.profiles);
  const catalog = useDaemon((c) => c.state?.catalog);
  const def = useDaemon((c) => c.state?.settings.default_profile);
  return useMemo(() => builderAgents(profiles, catalog, def), [profiles, catalog, def]);
}

export function AgentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const agents = useBuilderAgents();
  if (agents.length < 2) return null;
  const current = agents.find((a) => a.id === value) ? value : agents[0]!.id;
  return (
    <InlinePicker
      title="Built by"
      kind="list"
      value={current}
      options={agents.map((a, i) => ({ value: a.id, label: a.name, detail: i === 0 ? "Your default agent" : undefined }))}
      onChange={onChange}
    />
  );
}
