import express from 'express';
import { requireAccount } from '../middleware/auth.js';
import { listPublicPlans } from '../services/plans.js';
import { createPaymentRequest, listPaymentMethods, listUserPaymentRequests, siteCurrency } from '../services/payments.js';
import { getProfile } from '../services/users.js';
import { unreadCount } from '../services/notifications.js';
import { rateLimit } from '../middleware/security.js';
import { renderNotice } from '../views/layout.js';
import { renderPaymentsPage } from '../views/payments.js';

/**
 * الاشتراك والدفع اليدوي (دفع خارج المنصة):
 *   GET  /payments        صفحة الباقات + طرق الدفع + طلبات الباحث
 *   POST /payments        تقديم طلب (السعر يُقرأ من plans على الخادم)
 */
const router = express.Router();

const FLASH = {
  sent: { type: 'ok', message: 'أُرسل طلب الدفع — سيعرض لك النظام كود التفعيل؛ أرسله عبر واتساب لخدمة العملاء لتفعيل باقتك.' },
  empty: { type: 'error', message: 'أكمل بيانات الطلب (الباقة + طريقة الدفع + رقم الواتساب).' },
  bad_plan: { type: 'error', message: 'الباقة المطلوبة غير متاحة.' },
  bad_method: { type: 'error', message: 'طريقة الدفع غير متاحة — حدّث الصفحة.' },
  bad_whatsapp: { type: 'error', message: 'رقم الواتساب مطلوب (مثال: 0912345678).' },
  too_many: { type: 'error', message: 'لديك طلبات كثيرة قيد المراجعة — انتظر رد الإدارة.' }
};

function flashFromQuery(query) {
  const base = FLASH[String(query.ok || query.err || '')];
  const custom = String(query.msg || '').trim();
  if (!base) return null;
  if (query.ok === 'sent' && query.ref) {
    return {
      type: base.type,
      message: `أُرسل طلب الدفع — كود التفعيل الخاص بك: ${String(query.ref).slice(0, 6)}. أرسله عبر واتساب لخدمة العملاء لتفعيل باقتك.${custom ? ` (${custom.slice(0, 200)})` : ''}`
    };
  }
  return custom ? { ...base, message: `${base.message} (${custom.slice(0, 200)})` } : base;
}

router.get('/payments', requireAccount, async (req, res) => {
  try {
    const [plans, methods, requests, currency, unread, profile] = await Promise.all([
      listPublicPlans(),
      listPaymentMethods(),
      listUserPaymentRequests(req.account.id),
      siteCurrency(),
      unreadCount(req.account.id),
      getProfile(req.account.id)
    ]);

    res.type('html').send(
      renderPaymentsPage({
        account: req.account,
        unread,
        plans,
        methods,
        requests,
        currency,
        whatsapp: String(profile?.whatsapp_number || ''),
        selectedPlan: String(req.query.plan || '').slice(0, 100),
        flash: flashFromQuery(req.query)
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل صفحة الدفع',
      message: 'حدث خطأ أثناء قراءة الباقات وطرق الدفع — أعد المحاولة.',
      details: error?.message || '',
      area: 'app',
      activeKey: 'payments'
    });
    res.status(500).type('html').send(html);
  }
});

// حدّ الطلبات: 5 طلبات لكل حساب خلال 10 دقائق (الحد موجود أيضاً في الخدمة)
router.post('/payments', requireAccount, rateLimit('payments', { limit: 5, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  const body = req.body || {};

  try {
    const request = await createPaymentRequest(req.account.id, {
      plan_code: body.plan_code,
      method_code: body.method_code,
      whatsapp_number: body.whatsapp_number
    });
    res.redirect(303, `/payments?ok=sent&ref=${encodeURIComponent(String(request.reference_code || '').slice(0, 6))}`);
  } catch (error) {
    console.warn(`فشل طلب الدفع: ${error?.code || error?.message}`);
    const key = ['BAD_PLAN', 'BAD_METHOD', 'BAD_WHATSAPP', 'TOO_MANY'].includes(error?.code) ? error.code : 'empty';
    res.redirect(303, `/payments?err=${key}&msg=${encodeURIComponent(error?.message || '')}`);
  }
});

export { router as paymentsRouter };