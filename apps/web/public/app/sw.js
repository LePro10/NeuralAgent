// Web remote service worker: shows "an agent needs you" pushes and opens that agent on tap.
// A push carries only {t, kind, host, sid}; agent names come from this device's own cache.
const NAMES = "/app/__names";
const TITLE = { waiting: "Needs your input", done: "Finished", error: "Stopped with an error" };

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function nameOf(sid) {
  try {
    const res = await (await caches.open("na-remote")).match(NAMES);
    return (res && (await res.json())[sid]) || "Agent";
  } catch {
    return "Agent";
  }
}

self.addEventListener("push", (e) => {
  let n = {};
  try {
    n = e.data ? e.data.json() : {};
  } catch {}
  e.waitUntil(
    (async () => {
      if (n.t !== "attention") return self.registration.showNotification("NeuralAgent", { body: "Something needs your attention.", icon: "/app/icon-192.png" });
      // Always show something: Safari drops subscriptions whose pushes stay silent. The relay
      // already skips devices that are on screen.
      return self.registration.showNotification(await nameOf(n.sid), {
        body: TITLE[n.kind] || "Needs your attention",
        icon: "/app/icon-192.png",
        badge: "/app/icon-192.png",
        tag: n.sid,
        renotify: true,
        data: { host: n.host, sid: n.sid },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { host, sid } = e.notification.data || {};
  e.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = open.find((c) => new URL(c.url).pathname.startsWith("/app"));
      if (win) {
        win.postMessage({ t: "open", host, sid });
        return win.focus();
      }
      const q = host && sid ? `?${new URLSearchParams({ host, sid })}` : "";
      return self.clients.openWindow(`/app/${q}`);
    })(),
  );
});
