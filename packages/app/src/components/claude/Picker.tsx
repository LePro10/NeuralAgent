/**
 * Choices in the Claude view (model, effort, permission mode, attachments). Phones: a "pour"
 * that grows up out of the composer (same width, springs from its top edge, the transcript dims
 * behind it; back and Escape close it through the layer stack). Desktop: a popover that opens
 * upward above the composer, kept inside the composer's width so it never clips off-screen.
 */
import { cn, prefersReducedMotion, SPRING, useLayer } from "@neuralagent/ui";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

export function Picker({ open, onClose, phone, title, align = "start", wide, children }: {
  open: boolean;
  onClose: () => void;
  phone: boolean;
  title: string;
  /** Desktop: which edge of the composer the popover lines up with. */
  align?: "start" | "end";
  wide?: boolean;
  children: ReactNode;
}) {
  if (phone) return open ? <Pour onClose={onClose} title={title}>{children}</Pour> : null;
  if (!open) return null;
  return <Popover onClose={onClose} title={title} align={align} wide={wide}>{children}</Popover>;
}

/** Phone: the composer's surface grows upward into a list; the transcript stays visible, dimmed. */
export function Pour({ onClose, title, children, dim = true }: { onClose: () => void; title: string; children: ReactNode; dim?: boolean }) {
  useLayer(true, onClose);
  const still = prefersReducedMotion();
  return (
    <>
      <motion.div
        aria-hidden
        className={cn("fixed inset-0 z-20", dim && "bg-cv-scrim")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: still ? 0 : 0.18 }}
        onPointerDown={(e) => (e.preventDefault(), onClose())}
      />
      <motion.div
        role="menu"
        aria-label={title}
        className="cv-scroll absolute inset-x-0 bottom-full z-30 mb-2 origin-bottom overflow-y-auto overscroll-contain rounded-cv-card bg-cv-surface px-1.5 pt-1 pb-1.5 font-cv-sans text-cv-text shadow-cv-pop"
        style={{ maxHeight: "min(60svh, 560px)" }}
        initial={still ? { opacity: 0 } : { opacity: 0, y: 14, scaleY: 0.82, scaleX: 0.97 }}
        animate={{ opacity: 1, y: 0, scaleY: 1, scaleX: 1 }}
        transition={still ? { duration: 0 } : { ...SPRING.sheet, opacity: { duration: 0.14 } }}
      >
        <div className="flex h-10 items-center px-3 text-cv-meta text-cv-muted">{title}</div>
        {children}
      </motion.div>
    </>
  );
}

function Popover({ onClose, title, align, wide, children }: { onClose: () => void; title: string; align: "start" | "end"; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-cv-trigger]")) onClose();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", down, true);
    // Arrow keys work at once: focus the checked row (else the first).
    const f = requestAnimationFrame(() => {
      const el = ref.current;
      (el?.querySelector<HTMLElement>('[aria-checked="true"]') ?? el?.querySelector<HTMLElement>("[role^=menuitem]"))?.focus({ preventScroll: true });
    });
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", down, true);
      cancelAnimationFrame(f);
    };
  }, [onClose]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not([disabled])") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") (e.preventDefault(), rows[(i + 1) % rows.length]?.focus());
    else if (e.key === "ArrowUp") (e.preventDefault(), rows[(i - 1 + rows.length) % rows.length]?.focus());
    else if (/^[1-9]$/.test(e.key)) rows[Number(e.key) - 1]?.click();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      onKeyDown={onKeyDown}
      style={{ maxHeight: "min(70vh, 520px)" }}
      className={cn(
        "cv-scroll absolute bottom-full z-30 mb-2 max-w-full overflow-y-auto rounded-cv-md bg-cv-surface p-1.5 font-cv-sans text-cv-text shadow-cv-pop animate-cv-pop",
        align === "start" ? "left-0 origin-bottom-left" : "right-0 origin-bottom-right",
        wide ? "w-88" : "w-72",
      )}
    >
      {children}
    </div>
  );
}

export function PickSection({ children, first }: { children: ReactNode; first?: boolean }) {
  return <div className={cn("px-3 pb-1 text-cv-meta text-cv-muted", first ? "pt-1.5" : "mt-1.5 border-t border-cv-line-soft pt-3")}>{children}</div>;
}

export function PickRow({ label, hint, icon, badge, checked, danger, shortcut, disabled, trailing, onClick }: {
  label: ReactNode;
  /** Shown at the right edge (a value and chevron for a row that opens another list). */
  trailing?: ReactNode;
  hint?: string;
  icon?: ReactNode;
  badge?: string;
  checked?: boolean;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-cv-sm px-3 text-left outline-none transition-colors duration-100",
        "hover:bg-cv-hover focus-visible:bg-cv-hover active:bg-cv-press disabled:opacity-40",
        "min-h-12 py-2 [[data-mode=phone]_&]:min-h-14",
        danger ? "text-cv-danger" : "text-cv-text",
      )}
    >
      {icon && <span className={cn("grid size-5 shrink-0 place-items-center", danger ? "text-cv-danger" : "text-cv-text-2")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-cv-ui">{label}</span>
          {badge && <span className="shrink-0 rounded-full bg-cv-chip px-1.5 py-px text-cv-meta text-cv-muted">{badge}</span>}
        </span>
        {hint && <span className={cn("mt-0.5 block text-cv-meta", danger ? "text-cv-danger" : "text-cv-muted")}>{hint}</span>}
      </span>
      {shortcut && !checked && <span className="shrink-0 text-cv-meta text-cv-muted [[data-mode=phone]_&]:hidden">{shortcut}</span>}
      {trailing && <span className="flex shrink-0 items-center gap-1 text-cv-meta text-cv-muted">{trailing}</span>}
      {checked && <Check size={18} strokeWidth={2.2} className="shrink-0 text-cv-blue" />}
    </button>
  );
}

export function PickNote({ children }: { children: ReactNode }) {
  return <div className="px-3 pt-1 pb-2 text-cv-meta text-cv-muted">{children}</div>;
}
