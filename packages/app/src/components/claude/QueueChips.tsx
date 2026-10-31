/**
 * Messages typed while Claude works wait in the CLI's queue. They sit as chips above the
 * composer with "Send now" (Claude takes them at once instead of after its current step) and
 * "Edit" (pull them back into the input).
 */
import { cn } from "@neuralagent/ui";
import { Clock, CornerDownLeft, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import type { Queued } from "./queue";

export function QueueChips({ items, busy, onSendNow, onTakeBack }: { items: Queued[]; busy: boolean; onSendNow: () => void; onTakeBack: () => void }) {
  if (!items.length) return null;
  return (
    <div role="status" aria-label={`${items.length} queued`} className="mb-2 rounded-cv-card border border-cv-line-soft bg-cv-surface px-1 py-1 shadow-cv-card animate-cv-rise">
      <div className="flex flex-col">
        {items.slice(-3).map((q) => (
          <div key={q.id} className="flex min-h-9 items-center gap-2 px-2.5 text-cv-ui text-cv-text-2">
            <Clock size={14} strokeWidth={1.8} className="shrink-0 text-cv-muted" />
            <span className="min-w-0 flex-1 truncate">{q.text}</span>
          </div>
        ))}
        {items.length > 3 && <div className="px-2.5 pb-1 text-cv-meta text-cv-muted">and {items.length - 3} more</div>}
      </div>
      <div className="flex items-center gap-1 border-t border-cv-line-soft pt-1">
        <span className="min-w-0 flex-1 truncate px-2.5 text-cv-meta text-cv-muted">{busy ? "Sent after the current step" : "Waiting to be sent"}</span>
        <Act label="Edit" onClick={onTakeBack}>
          <Pencil size={14} strokeWidth={1.8} />
        </Act>
        <Act label="Send now" onClick={onSendNow} strong>
          <CornerDownLeft size={14} strokeWidth={1.9} />
        </Act>
      </div>
    </div>
  );
}

function Act({ children, label, strong, onClick }: { children: ReactNode; label: string; strong?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-cv-meta transition-colors hover:bg-cv-hover active:bg-cv-press",
        strong ? "text-cv-text" : "text-cv-text-2",
      )}
    >
      {children}
      {label}
    </button>
  );
}
