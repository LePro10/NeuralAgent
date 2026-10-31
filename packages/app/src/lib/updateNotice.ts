// "A new version is available" comes from three checks (this app or web build, the Android APK,
// the host computer), and at start they all finish within seconds. Phones show at most one of
// these notes per start; the rest stay reachable in Settings → Updates. Desktop is unchanged.
import { DESKTOP, toast, type ToastHandle, type ToastOptions } from "@neuralagent/ui";

let shown = false;

const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia(`(min-width: ${DESKTOP}px)`).matches;

/** Shows an update note unless a phone already showed one since it started. */
export function updateNotice(text: string, opts?: ToastOptions): ToastHandle | null {
  if (isPhone() && shown) return null;
  shown = true;
  return toast(text, opts);
}
