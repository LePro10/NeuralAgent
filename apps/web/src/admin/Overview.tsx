import { Empty, List, Pill, Row, Stat } from "@neuralagent/ui";
import { CheckCircle2, Inbox, LifeBuoy } from "lucide-react";
import type { Report, Stats, User } from "./api";
import { Bars, DayBars, Section } from "./charts";
import type { Period, Tab } from "./Dashboard";
import { ago } from "./format";

const sumPrefix = (t: Record<string, number>, p: string) =>
  Object.entries(t).reduce((a, [k, n]) => (k.startsWith(p) ? a + n : a), 0);

export function Overview({ stats, days, users, reports, go }: { stats: Stats; days: Period; users: User[]; reports: Report[]; go: (t: Tab, sub?: string) => void }) {
  const t = stats.totals ?? {};
  const pending = users.filter((u) => u.status === "pending");
  const open = reports.filter((r) => r.status === "open");
  const ins = stats.installs;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={ins?.active.d7 ?? 0} label="Active installs (7 d)" />
        <Stat value={ins?.active.d30 ?? 0} label="Active installs (30 d)" />
        <Stat value={stats.users} label="Approved users" />
        <Stat value={stats.pending} label="Pending requests" />
        <Stat value={stats.open_reports} label="Open reports" />
        <Stat value={stats.online} label="Online connections" />
        <Stat value={sumPrefix(t, "dl:")} label={`Downloads (${days} d)`} />
        <Stat value={sumPrefix(t, "page:")} label={`Page views (${days} d)`} />
      </div>

      <Section title="Needs attention">
        {pending.length + open.length === 0 ? (
          <Empty Icon={CheckCircle2} title="All clear" detail="No pending requests and no open reports." bare />
        ) : (
          <List>
            {pending.map((u) => (
              <Row key={u.id} Icon={Inbox} title={u.name || u.email} detail={`Access request · ${u.email} · ${ago(u.created_at)}`} chevron onClick={() => go("requests")} trailing={<Pill size="sm" tone="warning">pending</Pill>} />
            ))}
            {open.map((r) => (
              <Row key={r.id} Icon={LifeBuoy} title={r.summary || r.id} detail={`${r.id} · ${r.app ?? "app"} ${r.version ?? ""} · ${ago(r.created_at)}`} chevron onClick={() => go("reports", r.id)} trailing={<Pill size="sm" tone="danger">open</Pill>} />
            ))}
          </List>
        )}
      </Section>

      <Section title={`Last ${days} days`}>
        <div className="grid gap-2 md:grid-cols-3">
          <Bars label="Active installs" values={(ins?.daily ?? []).map((d) => d.n)} days={(ins?.daily ?? []).map((d) => d.day)} />
          <DayBars label="Downloads" days={stats.days} keys="dl:*" />
          <DayBars label="Sign-ins" days={stats.days} keys="signins" />
        </div>
      </Section>
    </div>
  );
}
