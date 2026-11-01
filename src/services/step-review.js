import { isUuid } from '../constants.js';
import { pool } from '../db/client.js';
import { degreeOfUser, isValidStepKeyForUser, resolvePathForDegree, setStepStatus } from './journey.js';
import { getMemory, resetStrikes, saveMemory } from './supervisor-memory.js';
import { logUsage } from './tokens.js';

/** Detects step completion without mutating progress until the user explicitly saves. */

/** Maximum value length for one review field. */
const FIELD_VALUE_LIMIT = 300;
/** Number of recent messages inspected. */
const TRANSCRIPT_LIMIT = 30;

/** Per-step fields and text patterns; unknown steps use FALLBACK_SPEC. */
const STEP_SPECS = {
  topic: {
    title: 'اختيار الموضوع',
    fields: [
      { key: 'problem', label: 'صياغة المشكلة', pattern: /مشكل(?:ة|تك|تي)|صياغة (?:المشكلة|السؤال)|السؤال الرئيس|سؤال (?:البحث|الدراسة)/i },
      { key: 'limits', label: 'حدود الدراسة', pattern: /حدود (?:الدراسة|البحث)|نطاق الدراسة|الحدود المكانية|الحدود الزمنية|المجتمع والعينة/i },
      { key: 'title', label: 'عنوان البحث المبدئي', pattern: /عنوان (?:البحث|الموضوع)|موضوعي|اخترت (?:عنوان|موضوع)|موضوع البحث/i }
    ]
  },
  proposal: {
    title: 'خطة البحث (البروبوزال)',
    fields: [
      { key: 'objective', label: 'الهدف من البحث', pattern: /الهدف من (?:البحث|هذه الدراسة)|أهداف البحث|الهدف الرئيس|الغرض من/i },
      { key: 'question', label: 'سؤال البحث', pattern: /سؤال (?:البحث|الرئيس)|السؤال الرئيس|سؤال البحث الرئيس|تساؤل البحث/i },
      { key: 'method', label: 'المنهج المبدئي', pattern: /المنهج|منهجية البحث|وصفي|تجريبي|مسحي|تاريخي|تحليلي|نوعي|كمي/i }
    ]
  },
  literature: {
    title: 'الدراسات السابقة',
    fields: [
      { key: 'count', label: 'عدد المراجع', pattern: /(?:\d+|[٠-٩]+)\s*(?:مرجعا?|مراجع|دراسة|دراسات)|(?:مراجع|دراسات)\s+(?:بعدد\s+)?(?:\d+|[٠-٩]+)/i },
      { key: 'themes', label: 'محاور التصنيف', pattern: /محاور|تصنيف|إطار نظري|الإطار النظر|فئات|أصناف|جدول مقارنة/i },
      { key: 'sources', label: 'مصادر البحث', pattern: /قاعدة بيانات|scopus|web of science|google scholar|وحدة بحث|مجلات محكّمة|مواقع علمية/i }
    ]
  },
  methodology: {
    title: 'المنهج وأدواته',
    fields: [
      { key: 'method', label: 'المنهج', pattern: /المنهج|منهجية البحث|وصفي|تجريبي|مسحي|تاريخي|تحليلي/i },
      { key: 'sample', label: 'العينة ومجتمعها', pattern: /عينة|مجتمع الدراسة|معاينة|عشوائية|مقاصد|حجم العينة/i },
      { key: 'tool', label: 'أداة جمع البيانات', pattern: /استبانة|مقابلة|اختبار|ملاحظة|أداة جمع|مقياس|كودلو|استمارة/i }
    ]
  },
  data: {
    title: 'جمع البيانات',
    fields: [
      { key: 'collection', label: 'أسلوب جمع البيانات', pattern: /جمع البيانات|الميدان|المشاركين|المستجيبين|تطبيق الأداة|التقريب الميداني/i },
      { key: 'protocol', label: 'توثيق الإجراءات', pattern: /بروتوكول|توثيق الإجراءات|سجل ميداني|خطوات التنفيذ|توثيق/i },
      { key: 'cleaning', label: 'تجهيز وتنظيف البيانات', pattern: /تنظيف (?:البيانات|القيم)|تجهيز البيانات|القيم المفقودة|إدخال البيانات|معالجة البيانات/i }
    ]
  },
  analysis: {
    title: 'تحليل النتائج',
    fields: [
      { key: 'tests', label: 'الاختبارات الإحصائية', pattern: /اختبار|anova|انحدار|ارتباط|كاي|ثبات|صدق|إحصائي/i },
      { key: 'software', label: 'برنامج التحليل', pattern: /spss|smartpls|amos|stata|excel|إكسل|jamovi|jasp|برنامج/i },
      { key: 'output', label: 'المخرجات (جداول وأشكال)', pattern: /جدول|شكل|مخرجات|نتائج|تفسير/i }
    ]
  },
  writing: {
    title: 'كتابة الفصول',
    fields: [
      { key: 'chapters', label: 'الفصول المنجزة', pattern: /فصل|الفصول|الإطار النظر|المنهجية|الخاتمة|المقدمة/i },
      { key: 'style', label: 'أسلوب التوثيق', pattern: /apa|هارفارد|شيكاغو|mla|ieee|أسلوب التوثيق|أسلوب الاقتباس/i },
      { key: 'draft', label: 'حالة المسودة', pattern: /مسودة|أدرجت|أنجزت|كتبت|النسخة|تسليم|مرسلة/i }
    ]
  },
  discussion: {
    title: 'المناقشة والتوصيات',
    fields: [
      { key: 'findings', label: 'الاستنتاجات', pattern: /استنتاج|خلاصة|نخلص|أظهرت نتائج|أكدت الدراسة/i },
      { key: 'recommendations', label: 'التوصيات', pattern: /توصي|التوصيات/i },
      { key: 'future', label: 'بحوث مستقبلية', pattern: /مستقبلية|لاحقة|أبحاث لاحقة/i }
    ]
  },
  defense: {
    title: 'العرض والمناقشة',
    fields: [
      { key: 'slides', label: 'العرض التقديمي', pattern: /شريحة|عرض تقديمي|بوربوينت|ppt|العرض/i },
      { key: 'questions', label: 'أسئلة اللجنة', pattern: /أسئلة|اللجنة|لجان المناقشة|نقاط الاعتراض|المناقشة/i },
      { key: 'rehearsal', label: 'المحاكاة والتدريب', pattern: /محاكاة|تمرّن|تدريبت|تجربة|ردود ممهّرة/i }
    ]
  },
  publication: {
    title: 'نشر بحث علمي',
    fields: [
      { key: 'journal', label: 'المجلة المستهدفة', pattern: /مجلة|تصنيف|Q1|Q2|نشر علمي/i },
      { key: 'manuscript', label: 'مقال النشر', pattern: /مقال|manuscript|رسالة البحث المختصرة/i },
      { key: 'cover', label: 'رسالة التغطية', pattern: /رسالة التغطية|cover letter|رسالة التقديم/i }
    ]
  },
  review: {
    title: 'مراجعة الأقران',
    fields: [
      { key: 'comments', label: 'ملاحظات المحكّمين', pattern: /ملاحظات المحكّمين|المحكّم|ملاحظة أولاً|تقييم الأقران/i },
      { key: 'responses', label: 'الردود', pattern: /رددت|ردود|أجبت عن|جواب|أجبنا/i },
      { key: 'revisions', label: 'التعديلات المطبّقة', pattern: /تعديل|عدّلت|أراجع|طبقت|عدّلنا/i }
    ]
  }
};

