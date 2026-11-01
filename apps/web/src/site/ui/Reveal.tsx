import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { prefersReducedMotion } from "./hooks";

export type RevealKind = "rise" | "pane" | "rule" | "slot";

/**
 * Entrance on first view, once. Four patterns, pick by what the element IS (do not use `rise` for everything):
 *   rise  copy and small things: 14 px up + fade
 *   pane  windows, cells, cards: a slight scale from the top edge + fade
 *   rule  a hairline: draws from the left (give it height: var(--hair) and a background)
 *   slot  display headlines: each line slides up out of a mask (use <SlotLines>)
 * `index` staggers siblings (65 ms per step); `immediate` plays on mount (above the fold) instead of on scroll.
 * Content is visible without JS and under reduced motion. Only opacity/transform animate.
 */
export function Reveal({ as: As = "div", kind = "rise", index = 0, immediate, margin = "0px 0px -9% 0px", className, style, children, ...rest }: {
  as?: ElementType;
  kind?: RevealKind;
  index?: number;
  immediate?: boolean;
  margin?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  [k: string]: unknown;
}) {
  const ref = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return setOn(true);
    if (immediate) {
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && (setOn(true), io.disconnect()), { rootMargin: margin, threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [immediate, margin]);
  return (
    <As ref={ref} data-reveal={kind} data-in={on ? "" : undefined} className={className} style={{ "--i": index, ...style } as CSSProperties} {...rest}>
      {children}
    </As>
  );
}

/**
 * A display headline revealed line by line (the `slot` pattern). One string per line; every line is a real line
 * of text. `stop` appends the accent pane-block full stop after the last line (with a hidden "." for screen readers).
 *   <SlotLines as="h1" className="t-display" lines={["Thirteen coding agents.", "One calm place"]} stop />
 */
export function SlotLines({ as: As = "h1", lines, stop, immediate = true, className, delay = 0, id }: {
  as?: ElementType;
  lines: string[];
  stop?: boolean;
  immediate?: boolean;
  className?: string;
  /** ms before the first line starts. */
  delay?: number;
  /** The heading's id: the target of the section's `aria-labelledby` (`<Section labelledBy="spec-h">`). */
  id?: string;
}) {
  return (
    <Reveal as={As} kind="slot" immediate={immediate} className={className} style={{ "--d": `${delay}ms` } as CSSProperties} id={id}>
      {lines.map((line, i) => (
        <span key={i} className="na-slot" style={{ "--i": i } as CSSProperties}>
          <span>
            {line}
            {stop && i === lines.length - 1 && (
              <>
                <span className="t-stop" data-late aria-hidden />
                <span className="na-sr">.</span>
              </>
            )}
          </span>
        </span>
      ))}
    </Reveal>
  );
}
