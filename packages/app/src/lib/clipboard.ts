/**
 * Writing text to the clipboard everywhere the app runs: the native shell first when it offers it
 * (Android WebViews may refuse navigator.clipboard), then the async Clipboard API (secure contexts),
 * then a hidden textarea + execCommand("copy") (plain http on a LAN, older WebViews).
 */
import { toast } from "@neuralagent/ui";
import type { Platform } from "./platform";

function execCopy(text: string): boolean {
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  // Off the layout but focusable; 16px keeps iOS from zooming in.
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none";
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  before?.focus({ preventScroll: true });
  return ok;
}

/** Puts `text` on the system clipboard; false when every way was refused. */
export async function writeClipboard(text: string, platform?: Pick<Platform, "copyText">): Promise<boolean> {
  if (platform?.copyText) {
    try {
      await platform.copyText(text);
      return true;
    } catch {
      /* fall through to the web ways */
    }
  }
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* not allowed here (permissions policy, no focus): try the old way */
    }
  }
  return execCopy(text);
}

/** Copies and says so ("Copied" / why not). */
export async function copyWithToast(text: string, platform?: Pick<Platform, "copyText">, what = "Copied"): Promise<boolean> {
  if (!text) {
    toast("Nothing to copy");
    return false;
  }
  const ok = await writeClipboard(text, platform);
  if (ok) toast(what, { duration: 1600 });
  else toast("Could not copy: the browser blocked the clipboard", { tone: "danger" });
  return ok;
}

/** Text on the clipboard, or null when the page may not read it. */
export async function readClipboardText(): Promise<string | null> {
  try {
    return (await navigator.clipboard?.readText?.()) ?? null;
  } catch {
    return null;
  }
}
