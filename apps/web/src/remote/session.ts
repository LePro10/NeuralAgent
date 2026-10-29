// The web remote's account and relay link, shared by every screen. One per tab.
import { localStore, memoryKeyStore, RelayLink, RemoteAccount, webKeyStore } from "@neuralagent/remote";
import { useEffect, useReducer } from "react";

const ua = navigator.userAgent;
const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
const os = ios ? (/iPad/.test(ua) ? "iPad" : "iPhone") : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";

/** How this browser shows up in the device list, e.g. "Safari on iPhone". */
export const deviceName = os ? `${browser} on ${os}` : browser;

const store = localStore();
export const account = await RemoteAccount.open({
  relay: location.origin,
  store,
  // A private window may have no IndexedDB; the key then lives as long as the tab.
  keys: "indexedDB" in window ? webKeyStore(store) : memoryKeyStore(),
  device: { name: deviceName, platform: ios ? "ios" : "web" },
});

export const link = new RelayLink(account);

/** Re-render when the account or the relay link changes. */
export function useLink() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const a = account.onChange(bump);
    const b = link.subscribe(bump);
    return () => (a(), b());
  }, []);
  return link;
}

const LAST = "na-remote:host";
export const lastHost = {
  get: () => {
    try {
      return localStorage.getItem(LAST);
    } catch {
      return null;
    }
  },
  set: (id: string | null) => {
    try {
      if (id) localStorage.setItem(LAST, id);
      else localStorage.removeItem(LAST);
    } catch {}
  },
};

export const REDIRECT = `${location.origin}/app/`;
