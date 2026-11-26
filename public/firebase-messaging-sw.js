console.log('[SW] Firebase Messaging Service Worker Loading v8...');

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const CACHE_NAME = 'afra-tech-point-v8';

firebase.initializeApp({
  apiKey: "AIzaSyDtgYq8LipfH9utcvi-V93TTe-QAeKQn5c",
  authDomain: "afra-tech-backup.firebaseapp.com",
  projectId: "afra-tech-backup",
  storageBucket: "afra-tech-backup.firebasestorage.app",
  messagingSenderId: "964585460815",
  appId: "1:964585460815:web:371460059841e85aab063a"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload?.notification?.title || 'Afra Tech Point';
  const notificationOptions = {
    body: payload?.notification?.body || '',
    icon: payload?.notification?.icon || '/logo.png',
    data: payload?.data,
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
    const url = payload.url || '/';

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        data: { url },
        tag: 'atp-notification-' + Date.now(),
        renotify: true,
      })
    );
  } catch (err) {
    console.error('[SW] Error parsing push data:', err);
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TEST_NOTIFICATION') {
    self.registration.showNotification(event.data.title, {
      body: event.data.body,
      icon: '/logo.png',
      tag: 'atp-debug',
    });
  }
});

self.addEventListener('install', () => {
  self.skipWaiting();
});

// Purge all old HTML/chunk caches so pages and JS bundles are NEVER served stale
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
  const urlToOpen = event.notification.data?.url || '/';

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
