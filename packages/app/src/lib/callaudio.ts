/**
 * Where a call with Neural is heard: at the ear (quiet, default) or on the loudspeaker.
 * Android sets the phone's audio route natively (earpiece/speaker, headsets win, proximity
 * sensor). Browsers can only choose an output device with `setSinkId` and most phones list no
 * earpiece there, so the choice is offered where it can work and explained where it cannot.
 */
import { create } from "zustand";
import { useEffect } from "react";
import { usePlatform } from "./store";

export type CallRoute = "earpiece" | "speaker";

/** Native route control on phones (`platform.call.audio`). */
export interface CallAudioApi {
  /** Remembers the route and applies it to a running call; resolves where the sound goes now. */
  set: (route: CallRoute) => Promise<string | void>;
}

const KEY = "na.callRoute";

function load(): CallRoute {
  try {
    return localStorage.getItem(KEY) === "speaker" ? "speaker" : "earpiece";
  } catch {
    return "earpiece";
  }
}

interface View {
  route: CallRoute;
  /** Where the sound goes now ("headset" when one is connected); set by the native side. */
  output?: string;
  /** A browser output labelled as earpiece/receiver exists. */
  webEarpiece: boolean;
}

export const useCallRoute = create<View>(() => ({ route: load(), webEarpiece: false }));

let api: CallAudioApi | null = null;

/** Binds the phone's native route control; applies the saved choice right away. */
export function bindCallAudio(a: CallAudioApi | undefined) {
  api = a ?? null;
  if (api) void api.set(useCallRoute.getState().route).then((o) => o && useCallRoute.setState({ output: o }), () => {});
}

export function setCallRoute(route: CallRoute) {
  try {
    localStorage.setItem(KEY, route);
  } catch {
    /* private mode: the choice lasts until reload */
  }
  useCallRoute.setState({ route });
  void api?.set(route).then((o) => o && useCallRoute.setState({ output: o }), () => {});
}

/** Components that show the choice bind the platform's native API once. */
export function useBindCallAudio() {
  const audio = usePlatform().call?.audio;
  useEffect(() => bindCallAudio(audio), [audio]);
}

/** Can the user pick? Native phones always; browsers only with an earpiece output. */
export function useCanPickRoute(): boolean {
  const audio = usePlatform().call?.audio;
  const web = useCallRoute((s) => s.webEarpiece);
  return !!audio || web;
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** Browser: look for an earpiece-like output (labels exist once the microphone was allowed). */
export async function probeWebOutputs(): Promise<MediaDeviceInfo | null> {
  try {
    if (!("setSinkId" in AudioContext.prototype)) return null;
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    const ear = outs.find((d) => /earpiece|receiver|handset/i.test(d.label)) ?? null;
    useCallRoute.setState({ webEarpiece: !!ear });
    return ear;
  } catch {
    return null;
  }
}

/** Routes the call's audio context for the current choice (browsers). */
export async function applyWebRoute(ctx: AudioContext) {
  const c = ctx as SinkContext;
  if (!c.setSinkId) return;
  const ear = await probeWebOutputs();
  const { route } = useCallRoute.getState();
  try {
    await c.setSinkId(route === "earpiece" && ear ? ear.deviceId : "");
  } catch {
    /* keep the default output */
  }
}
