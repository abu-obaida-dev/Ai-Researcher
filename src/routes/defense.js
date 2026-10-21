import express from 'express';
import { Readable } from 'node:stream';
import { requireCoreOnboarding, requireService } from '../middleware/auth.js';
import { concurrencyLimit, rateLimitUser } from '../middleware/security.js';
import { deleteConversation, getConversation, askSupervisor, appendMessage } from '../services/chat.js';
import {
  defenseChecklist,
  defenseProgress,
  extractQuestionFromReply,
  listDefenses,
  nextPendingPart,
  planParts,
  recordDefenseQuestion,
  setDefensePlan,
  setDefenseThesisFile,
  startDefense,
  syncDefenseState
} from '../services/defense.js';
import { extractFileText } from '../services/documents.js';
import { getFileRow, listFiles, readOwnedFile, saveUpload, userFileMaxBytes } from '../services/files.js';
import { unreadCount } from '../services/notifications.js';
import { getProfile } from '../services/users.js';
import { renderNotice } from '../views/layout.js';
import { renderDefensePage } from '../views/defense.js';

/**
 * المناقشة المستقلة (defense): دردشة مستقلة تماماً بملف بحث ثابت.
 *   GET  /defense                    قائمة الجلسات + الدردشة الحالية (?d=id)
 *   POST /defense/start              جلسة جديدة — أول رسالة: طلب رفع البحث
 *   POST /defense/:id/thesis         رفع ملف البحث وتثبيته للجلسة ثم بدء المناقشة منه
 *   POST /defense/:id/answer         إجابة سؤال المناقِش (تقييم + السؤال التالي من نفس الجزء أو التالي)
 *   POST /defense/:id/finish         إنهاء الجلسة بالتقييم النهائي
 *   POST /defense/:id/delete         حذف الجلسة
 *
 * النقاط تُخصم ذرّياً داخل services/chat.js كما في الدردشة تماماً.
 */
const router = express.Router();

/** رسائل النتيجة بعد التحويل. */
const FLASH = {
  empty: { type: 'error', message: 'اكتب إجابتك أولاً.' },
  missing: { type: 'error', message: 'جلسة المناقشة غير موجودة.' },
  no_file: { type: 'error', message: 'اختر ملف البحث أو ارفعه أولاً.' },
  no_tokens: { type: 'error', message: 'رصيدك لا يكفي — اشترِ باقة أو أنهِ الجلسة.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمناقِش الآن — نقاطك أُعيدت، أعد المحاولة.' },
  done: { type: 'ok', message: 'بدأت دردشة مناقشة مستقلة — ارفع ملف البحث أولاً.' },
  thesis_ok: { type: 'ok', message: 'وصل ملف البحث — بدأ المناقِش قراءته ومناقشتك فيه.' },
  answered: { type: 'ok', message: 'سجّل رد المناقِش على إجابتك.' },
  finished: { type: 'ok', message: 'انتهت المناقشة — اقرأ التقييم النهائي.' },
  file_bad: { type: 'error', message: 'تعذّر رفع الملف — تحقق من النوع والحجم.' }
};

/**
 * يسجّل سؤال المناقِش بعد كل ردّ: يزيد العدّاد، يحفظ نصّ السؤال، ويحدّد
 * الجزء الذي غطّاه (الجزء التالي في الخطة وقت السؤال).
 *
 * إن لم يكن في الردّ استفهام (تقييم فقط) فلا يُسجَّل شيء — العدّاد يعدّ
 * الأسئلة فعلاً لا الردود.
 */
async function recordReplyQuestion(conversationId, replyText) {
  try {
    const question = extractQuestionFromReply(replyText);
    if (!question) return null;
    const { pool: dbPool } = await import('../db/client.js');
    const { rows } = await dbPool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
    const raw = rows[0]?.defense_state && typeof rows[0].defense_state === 'object' ? rows[0].defense_state : {};
    const current = nextPendingPart(raw);
    return await recordDefenseQuestion(conversationId, {
      question,
      partKey: current?.key || ''
    });
  } catch (error) {
    console.warn(`تعذّر تسجيل سؤال المناقشة: ${error?.code || error?.message}`);
    return null;
  }
}

/**
 * يبني خطة المناقشة من نصّ ملف البحث: يقسمه إلى أجزاء ويحدّد سقف الأسئلة.
 *
 * تُستدعى مرة واحدة عند تثبيت الملف. الفشل لا يُسقط المناقشة: خطة فارغة
 * تعني «سقف افتراضي» والمناقِش يقرأ البحث بنفسه كالسابق.
 */
