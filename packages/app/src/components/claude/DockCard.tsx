/**
 * The frame of a card docked where the composer sits (permission, plan, question, menu):
 * a header with the terminal fallback and Esc, a body that scrolls, and a footer whose
 * buttons always stay in reach. Phones: at most 45% of the visible height until "Show full".
 */
import { cn } from "@neuralagent/ui";
import { ArrowUp, ChevronDown, ChevronUp, SquareTerminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function DockCard({ label, head, phone, onTerminal, onDismiss, children, footer, eyebrow }: {
  label: string;
  head: ReactNode;
  eyebrow?: ReactNode;
  phone: boolean;
  onTerminal: () => void;
  onDismiss: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const vh = useVisibleHeight(phone);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div
      role="group"
      aria-label={label}
      className="relative mb-2 flex flex-col overflow-hidden rounded-cv-card border border-cv-line-soft bg-cv-surface font-cv-sans text-cv-text shadow-cv-card animate-cv-rise"
      style={{ maxHeight: phone ? Math.round(vh * (full ? 0.85 : 0.45)) : "min(60vh, 560px)" }}
    >
      <div className="flex flex-none items-start gap-1 px-4 pt-3 pb-1">
        <div className="min-w-0 flex-1 pt-2">
          {eyebrow && <div className="pb-0.5 text-cv-meta text-cv-muted">{eyebrow}</div>}
          <div className="text-cv-ui whitespace-pre-wrap [overflow-wrap:anywhere]">{head}</div>
        </div>
        <button type="button" onClick={onTerminal} aria-label="Open the terminal" title="Open the terminal" className="-mr-1 grid size-11 shrink-0 place-items-center rounded-full text-cv-muted transition-colors hover:bg-cv-hover hover:text-cv-text">
          <SquareTerminal size={17} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss (Esc)" title="Dismiss (Esc)" className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-cv-text-2 transition-colors hover:bg-cv-hover">
          <span className="grid size-7 place-items-center rounded-full bg-cv-chip">
            <X size={15} strokeWidth={2} />
          </span>
        </button>
      </div>
      {children && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={body} className="cv-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div>{children}</div>
          </div>
          {phone && (overflows || full) && (
            <button
              type="button"
              onClick={() => setFull((f) => !f)}
              className="absolute right-3 bottom-1 flex h-11 items-center"
              aria-expanded={full}
            >
              <span className="flex items-center gap-1 rounded-full border border-cv-line-soft bg-cv-surface px-3 py-1.5 text-cv-meta text-cv-text-2 shadow-cv-pill">
                {full ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                {full ? "Show less" : "Show full"}
              </span>
            </button>
          )}
        </div>
      )}
      {footer && <div className="flex-none border-t border-cv-line-soft px-3 pt-2.5 pb-3">{footer}</div>}
    </div>
  );
}

/** What is visible above the keyboard (the visual viewport). */
function useVisibleHeight(on: boolean): number {
  const [h, setH] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  useEffect(() => {
    if (!on) return;
    const vv = window.visualViewport;
    const fit = () => setH(vv?.height ?? window.innerHeight);
    fit();
    vv?.addEventListener("resize", fit);
    window.addEventListener("resize", fit);
    return () => {
      vv?.removeEventListener("resize", fit);
      window.removeEventListener("resize", fit);
    };
  }, [on]);
  return h;
}

export function Btn({ children, kind, onClick, phone, className }: { children: ReactNode; kind: "primary" | "secondary" | "ghost" | "danger"; onClick: () => void; phone: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-full px-4 text-center font-cv-sans text-cv-ui transition duration-150 active:scale-97",
        phone ? "min-h-12 py-2" : "min-h-9 py-1.5",
        kind === "primary" && "bg-cv-primary text-cv-on-primary hover:opacity-90",
        kind === "secondary" && "border border-cv-line bg-cv-surface text-cv-text hover:bg-cv-hover",
        kind === "ghost" && "text-cv-text-2 hover:bg-cv-hover hover:text-cv-text",
        kind === "danger" && "border border-cv-line bg-cv-surface text-cv-danger hover:bg-cv-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** One-line text answer (deny reason, plan feedback, "Other"): Enter or the arrow sends. */
export function AnswerField({ placeholder, label, onSend, autoFocus, mono }: { placeholder: string; label: string; onSend: (text: string) => void; autoFocus?: boolean; mono?: boolean }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <form className="flex items-center gap-1 rounded-cv-card border border-cv-line-soft bg-cv-surface p-0.5 focus-within:border-cv-line" onSubmit={(e) => (e.preventDefault(), send())}>
      <input
        ref={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="send"
        className={cn("h-11 min-w-0 flex-1 bg-transparent px-3 text-cv-input text-cv-text outline-none placeholder:text-cv-placeholder", mono ? "font-cv-mono" : "font-cv-sans")}
      />
      <button type="submit" disabled={!text.trim()} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-40">
        <span className="grid size-8 place-items-center rounded-full bg-cv-clay text-cv-on-clay">
          <ArrowUp size={17} strokeWidth={2.2} />
        </span>
      </button>
    </form>
  );
}
