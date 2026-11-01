import express from 'express';
import { needsOnboarding, requireAccount, requireCoreOnboarding } from '../middleware/auth.js';
import { rateLimitUser } from '../middleware/security.js';
import { availableProviders } from '../services/ai.js';
import {
  askSupervisor,
  deleteConversation,
  getConversation,
  listConversations
} from '../services/chat.js';
import { cancelStepReview, editStepReview, saveStepReview } from '../services/step-review.js';
import { isValidStepKeyForUser, stepTitle } from '../services/journey.js';
import { unreadCount } from '../services/notifications.js';
import { getProfile } from '../services/users.js';
import { listFiles } from '../services/files.js';
import { renderNotice } from '../views/layout.js';
import { renderChatPage, renderChatUpdate } from '../views/chat.js';

/** Supervisor chat routes; billing is handled by the chat service. */
const router = express.Router();

/** Per-account read limit for the chat page. */
const pageReadLimit = rateLimitUser('page_read', { limit: 120, windowMs: 5 * 60 * 1000 });

/** Flash messages shown after redirects. */
const FLASH = {
  sent: { type: 'ok', message: 'وصل رد المشرف الذكي.' },
  empty: { type: 'error', message: 'اكتب رسالتك أولاً.' },
  no_tokens: { type: 'error', message: 'رصيدك لا يكفي لهذه الرسالة — اشترِ باقة أو ابدأ محادثة جديدة أقصر.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد — راجع ملف .env.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمشرف الذكي الآن — نقاطك أُعيدت لرصيدك، أعد المحاولة.' },
  bad_step: { type: 'error', message: 'الخطوة المحددة غير موجودة في مسارك.' },
  missing_conversation: { type: 'error', message: 'المحادثة غير موجودة.' },
  // Step-review data remains pending until the user saves it.
  review_saved: { type: 'ok', message: 'أُكملت الخطوة وحُفظت في مسارك.' },
  review_edited: { type: 'ok', message: 'عدّل البيانات ثم اضغط «حفظ وإتمام الخطوة» لإتمامها.' },
  review_cancelled: { type: 'ok', message: 'أُلغيت المراجعة — لم يتغيّر شيء في مسارك.' },
  review_missing: { type: 'error', message: 'لا توجد مراجعة معلّقة لهذه الخطوة.' },
  review_bad_field: { type: 'error', message: 'راجع بيانات الخطوة: لا يُترك حقل فارغاً.' },
  review_bad_step: { type: 'error', message: 'هذه الخطوة غير موجودة في مسارك.' },
  review_failed: { type: 'error', message: 'تعذّرت عملية مراجعة الخطوة — أعد المحاولة.' }
};

/** Resolves a redirect flash message. */
function flashFromQuery(query) {
  const base = FLASH[String(query.ok || query.err || '')];
  if (!base) return null;

  // The service supplies balance and reservation details for low-balance errors.
  const custom = String(query.msg || '').trim();
  return custom ? { ...base, message: custom.slice(0, 300) } : base;
}

/** Maps askSupervisor errors to flash-message keys. */
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

/** Chat page; sending requires a completed core profile. */
router.get('/chat', pageReadLimit, requireAccount, async (req, res) => {
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

    // Load the selected conversation or render a new empty one.
    const conversation = conversationId ? await getConversation(userId, conversationId) : null;

    res.type('html').send(
      renderChatPage({
        account: req.account,
        unread,
        conversation,
        conversations,
        stepKey,
        stepName: stepKey ? await stepTitle(stepKey) : '',
        // Prefill prompts from journey or note links.
        prefill: seedPrompt,
        // Offer up to three owned files as attachments.
        attachableFiles: await listFiles(userId, { limit: 12 }),
        providers: availableProviders(),
        // Reading stays open; sending requires core profile fields.
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
      details: error?.message || '',
      area: 'app',
      activeKey: 'chat'
    });
    res.status(500).type('html').send(html);
  }
});

/** Sends a supervisor message with normal-form and JSON response modes. */
router.post('/chat', requireCoreOnboarding, rateLimitUser('chat_message', { limit: 30, windowMs: 5 * 60 * 1000 }), async (req, res) => {
  const body = req.body || {};
  const stepKey = String(body.step || '').trim().slice(0, 100);
  const conversationId = String(body.conversation_id || '').trim();
  // Detect JSON requests only from the explicit Accept header.
  const wantsJson = String(req.get('accept') || '').includes('application/json');

  try {
    const profile = await getProfile(req.account.id);
    const result = await askSupervisor({
      userId: req.account.id,
      prompt: body.message,
      conversationId: conversationId || null,
      stepKey: stepKey || null,
      profile,
      // Attach only files owned by the current user.
      fileIds: body.file_ids
    });

    if (wantsJson) {
      // Reuse the page renderers for consistent response fragments.
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
    console.warn(`فشل الشات (${error?.code || 'UNKNOWN'}): ${error?.message || error}${error?.stack ? `\n${String(error.stack).split('\n').slice(0, 6).join('\n')}` : ''}`);
    // Preserve the detailed reservation and current-balance message.
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

/* Saves step-review data only after explicit user confirmation. */
router.post('/chat/:id/step-review', requireAccount, async (req, res) => {
  const conversationId = String(req.params.id);
  const action = String(req.body?.action || '');
  const stepKey = String(req.body?.step || '').trim().slice(0, 100);
  const back = `/chat?c=${encodeURIComponent(conversationId)}${stepKey ? `&step=${encodeURIComponent(stepKey)}` : ''}`;

  // Review fields use the f_<key> naming convention.
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

/** Deletes a conversation. */
router.post('/chat/:id/delete', requireAccount, async (req, res) => {
  await deleteConversation(req.account.id, String(req.params.id));
  res.redirect(303, '/chat');
});

export { router as chatRouter };