async function buildDefensePlanForFile(userId, conversationId, fileId) {
  try {
    const found = await readOwnedFile(userId, fileId);
    if (!found || !found.buffer) return false;
    const { text } = await extractFileText(found.buffer, found.row?.file_name || '');
    const parts = planParts(text);
    if (!parts.length) return false;
    return await setDefensePlan(conversationId, parts);
  } catch (error) {
    console.warn(`تعذّر بناء خطة المناقشة: ${error?.code || error?.message}`);
    return false;
  }
}

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
    const [sessions, unread, conversation, files] = await Promise.all([
      listDefenses(userId),
      unreadCount(userId),
      requested ? getConversation(userId, requested) : Promise.resolve(null),
      listFiles(userId, {})
    ]);

    // توفّق حالة المناقشة مع ما سُئل فعلاً (ترحيل الجلسات القديمة التي سُئلت
    // قبل وجود العدّاد) — فيعرض العدّاد الحقيقي بدل صفر.
    if (conversation?.mode === 'defense') {
      try {
        const synced = await syncDefenseState(conversation.id, conversation.messages || []);
        if (synced) conversation.defense_state = synced;
      } catch (error) {
        console.warn(`تعذّر توفّق حالة المناقشة: ${error?.code || error?.message}`);
      }
    }

    const flash = FLASH[String(req.query.ok || req.query.err || '')];
    res.type('html').send(
      renderDefensePage({
        account: req.account,
        unread,
        conversation: conversation?.mode === 'defense' ? conversation : null,
        sessions,
        progress: conversation?.mode === 'defense' ? defenseProgress(conversation.defense_state) : null,
        files,
        flash: flash ? { type: flash.type, message: flash.message } : null
      })
    );
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر تحميل المناقشة',
      message: 'حدث خطأ أثناء قراءة جلساتك — أعد المحاولة.',
      details: error?.message || '',
      area: 'app',
      activeKey: 'defense'
    });
    res.status(500).type('html').send(html);
  }
});

/** بدء دردشة مناقشة مستقلة جديدة — أول رسالة: ترحيب باسم الباحث + طلب تثبيت البحث. */
router.post('/defense/start', requireService('defense'), requireCoreOnboarding, rateLimitUser('defense_start', { limit: 5, windowMs: 30 * 60 * 1000 }), async (req, res) => {
  try {
    const conversation = await startDefense({ userId: req.account.id, title: 'مناقشة البحث' });

    // اسم الباحث يُحقن صراحةً في التعليمات (النموذج يتجاهل قسم السياق أحياناً)،
    // وكذلك إن كان يملك ملفات مرفوعة مسبقاً — فلا يقول «ارفع» وهو يملك ملفه أصلاً.
    const profile = (await getProfile(req.account.id)) || {};
    const name = String(profile.full_name || req.account.full_name || '').trim().slice(0, 60);
    const existingFiles = await listFiles(req.account.id, {});
    const uploadHint = existingFiles.length
      ? 'أن يثبّت ملف بحثه: إن كان يملك ملفات مرفوعة مسبقاً فليخترها من قائمة ملفاته، وإلا فيرفعه جديداً (PDF أو Word)'
      : 'أن يرفع ملف بحثه (PDF أو Word)';

    // أول رسالة من المناقِش: ترحيب باسمه + طلب التثبيت — تُخزَّن كرسالة مساعد
    await askSupervisor({
      userId: req.account.id,
      prompt: `[بدء مناقشة مستقلة] أنت الآن مناقِش أكاديمي في دردشة مستقلة تماماً. رحّب بالباحث${name ? ` «${name}»` : ' باسمه'} تحية أكاديمية قصيرة مع ذكر تخصصه ودرجته، ثم اطلب منه ${uploadHint} ليقرأه كاملاً ويناقشه جزءاً جزءاً. لا تطرح أي سؤال علمي في هذه الرسالة.`,
      conversationId: conversation.id,
      profile,
      mode: 'defense',
      internal: true
    });

    res.redirect(303, `/defense?d=${conversation.id}&ok=done`);
  } catch (error) {
    console.warn(`فشل بدء جلسة مناقشة: ${error?.code || error?.message}`);
    res.redirect(303, `/defense?err=${flashKeyForError(error)}`);
  }
});

