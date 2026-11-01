/** Firebase Cloud Messaging integration; user data and device tokens remain in PostgreSQL. */
import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DEFAULT_WEB_CONFIG = {
  apiKey: 'AIzaSyDwrVoVdykaGbU9ScPvZJDgdy5kQ0sgbHg',
  authDomain: 'zena-ai-e5164.firebaseapp.com',
  projectId: 'zena-ai-e5164',
  storageBucket: 'zena-ai-e5164.firebasestorage.app',
  messagingSenderId: '725694405420',
  appId: '1:725694405420:web:e0510342dac2fa235f2a89',
  measurementId: 'G-8LP5JXKHG2',
  vapidKey: 'BNhSRvfEaEa4q1Tl8raRJub-xjZjlOtLsgqRfhwxwZvQKoQRwCeiVWl4sWuvqR8DA2rr0v4YIO-Ec6Ncb0QdVOs'
};

/** Uses the configured service-account path; an unconfigured root-level key is a warned fallback. */
function findServiceAccountFile() {
  const configured = String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || '').trim();
  if (configured) {
    // Expand the home-directory shorthand.
    const expanded = configured.startsWith('~/') ? path.join(os.homedir(), configured.slice(2)) : configured;
    return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(ROOT_DIR, expanded);
  }

  try {
    const match = readdirSync(ROOT_DIR).find((name) => /^[^/]*firebase-adminsdk[^/]*\.json$/.test(name));
    if (match) {
      console.warn(
        [
          '⚠️  ملف حساب خدمة Firebase داخل جذر المشروع — أنقله خارج المجلد فوراً:',
          `    mkdir -p ~/.config/zena && mv "${match}" ~/.config/zena/ && chmod 600 ~/.config/zena/*.json`,
          '    ثم أضف في .env:  FIREBASE_SERVICE_ACCOUNT_FILE=~/.config/zena/' + match
        ].join('\n')
      );
      return path.join(ROOT_DIR, match);
    }
  } catch {
    return '';
  }
  return '';
}

let serviceAccountCache;

/** Loads and caches the service account without exposing private-key material. */
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

/** Returns public Firebase settings safe to expose to the browser. */
export function firebaseWebConfig() {
  const account = serviceAccount();

  // Fall back to the service-account project ID to avoid duplicate configuration.
  const config = {
    apiKey: (process.env.FIREBASE_API_KEY || DEFAULT_WEB_CONFIG.apiKey).trim(),
    authDomain: (process.env.FIREBASE_AUTH_DOMAIN || DEFAULT_WEB_CONFIG.authDomain).trim(),
    projectId: (process.env.FIREBASE_PROJECT_ID || DEFAULT_WEB_CONFIG.projectId).trim() || account?.projectId || '',
    storageBucket: (process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_WEB_CONFIG.storageBucket).trim(),
    messagingSenderId: (process.env.FIREBASE_MESSAGING_SENDER_ID || DEFAULT_WEB_CONFIG.messagingSenderId).trim(),
    appId: (process.env.FIREBASE_APP_ID || DEFAULT_WEB_CONFIG.appId).trim(),
    measurementId: (process.env.FIREBASE_MEASUREMENT_ID || DEFAULT_WEB_CONFIG.measurementId).trim()
  };
  const vapidKey = (process.env.FIREBASE_VAPID_KEY || DEFAULT_WEB_CONFIG.vapidKey).trim();

  return {
    ...config,
    vapidKey,
    configured: Boolean(config.apiKey && config.projectId && config.appId),
    // Readiness flags contain no secret values.
    serverReady: Boolean(account || (process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL)),
    vapidReady: Boolean(vapidKey)
  };
}

export function isFirebaseWebConfigured() {
  return firebaseWebConfig().configured;
}

/** Returns server-only FCM credentials. */
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

/** Lazily imports Firebase Admin so the app can run without the optional dependency. */
async function adminMessaging() {
  if (!isFcmServerConfigured()) return null;
  if (!adminMessagingPromise) {
    adminMessagingPromise = (async () => {
      try {
        const { initializeApp, getApps, cert } = await import('firebase-admin');
        const { getMessaging } = await import('firebase-admin/messaging');
        const { projectId, clientEmail, privateKey } = fcmServerConfig();
        const existing = getApps().find((app) => app.name === '[DEFAULT]');
        const app = existing || initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
        return getMessaging(app);
      } catch (error) {
        console.warn(`تعذّرت تهيئة Firebase Admin للإشعارات: ${error.message}`);
        return null;
      }
    })();
  }
  return adminMessagingPromise;
}

/** Sends push notifications and returns invalid device tokens for cleanup. */
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
