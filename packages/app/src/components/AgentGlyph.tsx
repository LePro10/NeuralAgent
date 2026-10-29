import { Atom, Bot, Braces, Code, Gem, Hexagon, MousePointer2, Orbit, Plane, Rocket, Sparkles, SquareTerminal, Wand2, Waves, Zap, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  shell: SquareTerminal,
  terminal: SquareTerminal,
  install: SquareTerminal,
  claude: Sparkles,
  codex: Braces,
  gemini: Gem,
  antigravity: Orbit,
  cursor: MousePointer2,
  copilot: Plane,
  opencode: Code,
  grok: Atom,
  amp: Zap,
  droid: Bot,
  kimi: Waves,
  qwen: Hexagon,
  aider: Wand2,
};

/** Quiet glyph for an engine. Vendor logos are not used (trademarks); a neutral icon per engine. */
export function AgentGlyph({ engine, size = 14, className }: { engine: string; size?: number; className?: string }) {
  const Icon = ICONS[engine] ?? Rocket;
  return <Icon size={size} strokeWidth={1.6} className={className} aria-hidden />;
}

/** The glyph on a list-row tile (same tile as `Row` icons). */
export function GlyphTile({ engine }: { engine: string }) {
  return (
    <span className="grid size-6.5 shrink-0 place-items-center rounded-tile bg-fill-3 text-ink shadow-lip">
      <AgentGlyph engine={engine} size={14} />
    </span>
  );
}
