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
  // Tells the page that this shell hands its splash over to the page's launch screen (MainActivity,
  // packages/app lib/launch.ts), so the page waits for the splash to fade before its motion.
  appendUserAgent: "NeuralAgentLaunch/1",
  android: { allowMixedContent: false },
};

export default config;
