import express from 'express';
import { requireService } from '../middleware/auth.js';
import { rateLimitUser } from '../middleware/security.js';
import { deleteConversation, getConversation, askSupervisor } from '../services/chat.js';
import { defenseChecklist, defenseProgress, listDefenses, startDefense } from '../services/defense.js';
import { unreadCount } from '../services/notifications.js';
import { getProfile } from '../services/users.js';
import { renderNotice } from '../views/layout.js';
import { renderDefensePage } from '../views/defense.js';

/**
 * خدمة المناقشة والتدريب عليها (defense):
 *   GET  /defense                    قائمة الجلسات + المحادثة الحالية (?d=id)
 *   POST /defense/start              جلسة محاكاة جديدة (mode='defense')
 *   POST /defense/:id/answer         إجابة سؤال اللجنة (المشرف الذكي يجيب ويقيّم)
 *   POST /defense/:id/delete         حذف المحاكاة
 *
 * كل المنطق (عدّاد الأسئلة والمراحل والتقييم) في services/defense.js،
 * والنقاط تُخصم ذرّياً داخل services/chat.js كما في الدردشة تماماً.
 */
const router = express.Router();

/** رسائل النتيجة بعد التحويل. */
const FLASH = {
  empty: { type: 'error', message: 'اكتب إجابتك أولاً.' },
  missing: { type: 'error', message: 'جلسة المناقشة غير موجودة.' },
  no_tokens: { type: 'error', message: 'رصيدك لا يكفي — اشترِ باقة أو أنهِ الجلسة.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمشرف الآن — نقاطك أُعيدت، أعد المحاولة.' },
  done: { type: 'ok', message: 'بدأت جلسة مناقشة جديدة.' },
  answered: { type: 'ok', message: 'سجّل رد اللجنة على إجابتك.' }
};

/** كود خطأ من askSupervisor → مفتاح رسالة FLASH. */
function flashKeyForError(error) {
  return (
    {
      EMPTY_PROMPT: 'empty',
      NOT_FOUND: 'missing',
      NO_TOKENS: 'no_tokens',
      NO_PROVIDER: 'no_provider',
      PROVIDERS_FAILED: 'failed'
    }[error?.code] || 'failed'
  );
}

router.get('/defense', requireService('defense'), async (req, res) => {
  try {
    const userId = req.account.id;
    const requested = String(req.query.d || '').trim();
    const [sessions, unread, conversation] = await Promise.all([
      listDefenses(userId),
      unreadCount(userId),
      requested ? getConversation(userId, requested) : Promise.resolve(null)
    ]);

    const flash = FLASH[String(req.query.ok || req.query.err || '')];
    res.type('html').send(
      renderDefensePage({
        account: req.account,
        unread,
        conversation: conversation?.mode === 'defense' ? conversation : null,
        sessions,
        progress: conversation?.mode === 'defense' ? defenseProgress(conversation.defense_state) : null,
        error: flash ? flash.message : ''
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل المناقشة',
      message: 'حدث خطأ أثناء قراءة جلساتك — أعد المحاولة.',
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/** بدء جلسة محاكاة جديدة + سؤال افتتاحي من اللجنة (أول رسالة من المشرف). */
router.post('/defense/start', requireService('defense'), rateLimitUser('defense_start', { limit: 5, windowMs: 30 * 60 * 1000 }), async (req, res) => {
  try {
    const conversation = await startDefense({ userId: req.account.id, title: 'محاكاة مناقشة' });

    // أول سؤال من اللجنة: يعرّف بنفسه ويطلب تقديم البحث — يخزَّن كرسالة مساعد
    await askSupervisor({
      userId: req.account.id,
      prompt: '[بدء محاكاة مناقشة] أنت الآن لجنة المناقشة. اكتب للباحث رسالة ترحيب قصيرة ثم اسأله: ليقدّم بحثه في ثلاث جمل (المشكلة، المنهج، أهم نتيجة). لا تسأل عن شيء آخر في هذه الرسالة.',
      conversationId: conversation.id,
      profile: (await getProfile(req.account.id)) || {},
      mode: 'defense'
    });

    res.redirect(303, `/defense?d=${conversation.id}&ok=done`);
  } catch (error) {
    console.warn(`فشل بدء جلسة مناقشة: ${error?.code || error?.message}`);
    res.redirect(303, `/defense?err=${flashKeyForError(error)}`);
  }
});

/** إرسال إجابة: المشرف الذكي يقيّمها ثم يطرح السؤال التالي (والتقييم النهائي في آخر جلسة). */
router.post('/defense/:id/answer', requireService('defense'), async (req, res) => {
  const conversationId = String(req.params.id);

  try {
    const existing = await getConversation(req.account.id, conversationId);
    if (!existing || existing.mode !== 'defense') {
      res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&err=missing`);
      return;
    }

    // آخر جلسة = التقييم النهائي: نطلب ملخص النقاط بدل سؤال جديد
    const finished = defenseProgress(existing.defense_state).done;
    const prompt = finished
      ? 'انتهت أسئلة المحاكاة — أعطني الآن التقييم النهائي: نقاط القوة، ونقاط الضعف (ثلاث بنود)، والتوصيات قبل المناقشة الحقيقية.'
      : String(req.body?.answer || '').trim();

    if (!prompt) {
      res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&err=empty`);
      return;
    }

    // الإجابة تُحفظ كما كتبها الباحث (رسالة user)، والمشرف يرد تقييماً + سؤال اللجنة التالي
    const result = await askSupervisor({
      userId: req.account.id,
      prompt,
      conversationId,
      profile: (await getProfile(req.account.id)) || {},
      mode: 'defense'
    });

    res.redirect(303, `/defense?d=${encodeURIComponent(result.conversationId)}&ok=${finished ? 'done' : 'answered'}`);
  } catch (error) {
    console.warn(`فشل تسجيل إجابة المناقشة: ${error?.code || error?.message}`);
    res.redirect(
      303,
      `/defense?d=${encodeURIComponent(conversationId)}&err=${flashKeyForError(error)}${
        error?.code === 'NO_TOKENS' ? `&msg=${encodeURIComponent(error.message)}` : ''
      }`
    );
  }
});

/** حذف جلسة محاكاة. */
router.post('/defense/:id/delete', requireService('defense'), async (req, res) => {
  await deleteConversation(req.account.id, String(req.params.id));
  res.redirect(303, '/defense');
});

export { router as defenseRouter };