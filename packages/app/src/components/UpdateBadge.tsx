// The running version and the Update button. Desktop: above the account block at the sidebar's
// foot. Phones: under the account on the More page. State: lib/updates.ts.
//
// When an update is out, the collapsed rail shows a square button filled with the accent; when the
// rail opens, it unrolls to the right into a pill, icon + "Update". The button always has its
// full width and only a clip-path animates (no layout per frame, so it stays smooth while the
// sidebar itself springs open). Without an update the version is a quiet label that only shows
// while the sidebar is open.
import { cn } from "@neuralagent/ui";
import { AlertTriangle, ArrowDownToLine } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { openUpdateDialog, useUpdates } from "../lib/updates";

/** Collapsed: a square as tall as the pill. Radii: the sidebar item's corner → a full pill. */
const SIZE = 32;
const SQUARE_RADIUS = 10;
/**
 * Left offset in the sidebar's content box (43 px wide: the 60 px rail minus padding and its hairline
 * rim) that puts the 32 px square's centre on the rail's centre, where the nav icons sit. The quiet
 * version label (no update) starts 1 px further left, so its text lines up with the icons' left edge.
 */
const RAIL_INSET = 5.5;
/** Everything in the open pill besides its label: padding 8 + icon 16 + gap 6 + padding 12. */
const PILL_CHROME = 42;

/**
 * `open`: the sidebar is expanded (collapsed: only the square icon button). `phone`: the More page
 * version, at touch size; `onOpen` runs before the dialog opens.
 */
export function UpdateBadge({ open = true, phone, onOpen }: { open?: boolean; phone?: boolean; onOpen?: () => void }) {
  const u = useUpdates();
  const reduce = useReducedMotion();
  // The pill's open width, measured from its label: "auto" would be measured inside the still
  // narrow rail and jump at the end, so the morph animates between two real numbers instead.
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  const measurable = !!labelRef.current;
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLabelWidth(el.offsetWidth));
    ro.observe(el);
    setLabelWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, [measurable]);
  if (!u.kind || !u.current) return null;
  const web = u.kind === "web";

  if (u.offer) {
    const label = u.installing ? `Updating ${Math.round((u.progress ?? 0) * 100)} %` : "Update";
    const title = web ? "A new version is ready: reload to update" : `NeuralAgent ${u.offer.version} is available`;
    const version = !web && !u.installing ? u.offer.version : null;
    const fill = "absolute inset-0 -z-10 bg-accent-deep shadow-lip transition group-hover:brightness-110";
    if (phone) {
      return (
        <button
          type="button"
          onClick={() => (onOpen?.(), openUpdateDialog("offer"))}
          aria-label={title}
          className="pressable group relative isolate inline-flex h-tap shrink-0 items-center gap-2 self-start rounded-full pr-4 pl-3 text-subhead text-on-color"
        >
          <span aria-hidden className={fill} style={{ borderRadius: "inherit" }} />
          <ArrowDownToLine className="size-icon-sm shrink-0" strokeWidth={2} />
          <span className="whitespace-nowrap">{label}</span>
          {version && <span className="whitespace-nowrap text-footnote text-on-color/75">{version}</span>}
        </button>
      );
    }
    return (
      // Collapsed, the square's centre sits on the rail's centre line, like the icons above it.
      <div className="mt-2 flex" style={{ marginLeft: RAIL_INSET }}>
        <button
          type="button"
          onClick={() => (onOpen?.(), openUpdateDialog("offer"))}
          aria-label={title}
          title={title}
          tabIndex={open ? 0 : -1}
          style={{
            height: SIZE,
            width: labelWidth ? labelWidth + PILL_CHROME : SIZE,
            // Collapsed: only the left square shows; open: the whole pill. Same curve and length
            // as the sidebar's spring, so the pill unrolls with the island.
            clipPath: open ? `inset(0 0 0 0 round ${SIZE / 2}px)` : `inset(0 calc(100% - ${SIZE}px) 0 0 round ${SQUARE_RADIUS}px)`,
            transition: reduce ? "none" : "clip-path 420ms cubic-bezier(0.32, 0.72, 0, 1)",
          }}
          className="pressable group relative isolate flex shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2 text-chip text-on-color"
        >
          <span aria-hidden className={fill} />
          <ArrowDownToLine size={16} strokeWidth={2} className="shrink-0" />
          <span
            ref={labelRef}
            className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap transition-opacity duration-200"
            style={{ opacity: open ? 1 : 0, transitionDelay: open ? "80ms" : "0ms" }}
          >
            {label}
            {version && <span className="text-meta text-on-color/75">{version}</span>}
          </span>
        </button>
      </div>
    );
  }

  if (!open) return null;
  const failed = !!u.service?.error;
  const text = web ? `NeuralAgent ${u.current} · web` : `NeuralAgent ${u.current}`;
  return (
    <button
      type="button"
      onClick={() => (onOpen?.(), openUpdateDialog("current"))}
      style={phone ? undefined : { marginLeft: RAIL_INSET - 1 }}
      title={failed ? "The background service did not switch to this version" : u.build ? `Build ${u.build}` : "What's new in this version"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-item transition-colors",
        phone ? "h-tap shrink-0 self-start px-4 text-footnote" : "mt-1 h-6 px-2 text-tiny",
        failed ? "text-warning hover:text-bright" : "text-faint hover:text-dim",
      )}
    >
      {failed && <AlertTriangle size={12} strokeWidth={1.8} />}
      <span className="whitespace-nowrap">{text}</span>
    </button>
  );
}
