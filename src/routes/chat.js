import express from 'express';
import { requireAccount } from '../middleware/auth.js';
import { availableProviders } from '../services/ai.js';
import {
  askSupervisor,
  deleteConversation,
  getConversation,
  listConversations
} from '../services/chat.js';
import { isValidStepKeyForUser, stepTitle } from '../services/journey.js';
import { unreadCount } from '../services/notifications.js';
import { getProfile } from '../services/users.js';
import { renderNotice } from '../views/layout.js';
import { renderChatPage } from '../views/chat.js';

/**
 * مسارات الشات (1F):
 * - GET  /chat                    صفحة المحادثة (?c=id لعرض محادثة، ?step= للسياق)
 * - POST /chat                    إرسال رسالة (تُحفظ في messages ويُسجَّل الاستهلاك)
 * - POST /chat/:id/delete         حذف محادثة
 * التوكنز تُخصم ذرّياً داخل services/chat.js ولا يوجد أي تسعير في الواجهة.
 */
const router = express.Router();

/** رسائل النتيجة بعد التحويل. */
const FLASH = {
  sent: { type: 'ok', message: 'وصل رد المشرف الذكي.' },
  empty: { type: 'error', message: 'اكتب رسالتك أولاً.' },
  no_tokens: { type: 'error', message: 'رصيد التوكنز غير كافٍ — اشترِ باقة أو انتظر التجديد الشهري.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد — راجع ملف .env.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمشرف الذكي الآن — توكناتك أُعيدت لرصيدك، أعد المحاولة.' },
  bad_step: { type: 'error', message: 'الخطوة المحددة غير موجودة في مسارك.' },
  missing_conversation: { type: 'error', message: 'المحادثة غير موجودة.' }
};

/** تنبيه النتيجة من باراميترات الرابط. */
function flashFromQuery(query) {
  return FLASH[String(query.ok || query.err || '')] || null;
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

/** صفحة الشات. */
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

    // عند القدوم من مسار البحث مع خطوة، ننشئ محادثة جديدة تحمل سياق الخطوة
    let conversation = conversationId ? await getConversation(userId, conversationId) : null;
    if (!conversation && stepKey && seedPrompt) {
      conversation = null; // السؤال الأول يأتي في النموذج أدناه
    }

    res.type('html').send(
      renderChatPage({
        account: req.account,
        unread,
        conversation,
        conversations,
        stepKey,
        stepName: stepKey ? await stepTitle(stepKey) : '',
        // اقتراحات البداية (?prompt=…) تُملأ بها مربع الرسالة مسبقاً
        prefill: seedPrompt,
        balance: Number(req.account.tokens_balance || 0),
        providers: availableProviders(),
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

/** إرسال رسالة للمشرف الذكي. */
router.post('/chat', requireAccount, async (req, res) => {
  const body = req.body || {};
  const stepKey = String(body.step || '').trim().slice(0, 100);
  const conversationId = String(body.conversation_id || '').trim();

  try {
    const profile = await getProfile(req.account.id);
    const result = await askSupervisor({
      userId: req.account.id,
      prompt: body.message,
      conversationId: conversationId || null,
      stepKey: stepKey || null,
      profile
    });

    res.redirect(303, `/chat?c=${result.conversationId}&step=${encodeURIComponent(stepKey)}&ok=sent`);
  } catch (error) {
    console.warn(`فشل الشات (${error?.code || 'UNKNOWN'}): ${error?.message}`);
    res.redirect(303, `/chat?c=${encodeURIComponent(conversationId)}&step=${encodeURIComponent(stepKey)}&err=${flashKeyForError(error)}`);
  }
});

/** حذف محادثة كاملة. */
router.post('/chat/:id/delete', requireAccount, async (req, res) => {
  await deleteConversation(req.account.id, String(req.params.id));
  res.redirect(303, '/chat');
});

export { router as chatRouter };
