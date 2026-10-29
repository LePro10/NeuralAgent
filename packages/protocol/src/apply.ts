import type { Event, State } from "./gen/index.ts";

/**
 * Applies a daemon event to a client's copy of the state, immutably (new references for what
 * changed, so React re-renders only those parts). Mirrors `apply` in crates/na-daemon/src/core.rs.
 */
export function apply(s: State, ev: Event): State {
  switch (ev.e) {
    case "workspace_upsert": {
      const i = s.workspaces.findIndex((w) => w.id === ev.workspace.id);
      const workspaces = i < 0 ? [...s.workspaces, ev.workspace] : s.workspaces.map((w, j) => (j === i ? ev.workspace : w));
      return { ...s, workspaces };
    }
    case "workspace_removed": {
      const { [ev.id]: _gone, ...layouts } = s.layouts;
      const sessions = Object.fromEntries(Object.entries(s.sessions).filter(([, x]) => x?.workspace_id !== ev.id));
      return { ...s, workspaces: s.workspaces.filter((w) => w.id !== ev.id), layouts, sessions };
    }
    case "remote_set":
      return { ...s, remote: ev.remote };
    case "layout_set":
      return { ...s, layouts: { ...s.layouts, [ev.workspace_id]: ev.layout } };
    case "session_upsert":
      return { ...s, sessions: { ...s.sessions, [ev.session.id]: ev.session } };
    case "session_removed": {
      const { [ev.id]: _gone, ...sessions } = s.sessions;
      return { ...s, sessions };
    }
    case "profiles_set":
      return { ...s, profiles: ev.profiles };
    case "mcp_set":
      return { ...s, mcp: ev.servers };
    case "limits_set":
      return { ...s, limits: ev.limits };
    case "catalog_set":
      return { ...s, catalog: ev.catalog };
    case "settings_set":
      return { ...s, settings: ev.settings };
    case "attention":
      return s;
  }
}
