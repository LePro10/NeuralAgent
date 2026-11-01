import { Stat } from "@neuralagent/ui";
import type { Stats } from "./api";
import { BarList, DayBars, Section, prefixed } from "./charts";
import { countryLabel } from "./countries";
import type { Period } from "./Dashboard";

export function Downloads({ stats, days }: { stats: Stats; days: Period }) {
  const t = stats.totals ?? {};
  const sum = (p: string) => prefixed(t, p).reduce((a, r) => a + r.n, 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={sum("dl:")} label={`Downloads (${days} d)`} />
        <Stat value={sum("dlclick:")} label="Download clicks" />
        <Stat value={sum("page:")} label="Page views" />
        <Stat value={sum("update_check:")} label="Update checks" />
      </div>

      <Section title="Downloads">
        <DayBars label="Downloads per day" days={stats.days} keys="dl:*" />
        <div className="grid items-start gap-2 md:grid-cols-2 lg:grid-cols-3">
          <BarList title="Per platform" rows={prefixed(t, "dl:")} />
          <BarList title="Per version" rows={prefixed(t, "dl_v:")} />
          <BarList title="Per country" rows={prefixed(t, "dl_cc:")} format={countryLabel} />
          <BarList title="Download clicks on the website" rows={prefixed(t, "dlclick:")} />
          <BarList title="Update checks per platform" rows={prefixed(t, "update_check:")} />
          <BarList title="Update downloads" rows={prefixed(t, "update_dl:")} />
        </div>
      </Section>

      <Section title="Website">
        <DayBars label="Page views per day" days={stats.days} keys="page:*" />
        <div className="grid items-start gap-2 md:grid-cols-2 lg:grid-cols-3">
          <BarList title="Views per page" rows={prefixed(t, "page:")} />
          <BarList title="Visits per country" rows={prefixed(t, "visit_cc:")} format={countryLabel} />
          <BarList title="Top referrers" rows={prefixed(t, "ref:")} />
        </div>
        {!stats.geoip && <p className="px-1 text-detail text-faint">Countries need the GeoIP table, see ADMIN-HANDBUCH.</p>}
      </Section>
      <p className="px-1 text-detail text-faint">Cookieless counts; Do Not Track / GPC visitors are not counted.</p>
    </div>
  );
}
