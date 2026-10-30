import type { TokenCounts, UsageLimit, UsageReport, UsageRow } from "@neuralagent/protocol";
import { BarChart, Callout, Empty, IconButton, List, Meter, Page, Segmented, Skeleton, SkeletonList, cn } from "@neuralagent/ui";
import { Gauge, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { compact, duration, money, totalTokens } from "../lib/format";
import { useClient, useDaemon } from "../lib/store";
import { Glow } from "./Glow";

const RANGES = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];
const ENGINES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
const WINDOWS: Record<string, string> = { "5h": "5-hour", "7d": "Weekly", "7d_opus": "Weekly · Opus", "7d_sonnet": "Weekly · Sonnet" };

const windowLabel = (l: UsageLimit) => WINDOWS[l.window] ?? (l.window_minutes ? duration(l.window_minutes * 60000) : l.window);

function ago(ms: number, now: number): string {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function resets(ms: number | undefined, now: number): string {
  if (!ms) return "";
  const left = ms - now;
  if (left <= 0) return "resetting";
  if (left < 24 * 3600000) return `resets in ${duration(left)}`;
  const d = new Date(ms);
  return `resets ${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

const sumTokens = (rows: UsageRow[]): TokenCounts =>
  rows.reduce(
    (a, r) => ({
      input: a.input + r.tokens.input,
      output: a.output + r.tokens.output,
      cache_read: a.cache_read + r.tokens.cache_read,
      cache_write: a.cache_write + r.tokens.cache_write,
    }),
    { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  );

interface Group {
  key: string;
  label: string;
  cost: number;
  unknown: boolean;
  tokens: number;
}

function group(rows: UsageRow[], keyOf: (r: UsageRow) => string, labelOf: (k: string) => string): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = map.get(k) ?? { key: k, label: labelOf(k), cost: 0, unknown: false, tokens: 0 };
    if (r.cost_usd === undefined || r.cost_usd === null) g.unknown = true;
    else g.cost += r.cost_usd;
    g.tokens += totalTokens(r.tokens);
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
}

/** A cost breakdown: each row with a bar for its share of the most expensive one. */
function Groups({ label, groups, footer }: { label: string; groups: Group[]; footer?: string }) {
  if (groups.length === 0) return null;
  const top = Math.max(...groups.map((g) => g.cost), 0);
  return (
    <List label={label} footer={footer}>
      {groups.map((g) => (
        <div key={g.key} className="px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-body text-bright">{g.label}</span>
            <span className="shrink-0 text-body text-bright tabular">{g.unknown ? (g.cost > 0 ? `${money(g.cost)} + —` : "—") : money(g.cost)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${top > 0 ? Math.max(2, (g.cost / top) * 100) : 0}%` }} />
            </div>
            <span className="shrink-0 text-footnote text-dim tabular">{compact(g.tokens)} tokens</span>
          </div>
        </div>
      ))}
    </List>
  );
}

/** One figure in the grid: a big light number over a short label. */
function Figure({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="surface rounded-list px-3.5 py-3">
      <div className={cn("truncate text-title-2 font-light tabular", tone ?? "text-bright")}>{value}</div>
      <div className="mt-0.5 truncate text-footnote text-dim">{label}</div>
    </div>
  );
}

