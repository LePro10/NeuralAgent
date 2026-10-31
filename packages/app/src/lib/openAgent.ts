// "Open this agent", one function for every place that has an agent to show (the Agents list,
// Neural's feed, a swarm, History, a notification). Phones push the agent's own screen through the
// phone router and never touch the computer's layout. Desktop switches to the agent's workspace
// and brings its tab and pane to the front (that layout is the desktop's own business).
import type { DaemonClient } from "@neuralagent/protocol";
import { useLayoutMode } from "@neuralagent/ui";
import { useCallback } from "react";
import { frontTabFor } from "./layout";
import { phoneRouter } from "./phoneRoute";
import { useClient, useUi } from "./store";

/** Desktop: the agent's workspace, with its tab in front and its pane focused. */
export function openAgentOnDesktop(client: DaemonClient, setWorkspace: (id: string) => void, sid: string): boolean {
  const st = client.state;
  const s = st?.sessions[sid];
  if (!s || !st) return false;
  const layout = frontTabFor(st.layouts[s.workspace_id], s.id);
  if (layout) client.req({ m: "layout_set", p: { workspace_id: s.workspace_id, layout } }).catch(() => {});
  setWorkspace(s.workspace_id);
  return true;
}

/** Opens an agent the way this layout does it (phone: its screen; desktop: its pane). */
export function useOpenAgent(): (sid: string) => void {
  const client = useClient();
  const setWorkspace = useUi((u) => u.setWorkspace);
  const phone = useLayoutMode() === "phone";
  return useCallback(
    (sid: string) => {
      if (phone) phoneRouter().openAgent(sid);
      else openAgentOnDesktop(client, setWorkspace, sid);
    },
    [phone, client, setWorkspace],
  );
}

// ───────────── names for screens shown before the state arrives ─────────────

const NAMES = "neuralagent.agentNames";
type Names = Record<string, { title: string; project?: string }>;
let names: Names | null = null;

function load(): Names {
  if (names) return names;
  try {
    names = JSON.parse(localStorage.getItem(NAMES) ?? "{}") as Names;
  } catch {
    names = {};
  }
  return names;
}

/** The agent's title and project as this device last saw them (a notification opens before the state is there). */
export function cachedAgent(sid: string): { title: string; project?: string } | undefined {
  return load()[sid];
}

/** Keeps the cache in step with the state (called from the phone shell). */
export function rememberAgents(client: DaemonClient) {
  const st = client.state;
  if (!st) return;
  const next: Names = {};
  for (const s of Object.values(st.sessions)) next[s.id] = { title: s.title, project: st.workspaces.find((w) => w.id === s.workspace_id)?.name };
  const json = JSON.stringify(next);
  if (json === JSON.stringify(load())) return;
  names = next;
  try {
    localStorage.setItem(NAMES, json);
  } catch {
    // private mode
  }
}
