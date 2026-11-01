import { Empty } from "@neuralagent/ui";
import type { ReactNode } from "react";
import type { Count, DayStats } from "./api";

/** Pure CSS bars: height is relative to the largest day; colours come from tokens. */
export function Bars({ label, values, days, className }: { label: string; values: number[]; days: string[]; className?: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className={`card !rounded-list p-4 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-body text-bright">{label}</h3>
        <span className="tabular text-meta text-dim">{total} in {days.length} {days.length === 1 ? "day" : "days"}</span>
      </div>
      <div className="mt-3 flex h-24 items-end gap-px border-b border-line" role="img" aria-label={`${label} per day, total ${total}`}>
        {values.map((v, i) => (
          <div key={days[i]} title={`${days[i]}: ${v}`} className="flex h-full max-w-8 flex-1 items-end">
            <div className="w-full rounded-t-xs bg-accent" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-tiny text-faint">
        <span>{days[0]?.slice(5)}</span>
        <span>{days.at(-1)?.slice(5)}</span>
      </div>
    </div>
  );
}

/** Daily bars for one counter key (or the sum of several) from the `days` rows. */
export function DayBars({ label, days, keys }: { label: string; days: DayStats[]; keys: string | string[] }) {
  // A key ending in `*` matches by prefix ("dl:*" = all downloads).
  const ks = Array.isArray(keys) ? keys : [keys];
  const hit = (k: string) => ks.some((p) => (p.endsWith("*") ? k.startsWith(p.slice(0, -1)) : k === p));
  const values = days.map((d) => Object.entries(d).reduce((a, [k, v]) => (typeof v === "number" && hit(k) ? a + v : a), 0));
  return <Bars label={label} values={values} days={days.map((d) => d.day)} />;
}

/** Horizontal bar list with counts and share. */
export function BarList({ title, rows, format, limit = 8 }: { title: string; rows: Count[]; format?: (key: string) => ReactNode; limit?: number }) {
  const shown = rows.slice(0, limit);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const max = Math.max(1, ...shown.map((r) => r.n));
  return (
    <div className="card !rounded-list p-4">
      <h3 className="text-body text-bright">{title}</h3>
      {shown.length === 0 ? (
        <p className="mt-2 text-detail text-dim">No data yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {shown.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-2 text-detail">
                <span className="min-w-0 truncate text-ink">{format ? format(r.key) : r.key || "—"}</span>
                <span className="tabular shrink-0 text-dim">{r.n} · {total ? Math.round((r.n / total) * 100) : 0}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(r.n / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && <p className="mt-2 text-tiny text-faint">+ {rows.length - limit} more</p>}
    </div>
  );
}

/** Totals whose key starts with `prefix`, sorted desc. */
export function prefixed(totals: Record<string, number>, prefix: string): Count[] {
  return Object.entries(totals)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, n]) => ({ key: k.slice(prefix.length), n }))
    .sort((a, b) => b.n - a.n);
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-footnote uppercase tracking-wide text-dim">{title}</h2>
      {children}
    </section>
  );
}

export const NoData = () => <Empty title="No data yet" detail="Numbers show up here once the app or website reports in." bare />;