/** What the agents cost and how full the subscription limits are, from the CLIs' own transcripts. */
export function UsagePage() {
  const client = useClient();
  const limits = useDaemon((c) => c.state?.limits ?? []);
  const workspaces = useDaemon((c) => c.state?.workspaces ?? []);
  const [days, setDays] = useState("7");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (d: string) => {
      setLoading(true);
      setError(null);
      try {
        setReport((await client.req({ m: "usage_report", p: { days: Number(d) } })) as UsageReport);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        setNow(Date.now());
      }
    },
    [client],
  );

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const rows = report?.rows ?? [];
  const tokens = useMemo(() => sumTokens(rows), [rows]);
  const cost = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
  const anyUnknown = rows.some((r) => r.cost_usd === undefined || r.cost_usd === null);
  const calls = rows.reduce((a, r) => a + Number(r.calls), 0);
  const busy = Object.values(report?.busy_ms ?? {}).reduce((a, b) => a + Number(b), 0);

  const byDay = useMemo(() => {
    const n = Number(days);
    const out: { day: string; cost: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ day, cost: rows.filter((r) => r.day === day).reduce((a, r) => a + (r.cost_usd ?? 0), 0) });
    }
    return out;
  }, [rows, days]);

  const byModel = useMemo(() => group(rows, (r) => `${r.engine}/${r.model}`, (k) => k.split("/").slice(1).join("/")), [rows]);
  const byWorkspace = useMemo(
    () => group(rows, (r) => r.workspace_id ?? "", (k) => workspaces.find((w) => w.id === k)?.name ?? "Other folders"),
    [rows, workspaces],
  );

  const engines = [...new Set(limits.map((l) => l.engine))];

  const refresh = (
    <IconButton label="Refresh" variant="ghost" onClick={() => void (loading || load(days))}>
      <RefreshCw className={cn(loading && "animate-spin")} />
    </IconButton>
  );

  return (
    <div className="relative h-full">
      <Glow tint="usage" />
      <Page title="Usage" eyebrow="Costs" actions={refresh} header={<Segmented label="Range" value={days} options={RANGES} onChange={setDays} className="w-full" />}>
        <div className="flex flex-col gap-7 pt-2 pb-8">
          {engines.map((e) => (
              <List key={e} label={`Limits · ${ENGINES[e] ?? e}`}>
                {limits
                  .filter((l) => l.engine === e)
                  .map((l) => (
                    <div key={l.window} className="px-4 py-3">
                      <Meter
                        value={l.used_percent}
                        max={100}
                        warn={0.75}
                        label={windowLabel(l)}
                        detail={`${Math.round(l.used_percent)} %${l.resets_at ? ` · ${resets(l.resets_at, now)}` : ""}`}
                      />
                      <div className="mt-1.5 text-footnote text-faint">Updated {ago(l.updated_at, now)}</div>
                    </div>
                  ))}
              </List>
            ))}
          {error ? (
            <Callout tone="danger" title="Could not read usage">
              {error}
            </Callout>
          ) : !report ? (
            <div className="flex flex-col gap-7" aria-busy="true" aria-label="Reading transcripts">
              <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="surface rounded-list px-3.5 py-3.5">
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="mt-2 h-3 w-24" />
                  </div>
                ))}
              </div>
              <div className="surface rounded-list p-4">
                <Skeleton className="h-7 w-24" />
                <Skeleton className="mt-5 h-32 w-full" />
              </div>
              <SkeletonList rows={3} lead={false} label />
            </div>
          ) : rows.length === 0 ? (
            <Empty Icon={Gauge} title="No usage in this range" detail="Agent runs from Claude Code and Codex on this computer show up here." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-4">
                <Figure value={anyUnknown && cost === 0 ? "—" : money(cost)} label="API price equivalent" tone="text-success" />
                <Figure value={duration(busy)} label="Agent time" />
                <Figure value={compact(calls)} label="Model calls" />
                <Figure value={compact(totalTokens(tokens))} label="Tokens" />
              </div>
              {days !== "1" && (
                <div>
                  <h3 className="mb-1.5 px-4 text-footnote text-dim uppercase tracking-wide">Cost per day</h3>
                  <div className="surface rounded-list px-4 pt-3.5 pb-3">
                    <BarChart
                      values={byDay.map((d) => d.cost)}
                      labels={byDay.map((d, i) => (days === "30" && i % 5 !== 4 && i !== byDay.length - 1 ? "" : d.day.slice(8).replace(/^0/, "")))}
                      title={(i) => new Date(`${byDay[i]?.day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}
                      format={(v) => money(v)}
                      height={140}
                    />
                  </div>
                </div>
              )}
              <List label="Tokens">
                {[
                  ["Input", tokens.input],
                  ["Output", tokens.output],
                  ["Cache read", tokens.cache_read],
                  ["Cache write", tokens.cache_write],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex min-h-row items-center justify-between gap-3 px-4">
                    <span className="text-body text-ink">{k}</span>
                    <span className="text-body text-bright tabular">{compact(v as number)}</span>
                  </div>
                ))}
              </List>
              <Groups label="By model" groups={byModel} />
              <Groups
                label="By workspace"
                groups={byWorkspace}
                footer={`${anyUnknown ? "— means the model's price is unknown, so it is not counted. " : ""}Costs are estimates at API list prices from the CLIs' transcripts on this computer. With a subscription you pay the plan, not these amounts.`}
              />
            </>
          )}

          {engines.length === 0 && <p className="px-4 text-footnote text-dim">Subscription limits show here once Claude Code or Codex report them (subscription plans only).</p>}
        </div>
      </Page>
    </div>
  );
}
