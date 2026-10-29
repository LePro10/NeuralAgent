import { Bot, Braces, Gem, Sparkles, SquareTerminal, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  shell: SquareTerminal,
  terminal: SquareTerminal,
  claude: Sparkles,
  codex: Braces,
  gemini: Gem,
};

/** Quiet glyph for an engine. Vendor logos are not used (trademarks); a neutral icon per engine. */
export function AgentGlyph({ engine, size = 14, className }: { engine: string; size?: number; className?: string }) {
  const Icon = ICONS[engine] ?? Bot;
  return <Icon size={size} strokeWidth={1.6} className={className} aria-hidden />;
}
