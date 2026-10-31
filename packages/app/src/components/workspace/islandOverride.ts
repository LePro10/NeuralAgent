// Phones: a layer inside the agent screen (the subagent view) can take over the Island for as long
// as it is open: its title, a breadcrumb line and its back (which pops the layer). So there is one
// back button on screen, not the Island's plus the layer's own header.
import { createContext, useContext, useEffect, useRef } from "react";

export interface IslandOverride {
  title: string;
  /** Second line: the breadcrumb ("Fix the tests › Explore"). */
  subtitle?: string;
  /** Where back goes, for screen readers. */
  backLabel: string;
  onBack: () => void;
}

/** Set by the agent screen (PhoneAgentScreen); null outside it (desktop, tests). */
export const IslandOverrideContext = createContext<((o: IslandOverride | null) => void) | null>(null);

/**
 * Shows `o` in the Island while mounted (null = leave it alone). Returns whether an Island takes it
 * (false on desktop: the caller draws its own header then).
 */
export function useIslandOverride(o: IslandOverride | null): boolean {
  const set = useContext(IslandOverrideContext);
  const back = useRef(o?.onBack);
  back.current = o?.onBack;
  const on = !!o;
  const { title = "", subtitle, backLabel = "" } = o ?? {};
  useEffect(() => {
    if (!set || !on) return;
    set({ title, subtitle, backLabel, onBack: () => back.current?.() });
    return () => set(null);
  }, [set, on, title, subtitle, backLabel]);
  return !!set;
}
