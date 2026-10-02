/* eslint-disable no-undef */
/**
 * Service Worker لإشعارات Zena AI (Firebase Cloud Messaging — Web Push).
 *
 * - يستورد مكتبة Firebase (compat) داخل try/catch حتى لا يسقط تقييم السكربت
 *   عند تعذّر تحميل CDN — فيبقى استقبال الـ push العادي يعمل.
 * - الإعدادات العامة تُقرأ من نفس النطاق (/api/firebase-config) فلا أسرار هنا.
 * - إنشاء التوكن يتم من داخل الصفحة، وهذا الملف يستقبل الرسائل في الخلفية فقط.
 */

const DEFAULT_TITLE = 'إشعار من Zena AI';
const DEFAULT_ICON = '/zena-ai-icon.svg';
const DEFAULT_URL = '/dashboard';
const SITE_NAME_CACHE = 'zena-site-name';
const SITE_NAME_KEY = '/__zena-site-name';

let firebaseReady = false;

try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebaseReady = true;
} catch {
  firebaseReady = false;
}

async function saveSiteName(name) {
  try {
    const cache = await caches.open(SITE_NAME_CACHE);
    await cache.put(SITE_NAME_KEY, new Response(String(name)));
  } catch {
    /* غير حاسم */
  }
}

async function loadSiteName() {
  try {
    const cache = await caches.open(SITE_NAME_CACHE);
    const stored = await cache.match(SITE_NAME_KEY);
    return stored ? (await stored.text()).trim() : '';
  } catch {
    return '';
  }
}

/** تهيئة Firebase من إعدادات الخادم العامة ثم الاستماع لرسائل الخلفية. */
async function initFirebaseMessaging() {
  if (!firebaseReady) return;
  try {
    const response = await fetch('/api/firebase-config');
    const config = await response.json();
    if (!config || !config.configured) return;
    firebase.initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId
    });
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const notification = payload.notification || {};
      const data = payload.data || {};
      const title = notification.title || data.title || DEFAULT_TITLE;
      const body = notification.body || data.body || '';
      const url = data.url || (payload.fcmOptions && payload.fcmOptions.link) || DEFAULT_URL;
      self.registration.showNotification(title, {
        body,
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        dir: 'rtl',
        lang: 'ar',
        tag: 'zena-notification',
        data: { url }
      });
    });
  } catch {
    /* يعمل الـ push العادي بدون Firebase */
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if ('clients' in self && self.clients.claim) await self.clients.claim();
      await initFirebaseMessaging();
    })()
  );
});

/** استخراج { title, body, url } من حمولة الـ push مهما اختلف شكلها. */
function readPushPayload(event) {
  if (!event.data) return null;
  let payload = null;
  try {
    payload = event.data.json();
  } catch {
    return { title: null, body: event.data.text() || '', url: DEFAULT_URL };
  }
  const notification = payload.notification || (payload.webpush && payload.webpush.notification) || {};
  const data = payload.data || {};
  const options = payload.fcmOptions || payload.fcm_options || {};
  return {
    title: notification.title || data.title || null,
    body: notification.body || data.body || '',
    url: data.url || options.link || DEFAULT_URL
  };
}

async function announceToOpenTabs(push) {
  try {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      client.postMessage({ type: 'zena:push', push });
    }
  } catch {
    /* غير حاسم */
  }
}

self.addEventListener('push', (event) => {
  const push = readPushPayload(event);
  if (!push || (!push.title && !push.body)) return;
  event.waitUntil(
    loadSiteName().then((siteName) => {
      const title = push.title || (siteName ? `إشعار من ${siteName}` : DEFAULT_TITLE);
      return Promise.all([
        self.registration.showNotification(title, {
          body: push.body,
          icon: DEFAULT_ICON,
          badge: DEFAULT_ICON,
          dir: 'rtl',
          lang: 'ar',
          tag: 'zena-notification',
          data: { url: push.url }
        }),
        announceToOpenTabs({ ...push, title })
      ]);
    })
  );
});

async function focusOrOpen(targetUrl) {
  const target = new URL(targetUrl, self.location.origin).href;
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    if (client.url === target && 'focus' in client) return client.focus();
  }
  for (const client of clientList) {
    if ('navigate' in client) {
      await client.navigate(target);
      return 'focus' in client ? client.focus() : undefined;
    }
  }
  if (self.clients.openWindow) return self.clients.openWindow(target);
  return undefined;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(focusOrOpen(data.url || DEFAULT_URL));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'ZENA_SITE_NAME' && event.data.name) {
    event.waitUntil(saveSiteName(event.data.name));
  }
});