/** Fallback for unknown steps requires an explicit completion statement and summary. */
const FALLBACK_SPEC = {
  title: 'خطوة مسار البحث',
  isFallback: true,
  fields: [
    { key: 'accomplished', label: 'ما أُنجز فعلياً', pattern: /أنجزت|أكملت|اكتمل|تم إنجاز|اعتمدت|جاهز|انتهيت/i },
    { key: 'summary', label: 'ملخص المخرجات', pattern: /ملخص|ما تم|الخطوة|المرحلة|المطلوب/i }
  ]
};

/** Returns the registered or fallback step specification. */
export function specForStep(stepKey) {
  return STEP_SPECS[String(stepKey || '').trim()] || FALLBACK_SPEC;
}

/** Extracts a single matching sentence for the review card. */
function excerptAround(text, index, max = 240) {
  const boundaries = '.؟!\n؛;';
  let start = index;
  while (start > 0 && index - start < 240 && !boundaries.includes(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && end - index < max && !boundaries.includes(text[end])) end += 1;

  const slice = text.slice(start, end + 1).replace(/\s+/g, ' ').trim();
  if (slice.length <= FIELD_VALUE_LIMIT) return slice;
  return `${slice.slice(0, FIELD_VALUE_LIMIT - 1)}…`;
}

/** Deterministically evaluates a transcript without database access. */
export function evaluateStepCompletion({ stepKey = '', transcript = '', stepTitle = '' } = {}) {
  const spec = specForStep(stepKey);
  const text = String(transcript || '');

  const fields = spec.fields.map((field) => {
    const match = field.pattern.exec(text);
    return {
      key: field.key,
      label: field.label,
      matched: Boolean(match),
      value: match ? excerptAround(text, match.index) : ''
    };
  });

  const matched = fields.filter((field) => field.matched).length;

  return {
    stepKey: String(stepKey || ''),
    stepTitle: stepTitle || spec.title,
    isFallback: Boolean(spec.isFallback),
    fields,
    matched,
    total: fields.length,
    complete: fields.length > 0 && matched === fields.length
  };
}

/** Loads an owned conversation or throws NOT_FOUND. */
async function ownedConversation(userId, conversationId) {
  if (!isUuid(conversationId)) {
    const error = new Error('المحادثة غير موجودة.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const { rows } = await pool.query('SELECT * FROM conversations WHERE id = $2 AND user_id = $1', [
    userId,
    conversationId
  ]);
  if (!rows.length) {
    const error = new Error('المحادثة غير موجودة.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  return rows[0];
}

/** Normalizes a review field to one bounded line. */
function sanitizeFieldValue(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FIELD_VALUE_LIMIT);
}

/** Stores a pending review when completion signals are found; never updates progress. */
export async function detectStepCompletion({ userId, conversation }) {
  if (!userId || !conversation?.id) return null;
  if (conversation.mode === 'defense') return null;

  const stepKey = String(conversation.step_key || '').trim();
  if (!stepKey) return null;
  // Keep the pending card until the user saves or cancels it.
  if (conversation.pending_review) return null;
  if (!(await isValidStepKeyForUser(userId, stepKey))) return null;

  const { rows: progressRows } = await pool.query(
    'SELECT status FROM user_step_progress WHERE user_id = $1 AND step_key = $2',
    [userId, stepKey]
  );
  if (progressRows[0]?.status === 'done') return null;

  const { rows: messageRows } = await pool.query(
    `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [conversation.id, TRANSCRIPT_LIMIT]
  );
  if (!messageRows.some((row) => row.role === 'assistant')) return null;

  const transcript = messageRows
    .reverse()
    .map((row) => String(row.content || ''))
    .join('\n');

  const path = await resolvePathForDegree(await degreeOfUser(userId));
  const step = path.steps.find((item) => item.key === stepKey);
  if (!step) return null;

  const result = evaluateStepCompletion({ stepKey, transcript, stepTitle: step.title });
  if (!result.complete) return null;

  const card = {
    stepKey,
    stepTitle: step.title,
    createdAt: new Date().toISOString(),
    editing: false,
    fields: result.fields.map((field) => ({ key: field.key, label: field.label, value: field.value }))
  };

  await pool.query('UPDATE conversations SET pending_review = $2 WHERE id = $1', [
    conversation.id,
    JSON.stringify(card)
  ]);

  return card;
}

/** Updates pending review fields without changing research progress. */
export async function editStepReview(userId, conversationId, values = {}) {
  const conversation = await ownedConversation(userId, conversationId);
  const card = conversation.pending_review;
  if (!card || !card.stepKey) {
    const error = new Error('لا توجد مراجعة معلّقة لهذه الخطوة.');
    error.code = 'NO_PENDING';
    throw error;
  }

  const updated = {
    ...card,
    editing: true,
    fields: (card.fields || []).map((field) => ({
      ...field,
      value: sanitizeFieldValue(Object.hasOwn(values, field.key) ? values[field.key] : field.value)
    }))
  };

  await pool.query('UPDATE conversations SET pending_review = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(updated)
  ]);

  return updated;
}

/** Saves the review and performs the step-completion transaction. */
export async function saveStepReview(userId, conversationId, values = {}) {
  const conversation = await ownedConversation(userId, conversationId);
  const card = conversation.pending_review;
  if (!card || !card.stepKey) {
    const error = new Error('لا توجد مراجعة معلّقة لهذه الخطوة.');
    error.code = 'NO_PENDING';
    throw error;
  }

  if (!(await isValidStepKeyForUser(userId, card.stepKey))) {
    const error = new Error('هذه الخطوة غير موجودة في مسارك.');
    error.code = 'BAD_STEP';
    throw error;
  }

  const fields = (card.fields || []).map((field) => {
    const value = sanitizeFieldValue(Object.hasOwn(values, field.key) ? values[field.key] : field.value);
    if (!value) {
      const error = new Error(`الحقل «${field.label}» فارغ — اكتب قيمته قبل الحفظ.`);
      error.code = 'EMPTY_FIELD';
      error.field = field.key;
      throw error;
    }
    return { ...field, value };
  });

  // Mark the current step complete and save its outputs.
  const outputNote = fields.map((field) => `${field.label}: ${field.value}`).join('\n').slice(0, 4000);
  await setStepStatus(userId, card.stepKey, { status: 'done', outputNote });

  // Save the title only if the profile does not already have one.
  const titleValue = fields.find((field) => field.key === 'title')?.value;
  if (titleValue) {
    await pool.query(
      "UPDATE profiles SET research_title = $2, updated_at = NOW() WHERE user_id = $1 AND COALESCE(TRIM(research_title), '') = ''",
      [userId, titleValue.slice(0, 200)]
    );
  }

  // Start the next step unless it was already completed manually.
  const path = await resolvePathForDegree(await degreeOfUser(userId));
  const index = path.steps.findIndex((item) => item.key === card.stepKey);
  const nextStep = index >= 0 ? path.steps[index + 1] : null;
  if (nextStep) {
    const { rows } = await pool.query(
      'SELECT status FROM user_step_progress WHERE user_id = $1 AND step_key = $2',
      [userId, nextStep.key]
    );
    if (!rows[0] || rows[0].status === 'not_started') {
      await setStepStatus(userId, nextStep.key, {
        status: 'in_progress',
        outputNote: `الخطوة التالية بعد اكتمال «${card.stepTitle}»`
      });
    }
  }

  // Update the supervisor's next task and reset strikes.
  const memory = await getMemory(userId).catch(() => ({ memory: '', openTask: '' }));
  await saveMemory(userId, {
    memory: memory.memory,
    openTask: nextStep ? `بدء خطوة «${nextStep.title}»` : ''
  });
  await resetStrikes(userId);

  // Record completion for platform reporting without charging credits.
  await logUsage(userId, { type: 'step_completed', tokens: 0, summary: `اكتملت خطوة: ${card.stepTitle}` });

  // Clear the pending review card.
  await pool.query('UPDATE conversations SET pending_review = NULL WHERE id = $1', [conversationId]);

  return {
    stepKey: card.stepKey,
    stepTitle: card.stepTitle,
    nextTitle: nextStep ? nextStep.title : '',
    message: nextStep
      ? `🎉 أُكملت خطوة «${card.stepTitle}» وحُفظت في مسارك — الخطوة التالية: «${nextStep.title}».`
      : `🎉 أُكملت خطوة «${card.stepTitle}» — اكتمل مسارك كاملاً!`
  };
}

/** Cancels the pending review without changing progress. */
export async function cancelStepReview(userId, conversationId) {
  const conversation = await ownedConversation(userId, conversationId);
  if (!conversation.pending_review) {
    const error = new Error('لا توجد مراجعة معلّقة لهذه الخطوة.');
    error.code = 'NO_PENDING';
    throw error;
  }

  await pool.query('UPDATE conversations SET pending_review = NULL WHERE id = $1', [conversationId]);
  return true;
}
