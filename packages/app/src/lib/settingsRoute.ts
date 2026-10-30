// Which Settings section to show next. Anything can open Settings at a section (the command
// palette, old routes such as the former Remote and MCP pages); SettingsPage takes the request
// once and clears it.
import { create } from "zustand";

/** The page id of Settings in the main navigation (`useUi().workspace`). */
export const SETTINGS_PAGE = "__settings";

/** Former top-level pages that now live in Settings: old route id → section id. */
export const MOVED_TO_SETTINGS: Record<string, string> = {
  __remote: "remote",
  __mcp: "mcp",
};

export const useSettingsRoute = create<{ section: string | null }>()(() => ({ section: null }));

/** Ask Settings to show `section` (it may not be mounted yet). */
export function requestSettingsSection(section: string) {
  useSettingsRoute.setState({ section });
}

/** Take the pending request, if any. */
export function takeSettingsSection(): string | null {
  const { section } = useSettingsRoute.getState();
  if (section) useSettingsRoute.setState({ section: null });
  return section;
}
