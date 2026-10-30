import { IconTile, cn, type Activity } from "@neuralagent/ui";
import { engineColor } from "../lib/agentui";
import { AgentGlyph } from "./AgentGlyph";

/**
 * An agent's coloured tile (iOS Settings style): the engine's glyph on its system colour, plus
 * its activity mark. `size="lg"` is the big tile of agent grids (44px).
 */
export function EngineTile({ engine, activity, size = "md", className }: { engine: string; activity?: Activity; size?: "md" | "lg"; className?: string }) {
  return (
    <IconTile color={engineColor(engine)} activity={activity} className={cn(size === "lg" && "size-11 rounded-tile", className)}>
      <AgentGlyph engine={engine} size={size === "lg" ? 24 : 16} />
    </IconTile>
  );
}
