/**
 * Firebase للإشعارات فقط — لا Auth ولا Firestore.
 * - الواجهة: مكتبة Firebase JS (compat عبر CDN) + مفتاح VAPID لتوكنات Web Push.
 * - الخادم: Firebase Admin SDK (FCM) لإرسال الـ push — اختياري، وبدونه
 *   تُحفظ الإشعارات داخل الموقع فقط.
 * - كل بيانات المستخدمين والنقطةات في PostgreSQL (جداول notifications وdevice_tokens).
 */

const OPTIONAL_WEB_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID'
];

/** إعدادات الواجهة العامة (مفاتيح غير سرية — تُرسل للمتصفح عبر /api/firebase-config). */
export function firebaseWebConfig() {
  const config = {
    apiKey: (process.env.FIREBASE_API_KEY || '').trim(),
    authDomain: (process.env.FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(),
    storageBucket: (process.env.FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: (process.env.FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: (process.env.FIREBASE_APP_ID || '').trim()
  };
  const vapidKey = (process.env.FIREBASE_VAPID_KEY || '').trim();
  const configured = Boolean(config.apiKey && config.projectId && config.appId);
  return { ...config, vapidKey, configured };
}

export function isFirebaseWebConfigured() {
  return firebaseWebConfig().configured;
}

/** إعدادات الخادم (Service Account — سرية ولا تخرج من الخادم أبداً). */
function fcmServerConfig() {
  const projectId = (process.env.FCM_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FCM_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return { projectId, clientEmail, privateKey, configured: Boolean(projectId && clientEmail && privateKey) };
}

export function isFcmServerConfigured() {
  return fcmServerConfig().configured;
}

let adminMessagingPromise = null;

/** تهيئة Firebase Admin كسولاً (dynamic import حتى لا ينهار الخادم بدون الاعتماد). */
async function adminMessaging() {
  if (!isFcmServerConfigured()) return null;
  if (!adminMessagingPromise) {
    adminMessagingPromise = (async () => {
      try {
        const admin = (await import('firebase-admin')).default;
        const { projectId, clientEmail, privateKey } = fcmServerConfig();
        if (admin.apps.length === 0) {
          admin.initializeApp({
            credential: admin.credential.cert({ projectId, clientEmail, privateKey })
          });
        }
        return admin.messaging();
      } catch (error) {
        console.warn(`تعذّرت تهيئة Firebase Admin للإشعارات: ${error.message}`);
        return null;
      }
    })();
  }
  return adminMessagingPromise;
}

/**
 * إرسال push عبر FCM لتوكنات جهاز معينة.
 * يعيد { sent, failed, invalidTokens } — التوكنات الميتة تُحذف من قاعدة البيانات.
 */
export async function sendPushToTokens(tokens, { title, body = '', url = '/account' } = {}) {
  const unique = [...new Set((tokens || []).filter(Boolean))].slice(0, 500);
  if (!unique.length) return { sent: 0, failed: 0, invalidTokens: [], skipped: 'no-tokens' };
  const messaging = await adminMessaging();
  if (!messaging) return { sent: 0, failed: 0, invalidTokens: [], skipped: 'fcm-not-configured' };

  try {
    const response = await messaging.sendEachForMulticast({
      tokens: unique,
      notification: { title: String(title).slice(0, 120), body: String(body).slice(0, 500) },
      webpush: {
        notification: { icon: '/zena-ai-icon.svg', badge: '/zena-ai-icon.svg', dir: 'rtl', lang: 'ar' },
        fcmOptions: { link: url }
      },
      data: { title: String(title).slice(0, 120), body: String(body).slice(0, 500), url }
    });
    const invalidTokens = [];
    (response.responses || []).forEach((item, index) => {
      if (!item.success) {
        const code = item.error?.code || '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          invalidTokens.push(unique[index]);
        }
      }
    });
    return { sent: response.successCount || 0, failed: response.failureCount || 0, invalidTokens, skipped: '' };
  } catch (error) {
    console.warn(`تعذّر إرسال push عبر FCM: ${error.message}`);
    return { sent: 0, failed: unique.length, invalidTokens: [], skipped: 'send-error' };
  }
}
