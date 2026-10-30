import { DaemonClient } from "@neuralagent/protocol";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Platform } from "./platform";

interface Ctx {
  client: DaemonClient;
  platform: Platform;
}

const DaemonCtx = createContext<Ctx | null>(null);

export function DaemonProvider({ client, platform, children }: Ctx & { children: ReactNode }) {
  return <DaemonCtx.Provider value={{ client, platform }}>{children}</DaemonCtx.Provider>;
}

export function useClient(): DaemonClient {
  const c = useContext(DaemonCtx);
  if (!c) throw new Error("DaemonProvider missing");
  return c.client;
}

export function usePlatform(): Platform {
  const c = useContext(DaemonCtx);
  if (!c) throw new Error("DaemonProvider missing");
  return c.platform;
}

/** Selects from the synced daemon state. Selectors must return stable references. */
export function useDaemon<T>(sel: (c: DaemonClient) => T): T {
  const client = useClient();
  return useSyncExternalStore(client.subscribe, () => sel(client), () => sel(client));
}

/** Per-device UI state (which workspace is open, …), remembered across restarts. */
interface UiState {
  workspace: string | null;
  sidebarPinned: boolean;
  /** New agents in git workspaces get their own worktree. */
  worktrees: boolean;
  setWorkspace: (id: string | null) => void;
  setSidebarPinned: (v: boolean) => void;
  setWorktrees: (v: boolean) => void;
  /** Claude sessions show the Claude view (true) or the terminal (false); null = the layout's default (phone: view, desktop: terminal). */
  claudeView: boolean | null;
  setClaudeView: (v: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      workspace: null,
      sidebarPinned: false,
      worktrees: false,
      setWorkspace: (workspace) => set({ workspace }),
      setSidebarPinned: (sidebarPinned) => set({ sidebarPinned }),
      setWorktrees: (worktrees) => set({ worktrees }),
      claudeView: null,
      setClaudeView: (claudeView) => set({ claudeView }),
    }),
    { name: "neuralagent.ui" },
  ),
);

/** The agent catalog sheet (install CLIs), opened from launchers and the dashboard. */
export const useCatalogSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** The changes sheet: a workspace, or one agent's worktree. */
export const useChanges = create<{
  target: { workspaceId: string; sessionId?: string } | null;
  show: (workspaceId: string, sessionId?: string) => void;
  close: () => void;
}>()((set) => ({
  target: null,
  show: (workspaceId, sessionId) => set({ target: { workspaceId, sessionId } }),
  close: () => set({ target: null }),
}));
