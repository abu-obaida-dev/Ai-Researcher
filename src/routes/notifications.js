import express from 'express';
import { requireAccount } from '../middleware/auth.js';
import { firebaseWebConfig } from '../services/firebase.js';
import {
  activeDeviceCount,
  deleteNotification,
  disableDeviceToken,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerDeviceToken,
  unreadCount
} from '../services/notifications.js';

/** In-app notification and device-token routes. */
const router = express.Router();

/** Sends a consistent JSON error response. */
function sendError(res, status, message) {
  res.status(status).json({ ok: false, message });
}

// Expose public Firebase settings only; never return server credentials.
router.get('/api/firebase-config', (_req, res) => {
  res.json(firebaseWebConfig());
});

// Preserve the legacy route while keeping notifications in the shared dropdown.
router.get('/notifications', (_req, res) => {
  res.redirect(302, '/dashboard');
});

// Return the account's latest notifications and unread count.
router.get('/api/notifications', requireAccount, async (req, res) => {
  try {
    const [items, unread, devices] = await Promise.all([
      listNotifications(req.account.id),
      unreadCount(req.account.id),
      activeDeviceCount(req.account.id)
    ]);
    res.json({ ok: true, unread, devices, items });
  } catch {
    sendError(res, 500, 'تعذّرت قراءة الإشعارات.');
  }
});

// Register a device token from the opt-in UI.
router.post('/api/notifications/register', requireAccount, async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const platform = String(req.body?.platform || 'web');
    await registerDeviceToken(req.account.id, token, platform);
    res.json({ ok: true, devices: await activeDeviceCount(req.account.id) });
  } catch (error) {
    sendError(res, 400, error.message || 'تعذّر تسجيل الجهاز.');
  }
});

// إيقاف توكن جهاز معيّن (إلغاء التفعيل من الهاتف نفسه)
router.post('/api/notifications/unregister', requireAccount, async (req, res) => {
  try {
    await disableDeviceToken(req.account.id, String(req.body?.token || ''));
    res.json({ ok: true, devices: await activeDeviceCount(req.account.id) });
  } catch {
    sendError(res, 500, 'تعذّر إيقاف الجهاز.');
  }
});

// تعليم كل الإشعارات كمقروءة
router.post('/api/notifications/read-all', requireAccount, async (req, res) => {
  const updated = await markAllNotificationsRead(req.account.id);
  res.json({ ok: true, updated, unread: 0 });
});

// تعليم إشعار واحد كمقروء (id غير صالح يعيد ok:false بدل خطأ 500)
router.post('/api/notifications/:id/read', requireAccount, async (req, res) => {
  const updated = await markNotificationRead(req.account.id, req.params.id);
  if (!updated) {
    sendError(res, 404, 'الإشعار غير موجود.');
    return;
  }
  res.json({ ok: true, unread: await unreadCount(req.account.id) });
});

// حذف إشعار واحد من قائمة الحساب (يملكه فقط صاحبه — تُستخدم من قائمة الجرس)
router.delete('/api/notifications/:id', requireAccount, async (req, res) => {
  const deleted = await deleteNotification(req.account.id, req.params.id);
  if (!deleted) {
    sendError(res, 404, 'الإشعار غير موجود.');
    return;
  }
  res.json({ ok: true, unread: await unreadCount(req.account.id) });
});

export { router as notificationsRouter };