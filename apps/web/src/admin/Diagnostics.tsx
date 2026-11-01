import { Button, toast } from "@neuralagent/ui";
import { Copy, Download } from "lucide-react";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[unprintable]";
    }
  }
  return String(v);
}

function Rows({ obj }: { obj: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-detail">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="col-span-1 truncate text-dim" title={k}>{k}</dt>
          <dd className="col-span-2 min-w-0 break-words text-ink">{isObj(v) ? <Rows obj={v} /> : scalar(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Value({ v }: { v: unknown }) {
  if (Array.isArray(v)) {
    if (v.length === 0) return <p className="text-detail text-faint">Empty.</p>;
    if (v.every((x) => typeof x === "string")) {
      return <pre className="max-h-72 overflow-auto rounded-field bg-fill-2 p-3 font-mono text-tiny text-ink">{(v as string[]).join("\n")}</pre>;
    }
    return (
      <ul className="flex flex-col gap-1">
        {v.map((x, i) => (
          <li key={i} className="rounded-field bg-fill-2 px-2.5 py-1.5 text-detail text-ink">
            {isObj(x) ? (
              <span className="break-words">{Object.entries(x).map(([k, val]) => `${k}: ${scalar(val)}`).join(" · ")}</span>
            ) : (
              scalar(x)
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (isObj(v)) return Object.keys(v).length ? <Rows obj={v} /> : <p className="text-detail text-faint">Empty.</p>;
  return <p className="text-detail text-ink">{scalar(v)}</p>;
}

/** Generic viewer: one section per top-level key, plus copy and download. */
export function Diagnostics({ data, name }: { data: unknown; name: string }) {
  const json = (() => {
    try {
      return JSON.stringify(data, null, 2) ?? "null";
    } catch {
      return "null";
    }
  })();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast("Copied");
    } catch {
      toast("Copy failed", { tone: "danger" });
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (data === null || data === undefined) return <p className="text-detail text-dim">No diagnostics attached.</p>;
  const sections = isObj(data) ? Object.entries(data) : [["data", data] as [string, unknown]];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button size="sm" variant="glass" Icon={Copy} onClick={() => void copy()}>Copy JSON</Button>
        <Button size="sm" variant="glass" Icon={Download} onClick={download}>Download JSON</Button>
      </div>
      {sections.map(([k, v]) => (
        <section key={k} className="card !rounded-list p-4">
          <h4 className="mb-2 text-footnote uppercase tracking-wide text-dim">{k}</h4>
          <Value v={v} />
        </section>
      ))}
    </div>
  );
}
