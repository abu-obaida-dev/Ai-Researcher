import express from 'express';
import { requireAccount, requireService } from '../middleware/auth.js';
import { degreeOfUser, getJourney, setStepStatus } from '../services/journey.js';
import { unreadCount } from '../services/notifications.js';
import { getProfile } from '../services/users.js';
import { renderNotice } from '../views/layout.js';
import { renderJourneyPage } from '../views/journey.js';

/**
 * مسارات «مسار البحث» (1D):
 * - GET  /journey              صفحة الخطوات مع حالة الباحث في كل خطوة
 * - POST /journey/steps/:key   تغيير حالة الخطوة + ملاحظة المخرجات (نموذج HTML)
 * الخطوات تأتي من جدول research_paths إن كان مُ جهّزًا، وإلا من التعريفات
 * البرمجية في src/data/research-paths.js — فالصفحة تعمل بدون أي بذرة.
 */
const router = express.Router();

/** رسائل النتيجة التي تظهر في الصفحة بعد الـ POST (تٌرسل عبر باراميتر في الرابط). */
const FLASH = {
  status_saved: { type: 'ok', message: 'تم حفظ حالة الخطوة.' },
  bad_status: { type: 'error', message: 'حالة الخطوة غير معروفة — اختر لم يبدأ أو جاري أو تم.' },
  bad_step: { type: 'error', message: 'هذه الخطوة غير موجودة في مسار بحثك.' },
  failed: { type: 'error', message: 'تعذّر حفظ الحالة — أعد المحاولة بعد لحظات.' }
};

/** تنبيه النتيجة من باراميترات الرابط. */
function flashFromQuery(query) {
  const key = String(query.ok || query.err || '');
  return FLASH[key] || null;
}

router.get('/journey', requireService('journey'), async (req, res) => {
  try {
    const userId = req.account.id;
    const [degree, profile, unread] = await Promise.all([
      degreeOfUser(userId),
      getProfile(userId),
      unreadCount(userId)
    ]);
    const journey = await getJourney(userId, degree);

    res.type('html').send(
      renderJourneyPage({
        account: req.account,
        journey,
        profile,
        unread,
        flash: flashFromQuery(req.query)
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل مسار البحث',
      message: 'حدث خطأ أثناء قراءة خطوات المسار — أعد المحاولة بعد لحظات.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/** تغيير حالة خطوة (لم يبدأ / جاري / تم) مع ملاحظة المخرجات. */
router.post('/journey/steps/:key', requireService('journey'), async (req, res) => {
  const stepKey = String(req.params.key || '').slice(0, 100);

  try {
    await setStepStatus(req.account.id, stepKey, {
      status: String(req.body?.status || 'not_started'),
      outputNote: String(req.body?.output_note || '')
    });
    res.redirect(303, '/journey?ok=status_saved');
  } catch (error) {
    const code = error?.code === 'BAD_STATUS' ? 'bad_status' : error?.code === 'BAD_STEP' ? 'bad_step' : 'failed';
    if (code === 'failed') console.warn(`فشل حفظ حالة الخطوة ${stepKey}: ${error?.code || error?.message}`);
    res.redirect(303, `/journey?err=${code}`);
  }
});

export { router as journeyRouter };
