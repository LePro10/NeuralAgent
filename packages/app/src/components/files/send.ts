// Files explorer (D68): "Send to agent" puts a file's path into an agent's next message. A Claude
// agent shown as chat gets it in its composer (now, or when its composer next opens; Composer
// calls `takeInsert`); any other agent gets it typed into its terminal, without Enter, so nothing
// is sent before you add your words.
import type { DaemonClient, Profile, Session, State } from "@neuralagent/protocol";
import { pathToken } from "../claude/files";
import { CONTROL, termToken } from "./model";

const pending = new Map<string, string>();

/** Composer: the paths waiting for this agent's next message (taken once). */
export function takeInsert(sid: string): string | undefined {
  const t = pending.get(sid);
  pending.delete(sid);
  return t;
}

/** The live agents of a workspace that can take a path, the ones waiting for you first. */
export function agentsFor(state: State | null | undefined, workspaceId: string | undefined): Session[] {
  if (!state) return [];
  const rank = (s: Session) => (s.status === "waiting" ? 0 : s.status === "idle" || s.status === "done" ? 1 : 2);
  return Object.values(state.sessions)
    .filter((s): s is Session => !!s && s.alive && (!workspaceId || s.workspace_id === workspaceId))
    .sort((a, b) => rank(a) - rank(b) || b.status_since - a.status_since);
}

/** Whether this agent shows as chat: on phones its own choice (ClaudeViewSwitch), else the app-wide one. */
function showsChat(sid: string, appChat: boolean, phone: boolean): boolean {
  if (!phone) return appChat;
  try {
    const own = (JSON.parse(localStorage.getItem("na.agentView") ?? "{}") as Record<string, string>)[sid];
    return own ? own === "chat" : appChat;
  } catch {
    return appChat;
  }
}

/**
 * Puts `path` into the agent's next message. `appChat`: the app shows Claude agents as chat
 * (useClaudeChat). Resolves with where it went.
 */
export async function sendPathTo(
  client: DaemonClient,
  session: Session,
  profiles: Profile[] | undefined,
  path: string,
  opts: { appChat: boolean; phone: boolean },
): Promise<"composer" | "terminal"> {
  const claude = profiles?.find((p) => p.id === session.profile_id)?.engine === "claude";
  if (claude && showsChat(session.id, opts.appChat, opts.phone)) {
    const token = pathToken(path.replace(CONTROL, "?"));
    const was = pending.get(session.id);
    pending.set(session.id, was ? `${was} ${token}` : token);
    window.dispatchEvent(new Event("na-insert-text"));
    return "composer";
  }
  await client.req({ m: "term_write", p: { sid: session.id, data: `${termToken(path)} ` } });
  return "terminal";
}
