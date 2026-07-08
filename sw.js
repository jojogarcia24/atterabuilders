/* sw.js — Aterra Builders service worker (web-push notifications for admins/agents) */
self.addEventListener('push', function (e) {
  var d = (function () { try { return e.data.json(); } catch (_) { return {}; } })();
  e.waitUntil(self.registration.showNotification(d.title || 'New alert', {
    body: d.body || '',
    data: { url: d.url || '/' },
    tag: d.tag,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png'
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data && e.notification.data.url || '/'));
});
