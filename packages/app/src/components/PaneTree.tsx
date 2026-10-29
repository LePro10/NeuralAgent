import type { LayoutNode } from "@neuralagent/protocol";
import { cn } from "@neuralagent/ui";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Pane, type PaneActions } from "./Pane";

export interface TreeCtx {
  workspaceId: string;
  focused: string;
  zoomed?: string;
  webgl: boolean;
  actions: (paneId: string) => PaneActions;
  onSizes: (splitId: string, sizes: number[]) => void;
}

const MIN = 0.08;

/** Renders a split tree. Panes keep their React identity across re-layouts (keyed by id). */
export function PaneTree({ node, ctx }: { node: LayoutNode; ctx: TreeCtx }) {
  if (node.type === "pane") {
    const zoomed = ctx.zoomed === node.id;
    return (
      <div className={cn("min-h-0 min-w-0", zoomed ? "absolute inset-0 z-10" : "h-full w-full", ctx.zoomed && !zoomed && "invisible")}>
        <Pane workspaceId={ctx.workspaceId} paneId={node.id} content={node.content} focused={ctx.focused === node.id} zoomed={zoomed} webgl={ctx.webgl} actions={ctx.actions(node.id)} />
      </div>
    );
  }
  return <Split node={node} ctx={ctx} />;
}

function Split({ node, ctx }: { node: Extract<LayoutNode, { type: "split" }>; ctx: TreeCtx }) {
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number[] | null>(null);
  const sizes = live ?? node.sizes;
  // Keep the dragged sizes until the daemon echoes the new layout back (no snap-back flicker).
  useEffect(() => setLive(null), [node.sizes]);
  const row = node.dir === "row";

  const startDrag = (i: number) => (e: RPointerEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = row ? rect.width : rect.height;
    const start = row ? e.clientX : e.clientY;
    const base = [...sizes];
    let cur = base;
    const move = (ev: PointerEvent) => {
      const d = ((row ? ev.clientX : ev.clientY) - start) / total;
      const a = base[i]! + d;
      const b = base[i + 1]! - d;
      if (a < MIN || b < MIN) return;
      cur = base.map((s, j) => (j === i ? a : j === i + 1 ? b : s));
      setLive(cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      if (cur !== base) ctx.onSizes(node.id, cur);
    };
    document.body.style.cursor = row ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const even = () => ctx.onSizes(node.id, node.children.map(() => 1 / node.children.length));

  return (
    <div ref={box} className={cn("flex h-full min-h-0 w-full min-w-0", row ? "flex-row" : "flex-col")}>
      {node.children.map((child, i) => (
        <div key={child.id} className="contents">
          {i > 0 && (
            <div
              role="separator"
              aria-orientation={row ? "vertical" : "horizontal"}
              onPointerDown={startDrag(i - 1)}
              onDoubleClick={even}
              className={cn("group/div relative shrink-0", row ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize")}
            >
              <span className={cn("absolute rounded-full bg-fill-4 opacity-0 transition-opacity group-hover/div:opacity-100", row ? "inset-y-2 left-1/2 w-px" : "inset-x-2 top-1/2 h-px")} />
            </div>
          )}
          <div className="flex min-h-0 min-w-0" style={{ flex: `${sizes[i] ?? 1} 1 0` }}>
            <PaneTree node={child} ctx={ctx} />
          </div>
        </div>
      ))}
    </div>
  );
}
