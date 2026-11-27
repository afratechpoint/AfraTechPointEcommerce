importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDtgYq8LipfH9utcvi-V93TTe-QAeKQn5c",
  authDomain: "afra-tech-backup.firebaseapp.com",
  projectId: "afra-tech-backup",
  storageBucket: "afra-tech-backup.firebasestorage.app",
  messagingSenderId: "964585460815",
  appId: "1:964585460815:web:371460059841e85aab063a"
});

const messaging = firebase.messaging();

function resolveSafeNotificationUrl(candidate) {
  if (typeof candidate !== 'string') return '/';
  const trimmed = candidate.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, self.location.origin);
    if (parsed.origin === self.location.origin) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
  } catch (_) {}
  return '/';
}

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload?.notification?.title || 'Afra Tech Point';
  const safeUrl = resolveSafeNotificationUrl(payload?.data?.url);
  const notificationOptions = {
    body: payload?.notification?.body || '',
    icon: payload?.notification?.icon || '/logo.png',
    data: { url: safeUrl },
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const payload = data.notification || data.data || data;
    const title = payload.title || 'New Notification';
    const body = payload.body || '';
    const icon = payload.icon || '/logo.png';
    const url = resolveSafeNotificationUrl(payload.url || data?.data?.url);

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        data: { url },
        tag: 'atp-notification-' + Date.now(),
        renotify: true,
      })
    );
  } catch (_) {}
});

self.addEventListener('install', () => {
  self.skipWaiting();
});

// Purge any legacy HTML/API caches so private customer/admin pages are never served from SW cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(cacheNames.map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const safeRelative = resolveSafeNotificationUrl(event.notification.data?.url);
  const urlToOpen = new URL(safeRelative, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
