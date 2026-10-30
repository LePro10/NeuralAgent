import type { CapacitorConfig } from "@capacitor/cli";

// The app is the web remote served by the relay (`/app`), wrapped with native push, sign-in
// in a Custom Tab, a quick-settings tile and a widget. NA_REMOTE_URL points a debug build at a
// local relay, e.g. http://10.0.2.2:8095/app/ from the emulator.
const url = process.env.NA_REMOTE_URL ?? "https://agent.neuralhub.dev/app/";

const config: CapacitorConfig = {
  appId: "dev.neuralhub.neuralagent",
  appName: "NeuralAgent",
  webDir: "www",
  server: { url, cleartext: url.startsWith("http://"), androidScheme: "https" },
  android: { allowMixedContent: false },
};

export default config;
