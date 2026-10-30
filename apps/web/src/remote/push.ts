// Web Push for the web remote: the service worker, the subscription the relay pushes to, and
// "open this agent" requests from notification taps.
import { account, ios } from "./session";

const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export type PushState = "unsupported" | "install" | "denied" | "off" | "on";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let worker: Promise<ServiceWorkerRegistration | null> = Promise.resolve(null);

/** Registers the service worker; safe to call once at start. */
export function startWorker() {
  if (!("serviceWorker" in navigator)) return;
  worker = navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch((e) => {
    console.warn(`remote: service worker: ${(e as Error).message}`);
    return null;
  });
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.t === "open" && typeof e.data.sid === "string") request(e.data.host, e.data.sid);
  });
}

export async function pushState(): Promise<PushState> {
  // iPhone and iPad only offer Web Push to an app added to the Home Screen.
  if (ios && !standalone) return "install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await worker;
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

const toKey = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function target(sub: PushSubscription) {
  const k = sub.toJSON().keys ?? {};
  return { web: { endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth } };
}

/** Asks for permission (call from a tap) and registers this browser with the relay. */
export async function enablePush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== "granted") return pushState();
  const reg = await worker;
  if (!reg) throw new Error("This browser could not start the notification service.");
  const { vapid } = await fetch("/api/config").then((r) => r.json());
  if (!vapid) throw new Error("The relay does not offer notifications.");
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for another relay key is useless: start over.
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== vapid) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapid) });
  await account.api("PUT", "/api/me/push", target(sub));
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await worker)?.pushManager.getSubscription();
  await account.api("PUT", "/api/me/push", null);
  await sub?.unsubscribe();
  return pushState();
}

/** Push services rotate endpoints: tell the relay the current one on every start. */
export async function syncPush() {
  if (!account.signedIn || (await pushState()) !== "on") return;
  const sub = await (await worker)?.pushManager.getSubscription();
  if (sub) await account.api("PUT", "/api/me/push", target(sub)).catch(() => {});
}

// ───────────── open this agent ─────────────

type Open = { host: string | null; sid: string };
let pending: Open | null = null;
const listeners = new Set<(o: Open) => void>();

function request(host: string | null, sid: string) {
  pending = { host, sid };
  for (const l of listeners) l(pending);
}

/** `/app/?host=…&sid=…` from a notification that opened a new window. */
export function takeLaunchRequest(): Open | null {
  const q = new URLSearchParams(location.search);
  const sid = q.get("sid");
  if (!sid) return null;
  history.replaceState(null, "", "/app/");
  pending = { host: q.get("host"), sid };
  return pending;
}

/** The next "open this agent" request, also one that came before the listener. */
export function onOpenRequest(cb: (o: Open) => void): () => void {
  listeners.add(cb);
  if (pending) cb(pending);
  return () => void listeners.delete(cb);
}

/** The request was handled. */
export function doneOpening(sid: string) {
  if (pending?.sid === sid) pending = null;
}

/** Agent names for notifications; stays on this device, the push itself has no names. */
export function rememberNames(json: string) {
  if (!("caches" in window)) return;
  void caches
    .open("na-remote")
    .then((c) => c.put("/app/__names", new Response(json, { headers: { "content-type": "application/json" } })))
    .catch(() => {});
}
