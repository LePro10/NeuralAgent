/**
 * The one clipboard path for the whole app (desktop, web remote, Android). Writing: the native
 * shell first when it offers it (Tauri: no user gesture needed, so programs in a terminal can copy;
 * Android WebViews may refuse navigator.clipboard), then the async Clipboard API (secure contexts),
 * then a hidden textarea + execCommand("copy") (plain http on a LAN, older WebViews).
 * Reading: the native shell (WebKit would show its own "Paste" bubble), then the async API.
 */
import { toast } from "@neuralagent/ui";
import type { Platform } from "./platform";

type Native = Pick<Platform, "copyText" | "readClipboardText">;

/** The shell's clipboard, set once by DaemonProvider so callers need not pass the platform. */
let native: Native = {};
export function setClipboardPlatform(p: Native): void {
  native = p;
}

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
export async function writeClipboard(text: string, platform: Pick<Platform, "copyText"> = native): Promise<boolean> {
  const viaShell = platform.copyText ?? native.copyText;
  if (viaShell) {
    try {
      await viaShell(text);
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
export async function copyWithToast(text: string, platform: Pick<Platform, "copyText"> = native, what = "Copied"): Promise<boolean> {
  if (!text) {
    toast("Nothing to copy");
    return false;
  }
  const ok = await writeClipboard(text, platform);
  if (ok) toast(what, { duration: 1600 });
  else toast("Could not copy: the browser blocked the clipboard", { tone: "danger" });
  return ok;
}

/**
 * Copies text a program in a terminal asked for (OSC 52). That arrives without a click, so a
 * browser may refuse it: then a toast offers the copy as a button (the click makes it allowed).
 */
export async function copyFromProgram(text: string): Promise<boolean> {
  if (await writeClipboard(text)) {
    toast("Copied", { duration: 1400 });
    return true;
  }
  toast("Selection ready to copy", { actionLabel: "Copy", undo: () => void copyWithToast(text) });
  return false;
}

/** Text on the clipboard, or null when the page may not read it. */
export async function readClipboardText(): Promise<string | null> {
  if (native.readClipboardText) {
    try {
      return await native.readClipboardText();
    } catch {
      /* fall through to the web way */
    }
  }
  try {
    return (await navigator.clipboard?.readText?.()) ?? null;
  } catch {
    return null;
  }
}
