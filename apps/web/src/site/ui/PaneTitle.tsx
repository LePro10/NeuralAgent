import type { ReactNode } from "react";
import { ActivityMark, type ActivityKind } from "./ActivityMark";

/**
 * Pane title bar: a status mark and a short path-like label in mono, e.g. `agents/side-by-side`
 * (the last segment is bright). Never a pill, never an eyebrow above a heading: it IS the section's top bar.
 * `meta` sits at the right edge (a version, a key hint).
 */
export function PaneTitle({ status = "idle", label, meta, sticky, className }: { status?: ActivityKind; label: string; meta?: ReactNode; sticky?: boolean; className?: string }) {
  const parts = label.split("/");
  const last = parts.pop();
  return (
    <div className={`na-pane-title${sticky ? " na-pane-title--sticky" : ""}${className ? ` ${className}` : ""}`}>
      <ActivityMark kind={status} />
      <span className="na-pane-title__path">
        {parts.map((p, i) => (
          <span key={i}>{p}<span className="na-pane-title__sep">/</span></span>
        ))}
        <b>{last}</b>
      </span>
      {meta != null && <span className="na-pane-title__meta">{meta}</span>}
    </div>
  );
}
