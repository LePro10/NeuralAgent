import { useDaemon, useUi } from "./store";

/** Extra `session_start` fields: agents (not shells) in a git workspace get their own worktree when that is switched on. */
export function useWorktreeStart(workspaceId: string) {
  const git = useDaemon((c) => !!c.state?.workspaces.find((w) => w.id === workspaceId)?.git);
  const on = useUi((u) => u.worktrees);
  return (engine: string) => (git && on && engine !== "shell" ? { worktree: true } : {});
}
