/**
 * The host computer as seen from any client (D42). Voice models and update checks are daemon
 * requests (`host_*`), so they work from the desktop window, the web remote and the Android app
 * alike. What only the desktop app can do (hotkey, wake word, installing an update) is forwarded
 * by the daemon to that app while it is open (`host_ui`).
 */
import type { DaemonClient, HostUpdate, ModelInfo } from "@neuralagent/protocol";
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { VoiceApi, VoiceStatus } from "./voice";

/** Pushes from the host that are not part of the synced state. */
export function onHostNotice(client: DaemonClient, topic: string, cb: (data: unknown) => void): () => void {
  return client.onEvent((ev) => {
    if (ev.e === "host_notice" && ev.topic === topic) cb(ev.data);
  });
}

/** Voice models on the host, live (downloads show their progress). */
export function useHostModels(client: DaemonClient): ModelInfo[] | null {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  useEffect(() => {
    const load = () => client.req<ModelInfo[]>({ m: "host_models" }).then(setModels, () => {});
    void load();
    const off = onHostNotice(client, "models", (d) => setModels(d as ModelInfo[]));
    const offHello = client.onHello(() => void load());
    return () => {
      off();
      offHello();
    };
  }, [client]);
  return models;
}

export interface HostVoice {
  api: VoiceApi | null;
  /** The host's desktop app is not open (dictation and wake word live there). */
  appClosed: boolean;
}

/** Dictation and wake word of the host: the local app's own API, or through the daemon from a remote. */
export function useHostVoice(client: DaemonClient, local: VoiceApi | undefined): HostVoice {
  const [remote, setRemote] = useState<VoiceApi | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (local) return;
    const call = <T,>(op: string, args?: unknown) => client.req<T>({ m: "host_ui", p: { op, args } });
    const api: VoiceApi = {
      status: () => call<VoiceStatus>("voice.status"),
      set: (config) => call<void>("voice.set", config),
      download: () => Promise.resolve(), // models are the daemon's (host_model_download)
      learn: () => call<string>("voice.learn"),
      onStatus: (cb) => onHostNotice(client, "voice", (d) => cb(d as VoiceStatus)),
      onCommand: () => () => {},
    };
    let live = true;
    const probe = () =>
      api.status().then(
        () => live && (setRemote(api), setClosed(false)),
        () => live && (setRemote(null), setClosed(true)),
      );
    void probe();
    const off = client.onHello(() => void probe());
    // The app may be opened or closed meanwhile.
    const t = setInterval(() => void probe(), 15_000);
    return () => {
      live = false;
      off();
      clearInterval(t);
    };
  }, [client, local]);
  return local ? { api: local, appClosed: false } : { api: remote, appClosed: closed };
}

// ── updates ──

export interface HostUpdateView {
  info: HostUpdate | null;
  checking: boolean;
  /** Install running: `progress` is 0..1 while downloading, null while the app restarts. */
  installing: { version: string; progress: number | null } | null;
  error?: string;
}

export const useHostUpdate = create<HostUpdateView>(() => ({ info: null, checking: false, installing: null }));

const set = (p: Partial<HostUpdateView>) => useHostUpdate.setState(p);

export async function checkHostUpdate(client: DaemonClient): Promise<HostUpdate | null> {
  set({ checking: true, error: undefined });
  try {
    const info = await client.req<HostUpdate>({ m: "host_update_check" });
    set({ info });
    return info;
  } catch (e) {
    set({ error: (e as Error).message });
    return null;
  } finally {
    set({ checking: false });
  }
}

/** Starts the install on the host's app; resolves when the host runs the new version (or gives up). */
export async function installHostUpdate(client: DaemonClient): Promise<void> {
  const version = useHostUpdate.getState().info?.available;
  if (!version || useHostUpdate.getState().installing) return;
  set({ installing: { version, progress: 0 }, error: undefined });
  try {
    await client.req({ m: "host_ui", p: { op: "update.install" } });
  } catch (e) {
    set({ installing: null, error: (e as Error).message });
    return;
  }
  // The app restarts (the connection to the daemon stays); wait until it reports the new version.
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until && useHostUpdate.getState().installing) {
    await new Promise((r) => setTimeout(r, 4000));
    const info = await client.req<HostUpdate>({ m: "host_update_check" }).catch(() => null);
    if (info && info.current === version) {
      set({ info, installing: null });
      return;
    }
  }
  set({ installing: null, error: "The host did not come back with the new version. Check the NeuralAgent app on it." });
}

/** Progress and failures the host's app reports while installing. */
export function watchHostUpdate(client: DaemonClient): () => void {
  return onHostNotice(client, "update", (d) => {
    const p = d as { done?: number; total?: number | null; error?: string };
    if (p.error) return set({ installing: null, error: p.error });
    const inst = useHostUpdate.getState().installing;
    if (!inst || p.done === undefined) return;
    const progress = p.total ? Math.min(1, p.done / p.total) : 0;
    set({ installing: { ...inst, progress: progress >= 1 ? null : progress } });
  });
}
