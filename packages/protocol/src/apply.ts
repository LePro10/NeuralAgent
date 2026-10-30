import type { Event, State } from "./gen/index.ts";

/** Messages kept in the conversation with Neural (`KEEP` in crates/na-daemon/src/orch.rs). */
const ORCH_KEEP = 60;
// Same as the daemon (`swarm::KEEP`).
const SWARM_KEEP = 300;

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
    case "orch_message": {
      const old = s.orchestrator.messages;
      const i = old.findIndex((m) => m.id === ev.message.id);
      let messages = i < 0 ? [...old, ev.message] : old.map((m, j) => (j === i ? ev.message : m));
      if (messages.length > ORCH_KEEP) messages = messages.slice(messages.length - ORCH_KEEP);
      return { ...s, orchestrator: { ...s.orchestrator, messages } };
    }
    case "orch_status":
      return { ...s, orchestrator: { ...s.orchestrator, ready: ev.ready, keys: ev.keys, busy: ev.busy } };
    case "orch_cleared":
      return { ...s, orchestrator: { ...s.orchestrator, messages: [] } };
    case "swarm_upsert": {
      const i = s.swarms.findIndex((w) => w.id === ev.swarm.id);
      return { ...s, swarms: i < 0 ? [...s.swarms, ev.swarm] : s.swarms.map((w, j) => (j === i ? ev.swarm : w)) };
    }
    case "swarm_removed":
      return { ...s, swarms: s.swarms.filter((w) => w.id !== ev.id), swarm_messages: s.swarm_messages.filter((m) => m.swarm_id !== ev.id) };
    case "swarm_message": {
      const old = s.swarm_messages;
      const i = old.findIndex((m) => m.id === ev.message.id);
      let msgs = i < 0 ? [...old, ev.message] : old.map((m, j) => (j === i ? ev.message : m));
      const mine = msgs.filter((m) => m.swarm_id === ev.message.swarm_id);
      if (mine.length > SWARM_KEEP) {
        const drop = new Set(mine.slice(0, mine.length - SWARM_KEEP).map((m) => m.id));
        msgs = msgs.filter((m) => !drop.has(m.id));
      }
      return { ...s, swarm_messages: msgs };
    }
    case "attention":
    case "host_notice":
      return s;
  }
}
