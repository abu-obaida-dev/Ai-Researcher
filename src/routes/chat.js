import express from 'express';
import { needsOnboarding, requireAccount, requireCoreOnboarding } from '../middleware/auth.js';
import { rateLimitUser } from '../middleware/security.js';
import { availableProviders } from '../services/ai.js';
import {
  askSupervisor,
  deleteConversation,
  getConversation,
  listConversations,
  setConversationMode
} from '../services/chat.js';
import { cancelStepReview, editStepReview, saveStepReview } from '../services/step-review.js';
import { isValidStepKeyForUser, stepTitle } from '../services/journey.js';
import { unreadCount } from '../services/notifications.js';
import { getProfile } from '../services/users.js';
import { listFiles } from '../services/files.js';
import { renderNotice } from '../views/layout.js';
import { renderChatPage, renderChatUpdate } from '../views/chat.js';

/**
 * مسارات الشات (1F):
 * - GET  /chat                    صفحة المحادثة (?c=id لعرض محادثة، ?step= للسياق)
 * - POST /chat                    إرسال رسالة (تُحفظ في messages ويُسجَّل الاستهلاك)
 * - POST /chat/:id/delete         حذف محادثة
 * النقاط تُخصم ذرّياً داخل services/chat.js ولا يوجد أي تسعير في الواجهة.
 */
const router = express.Router();

/** رسائل النتيجة بعد التحويل. */
const FLASH = {
  sent: { type: 'ok', message: 'وصل رد المشرف الذكي.' },
  empty: { type: 'error', message: 'اكتب رسالتك أولاً.' },
  no_tokens: { type: 'error', message: 'رصيدك لا يكفي لهذه الرسالة — اشترِ باقة أو ابدأ محادثة جديدة أقصر.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد — راجع ملف .env.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمشرف الذكي الآن — نقاطك أُعيدت لرصيدك، أعد المحاولة.' },
  bad_step: { type: 'error', message: 'الخطوة المحددة غير موجودة في مسارك.' },
  missing_conversation: { type: 'error', message: 'المحادثة غير موجودة.' },
  mode_normal: { type: 'ok', message: 'رجعت المحادثة إلى وضع الإرشاد.' },
  mode_defense: { type: 'ok', message: 'وضع المناقشة: سؤال واحد في كل مرة، ثم تقييم الإجابة.' },
  // بطاقة مراجعة اكتمال الخطوة: لا شيء يُكتب في المسار قبل «حفظ» الباحث
  review_saved: { type: 'ok', message: 'أُكملت الخطوة وحُفظت في مسارك.' },
  review_edited: { type: 'ok', message: 'عدّل البيانات ثم اضغط «حفظ وإتمام الخطوة» لإتمامها.' },
  review_cancelled: { type: 'ok', message: 'أُلغيت المراجعة — لم يتغيّر شيء في مسارك.' },
  review_missing: { type: 'error', message: 'لا توجد مراجعة معلّقة لهذه الخطوة.' },
  review_bad_field: { type: 'error', message: 'راجع بيانات الخطوة: لا يُترك حقل فارغاً.' },
  review_bad_step: { type: 'error', message: 'هذه الخطوة غير موجودة في مسارك.' },
  review_failed: { type: 'error', message: 'تعذّرت عملية مراجعة الخطوة — أعد المحاولة.' }
};

/** تنبيه النتيجة من باراميترات الرابط. */
function flashFromQuery(query) {
  const base = FLASH[String(query.ok || query.err || '')];
  if (!base) return null;

  // رسالة نقص الرصيد تحمل معناها من services/chat.js (كم نحتاج وكم لديه)
  const custom = String(query.msg || '').trim();
  return custom ? { ...base, message: custom.slice(0, 300) } : base;
}

/** كود خطأ من askSupervisor → مفتاح رسالةFLASH. */
function flashKeyForError(error) {
  const map = {
    EMPTY_PROMPT: 'empty',
    NO_TOKENS: 'no_tokens',
    NO_PROVIDER: 'no_provider',
    PROVIDERS_FAILED: 'failed',
    BAD_STEP: 'bad_step',
    NOT_FOUND: 'missing_conversation'
  };
  return map[error?.code] || 'failed';
}

