// Lets a settings page open a detail page above itself (phones: pushed; desktop: right column),
// and leave it again (after Save, Cancel or Delete).
import { createContext, useContext, type ReactNode } from "react";

export interface SettingsNav {
  /** Opens `node` as a page titled `title`. `key` names it in the URL (phones) and for reloads. */
  push: (key: string, title: string, node: ReactNode) => void;
  /** Back to the section the detail was opened from. */
  back: () => void;
}
export const SettingsNavCtx = createContext<SettingsNav>({ push: () => {}, back: () => {} });
export const useSettingsNav = () => useContext(SettingsNavCtx);
