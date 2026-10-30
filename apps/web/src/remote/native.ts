// Inside the Android app, which loads this page from the relay: FCM push, sign-in in a Custom
// Tab (Google refuses sign-in inside a WebView), status for the widget and the quick tile.
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface NeuralAgentPlugin {
  pushState(): Promise<{ available: boolean; permission: "granted" | "denied" | "prompt" }>;
  pushToken(): Promise<{ token: string }>;
  dropToken(): Promise<void>;
  setStatus(o: { computer: string; running: number; working: number; waiting: number }): Promise<void>;
  setNames(o: { json: string }): Promise<void>;
  pinWidget(): Promise<{ ok: boolean }>;
  callActive(o: { on: boolean }): Promise<void>;
  addListener(event: "dial", cb: (o: { start: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: "open", cb: (o: { host: string | null; sid: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "token", cb: (o: { token: string }) => void): Promise<PluginListenerHandle>;
}

export const plugin = registerPlugin<NeuralAgentPlugin>("NeuralAgent");

/** Where the relay sends the browser back to after sign-in; the app catches this link. */
export const REDIRECT = "neuralagent://auth";

export const signIn = (url: string) => Browser.open({ url, presentationStyle: "popover" });

/** The installed APK's version. The page itself always comes fresh from the relay. */
export const apkVersion = () => App.getInfo().then((i) => i.version);

/** Outside the app, so Android downloads the file and offers to install it. */
export const openOutside = (url: string) => Browser.open({ url });

// Links that open the app: the sign-in return and pairing QR codes. Both continue in this page.
function opened(url: string) {
  const u = new URL(url);
  if (u.protocol === "neuralagent:") {
    void Browser.close().catch(() => {});
    location.replace(`/app/${u.search}`);
  } else if (u.pathname.startsWith("/app/pair")) {
    location.replace(`/app/pair${u.hash}`);
  }
}
void App.addListener("appUrlOpen", (e) => opened(e.url));
void App.getLaunchUrl().then((l) => {
  if (l?.url && !location.search && !location.pathname.startsWith("/app/pair")) opened(l.url);
});

export const onActive = (cb: (active: boolean) => void) => void App.addListener("appStateChange", (s) => cb(s.isActive));
