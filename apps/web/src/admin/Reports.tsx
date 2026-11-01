import { Avatar, Button, Callout, ConfirmButton, Empty, Field, List, Pill, Row, SearchField, Segmented, Spinner, TextArea, toast } from "@neuralagent/ui";
import { ArrowLeft, LifeBuoy, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Report, type ReportDetail, type ReportStatus } from "./api";
import { countryTag } from "./countries";
import type { Tab } from "./Dashboard";
import { Diagnostics } from "./Diagnostics";
import { ago, date } from "./format";
import type { Polled } from "./hooks";
import { Devices } from "./Users";

const tone = (s: ReportStatus) => (s === "open" ? "danger" : s === "seen" ? "warning" : "success");
type Filter = "all" | ReportStatus;

function Detail({ id, reload, go }: { id: string; reload: () => Promise<void>; go: (t: Tab, sub?: string) => void }) {
  const [d, setD] = useState<ReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const marked = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setD(null);
    setError(null);
    void (async () => {
      try {
        let r = await api.report(id);
        if (!live) return;
        // Opening an open report marks it as seen.
        if (r.report.status === "open" && marked.current !== id) {
          marked.current = id;
          try {
            const upd = await api.updateReport(id, { status: "seen" });
            r = { ...r, report: { ...r.report, ...upd } };
            void reload();
          } catch {
            /* stays open */
          }
        }
        if (!live) return;
        setD(r);
        setNote(r.report.note ?? "");
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (patch: { status?: ReportStatus; note?: string }, done: string) => {
    setBusy(true);
    try {
      const upd = await api.updateReport(id, patch);
      setD((cur) => (cur ? { ...cur, report: { ...cur.report, ...upd } } : cur));
      toast(done);
      await reload();
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const back = <Button size="sm" variant="glass" Icon={ArrowLeft} onClick={() => go("reports")}>All reports</Button>;
  if (error) return <div className="flex flex-col gap-3">{back}<Callout tone="danger" title="Could not load the report">{error}</Callout></div>;
  if (!d) return <div className="flex flex-col gap-3">{back}<div className="flex justify-center py-10"><Spinner label="Loading report" /></div></div>;
  const r = d.report;
  const subject = encodeURIComponent(`Re: ${r.id}`);
  const meta: [string, string][] = [
    ["App", r.app || "—"],
    ["Version", r.version || "—"],
    ["OS", r.os || "—"],
    ["Country", countryTag(r.country)],
    ["Sent", date(r.created_at)],
    ["Updated", ago(r.updated_at)],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div>{back}</div>
      <div className="card !rounded-list p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-detail text-dim">{r.id}</span>
          <Pill size="sm" tone={tone(r.status)}>{r.status}</Pill>
        </div>
        <h2 className="mt-2 break-words text-headline text-bright">{r.summary || "(no summary)"}</h2>
        {r.details && <p className="mt-2 whitespace-pre-wrap break-words text-body text-ink">{r.details}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-detail sm:grid-cols-3">
          {meta.map(([k, v]) => (
            <div key={k}><dt className="text-dim">{k}</dt><dd className="break-words text-ink">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {r.email ? <Button size="sm" Icon={Mail} href={`mailto:${r.email}?subject=${subject}`}>Reply to {r.email}</Button> : <span className="text-detail text-dim">Anonymous, no contact address.</span>}
        </div>
      </div>

      <div className="card !rounded-list flex flex-col gap-3 p-4">
        <Segmented label="Status" value={r.status} onChange={(s) => void update({ status: s }, `Marked ${s}`)} options={[{ value: "open", label: "Open" }, { value: "seen", label: "Seen" }, { value: "solved", label: "Solved" }]} />
        <Field label="Admin note (private)">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you find, what did you answer?" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" busy={busy} disabled={note === (r.note ?? "")} onClick={() => void update({ note }, "Note saved")}>Save note</Button>
          <ConfirmButton
            size="sm"
            label="Delete report"
            doneLabel="Deleted"
            onConfirm={async () => {
              try {
                await api.deleteReport(r.id);
                await reload();
                go("reports");
              } catch (e) {
                toast((e as Error).message, { tone: "danger" });
              }
            }}
          />
        </div>
      </div>

      {d.account && (
        <div className="card !rounded-list overflow-hidden">
          <Row wrap leading={<Avatar name={d.account.user.name || d.account.user.email} src={d.account.user.avatar ?? undefined} size={32} />} title={d.account.user.name || d.account.user.email} detail={`${d.account.user.email} · ${d.account.user.status} · ${d.account.devices.length} devices`} />
          <Devices userId={d.account.user.id} />
        </div>
      )}

      <div>
        <h3 className="mb-2 px-1 text-footnote uppercase tracking-wide text-dim">Diagnostics</h3>
        <Diagnostics data={r.diagnostics} name={r.id} />
      </div>
    </div>
  );
}

export function Reports({ list, sub, go }: { list: Polled<Report[]>; sub: string; go: (t: Tab, sub?: string) => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  if (sub) return <Detail id={sub} reload={list.reload} go={go} />;
  if (list.error && !list.data) return <Callout tone="danger" title="Could not load reports">{list.error}</Callout>;
  if (!list.data) return <div className="flex justify-center py-10"><Spinner label="Loading reports" /></div>;
  const needle = q.trim().toLowerCase();
  const rows = list.data.filter(
    (r) => (filter === "all" || r.status === filter) && (!needle || [r.id, r.summary, r.details, r.email, r.app, r.version, r.os].some((s) => s?.toLowerCase().includes(needle))),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField className="flex-1" value={q} onChange={setQ} placeholder="Search reports" />
        <div className="min-w-0 overflow-x-auto">
          <Segmented scroll size="sm" label="Status" value={filter} onChange={setFilter} options={[{ value: "open", label: "Open" }, { value: "seen", label: "Seen" }, { value: "solved", label: "Solved" }, { value: "all", label: "All" }]} />
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty Icon={LifeBuoy} title="No reports" detail={filter === "open" ? "Nothing open. Reports sent from the app show up here." : "No reports match."} />
      ) : (
        <List label={`${rows.length} reports`}>
          {rows.map((r) => (
            <Row
              key={r.id}
              wrap
              chevron
              onClick={() => go("reports", r.id)}
              title={<span className="flex flex-wrap items-center gap-1.5"><span className="truncate">{r.summary || "(no summary)"}</span><Pill size="sm" tone={tone(r.status)}>{r.status}</Pill></span>}
              detail={`${r.id} · ${r.email || "anonymous"} · ${r.app ?? "app"} ${r.version ?? ""} · ${r.os ?? ""} · ${countryTag(r.country)} · ${ago(r.created_at)}`}
            />
          ))}
        </List>
      )}
    </div>
  );
}