/** صفحة الشات: القراءة مسموحة للجميع، والإرسال يتطلب الملف الأساسي. */
router.get('/chat', requireAccount, async (req, res) => {
  try {
    const userId = req.account.id;
    const conversationId = String(req.query.c || '').trim();
    const rawStep = String(req.query.step || '').trim().slice(0, 100);
    const stepKey = rawStep && (await isValidStepKeyForUser(userId, rawStep)) ? rawStep : '';
    const seedPrompt = String(req.query.prompt || '').trim().slice(0, 2000);

    const [conversations, profile, unread] = await Promise.all([
      listConversations(userId),
      getProfile(userId),
      unreadCount(userId)
    ]);

    // المحادثة الحالية: ?c= لاختيار محادثة محفوظة، وإلا محادثة جديدة فارغة
    const conversation = conversationId ? await getConversation(userId, conversationId) : null;

    res.type('html').send(
      renderChatPage({
        account: req.account,
        unread,
        conversation,
        conversations,
        stepKey,
        stepName: stepKey ? await stepTitle(stepKey) : '',
        // ?prompt= يملأ مربع الرسالة مسبقاً (يصل من روابط الخطوات/الملاحظات)
        prefill: seedPrompt,
        // ملفات الباحث لاختيارها وإرفاقها بالرسالة (بحد أقصى ٣ في الرسالة)
        attachableFiles: await listFiles(userId, { limit: 12 }),
        providers: availableProviders(),
        // بوابة جزئية: بلا ملف مكتمل يمكنه القراءة، لكن الإرسال يتطلب السياق الأساسي
        profileNotice: needsOnboarding(req.account)
          ? 'لم تُكمل ملفك البحثي بعد — أضف مرحلتك الأكاديمية وتخصصك وهدفك الحالي ليضبط المشرف الذكي إجاباته. <a href="/onboarding?next=/chat">أكمل ملفك الآن</a> (يستغرق دقيقة).'
          : '',
        flash: flashFromQuery(req.query)
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل المحادثة',
      message: 'حدث خطأ أثناء قراءة محادثاتك — أعد المحاولة.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/**
 * إرسال رسالة للمشرف الذكي (يتطلب الملف الأساسي — سياق الإشراف).
 *
 * مساران في معالج واحد:
 * - نموذج HTML عادي (بلا جافاسكربت): 303 مع flash في الرابط — كما كان دائماً.
 * - طلب JSON (Accept: application/json من chat-send.js): قطع HTML محدّثة
 *   (رسائل + شريط وضع + مراجع + سايدبار) — بلا إعادة تحميل الصفحة.
 */
router.post('/chat', requireCoreOnboarding, rateLimitUser('chat_message', { limit: 30, windowMs: 5 * 60 * 1000 }), async (req, res) => {
  const body = req.body || {};
  const stepKey = String(body.step || '').trim().slice(0, 100);
  const conversationId = String(body.conversation_id || '').trim();
  // نكشف JSON من الترويسة الصريحة فقط — طلبات fetch الافتراضية (*/*) تبقى على مسار 303
  const wantsJson = String(req.get('accept') || '').includes('application/json');

  try {
    const profile = await getProfile(req.account.id);
    const result = await askSupervisor({
      userId: req.account.id,
      prompt: body.message,
      conversationId: conversationId || null,
      stepKey: stepKey || null,
      profile,
      // ملفات يرفقها الباحث بهذه الرسالة (من ملفاته المرفوعة فقط — يُتحقق من الملكية)
      fileIds: body.file_ids
    });

    if (wantsJson) {
      // نعيد قطعاً مُعرَّضة بنفس دوال عرض الصفحة — مصدر واحد للشكل.
      const [conversation, conversations] = await Promise.all([
        getConversation(req.account.id, result.conversationId),
        listConversations(req.account.id)
      ]);
      return res.json({
        ok: true,
        conversationId: result.conversationId,
        conversationUrl: `/chat?c=${result.conversationId}&step=${encodeURIComponent(stepKey)}`,
        fragments: renderChatUpdate({ conversation, conversations })
      });
    }

    res.redirect(303, `/chat?c=${result.conversationId}&step=${encodeURIComponent(stepKey)}&ok=sent`);
  } catch (error) {
    console.warn(`فشل الشات (${error?.code || 'UNKNOWN'}): ${error?.message}`);
    // نقص الرصيد ورصيده وكم نحتاج: رسالة الكود أوضح من نص ثابت
    const message = error?.code === 'NO_TOKENS' ? error.message : '';

    if (wantsJson) {
      const key = flashKeyForError(error);
      const status = { no_tokens: 402, no_provider: 503, failed: 502, bad_step: 400, missing_conversation: 404 }[key] || 400;
      return res.status(status).json({
        ok: false,
        error: { code: key, message: message || FLASH[key].message }
      });
    }

    res.redirect(
      303,
      `/chat?c=${encodeURIComponent(conversationId)}&step=${encodeURIComponent(stepKey)}` +
        `&err=${flashKeyForError(error)}${message ? `&msg=${encodeURIComponent(message)}` : ''}`
    );
  }
});

/** تبديل وضع المحادثة: إرشاد عادي ⇄ مناقشة تدريبية. */
router.post('/chat/:id/mode', requireAccount, async (req, res) => {
  const conversationId = String(req.params.id);
  const mode = String(req.body?.mode || 'normal') === 'defense' ? 'defense' : 'normal';
  const ok = await setConversationMode(req.account.id, conversationId, mode);

  res.redirect(303, `/chat?c=${encodeURIComponent(conversationId)}&${ok ? 'ok' : 'err'}=${ok ? `mode_${mode}` : 'missing_conversation'}`);
});

/**
 * بطاقة مراجعة اكتمال الخطوة: edit ⇄ save ⇄ cancel.
 * الكشف حتمي (services/step-review.js) لكن الكتابة في المسار لا تقع إلا هنا
 * بعد ضغط الباحث «حفظ وإتمام الخطوة» — وقبل ذلك لا يتغيّر شيء في تقدّمه.
 */
router.post('/chat/:id/step-review', requireAccount, async (req, res) => {
  const conversationId = String(req.params.id);
  const action = String(req.body?.action || '');
  const stepKey = String(req.body?.step || '').trim().slice(0, 100);
  const back = `/chat?c=${encodeURIComponent(conversationId)}${stepKey ? `&step=${encodeURIComponent(stepKey)}` : ''}`;

  // حقول البطاقة تصل كـ f_<key> (قيمة واحدة لكل حقل)
  const values = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (key.startsWith('f_')) values[key.slice(2)] = String(value);
  }

  try {
    if (action === 'edit') {
      await editStepReview(req.account.id, conversationId, values);
      res.redirect(303, `${back}&ok=review_edited`);
    } else if (action === 'save') {
      const result = await saveStepReview(req.account.id, conversationId, values);
      res.redirect(303, `${back}&ok=review_saved&msg=${encodeURIComponent(result.message)}`);
    } else if (action === 'cancel') {
      await cancelStepReview(req.account.id, conversationId);
      res.redirect(303, `${back}&ok=review_cancelled`);
    } else {
      res.redirect(303, `${back}&err=review_failed`);
    }
  } catch (error) {
    console.warn(`مراجعة الخطوة فشلت (${error?.code || 'UNKNOWN'}): ${error?.message}`);
    const keyFor = {
      NOT_FOUND: 'missing_conversation',
      NO_PENDING: 'review_missing',
      EMPTY_FIELD: 'review_bad_field',
      BAD_STEP: 'review_bad_step'
    }[error?.code] || 'review_failed';
    const message = error?.message && error.code === 'EMPTY_FIELD' ? `&msg=${encodeURIComponent(error.message)}` : '';
    res.redirect(303, `${back}&err=${keyFor}${message}`);
  }
});

/** حذف محادثة كاملة. */
router.post('/chat/:id/delete', requireAccount, async (req, res) => {
  await deleteConversation(req.account.id, String(req.params.id));
  res.redirect(303, '/chat');
});

export { router as chatRouter };
