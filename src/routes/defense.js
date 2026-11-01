import express from 'express';
import { Readable } from 'node:stream';
import { requireCoreOnboarding, requireService } from '../middleware/auth.js';
import { concurrencyLimit, rateLimitUser } from '../middleware/security.js';
import { deleteConversation, getConversation, askSupervisor, appendMessage } from '../services/chat.js';
import { gradeDefenseAnswer } from '../services/defense-grading.js';
import {
  buildDefensePlan,
  defenseChecklist,
  defenseProgress,
  extractQuestionFromReply,
  finishDefense,
  listDefenses,
  nextPendingPart,
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

/** Independent defense-session routes. */
const router = express.Router();

/** Flash messages shown after redirects. */
const FLASH = {
  empty: { type: 'error', message: 'اكتب إجابتك أولاً.' },
  missing: { type: 'error', message: 'جلسة المناقشة غير موجودة.' },
  no_file: { type: 'error', message: 'اختر ملف البحث أو ارفعه أولاً.' },
  no_tokens: { type: 'error', message: 'رصيدك لا يكفي — اشترِ باقة أو أنهِ الجلسة.' },
  no_provider: { type: 'error', message: 'لم يُضبط أي مزوّد ذكاء اصطناعي بعد.' },
  failed: { type: 'error', message: 'تعذّر الوصول للمناقِش الآن — نقاطك أُعيدت، أعد المحاولة.' },
  done: { type: 'ok', message: 'بدأت دردشة مناقشة مستقلة — ارفع ملف البحث أولاً.' },
  grade_no_tokens: { type: 'error', message: 'تم حفظ ردك، لكن رصيدك لا يكفي لتقييمه؛ سيظهر ضمن الأسئلة غير المقيمة.' },
  grade_invalid: { type: 'error', message: 'تم حفظ ردك، لكن تعذّر فهم نتيجة التقييم؛ سيظهر ضمن الأسئلة غير المقيمة.' },
  grade_failed: { type: 'error', message: 'تم حفظ ردك، لكن خدمة تقييم الإجابات غير متاحة الآن؛ سيظهر ضمن الأسئلة غير المقيمة.' },
  finished: { type: 'ok', message: 'انتهت المناقشة — اقرأ التقييم النهائي.' },
  file_bad: { type: 'error', message: 'تعذّر رفع الملف — تحقق من النوع والحجم.' }
};

/** Records the next question and the previous answer's grade. */
async function recordReplyQuestion(conversationId, replyText, { grade = null, gradeIssue = null } = {}) {
  const question = extractQuestionFromReply(replyText);
  if (!question && !grade && !gradeIssue) return null;
  const { pool: dbPool } = await import('../db/client.js');
  const { rows } = await dbPool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  const raw = rows[0]?.defense_state && typeof rows[0].defense_state === 'object' ? rows[0].defense_state : {};
  const current = nextPendingPart(raw);
  return await recordDefenseQuestion(conversationId, {
    question,
    partKey: current?.key || '',
    grade,
    gradeIssue
  });
}

/** Builds a thesis plan; extraction failures fall back to the default question limit. */
async function buildDefensePlanForFile(userId, conversationId, fileId) {
  try {
    const found = await readOwnedFile(userId, fileId);
    if (!found || !found.buffer) return false;
    const { text } = await extractFileText(found.buffer, found.row?.file_name || '');
    const { parts, pages } = buildDefensePlan(text);
    if (!parts.length) return false;
    return await setDefensePlan(conversationId, parts, pages);
  } catch (error) {
    console.warn(`تعذّر بناء خطة المناقشة: ${error?.code || error?.message}`);
    return false;
  }
}

/** Maps askSupervisor errors to flash-message keys. */
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

    // Reconcile legacy sessions whose questions were not tracked yet.
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

/** Starts a defense session and asks the user to attach a thesis. */
router.post('/defense/start', requireService('defense'), requireCoreOnboarding, rateLimitUser('defense_start', { limit: 5, windowMs: 30 * 60 * 1000 }), async (req, res) => {
  try {
    const conversation = await startDefense({ userId: req.account.id, title: 'مناقشة البحث' });

    // Include the name and existing files explicitly because models may overlook context.
    const profile = (await getProfile(req.account.id)) || {};
    const name = String(profile.full_name || req.account.full_name || '').trim().slice(0, 60);
    const existingFiles = await listFiles(req.account.id, {});
    const uploadHint = existingFiles.length
      ? 'أن يثبّت ملف بحثه: إن كان يملك ملفات مرفوعة مسبقاً فليخترها من قائمة ملفاته، وإلا فيرفعه جديداً (PDF أو Word)'
      : 'أن يرفع ملف بحثه (PDF أو Word)';

    // Store the opening prompt as an assistant message.
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

/** Attaches an uploaded or existing thesis, stores it in session state, and starts the defense. */
router.post(
  '/defense/:id/thesis',
  requireService('defense'),
  requireCoreOnboarding,
  rateLimitUser('defense_thesis', { limit: 10, windowMs: 30 * 60 * 1000 }),
  concurrencyLimit('uploads'),
  async (req, res) => {
    const conversationId = String(req.params.id);
    const back = (key) => `/defense?d=${encodeURIComponent(conversationId)}&${key}`;

    // Reject oversized requests before Express buffers the multipart body.
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

      // Parse multipart uploads without an additional dependency.
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

      // Build the plan once, before the first question.
      await buildDefensePlanForFile(req.account.id, conversationId, fileId);

      // Explain the transition to the attached thesis without counting this as a user message.
      await appendMessage(conversationId, {
        role: 'system',
        content: `📎 ثُبِّت ملف البحث «${row.file_name || row.title || 'الملف'}» في هذه الجلسة.`
      });

      // The thesis is already injected from defense_state; do not duplicate its text in this prompt.
      try {
        const opening = await askSupervisor({
          userId: req.account.id,
          prompt: '[ملف البحث مثبّت أعلاه — اقرأه كاملاً] اكتب للباحث أنك قرأت بحثه وفهمته، ثم ابدأ مناقشته من أول جزء بسؤال واحد فقط من قلب النص مع الإشارة لموضعه.',
          conversationId,
          profile: (await getProfile(req.account.id)) || {},
          mode: 'defense',
          internal: true
        });
        // Count the opening question like any other defense question.
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

/** Grades the user's answer and records the next defense question. */
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

    // The thesis is injected from defense_state; no repeat attachment is needed.
    const result = await askSupervisor({
      userId: req.account.id,
      prompt,
      conversationId,
      profile: (await getProfile(req.account.id)) || {},
      mode: 'defense'
    });

    const previousExaminerReply = [...(existing.messages || [])]
      .reverse()
      .find((message) => message.role === 'assistant' && extractQuestionFromReply(message.content));
    let gradeResult = { grade: null, reason: 'question_not_found' };
    if (previousExaminerReply) {
      try {
        let thesisContext = '';
        const thesisId = existing.defense_state?.thesisFileId;
        if (thesisId) {
          try {
            const thesis = await readOwnedFile(req.account.id, thesisId);
            if (thesis?.buffer) {
              const extracted = await extractFileText(thesis.buffer, thesis.row?.file_name || '');
              thesisContext = extracted.text.slice(0, 500);
            }
          } catch (contextError) {
            console.warn(`تعذّر تجهيز نص البحث لتقييم الإجابة: ${contextError?.code || contextError?.message}`);
          }
        }
        gradeResult = await gradeDefenseAnswer({
          userId: req.account.id,
          question: extractQuestionFromReply(previousExaminerReply.content),
          answer: prompt,
          examinerReply: previousExaminerReply.content,
          thesisContext
        });
      } catch (gradeError) {
        console.warn(`تعذّر تقييم إجابة المناقشة: ${gradeError?.code || gradeError?.message}`);
        gradeResult = { grade: null, reason: gradeError?.code || 'provider_failed' };
      }
    }

    // Persist the grade separately from the examiner's prose and record the next question.
    const gradeIssue = gradeResult.grade ? null : gradeResult.reason || 'provider_failed';
    const savedState = await recordReplyQuestion(conversationId, result.answer, {
      grade: gradeResult.grade,
      gradeIssue
    });
    if (gradeResult.grade && !savedState) {
      gradeResult = { grade: null, reason: 'persistence_failed' };
    }
    if (!gradeResult.grade) {
      console.warn(`لم يُسجّل تقييم إجابة المناقشة: ${gradeResult.reason || 'unknown'}`);
    }
    if (result.defenseEnded) await finishDefense(conversationId);

    const gradeErrorKey = gradeResult.reason === 'insufficient_credits'
      ? 'grade_no_tokens'
      : gradeResult.reason === 'invalid_grade'
        ? 'grade_invalid'
        : 'grade_failed';
    const gradeStatus = gradeResult.grade ? 'ok=answered' : `err=${gradeErrorKey}`;
    res.redirect(303, `/defense?d=${encodeURIComponent(result.conversationId)}&${gradeStatus}`);
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

/** Requests the final defense report and marks the session complete. */
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
      prompt: 'أنهينا المناقشة الآن قبل تغطية جميع الأسئلة. قيّم محتوى ملف البحث كاملاً: نقاط القوة، ونقاط الضعف، والتوصيات العملية قبل المناقشة الحقيقية. قيّم أداء الباحث فقط في الإجابات التي أجاب عنها، واذكر بوضوح الجوانب التي لم تُختبر بسبب عدم طرح أسئلتها. لا ترفض التقييم، ولا تطلب متابعة الأسئلة، ولا تطرح سؤالاً جديداً.',
      conversationId,
      profile: (await getProfile(req.account.id)) || {},
      mode: 'defense',
      internal: true,
      defenseFinalRequested: true
    });

    await finishDefense(conversationId);

    res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&ok=finished`);
  } catch (error) {
    console.warn(`فشل إنهاء المناقشة: ${error?.code || error?.message}`);
    res.redirect(303, `/defense?d=${encodeURIComponent(conversationId)}&err=${flashKeyForError(error)}`);
  }
});

/** Deletes a defense session. */
router.post('/defense/:id/delete', requireService('defense'), async (req, res) => {
  await deleteConversation(req.account.id, String(req.params.id));
  res.redirect(303, '/defense');
});

export { router as defenseRouter };