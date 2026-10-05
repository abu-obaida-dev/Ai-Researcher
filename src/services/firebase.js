/**
 * Firebase للإشعارات فقط — لا Auth ولا Firestore.
 * - الواجهة: مكتبة Firebase JS (compat عبر CDN) + مفتاح VAPID لتوكنات Web Push.
 * - الخادم: Firebase Admin SDK (FCM) لإرسال الـ push.
 * - كل بيانات المستخدمين والتوكنات في PostgreSQL (notifications و device_tokens).
 *
 * مفتاحان اثنان لا ثالث لهما:
 *   1) **مفاتيح الواجهة** (غير سرّية) في ملف البيئة `FIREBASE_*` مع بقية الإعدادات.
 *   2) **المفتاح الخاص للإرسال** في ملف حساب الخدمة `*firebase-adminsdk*.json` بجذر المشروع،
 *      نقرأه من مساره مباشرةً فلا يُنسخ أبداً إلى .env ولا إلى أي واجهة.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const OPTIONAL_WEB_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID'
];

/** يجد ملف حساب الخدمة في جذر المشروع تلقائياً إن لم يُحدَّد مساره في البيئة. */
function findServiceAccountFile() {
  const configured = String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || '').trim();
  if (configured) return path.resolve(ROOT_DIR, configured);

  try {
    const match = readdirSync(ROOT_DIR).find((name) => /^[^/]*firebase-adminsdk[^/]*\.json$/.test(name));
    return match ? path.join(ROOT_DIR, match) : '';
  } catch {
    return '';
  }
}

let serviceAccountCache;

/**
 * حساب الخدمة من ملفه: لا يرمي خطأ أبداً — غياب الملف يعني «الإرسال غير مفعّل» فقط.
 * يُقرأ مرة واحدة ويُخزَّن (المفتاح الخاص لا يُطبع ولا يُعاد تدويره).
 */
function serviceAccount() {
  if (serviceAccountCache !== undefined) return serviceAccountCache;
  serviceAccountCache = null;

  const file = findServiceAccountFile();
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed?.project_id && parsed?.client_email && parsed?.private_key) {
        serviceAccountCache = {
          projectId: String(parsed.project_id).trim(),
          clientEmail: String(parsed.client_email).trim(),
          privateKey: String(parsed.private_key).replace(/\\n/g, '\n')
        };
      }
    } catch (error) {
      console.warn(`تعذّرت قراءة ملف حساب خدمة Firebase (${path.basename(file)}): ${error.message}`);
    }
  }
  return serviceAccountCache;
}

/** إعدادات الواجهة العامة (مفاتيح غير سرّية — تُرسل للمتصفح عبر /api/firebase-config). */
export function firebaseWebConfig() {
  const account = serviceAccount();

  // المفاتيح كلها من ملف البيئة (ملف واحد لكل شيء).
  // و projectId يكمله حساب الخدمة من ملفه حتى لا يتكرر في مكانين.
  const config = {
    apiKey: (process.env.FIREBASE_API_KEY || '').trim(),
    authDomain: (process.env.FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: (process.env.FIREBASE_PROJECT_ID || '').trim() || account?.projectId || '',
    storageBucket: (process.env.FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: (process.env.FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: (process.env.FIREBASE_APP_ID || '').trim()
  };
  const vapidKey = (process.env.FIREBASE_VAPID_KEY || '').trim();

  return {
    ...config,
    vapidKey,
    configured: Boolean(config.apiKey && config.projectId && config.appId),
    // حقائق للمدير فقط: ما ينقصه بالضبط (بلا أي سرّ)
    serverReady: Boolean(account || (process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL)),
    vapidReady: Boolean(vapidKey)
  };
}

export function isFirebaseWebConfigured() {
  return firebaseWebConfig().configured;
}

/** إعدادات الخادم (Service Account — سرية ولا تخرج من الخادم أبداً). */
function fcmServerConfig() {
  const account = serviceAccount();
  const projectId = (process.env.FCM_PROJECT_ID || '').trim() || account?.projectId || '';
  const clientEmail = (process.env.FCM_CLIENT_EMAIL || '').trim() || account?.clientEmail || '';
  const privateKey = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n') || account?.privateKey || '';
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
