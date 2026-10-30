// The running version and the Update button. Desktop: above the account block at the sidebar's
// foot. Phones: under the account on the More page. State: lib/updates.ts.
//
// When an update is out, the collapsed rail shows a square accent button with the update icon;
// when the rail opens, that same button grows into a pill, icon + "Update", on the sidebar's own
// spring (the icon stays where it is, the pill unrolls to the right). Without an update the
// version is a quiet label that only shows while the sidebar is open.
import { SPRING, cn } from "@neuralagent/ui";
import { AlertTriangle, ArrowUpCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { openUpdateDialog, useUpdates } from "../lib/updates";

/** Collapsed: a square as tall as the pill. Radii: the sidebar item's corner → a full pill. */
const SIZE = 32;
const SQUARE_RADIUS = 10;

/**
 * `open`: the sidebar is expanded (collapsed: only the square icon button). `phone`: the More page
 * version, at touch size; `onOpen` runs before the dialog opens.
 */
export function UpdateBadge({ open = true, phone, onOpen }: { open?: boolean; phone?: boolean; onOpen?: () => void }) {
  const u = useUpdates();
  const reduce = useReducedMotion();
  if (!u.kind || !u.current) return null;
  const web = u.kind === "web";

  if (u.offer) {
    const label = u.installing ? `Updating ${Math.round((u.progress ?? 0) * 100)} %` : "Update";
    const title = web ? "A new version is ready: reload to update" : `NeuralAgent ${u.offer.version} is available`;
    const version = !web && !u.installing ? u.offer.version : null;
    const tint = "absolute inset-0 -z-10 bg-accent/15 shadow-lip ring-1 ring-inset ring-accent/35 transition-colors group-hover:bg-accent/25";
    if (phone) {
      return (
        <button
          type="button"
          onClick={() => (onOpen?.(), openUpdateDialog("offer"))}
          aria-label={title}
          className="pressable group relative isolate inline-flex h-tap shrink-0 items-center gap-2 self-start rounded-full pr-4 pl-3 text-subhead text-accent"
        >
          <span aria-hidden className={tint} style={{ borderRadius: "inherit" }} />
          <ArrowUpCircle className="size-icon-sm shrink-0" strokeWidth={1.9} />
          <span className="whitespace-nowrap">{label}</span>
          {version && <span className="whitespace-nowrap text-footnote text-accent/70">{version}</span>}
        </button>
      );
    }
    return (
      <div className="ml-1.5 mt-2 flex">
        <motion.button
          type="button"
          onClick={() => (onOpen?.(), openUpdateDialog("offer"))}
          aria-label={title}
          title={title}
          initial={false}
          animate={{ width: open ? "auto" : SIZE, borderRadius: open ? SIZE / 2 : SQUARE_RADIUS }}
          transition={reduce ? { duration: 0 } : SPRING.sheet}
          style={{ height: SIZE }}
          className="pressable group relative isolate flex items-center gap-1.5 overflow-hidden pr-3 pl-2 text-chip text-accent"
        >
          <span aria-hidden className={tint} style={{ borderRadius: "inherit" }} />
          <ArrowUpCircle size={16} strokeWidth={1.9} className="shrink-0" />
          <span
            className="flex items-baseline gap-1.5 whitespace-nowrap transition-opacity duration-200"
            style={{ opacity: open ? 1 : 0, transitionDelay: open ? "60ms" : "0ms" }}
          >
            {label}
            {version && <span className="text-meta text-accent/70">{version}</span>}
          </span>
        </motion.button>
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
      title={failed ? "The background service did not switch to this version" : u.build ? `Build ${u.build}` : "What's new in this version"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-item transition-colors",
        phone ? "h-tap shrink-0 self-start px-4 text-footnote" : "mt-1 ml-1.5 h-6 px-2 text-tiny",
        failed ? "text-warning hover:text-bright" : "text-faint hover:text-dim",
      )}
    >
      {failed && <AlertTriangle size={12} strokeWidth={1.8} />}
      <span className="whitespace-nowrap">{text}</span>
    </button>
  );
}
