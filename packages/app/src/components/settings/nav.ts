// Lets a settings page open a detail page above itself (phones: pushed; desktop: right column).
import { createContext, useContext, type ReactNode } from "react";

export interface SettingsNav {
  push: (key: string, title: string, node: ReactNode) => void;
}
export const SettingsNavCtx = createContext<SettingsNav>({ push: () => {} });
export const useSettingsNav = () => useContext(SettingsNavCtx);
