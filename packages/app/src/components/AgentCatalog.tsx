import { useLayoutMode } from "@neuralagent/ui";
import { useEffect } from "react";
import { phoneRouter, usePhoneNav } from "../lib/phoneRoute";
import { requestSettingsSection, SETTINGS_PAGE } from "../lib/settingsRoute";
import { useCatalogSheet, useUi } from "../lib/store";
import { rememberInstallTarget } from "./settings/AgentsPanel";

/**
 * "Install agents…" from anywhere (`useCatalogSheet().setOpen(true)`) opens Settings → Agents
 * (D71; it was a sheet before). Phones push the page in the current tab, so back returns to
 * where you were; desktop switches to Settings. Installs run in the workspace you came from.
 */
export function AgentCatalog() {
  const open = useCatalogSheet((c) => c.open);
  const phone = useLayoutMode() === "phone";
  useEffect(() => {
    if (!open) return;
    useCatalogSheet.getState().setOpen(false);
    const { workspace, setWorkspace } = useUi.getState();
    if (phone) {
      // The project on screen, if any.
      const project = [...usePhoneNav.getState().stack].reverse().find((r) => r.k === "project");
      rememberInstallTarget(project?.k === "project" ? project.id : null);
      phoneRouter().push({ k: "section", id: "agents" });
    } else {
      rememberInstallTarget(workspace && !workspace.startsWith("__") ? workspace : null);
      requestSettingsSection("agents");
      setWorkspace(SETTINGS_PAGE);
    }
  }, [open, phone]);
  return null;
}
