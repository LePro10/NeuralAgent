import { Callout, Spinner, Stat } from "@neuralagent/ui";
import { api, type DayStats } from "./api";
import { usePolled } from "./hooks";

const METRICS: { key: keyof Omit<DayStats, "day">; label: string }[] = [
  { key: "signins", label: "Sign-ins" },
  { key: "connections", label: "Connections" },
  { key: "pairings", label: "Pairings" },
  { key: "requests", label: "Access requests" },
  { key: "active_devices", label: "Active devices" },
];

/** Pure CSS bars: height is relative to the largest day; colours come from tokens. */
function Bars({ label, days, metric }: { label: string; days: DayStats[]; metric: keyof Omit<DayStats, "day"> }) {
  const values = days.map((d) => d[metric] ?? 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="card !rounded-list p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-body text-bright">{label}</h3>
        <span className="tabular text-meta text-dim">{total} in {days.length} days</span>
      </div>
      <div className="mt-3 flex h-24 items-end gap-px" role="img" aria-label={`${label} per day, total ${total}`}>
        {days.map((d, i) => (
          <div key={d.day} title={`${d.day}: ${values[i]}`} className="flex h-full flex-1 items-end">
            <div className="w-full rounded-t-xs bg-accent" style={{ height: `${(values[i]! / max) * 100}%`, minHeight: values[i] ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-tiny text-faint">
        <span>{days[0]?.day.slice(5)}</span>
        <span>{days.at(-1)?.day.slice(5)}</span>
      </div>
    </div>
  );
}

export function Stats() {
  const { data, error } = usePolled(() => api.stats(30), 30_000);
  if (error && !data) return <Callout tone="danger" title="Could not load stats">{error}</Callout>;
  if (!data) return <div className="flex justify-center py-10"><Spinner label="Loading stats" /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={data.users} label="Approved users" />
        <Stat value={data.pending} label="Pending" />
        <Stat value={data.devices} label="Devices" />
        <Stat value={data.online} label="Online now" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {METRICS.map((m) => (
          <Bars key={m.key} label={m.label} days={data.days} metric={m.key} />
        ))}
      </div>
      <p className="px-1 text-detail text-faint">Anonymous daily counters only, never tied to a person.</p>
    </div>
  );
}
