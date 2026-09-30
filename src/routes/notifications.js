import express from 'express';
import { requireAccount } from '../middleware/auth.js';
import { firebaseWebConfig } from '../services/firebase.js';
import {
  activeDeviceCount,
  disableDeviceToken,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushStatusHint,
  registerDeviceToken,
  unreadCount
} from '../services/notifications.js';
import { renderNotice } from '../views/layout.js';
import { renderNotificationsPage } from '../views/notifications.js';

/**
 * مسارات الإشعارات:
 * - GET  /notifications                صفحة الإشعارات (القائمة + تفعيل الهاتف)
 * - GET  /api/firebase-config          إعدادات Firebase العامة للواجهة والـ SW (بدون أسرار)
 * - GET  /api/notifications            JSON: عدد غير المقروء + آخر الإشعارات
 * - POST /api/notifications/register    حفظ توكن جهاز (FCM)
 * - POST /api/notifications/unregister  إيقاف توكن جهاز
 * - POST /api/notifications/read-all    تعليم الكل كمقروء
 * - POST /api/notifications/:id/read    تعليم إشعار واحد كمقروء
 */
const router = express.Router();

/** استجابة JSON موحّدة لخطأ بسيط برسالة عربية قصيرة. */
function sendError(res, status, message) {
  res.status(status).json({ ok: false, message });
}

// إعدادات عامة فقط (apiKey/appId/...) — يقرأها Service Worker والصفحة من نفس النطاق.
// السرّيات (FCM_PRIVATE_KEY مثلاً) لا تظهر هنا أبداً.
router.get('/api/firebase-config', (_req, res) => {
  res.json(firebaseWebConfig());
});

// صفحة الإشعارات داخل الموقع (تحتاج جلسة فعّالة — الزائر يُحوَّل لـ /login)
router.get('/notifications', requireAccount, async (req, res) => {
  try {
    const userId = req.account.id;
    const [items, unread, devices] = await Promise.all([
      listNotifications(userId),
      unreadCount(userId),
      activeDeviceCount(userId)
    ]);
    res.type('html').send(
      renderNotificationsPage({
        account: req.account,
        items,
        unread,
        devices,
        hint: pushStatusHint()
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل الإشعارات',
      message: 'حدث خطأ أثناء قراءة إشعاراتك من قاعدة البيانات — أعد المحاولة بعد لحظات.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

// JSON للاستخدام من أي واجهة: آخر إشعارات الحساب + عدّاد غير المقروء
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

// تسجيل توكن جهاز — يأتي من زر «تفعيل على هذا الجهاز» في صفحة الإشعارات
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

export { router as notificationsRouter };