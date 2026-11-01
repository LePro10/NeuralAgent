import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import type { ActivityKind } from "./ActivityMark";
import { useInView } from "./hooks";
import { PaneTitle } from "./PaneTitle";

/** Faint column guides (hairlines at 25 / 50 / 75 %). Put inside a `.na-frame`. Desktop only. */
export function Guides() {
  return <div className="na-guides" aria-hidden />;
}

/**
 * A landing section: full-width top rule with crosshair marks at the rails, then a frame with a pane title bar
 * and the body. The title's mark shows the activity vocabulary: `working` while the section is in the reading
 * band, `idle` otherwise (override with `status`).
 *
 *   <Section id="security" path="security/sealed-in-transit" labelledBy="security-h">
 *     <div className="na-head"><h2 id="security-h" className="t-h2">…</h2></div>
 *   </Section>
 *
 * `flush` removes the body padding (full-bleed sticky stages), `tight` halves it, `guides` draws the column guides.
 * `bare` renders no pane title (when the section brings its own bar).
 */
export function Section({ id, path, meta, status, label, labelledBy, tight, flush, guides, bare, as: As = "section", className, bodyClassName, children }: {
  id: string;
  path: string;
  meta?: ReactNode;
  status?: ActivityKind;
  label?: string;
  labelledBy?: string;
  tight?: boolean;
  flush?: boolean;
  guides?: boolean;
  bare?: boolean;
  as?: ElementType;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const active = useInView(ref, { margin: "-38% 0px -58% 0px" });
  // `labelledBy` must point at a real element, or the region has no accessible name. The heading should carry the id itself
  // (<SlotLines id>); if it does not, the section's first h1/h2 takes it, so the landmark is never left unnamed.
  useEffect(() => {
    if (!labelledBy || document.getElementById(labelledBy)) return;
    const h = ref.current?.querySelector("h1, h2");
    if (h && !h.id) h.id = labelledBy;
  }, [labelledBy]);
  const cls = ["na-section", tight && "na-section--tight", flush && "na-section--flush", className].filter(Boolean).join(" ");
  return (
    <As id={id} ref={ref} className={cls} aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : (label ?? path.replace(/\//g, " ").replace(/-/g, " "))}>
      <div className="na-frame">
        {guides && <Guides />}
        {!bare && <PaneTitle status={status ?? (active ? "working" : "idle")} label={path} meta={meta} />}
        <div className={`na-section__body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
      </div>
    </As>
  );
}
