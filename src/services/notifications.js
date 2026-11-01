import { pool } from '../db/client.js';
import {
  firebaseWebConfig,
  isFirebaseWebConfigured,
  isFcmServerConfigured,
  sendPushToTokens
} from './firebase.js';

/** Stores in-app notifications and optionally sends push notifications through FCM. */

// Re-export Firebase configuration helpers from one module.
export { firebaseWebConfig, isFirebaseWebConfigured, isFcmServerConfigured };

/** Stores an in-app notification. */
export async function saveNotification(userId, { title, body = '', kind = 'system', url = '/account' }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, title, body, kind, url)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      userId,
      String(title || '').slice(0, 255),
      String(body || '').slice(0, 2000),
      String(kind || 'system').slice(0, 50),
      String(url || '/account').slice(0, 500)
    ]
  );
  return rows[0];
}

/** Lists enabled device tokens for a user. */
async function deviceTokens(userId) {
  try {
    const { rows } = await pool.query(
      'SELECT token FROM device_tokens WHERE user_id = $1 AND enabled = true',
      [userId]
    );
    return rows.map((row) => row.token).filter(Boolean);
  } catch {
    return [];
  }
}

/** Sends push notifications and returns per-device results without throwing. */
export async function sendPushToUser(userId, { title, body = '', url = '/account' }) {
  const result = { sent: 0, failed: 0, skipped: 0, error: '' };

  if (!isFcmServerConfigured()) {
    result.error = 'مفاتيح FCM غير مضبوطة على الخادم — حُفظ الإشعار داخل الموقع فقط.';
    return result;
  }

  const tokens = await deviceTokens(userId);
  if (!tokens.length) {
    result.skipped = 1;
    result.error = 'لا توجد أجهزة مسجّلة لهذا المستخدم.';
    return result;
  }

  try {
    const push = await sendPushToTokens(tokens, { title, body, url });
    result.sent = push.sent;
    result.failed = push.failed;
    // Remove invalid tokens to avoid repeated FCM failures.
    if (push.invalidTokens?.length) {
      await pool.query('DELETE FROM device_tokens WHERE user_id = $1 AND token = ANY($2)', [
        userId,
        push.invalidTokens
      ]);
    }
    if (push.skipped === 'send-error') {
      result.error = 'تعذّر الإرسال عبر FCM — أُبقي الإشعار داخل الموقع.';
    }
  } catch (error) {
    result.error = `تعذّر إرسال الإشعار: ${error.code || error.message}`;
  }

  return result;
}

/** Stores an in-app copy and attempts push delivery. */
export async function notifyUser(userId, { title, body = '', kind = 'system', url = '/account' }) {
  try {
    const saved = await saveNotification(userId, { title, body, kind, url });
    const push = await sendPushToUser(userId, { title, body, url });
    return { saved, push };
  } catch (error) {
    console.warn(`تعذّر حفظ إشعار للمستخدم ${userId}: ${error.code || error.message}`);
    return {
      saved: null,
      push: { sent: 0, failed: 0, skipped: 1, error: error.code || error.message }
    };
  }
}

/** Registers or re-enables a device token. */
export async function registerDeviceToken(userId, token, platform = 'web') {
  const clean = String(token || '').trim();
  if (clean.length < 20 || clean.length > 4096) {
    throw new Error('توكن الإشعارات غير صالح.');
  }

  const { rows } = await pool.query(
    `INSERT INTO device_tokens (user_id, token, platform, enabled, updated_at)
     VALUES ($1, $2, $3, true, NOW())
     ON CONFLICT (user_id, token)
     DO UPDATE SET enabled = true, platform = EXCLUDED.platform, updated_at = NOW()
     RETURNING id`,
    [userId, clean, String(platform || 'web').slice(0, 50)]
  );
  await setNotificationsEnabled(userId, true);
  return rows[0];
}

/** Disables a device token. */
export async function disableDeviceToken(userId, token) {
  const clean = String(token || '').trim();
  if (!clean) return false;

  const { rowCount } = await pool.query(
    'UPDATE device_tokens SET enabled = false, updated_at = NOW() WHERE user_id = $1 AND token = $2',
    [userId, clean]
  );
  const remaining = await activeDeviceCount(userId);
  if (remaining === 0) await setNotificationsEnabled(userId, false);
  return rowCount > 0;
}

/** Lists the user's latest notifications. */
export async function listNotifications(userId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await pool.query(
    `SELECT id, title, body, kind, url, read, created_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, safeLimit]
  );
  return rows;
}

/** Returns the unread notification count. */
export async function unreadCount(userId) {
  try {
    const { rows } = await pool.query(
      'SELECT count(*)::int AS total FROM notifications WHERE user_id = $1 AND read = false',
      [userId]
    );
    return rows[0].total;
  } catch {
    return 0;
  }
}

/** Marks one notification as read; invalid IDs return false. */
export async function markNotificationRead(userId, id) {
  try {
    const { rowCount } = await pool.query(
      'UPDATE notifications SET read = true WHERE user_id = $1 AND id = $2',
      [userId, String(id || '')]
    );
    return rowCount > 0;
  } catch {
    return false;
  }
}

/** Marks all notifications as read. */
export async function markAllNotificationsRead(userId) {
  try {
    const { rowCount } = await pool.query(
      'UPDATE notifications SET read = true WHERE user_id = $1 AND read = false',
      [userId]
    );
    return rowCount;
  } catch {
    return 0;
  }
}

/** Deletes an owned notification; invalid IDs return false. */
export async function deleteNotification(userId, id) {
  try {
    const { rowCount } = await pool.query('DELETE FROM notifications WHERE user_id = $1 AND id = $2', [
      userId,
      String(id || '')
    ]);
    return rowCount > 0;
  } catch {
    return false;
  }
}

/** Counts enabled devices for the user. */
export async function activeDeviceCount(userId) {
  try {
    const { rows } = await pool.query(
      'SELECT count(*)::int AS total FROM device_tokens WHERE user_id = $1 AND enabled = true',
      [userId]
    );
    return rows[0].total;
  } catch {
    return 0;
  }
}

/** Best-effort sync of the user's notification preference. */
async function setNotificationsEnabled(userId, enabled) {
  try {
    await pool.query('UPDATE users SET notifications_enabled = $2, updated_at = NOW() WHERE id = $1', [
      userId,
      Boolean(enabled)
    ]);
  } catch {
    /* Device tokens remain the source of truth. */
  }
}

/** Returns notification readiness flags and a user-facing status message. */
export function pushStatusHint() {
  const webReady = isFirebaseWebConfigured();
  const serverReady = isFcmServerConfigured();

  if (!webReady) {
    return {
      ready: false,
      webReady,
      serverReady,
      text: 'إشعارات الهاتف غير مُهيّأة: أضف مفاتيح FIREBASE_* الستة في ملف .env (خطوة واحدة — راجع .env.example).'
    };
  }
  if (!serverReady) {
    return {
      ready: false,
      webReady,
      serverReady,
      text: 'إعدادات المتصفح جاهزة، لكن إرسال الإشعارات من الخادم يتطلب مفاتيح FCM_* (Service Account) في .env.'
    };
  }
  return {
    ready: true,
    webReady,
    serverReady,
    text: 'إشعارات الهاتف مفعّلة — افتح الصفحة من هاتفك واضغط «تفعيل على هذا الجهاز».'
  };
}