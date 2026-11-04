import { Avatar, Button, Callout, Segmented, Spinner } from "@neuralagent/ui";
import { LogOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "../brand";
import { Activity } from "./Activity";
import { ApiKeys } from "./ApiKeys";
import { api, type Session } from "./api";
import { Downloads } from "./Downloads";
import { usePolled } from "./hooks";
import { Overview } from "./Overview";
import { Reports } from "./Reports";
import { Requests } from "./Requests";
import { Usage } from "./Usage";
import { Users } from "./Users";

export type Tab = "overview" | "requests" | "users" | "reports" | "usage" | "downloads" | "activity" | "keys";
const TABS: Tab[] = ["overview", "requests", "users", "reports", "usage", "downloads", "activity", "keys"];
export type Period = 7 | 30 | 90;

/** `#reports/R-ABC123` -> tab + sub path. */
function parseHash(): { tab: Tab; sub: string } {
  const [t = "", ...rest] = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/");
  return { tab: (TABS as string[]).includes(t) ? (t as Tab) : "overview", sub: rest.join("/") };
}

export function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [route, setRoute] = useState(parseHash);
  const [days, setDays] = useState<Period>(30);
  const users = usePolled(() => api.users(), 10_000);
  const stats = usePolled(() => api.stats(days), 30_000);
  const reports = usePolled(() => api.reports(), 20_000);
  const me = session.user;

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => void stats.reload(), [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((tab: Tab, sub = "") => {
    location.hash = sub ? `${tab}/${encodeURIComponent(sub)}` : tab;
  }, []);

  const pending = users.data?.filter((u) => u.status === "pending").length ?? 0;
  const open = reports.data?.filter((r) => r.status === "open").length ?? stats.data?.open_reports ?? 0;
  const badge = (label: string, n: number) => (n > 0 ? `${label} ${n}` : label);
  const { tab, sub } = route;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-4 pb-12">
      <header className="flex items-center justify-between gap-3 py-5">
        <Brand />
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-detail text-dim sm:flex">
            <Avatar name={me.name || me.email} src={me.avatar ?? undefined} size={24} />
            {me.name || me.email}
          </span>
          <Button size="sm" variant="glass" Icon={LogOut} onClick={onSignOut}>Sign out</Button>
        </div>
      </header>

      <div className="min-w-0 overflow-x-auto">
        <Segmented
          scroll
          label="Section"
          value={tab}
          onChange={(t) => go(t)}
          options={[
            { value: "overview", label: "Overview" },
            { value: "requests", label: badge("Requests", pending) },
            { value: "users", label: "Users" },
            { value: "reports", label: badge("Reports", open) },
            { value: "usage", label: "Usage" },
            { value: "downloads", label: "Downloads & Website" },
            { value: "activity", label: "Activity" },
            { value: "keys", label: "API keys" },
          ]}
        />
      </div>

      {(tab === "overview" || tab === "usage" || tab === "downloads") && (
        <div className="flex items-center justify-between gap-3">
          <Segmented size="sm" label="Period" value={String(days) as "7" | "30" | "90"} onChange={(v) => setDays(Number(v) as Period)} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
          {stats.error && stats.data && <span className="text-detail text-danger">Refresh failed</span>}
        </div>
      )}
      {(tab === "usage" || tab === "downloads" || tab === "overview") && stats.error && !stats.data && (
        <Callout tone="danger" title="Could not load stats">{stats.error}</Callout>
      )}
      {(tab === "usage" || tab === "downloads" || tab === "overview") && !stats.data && !stats.error && (
        <div className="flex justify-center py-10"><Spinner label="Loading stats" /></div>
      )}

      {tab === "overview" && stats.data && <Overview stats={stats.data} days={days} users={users.data ?? []} reports={reports.data ?? []} go={go} />}
      {tab === "requests" && <Requests users={users} />}
      {tab === "users" && <Users users={users} reports={reports.data ?? []} me={me.id} go={go} />}
      {tab === "reports" && <Reports list={reports} sub={sub} go={go} />}
      {tab === "usage" && stats.data && <Usage stats={stats.data} days={days} />}
      {tab === "downloads" && stats.data && <Downloads stats={stats.data} days={days} />}
      {tab === "activity" && <Activity />}
      {tab === "keys" && <ApiKeys />}
    </div>
  );
}
