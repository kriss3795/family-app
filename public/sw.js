// The House App — service worker: notificaciones push y caché básico
const CACHE = "house-v4";
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(["/", "/equipo.jpg", "/icon-192.png", "/logo.png"])).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/") || u.origin !== location.origin) return;
  // red primero, caché si no hay internet
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || (e.request.mode === "navigate" ? caches.match("/") : Response.error()))));
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "The House App", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "The House App", {
    body: d.body || "", tag: d.tag || undefined, renotify: true,
    icon: "/icon-192.png", badge: "/badge-96.png",
    vibrate: [220, 100, 220], requireInteraction: !!d.requireInteraction,
    data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow(e.notification.data && e.notification.data.url || "/");
  }));
});
