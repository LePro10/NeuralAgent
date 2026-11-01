import { Callout, Empty, Pill, SearchField, Spinner } from "@neuralagent/ui";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { api } from "./api";
import { ago, date } from "./format";
import { usePolled } from "./hooks";

export function Activity() {
  const { data, error } = usePolled(() => api.audit(), 30_000);
  const [q, setQ] = useState("");
  if (error && !data) return <Callout tone="danger" title="Could not load the activity log">{error}</Callout>;
  if (!data) return <div className="flex justify-center py-10"><Spinner label="Loading activity" /></div>;
  const needle = q.trim().toLowerCase();
  const rows = needle ? data.filter((a) => [a.actor, a.action, a.target, a.detail].some((s) => s?.toLowerCase().includes(needle))) : data;
  return (
    <div className="flex flex-col gap-3">
      <SearchField value={q} onChange={setQ} placeholder="Filter activity" />
      {rows.length === 0 ? (
        <Empty Icon={ScrollText} title="Nothing here" detail="Admin actions are logged here." />
      ) : (
        <div className="surface list-rows overflow-hidden rounded-list">
          {rows.map((a, i) => (
            <div key={`${a.at}-${i}`} className="flex flex-col gap-1 px-3.5 py-3 sm:grid sm:grid-cols-4 sm:items-baseline sm:gap-4">
              <span className="text-detail text-dim" title={date(a.at)}>{ago(a.at)} · {date(a.at)}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-detail">
                <Pill size="sm">{a.action}</Pill>
                <span className="truncate text-dim">{a.actor}</span>
              </span>
              <span className="min-w-0 break-words text-detail text-ink sm:col-span-2">{[a.target, a.detail].filter(Boolean).join(" · ") || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
