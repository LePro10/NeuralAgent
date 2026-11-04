// Autopilot (D87): the state, the requests and the little UI state the screens share.
import type { AutopilotOp, AutopilotState, Connector, Pilot } from "@neuralagent/protocol";
import { toast } from "@neuralagent/ui";
import { create } from "zustand";
import { EMPTY_AUTOPILOT } from "../../lib/autopilot";
import { useClient, useDaemon } from "../../lib/store";

/** The autopilot part of the snapshot; stable while nothing changes. */
export function useAutopilot(): AutopilotState {
  return useDaemon((c) => c.state?.autopilot) ?? EMPTY_AUTOPILOT;
}

/** True when the connected daemon has the Autopilot feature (older ones: hide every entry). */
export function useAutopilotSupported(): boolean {
  return useDaemon((c) => c.status === "open" && c.has("autopilot"));
}

export type PilotTab = "inbox" | "chat" | "instructions";

interface PilotUi {
  /** The pilot shown (null: the first one). */
  pilotId: string | null;
  tab: PilotTab;
  setPilot: (id: string | null, tab?: PilotTab) => void;
  setTab: (tab: PilotTab) => void;
  /** Set by the command palette: the Autopilot page opens its connectors once. */
  wantConnectors: boolean;
  askConnectors: (v: boolean) => void;
}

export const usePilotUi = create<PilotUi>()((set) => ({
  pilotId: null,
  tab: "inbox",
  setPilot: (pilotId, tab) => set((s) => ({ pilotId, tab: tab ?? s.tab })),
  setTab: (tab) => set({ tab }),
  wantConnectors: false,
  askConnectors: (wantConnectors) => set({ wantConnectors }),
}));

/** The pilot on screen: the chosen one if it still exists, else the first. */
export function useShownPilot(): Pilot | undefined {
  const pilots = useAutopilot().pilots;
  const id = usePilotUi((s) => s.pilotId);
  return pilots.find((p) => p.id === id) ?? pilots[0];
}

/** Sends an autopilot request. Resolves with the answer, rejects with the daemon's error. */
export function useApRequest() {
  const client = useClient();
  return <T = unknown>(op: AutopilotOp) => client.req<T>({ m: "autopilot", p: { op } });
}

/** Like `useApRequest`, but a failure becomes a toast and the result is undefined (fire-and-forget buttons). */
export function useApDo() {
  const req = useApRequest();
  return async <T = unknown>(op: AutopilotOp, done?: string): Promise<T | undefined> => {
    try {
      const r = await req<T>(op);
      if (done) toast(done);
      return r;
    } catch (e) {
      toast((e as Error).message, { tone: "danger" });
      return undefined;
    }
  };
}

export function useConnector(id: string): Connector | undefined {
  return useAutopilot().connectors.find((c) => c.id === id);
}

export function useConnectorName() {
  const list = useAutopilot().connectors;
  return (id: string) => list.find((c) => c.id === id)?.manifest.name ?? id;
}
