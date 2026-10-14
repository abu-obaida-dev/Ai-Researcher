import express from 'express';
import { requireAccount, requireCoreOnboarding } from '../middleware/auth.js';
import { rateLimitUser } from '../middleware/security.js';
import { availableProviders } from '../services/ai.js';
import { askAssistant, deleteConversation, getConversation, listConversations } from '../services/assistant.js';
import { unreadCount } from '../services/notifications.js';
import { getProfile } from '../services/users.js';
import { listFiles } from '../services/files.js';
import { renderNotice } from '../views/layout.js';
import { renderAssistantPage, renderAssistantUpdate } from '../views/assistant.js';

/**
 * مسارات «المعلم» (/assistant) — مساعد تعليمي مستقل:
 * - GET  /assistant            صفحة المحادثة (?c=id · ?prompt= تعبئة مسبقة)
 * - POST /assistant            إرسال رسالة (نموذج تقليدي 303 · أو JSON بلا إعادة تحميل)
 * - POST /assistant/:id/delete حذف محادثة
 *
 * جداوله الخاصة (assistant_conversations/messages) منفصلة تماماً عن
 * المشرف الذكي — ولا يمسّ خطوات الرحلة ولا الذاكرة.
 */
const router = express.Router();

/** رسائل النتيجة بعد التحويل. */
const FLASH = {
  sent: { type: 'ok', message: 'وصل رد المعلم.' },
  empty: { type: 'error', message: 'اكتب رسالتك أولاً.' },
  no_tokens: { type: 'error', message: 'رصيدك لا يكفي لهذه الرسالة — اشترِ باقة أو ابدأ محادثة جديدة أقصر.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد — راجع ملف .env.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمعلم الآن — نقاطك أُعيدت لرصيدك، أعد المحاولة.' },
  missing_conversation: { type: 'error', message: 'المحادثة غير موجودة.' },
  deleted: { type: 'ok', message: 'حُذفت المحادثة.' }
};

/** تنبيه النتيجة من باراميترات الرابط (مع رسالة مخصّصة لنقص الرصيد). */
function flashFromQuery(query) {
  const base = FLASH[String(query.ok || query.err || '')];
  if (!base) return null;
  const custom = String(query.msg || '').trim();
  return custom ? { ...base, message: custom.slice(0, 300) } : base;
}

/** كود خطأ من askAssistant → مفتاح رسالة FLASH. */
function flashKeyForError(error) {
  const map = {
    EMPTY_ASSISTANT: 'empty',
    NO_TOKENS: 'no_tokens',
    NO_PROVIDER: 'no_provider',
    PROVIDERS_FAILED: 'failed',
    NOT_FOUND: 'missing_conversation'
  };
  return map[error?.code] || 'failed';
}

/** صفحة المعلم: القراءة مسموحة للجميع، والإرسال يتطلب الملف الأساسي. */
router.get('/assistant', requireAccount, async (req, res) => {
  try {
    const userId = req.account.id;
    const conversationId = String(req.query.c || '').trim();
    const seedPrompt = String(req.query.prompt || '').trim().slice(0, 2000);

    const [conversations, profile, unread] = await Promise.all([
      listConversations(userId),
      getProfile(userId),
      unreadCount(userId)
    ]);

    const conversation = conversationId ? await getConversation(userId, conversationId) : null;

    res.type('html').send(
      renderAssistantPage({
        account: req.account,
        unread,
        conversation,
        conversations,
        prefill: seedPrompt,
        attachableFiles: await listFiles(userId, { limit: 12 }),
        providers: availableProviders(),
        flash: flashFromQuery(req.query)
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل المعلم',
      message: 'حدث خطأ أثناء قراءة محادثاتك — أعد المحاولة.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/**
 * إرسال رسالة للمعلم — نفس نمط الشات تماماً:
 * نموذج HTML عادي (بلا جافاسكربت): 303 مع flash في الرابط.
 * طلب JSON (Accept: application/json من chat-send.js): قطع HTML محدّثة
 * (رسائل + لوحة مصادر + سايدبار) — بلا إعادة تحميل الصفحة.
 */
router.post(
  '/assistant',
  requireCoreOnboarding,
  rateLimitUser('assistant_message', { limit: 30, windowMs: 5 * 60 * 1000 }),
  async (req, res) => {
    const body = req.body || {};
    const conversationId = String(body.conversation_id || '').trim();
    const wantsJson = String(req.get('accept') || '').includes('application/json');

    try {
      const profile = await getProfile(req.account.id);
      const result = await askAssistant({
        userId: req.account.id,
        prompt: body.message,
        conversationId: conversationId || null,
        // ملفات يرفقها الباحث بهذه الرسالة (من ملفاته المرفوعة فقط — تُتحقّق الملكية)
        fileIds: body.file_ids,
        profile
      });

      if (wantsJson) {
        const [conversation, conversations] = await Promise.all([
          getConversation(req.account.id, result.conversationId),
          listConversations(req.account.id)
        ]);
        return res.json({
          ok: true,
          conversationId: result.conversationId,
          conversationUrl: `/assistant?c=${result.conversationId}`,
          fragments: renderAssistantUpdate({ conversation, conversations })
        });
      }

      res.redirect(303, `/assistant?c=${result.conversationId}&ok=sent`);
    } catch (error) {
      console.warn(`فشل المعلم (${error?.code || 'UNKNOWN'}): ${error?.message}`);
      const message = error?.code === 'NO_TOKENS' ? error.message : '';

      if (wantsJson) {
        const key = flashKeyForError(error);
        const status = { no_tokens: 402, no_provider: 503, failed: 502, missing_conversation: 404 }[key] || 400;
        return res.status(status).json({
          ok: false,
          error: { code: key, message: message || FLASH[key].message }
        });
      }

      res.redirect(
        303,
        `/assistant?c=${encodeURIComponent(conversationId)}&err=${flashKeyForError(error)}${
          message ? `&msg=${encodeURIComponent(message)}` : ''
        }`
      );
    }
  }
);

/** حذف محادثة معلم كاملة برسائلها (لا يمسّ النقاط المستهلكة). */
router.post('/assistant/:id/delete', requireAccount, async (req, res) => {
  const wantsJson = String(req.get('accept') || '').includes('application/json');
  try {
    const removed = await deleteConversation(req.account.id, String(req.params.id || ''));
    if (wantsJson) return res.json({ ok: removed });
    res.redirect(303, removed ? '/assistant?ok=deleted' : '/assistant?err=missing_conversation');
  } catch (error) {
    console.warn(`تعذّر حذف محادثة المعلم: ${error?.message}`);
    if (wantsJson) return res.status(500).json({ ok: false });
    res.redirect(303, '/assistant?err=missing_conversation');
  }
});

export { router as assistantRouter };

