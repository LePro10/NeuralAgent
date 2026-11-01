import { Callout, Stat } from "@neuralagent/ui";
import type { Stats } from "./api";
import { BarList, Bars, Section, prefixed } from "./charts";
import { countryLabel } from "./countries";
import type { Period } from "./Dashboard";

const LABELS: Record<string, string> = {
  agents_started: "Agents started",
  neural_turns: "Neural turns",
  calls: "Calls",
  call_minutes: "Call minutes",
  teams_started: "Teams started",
  remote_sessions: "Remote sessions",
};

export function Usage({ stats, days }: { stats: Stats; days: Period }) {
  const i = stats.installs;
  const t = stats.totals ?? {};
  if (!i) return <Callout tone="warning" title="No install data">The relay did not return install statistics.</Callout>;
  const features = prefixed(t, "use:").filter((r) => !r.key.startsWith("agent."));
  const clis = prefixed(t, "use:agent.");
  const versions = prefixed(t, "update_from:");
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat value={i.total} label="Known installs" />
        <Stat value={i.active.d1} label="Active (1 d)" />
        <Stat value={i.active.d7} label="Active (7 d)" />
        <Stat value={i.active.d30} label="Active (30 d)" />
        <Stat value={i.new} label={`New (${days} d)`} />
      </div>
      <Bars label="Daily active installs" values={i.daily.map((d) => d.n)} days={i.daily.map((d) => d.day)} />

      <Section title="Active installs, last 30 days">
        <div className="grid items-start gap-2 md:grid-cols-2 lg:grid-cols-3">
          <BarList title="App" rows={i.by_app} />
          <BarList title="Operating system" rows={i.by_os} />
          <BarList title="OS version" rows={i.by_os_version} />
          <BarList title="App version" rows={i.by_version} />
          <BarList title="Country" rows={i.by_country} format={countryLabel} />
          <BarList title="Architecture" rows={i.by_arch} />
          <BarList title="Language" rows={i.by_language} />
        </div>
        {!stats.geoip && <p className="px-1 text-detail text-faint">Countries need the GeoIP table, see ADMIN-HANDBUCH.</p>}
      </Section>

      <Section title={`Feature use, last ${days} days`}>
        <div className="grid items-start gap-2 md:grid-cols-2">
          <div className="card !rounded-list p-4">
            <h3 className="text-body text-bright">Features</h3>
            {features.length === 0 ? (
              <p className="mt-2 text-detail text-dim">No data yet.</p>
            ) : (
              <table className="mt-2 w-full text-detail">
                <tbody>
                  {features.map((r) => (
                    <tr key={r.key} className="border-t border-line first:border-0">
                      <td className="py-1.5 text-ink">{LABELS[r.key] ?? r.key}</td>
                      <td className="tabular py-1.5 text-right text-bright">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <BarList title="Agent starts per CLI" rows={clis} />
          <BarList title="Installed versions (from update checks)" rows={versions} />
        </div>
      </Section>
      <p className="px-1 text-detail text-faint">Anonymous: installs are a random id, no IP, no account. Users can turn this off in Settings → Privacy.</p>
    </div>
  );
}
