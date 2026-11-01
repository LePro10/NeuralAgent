export type ActivityKind = "working" | "waiting" | "done" | "error" | "idle";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = { working: "Working", waiting: "Needs input", done: "Finished", error: "Error", idle: "Idle" };

/**
 * The app's activity vocabulary (docs/notes/design-system.md section 5), one language everywhere on the site:
 *   working  a thin accent light running round a ring
 *   waiting  a pulsing accent dot: it needs you
 *   done     an ember dot (ember means ONLY this)
 *   error    a red dot
 *   idle     a quiet hollow dot (the site's addition for "nothing going on")
 * Decorative unless `label` is set (`label` or `true` for the default text).
 */
export function ActivityMark({ kind, size, label, className }: { kind: ActivityKind; size?: "sm" | "md" | "lg"; label?: string | boolean; className?: string }) {
  const text = label === true ? ACTIVITY_LABEL[kind] : label || undefined;
  return (
    <span className={`na-mark${className ? ` ${className}` : ""}`} data-kind={kind} data-size={size} role={text ? "img" : undefined} aria-label={text} aria-hidden={text ? undefined : true}>
      {kind === "working" && <i />}
    </span>
  );
}