/**
 * رفع ملف البحث وتثبيته للجلسة: يستقبل multipart (حقل file) أو file_id لملف
 * موجود، ثم يثبّته في defense_state ويطلب من المناقِش قراءته وبدء المناقشة منه.
 */
router.post(
  '/defense/:id/thesis',
  requireService('defense'),
  requireCoreOnboarding,
  rateLimitUser('defense_thesis', { limit: 10, windowMs: 30 * 60 * 1000 }),
  concurrencyLimit('uploads'),
  async (req, res) => {
    const conversationId = String(req.params.id);
    const back = (key) => `/defense?d=${encodeURIComponent(conversationId)}&${key}`;

    // فحص مبكر للحجم المعلن (C4): express 5 يقرأ جسم POST كاملاً في الذاكرة،
    // فنرفض الطلب الضخم قبل قراءته — كما في مسار /files (workspace.js).
    // الهامش 2MB لأن ترميز multipart يضيف ~100 بايت فقط لكل حقل.
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > 0) {
      const maxBytes = await userFileMaxBytes(req.account.id);
      if (declared > maxBytes + 2 * 1024 * 1024) {
        console.warn(`رُفض رفع thesis ضخم بلا قراءة: ${declared} بايت`);
        res.redirect(303, back('err=file_bad'));
        return;
      }
    }

    try {
      const existing = await getConversation(req.account.id, conversationId);
      if (!existing || existing.mode !== 'defense') {
        res.redirect(303, `/defense?err=missing`);
        return;
      }

      let fileId = String(req.body?.file_id || '').trim();

      // رفع جديد عبر multipart (حقل file) — نفس حماية /files بدون مكتبة خارجية
      const contentType = String(req.headers['content-type'] || '');
      if (!fileId && contentType.includes('multipart/form-data')) {
        const request = new Request('http://localhost/defense-thesis', {
          method: 'POST',
          body: Readable.toWeb(req),
          headers: { 'content-type': contentType },
          duplex: 'half'
        });
        const form = await request.formData();
        const file = form.get('file');
        const picked = form.get('file_id');
        if (picked && String(picked).trim()) {
          fileId = String(picked).trim();
        } else if (file instanceof File && file.size) {
          const saved = await saveUpload(req.account.id, { file, title: file.name || 'ملف البحث' });
          fileId = saved.id;
        }
      }

      if (!fileId) {
        res.redirect(303, back('err=no_file'));
        return;
      }

      const row = await getFileRow(req.account.id, fileId);
      if (!row) {
        res.redirect(303, back('err=no_file'));
        return;
      }

      await setDefenseThesisFile(conversationId, fileId);

      // خطة المناقشة: نقسم نصّ البحث إلى أجزاء ونحدّد سقف الأسئلة — قبل أول
      // سؤال، حتى يعرف المناقِش خطّته وكم-question له. تُبنى مرة واحدة هنا.
      await buildDefensePlanForFile(req.account.id, conversationId, fileId);

      // رسالة نظام مرئية تفصل بين «اطلب التثبيت» و«قرأتُ بحثك»: بدونها يبدو ردّ
      // المناقِش تناقضاً (طلب رفعاً ثم أعلن قراءته فوراً). دور='system' فلا تُعدّ
      // رسالة باحث في isFirstMessageEver ولا في عدّادات المحادثات.
      await appendMessage(conversationId, {
        role: 'system',
        content: `📎 ثُبِّت ملف البحث «${row.file_name || row.title || 'الملف'}» في هذه الجلسة.`
      });

      // المناقِش يقرأ البحث المثبّت ويبدأ المناقشة من أول جزء — الملف يُحقن تلقائياً.
      // التثبيت يبقى حتى لو فشل نداء الذكاء (البطاقة تختفي والدردشة تظهر) — الباحث
      // يعيد تحميل الصفحة فيجد ملفه مثبّتاً ويحاول بدء المناقشة من جديد.
      // ملاحظة: رسالة البدء قصيرة عمداً (بلا إقحام نص الملف كاملاً في سطر البرومبت)
      // لأن النص الكامل يُحقن أصلاً من defense_state عبر buildSupervisorContext —
      // إقحامه هنا يضاعف السياق فيفشل Groq بحد الطول، ويفشل OpenRouter بنفاد الرصيد.
      try {
        const opening = await askSupervisor({
          userId: req.account.id,
          prompt: '[ملف البحث مثبّت أعلاه — اقرأه كاملاً] اكتب للباحث أنك قرأت بحثه وفهمته، ثم ابدأ مناقشته من أول جزء بسؤال واحد فقط من قلب النص مع الإشارة لموضعه.',
          conversationId,
          profile: (await getProfile(req.account.id)) || {},
          mode: 'defense',
          internal: true
        });
        // أول سؤال من المناقِش يُحتسب في العدّاد (كغيره).
        await recordReplyQuestion(conversationId, opening?.answer);
      } catch (aiError) {
        console.warn(`فشل بدء المناقشة من البحث (الملف مثبّت): ${aiError?.code || aiError?.message}`);
        res.redirect(303, back(`err=${flashKeyForError(aiError)}`));
        return;
      }

      res.redirect(303, back('ok=thesis_ok'));
    } catch (error) {
      console.warn(`فشل تثبيت ملف البحث: ${error?.code || error?.message}`);
      res.redirect(303, back(`err=${flashKeyForError(error)}`));
    }
  }
);

