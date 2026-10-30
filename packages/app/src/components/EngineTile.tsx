import { ActivityMark, cn, type Activity } from "@neuralagent/ui";
import type { ReactNode } from "react";
import { AgentGlyph } from "./AgentGlyph";

type TileSize = "sm" | "md" | "chip" | "lg";

const BOX: Record<TileSize, string> = {
  sm: "size-6",
  md: "size-icon-tile",
  chip: "size-8",
  lg: "size-11",
};
const GLYPH: Record<TileSize, number> = { sm: 14, md: 16, chip: 17, lg: 22 };

/**
 * A quiet icon tile (the library's list-row tile): a lit fill with the glyph in ink, brighter when
 * `selected`. No colour per engine: the glyph names the agent, colour stays for status. The
 * activity mark sits on it (light ring while working, a dot when it waits, finished or failed).
 */
export function QuietTile({ size = "md", round, selected, activity, edge, className, children }: {
  size?: TileSize;
  round?: boolean;
  selected?: boolean;
  activity?: Activity;
  /** ring-* class of the surface behind the activity dot. */
  edge?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center shadow-lip transition-colors",
        BOX[size],
        round ? "rounded-full" : "rounded-tile",
        selected ? "bg-fill-4 text-bright" : "bg-fill-3 text-ink",
        className,
      )}
    >
      {children}
      <ActivityMark activity={activity} shape={round ? "round" : "tile"} edge={edge} size={size === "sm" ? 8 : 10} corner={round ? "-top-0.5 -right-0.5" : "-top-1 -right-1"} />
    </span>
  );
}

/** An agent's tile: its engine's glyph on a quiet tile, plus its activity mark. */
export function EngineTile({ engine, size = "md", ...rest }: { engine: string; size?: TileSize; round?: boolean; selected?: boolean; activity?: Activity; edge?: string; className?: string }) {
  return (
    <QuietTile size={size} {...rest}>
      <AgentGlyph engine={engine} size={GLYPH[size]} />
    </QuietTile>
  );
}

/** Glyph size that fits a tile of `size` (for non-engine icons on a QuietTile). */
export const tileGlyph = (size: TileSize) => GLYPH[size];
