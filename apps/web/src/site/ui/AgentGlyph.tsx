import { Atom, Bot, Braces, Code, Gem, Hexagon, MousePointer2, Orbit, Plane, Rocket, Sparkles, SquareTerminal, Wand2, Waves, Zap, type LucideIcon } from "lucide-react";

// Mirror of packages/app/src/components/AgentGlyph.tsx (not importable: the app barrel is heavy). Same glyph per engine id.
// The app uses neutral glyphs, never vendor logos (trademarks): so does the site.
const ICONS: Record<string, LucideIcon> = {
  shell: SquareTerminal, terminal: SquareTerminal, install: SquareTerminal,
  claude: Sparkles, codex: Braces, gemini: Gem, antigravity: Orbit, cursor: MousePointer2, copilot: Plane,
  opencode: Code, grok: Atom, amp: Zap, droid: Bot, kimi: Waves, qwen: Hexagon, aider: Wand2,
};

/** Quiet glyph for an engine id (`claude`, `codex`, … `shell`). */
export function AgentGlyph({ engine, size = 16, className }: { engine: string; size?: number; className?: string }) {
  const Glyph = ICONS[engine] ?? Rocket;
  return <Glyph size={size} strokeWidth={1.6} className={className} aria-hidden />;
}
