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

/** Independent teaching-assistant routes. */
const router = express.Router();

/** Per-account read limit for the assistant page. */
const pageReadLimit = rateLimitUser('page_read', { limit: 120, windowMs: 5 * 60 * 1000 });

/** Flash messages shown after redirects. */
const FLASH = {
  sent: { type: 'ok', message: 'وصل رد المعلم.' },
  empty: { type: 'error', message: 'اكتب رسالتك أولاً.' },
  no_tokens: { type: 'error', message: 'رصيدك لا يكفي لهذه الرسالة — اشترِ باقة أو ابدأ محادثة جديدة أقصر.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد — راجع ملف .env.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمعلم الآن — نقاطك أُعيدت لرصيدك، أعد المحاولة.' },
  missing_conversation: { type: 'error', message: 'المحادثة غير موجودة.' },
  deleted: { type: 'ok', message: 'حُذفت المحادثة.' }
};

/** Resolves a redirect flash message, including low-balance details. */
function flashFromQuery(query) {
  const base = FLASH[String(query.ok || query.err || '')];
  if (!base) return null;
  const custom = String(query.msg || '').trim();
  return custom ? { ...base, message: custom.slice(0, 300) } : base;
}

/** Maps askAssistant errors to flash-message keys. */
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

/** Assistant page; sending requires a completed core profile. */
router.get('/assistant', pageReadLimit, requireAccount, async (req, res) => {
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
      details: error?.message || '',
      area: 'app',
      activeKey: 'assistant'
    });
    res.status(500).type('html').send(html);
  }
});

/** Sends an assistant message with normal-form and JSON response modes. */
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
        // Attach only files owned by the current user.
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

/** Deletes an assistant conversation without changing recorded usage. */
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

