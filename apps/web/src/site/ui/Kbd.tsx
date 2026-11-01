import type { ReactNode } from "react";

/** A keycap. `<Kbd>⌘</Kbd><Kbd>K</Kbd>`. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="na-kbd">{children}</kbd>;
}
