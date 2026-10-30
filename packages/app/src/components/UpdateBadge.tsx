// The running version, small, above the account row (desktop sidebar foot; phones: next to the
// account in the More sheet). When an update is out it becomes a calm accent "Update" pill with a
// still halo, which opens the update dialog. State: lib/updates.ts.
import { cn } from "@neuralagent/ui";
import { AlertTriangle, ArrowUpCircle } from "lucide-react";
import { openUpdateDialog, useUpdates } from "../lib/updates";

/**
 * `open`: the sidebar is expanded (collapsed: only the pill's icon). `phone`: compact, for the More
 * sheet header; `onOpen` closes that sheet before the dialog opens.
 */
export function UpdateBadge({ open = true, phone, onOpen }: { open?: boolean; phone?: boolean; onOpen?: () => void }) {
  const u = useUpdates();
  if (!u.kind || !u.current) return null;
  const web = u.kind === "web";

  if (u.offer) {
    const label = u.installing ? `Updating ${Math.round((u.progress ?? 0) * 100)} %` : web && !phone ? "Reload to update" : "Update";
    const title = web ? "A new version is ready: reload to update" : `NeuralAgent ${u.offer.version} is available`;
    return (
      <button
        type="button"
        onClick={() => (onOpen?.(), openUpdateDialog("offer"))}
        aria-label={title}
        title={title}
        className={cn(
          "pressable group relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-accent",
          open ? "h-8 px-3 text-chip" : "h-8 w-8",
          !phone && open && "w-full",
        )}
      >
        {/* A calm, still halo: noticeable without pulling at the eye. */}
        <span aria-hidden className="absolute -inset-0.5 -z-10 rounded-full bg-accent/15 blur-sm" />
        <span aria-hidden className="absolute inset-0 -z-10 rounded-full bg-accent/15 shadow-lip ring-1 ring-accent/40 transition-colors group-hover:bg-accent/25" />
        <ArrowUpCircle size={15} strokeWidth={1.9} className="shrink-0" />
        {open && <span className="whitespace-nowrap">{label}</span>}
        {open && !web && !phone && !u.installing && <span className="whitespace-nowrap text-meta text-accent/70">{u.offer.version}</span>}
      </button>
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
        "inline-flex items-center gap-1.5 rounded-item text-tiny transition-colors",
        phone ? "h-11 shrink-0 px-2" : "h-6 px-2",
        failed ? "text-warning hover:text-bright" : "text-faint hover:text-dim",
      )}
    >
      {failed && <AlertTriangle size={12} strokeWidth={1.8} />}
      <span className="whitespace-nowrap">{phone ? `v${u.current}` : text}</span>
    </button>
  );
}