/** إرسال إجابة: المناقِش يقيّمها ثم يطرح سؤاله التالي من نفس الجزء أو التالي — بلا تكرار. */
router.post('/defense/:id/answer', requireService('defense'), requireCoreOnboarding, async (req, res) => {
  const conversationId = String(req.params.id);

  try {
    const existing = await getConversation(req.account.id, conversationId);
    if (!existing || existing.mode !== 'defense') {
      res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&err=missing`);
      return;
    }

    const progress = defenseProgress(existing.defense_state);
    if (progress.done) {
      res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&ok=finished`);
      return;
    }
    if (!progress.thesisFileId) {
      res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&err=no_file`);
      return;
    }

    const prompt = String(req.body?.answer || '').trim();
    if (!prompt) {
      res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&err=empty`);
      return;
    }

    // الإجابة تُحفظ كما كتبها الباحث (رسالة user)، والمناقِش يرد تقييماً + سؤاله التالي
    // (ملف البحث يُحقن تلقائياً من defense_state — لا يحتاج إرفاقاً جديداً)
    const result = await askSupervisor({
      userId: req.account.id,
      prompt,
      conversationId,
      profile: (await getProfile(req.account.id)) || {},
      mode: 'defense'
    });

    // عدّاد المناقشة: نسجّل سؤال المناقِش (نصّه + الجزء الذي غطّاه) ⇒ يعرف
    // المناقِش كم طرح وكم بقي، فلا يكرّر ولا يتجاوز السقف.
    await recordReplyQuestion(conversationId, result.answer);

    res.redirect(303, `/defense?d=${encodeURIComponent(result.conversationId)}&ok=answered`);
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

/** إنهاء الجلسة بالتقييم النهائي: نقاط القوة والضعف والتوصيات قبل المناقشة الحقيقية. */
router.post('/defense/:id/finish', requireService('defense'), requireCoreOnboarding, async (req, res) => {
  const conversationId = String(req.params.id);

  try {
    const existing = await getConversation(req.account.id, conversationId);
    if (!existing || existing.mode !== 'defense') {
      res.redirect(303, `/defense?err=missing`);
      return;
    }

    await askSupervisor({
      userId: req.account.id,
      prompt: 'انتهت المناقشة — غطّيتَ كل أجزاء البحث. أعطني الآن التقييم النهائي: نقاط القوة، ونقاط الضعف، والتوصيات قبل المناقشة الحقيقية. لا تطرح أسئلة جديدة.',
      conversationId,
      profile: (await getProfile(req.account.id)) || {},
      mode: 'defense',
      internal: true
    });

    // نقرأ الحالة مجدداً بعد رد المناقِش (قد يكون حدّث العدّاد أو أغلق الجلسة
    // بنفسه بالوسم الداخلي) — لا نكتب حالة قديمة فوق ما حدّثه.
    const { pool: dbPool } = await import('../db/client.js');
    const { rows } = await dbPool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
    const raw = rows[0]?.defense_state && typeof rows[0].defense_state === 'object' ? rows[0].defense_state : {};
    await dbPool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
      conversationId,
      JSON.stringify({ ...raw, done: true })
    ]);

    res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&ok=finished`);
  } catch (error) {
    console.warn(`فشل إنهاء المناقشة: ${error?.code || error?.message}`);
    res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&err=${flashKeyForError(error)}`);
  }
});

/** حذف جلسة محاكاة. */
router.post('/defense/:id/delete', requireService('defense'), async (req, res) => {
  await deleteConversation(req.account.id, String(req.params.id));
  res.redirect(303, '/defense');
});

export { router as defenseRouter };