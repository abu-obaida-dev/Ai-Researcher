import { pool } from '../db/client.js';

/**
 * خدمة المناقشة المستقلة (defense): دردشة مستقلة تماماً بملف بحث ثابت.
 *
 * الفكرة: جلسة المناقشة = دردشة مستقلة تُفتح بملف بحث واحد ثابت
 * (thesis_file_id في defense_state)، والمناقِش يقسم البحث ذهنياً إلى أجزائه
 * الطبيعية ويناقش جزءاً جزءاً بلا تكرار.
 *
 * الإصلاح (21 أكتوبر 2026): المناقشة كانت بلا حدّ ولا تتبّع — يسأل بلا نهاية
 * ويكرّر من الأول (لأن `asked` و `coveredParts` لم يُزادا أبداً). الآن:
 *   - خطة الأجزاء: تُستخرج من نصّ الملف (فصول/مقاطع) وتُخزَّن في defense_state.
 *   - سقف أسئلة محسوب (حصّة كل جزء) ⇒ لا تساؤل لا ينتهي.
 *   - عدّاد `asked` حقيقي + `askedQuestions` (نصّ كل سؤال) + `coveredParts`.
 *   - المناقِش يعرف في موجّه: كم طرح، كم بقي، وأي جزء غطّاه ⇒ لا يكرّر.
 */

/**
 * وسم ختام المناقشة: المناقِش يوسم رسالة تقييمه النهائي به، فتُحذف الصيغة من
 * النص المحفوظ ويُغلق مسار الجلسة (done) فوراً — لا انتظار لزر «إنهاء».
 */
const DEFENSE_FINAL_RE = /\[\[\s*defense-final\s*\]\]/i;
const DEFENSE_FINAL_GLOBAL_RE = /\s*\[\[\s*defense-final\s*\]\]/gi;

export function extractDefenseFinalTag(text) {
  const raw = String(text || '');
  return {
    text: raw.replace(DEFENSE_FINAL_GLOBAL_RE, '').replace(/\s+$/, ''),
    ended: DEFENSE_FINAL_RE.test(raw)
  };
}

/* =============================================================================
 * خطة المناقشة: تقسيم البحث إلى أجزاء + سقف أسئلة + تتبّع التغطية
 * ============================================================================= */

/**
 * أقسام البحث الشائعة — تُطابَق على عناوين الفصول/المقاطع في نصّ الملف.
 * الترتيب مهم: نطابق الأعمق أولاً (نتائج ومناقشة قبل المنهجية).
 */
const SECTION_PATTERNS = [
  { key: 'intro', label: 'المقدمة والخلفية والمشكلة', re: /مقدم|تمهيد|المشكلة|الفرضية|الفكرة العامة/i },
  { key: 'problem', label: 'المشكلة البحثية والأهداف والفرضيات', re: /أهد[اف]|مشكلة البحث|فرضي|تساؤل|قائمة الفرضيات/i },
  { key: 'method', label: 'المنهجية والإجراءات والتحليل الإحصائي', re: /منهج|طرائق|إجراءات|أسلوب البحث|مجتمع|عيّن|الإحصاء|النموذج|عينة/i },
  { key: 'results', label: 'النتائج والتحليل الإحصائي وجدول البيانات', re: /نتائج|جداول|تحليل البيانات|الإحصاء|المعاملات|الجدول الرئيسي/i },
  { key: 'discussion', label: 'المناقشة والتوصيات والخلاصة', re: /مناقش[ةه]|توصيات|الخلاص|النتيجة الرئيسية|أهمية البحث/i },
  { key: 'references', label: 'المراجع وقائمة المصادر', re: /مراجع|قائمة المصادر/i }
];

/** الحد الأدنى لعدد الأسئلة في الجلسة كلها (حتى لو كان الملف صغيراً). */
const MIN_QUESTIONS = 6;

/** سقف أعلى للجلسة كلها: مناقشة حقيقية، لا استجواب لا ينتهي. */
const MAX_QUESTIONS = 36;

/**
 * كل هذا العدد من أحرف الجزء ≈ سؤال واحد فيه (≈ ٣ صفحات: كل صفحة ~٩٠٠ حرف
 * في estimatePages). هذا هو **مقياس عدد الأسئلة**: بحث من ١٠٠ صفحة ⇒ ~٣٠ سؤالاً،
 * وبحث من ٢٠ صفحة ⇒ ~٧ أسئلة. (كان قبل ذلك ٦ أسئلة ثابتة لكل بحث.)
 */
const CHARS_PER_QUESTION = 2800;

/** أقصى حصّة للجزء الواحد: كتلة ضخمة لا تبتلع المناقشة كلها. */
const MAX_QUOTA_PER_PART = 5;

/** أقصى عدد أجزاء في الخطة (حماية من فهرس/عناوين متكرّرة في ملف ضخم). */
const MAX_PLAN_PARTS = 60;

/** حجم الجزء الاحتياطي حين لا تُوجد عناوين في النص المستخرج. */
const FALLBACK_CHUNK_CHARS = CHARS_PER_QUESTION * 2;

/** كلمات بداية عناوين الفصول/المقاطع في الرسائل العربية. */
const CHAPTER_WORDS = [
  'الفصل ',
  'الباب ',
  'المبحث ',
  'المطلب ',
  'الجزء ',
  'المحور ',
  'الملحق ',
  'فصل ',
  'باب '
];

/**
 * ترقيم القسم: «١.٢ منهجية» أو «2) …» أو «3: …» — **بلا شُرَطة** لأن
 * «3- …» في الرسائل عنصر قائمة لا عنواناً.
 */
const NUMBERED_HEADING_RE = /^(?:[\(\[]?\s*[\d٠-٩]{1,3}\s*[\)\].:]\s*\S|[\d٠-٩]{1,3}(?:\.[\d٠-٩]{1,3})+\s+\S)/u;

/** سطر فهرس المحتويات: نقاط قائدة («المقدمة ...... ٥») أو رقم صفحة في آخره. */
function looksLikeToc(line) {
  const l = String(line || '');
  return /\.{3,}|…/.test(l) || /\s[\d٠-٩]{1,4}\s*$/u.test(l.trim());
}

function isChapterLine(line) {
  const l = String(line || '').trim();
  return CHAPTER_WORDS.some((word) => l.startsWith(word));
}

/**
 * هل السطر عنوان قسم فعلي؟ (لا سطر فهرس ولا سطر بيانات ولا جملة عادية)
 * السطر الطويل جملة عادية بالضرورة ⇒ ليس عنواناً.
 */
function isHeadingLine(line) {
  const l = String(line || '').trim();
  if (!l || l.length > 120) return false;
  if (isChapterLine(l)) return true; // عناوين الفصول أولوية على قاعدة "ينتهي برقم"
  if (looksLikeToc(l)) return false; // فهرس المحتويات («… ..... ٥») ليس قسمًا
  if (!NUMBERED_HEADING_RE.test(l)) return false;

  const body = l.replace(NUMBERED_HEADING_RE, '').trim();
  if (body.length < 3) return false;
  const separators = (l.match(/[,،|؛]/gu) || []).length;
  if (separators >= 3) return false; // سطر جدول بيانات لا عنوان
  if (/^[\d٠-٩\s.\-–↑%]+$/u.test(body)) return false; // أرقام فقط
  return true;
}

/** مفتاح فريد للجزء: نسمح بتكرار المفتاح المنطقي («intro#2») للفصول المكرّرة. */
function uniqueKey(base, taken) {
  const key = String(base || 'part').trim() || 'part';
  if (!taken.has(key)) {
    taken.add(key);
    return key;
  }
  let n = 2;
  while (taken.has(`${key}#${n}`)) n += 1;
  const out = `${key}#${n}`;
  taken.add(out);
  return out;
}

function keyOf(title, body) {
  const t = String(title || '');
  for (const { key, re } of SECTION_PATTERNS) {
    if (re.test(t)) return key;
  }
  const all = String(title || '') + ' ' + String(body || '');
  for (const { key, re } of SECTION_PATTERNS) {
    if (re.test(all)) return key;
  }
  return null;
}

/**
 * يقسّم نص البحث إلى أجزائه الفعلية كما وردت في الملف (فصول/مقاطع/عناوين
 * مرقّمة)، كل جزء بمفتاحه وعنوانه وحجم متنه ووزنه العلمي.
 *
 * التغيير الجوهري (٢١ أكتوبر ٢٠٢٦): كان التقسيم يعطي **٦ أجزاء كحدّ أقصى
 * دائماً** (المفاتيح من أنماط الأقسام الستة وحدها) ⇒ سقف الأسئلة = ٦ لكل بحث
 * مهما كان حجمه (١٠٠ صفحة = ٢٠ صفحة). الآن:
 *   - كل عنوان فعلي في الملف = جزء مستقل (بحدّ ٦٠ جزءاً).
 *   - تُهمَل أسطر فهرس المحتويات وعناوين الجداول وعناصر القوائم («٣- …»).
 *   - إن لم توجد عناوين في النص المستخرج: يُقسَّم المتن بالحجم (chunkBySize)
 *     فلا يسقط بحث ضخم إلى عدد أسئلة صغير.
 *   - الترتيب = ترتيب البحث نفسه (كما يمشي المناقِش في الورقة).
 */
export function planParts(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const lines = raw.split('\n');
  const blocks = [];
  let current = { title: '', body: '' };
  for (const line of lines) {
    if (isHeadingLine(line)) {
      if (current.title || current.body.trim()) blocks.push(current);
      current = { title: line.trim(), body: '' };
    } else {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current.title || current.body.trim()) blocks.push(current);

  const taken = new Set();
  const parts = [];
  for (const block of blocks) {
    const title = String(block.title || '').replace(/\s+/g, ' ').trim();
    const body = String(block.body || '').trim();
    const canonical = keyOf(title, body);
    // كتلة بلا متن وبلا عنوان معروف (عنوان شارد/سطر فهرس) ليست جزءاً.
    if (!body && !canonical) continue;

    const label = (
      title ||
      SECTION_PATTERNS.find((pattern) => pattern.key === canonical)?.label ||
      `الجزء ${parts.length + 1}`
    ).slice(0, 90);

    // العنوان نفسه مرّتين (فهرس ثم فصل حقيقي): نُبقي الجزء الأكبر متناً.
    const twin = parts.findIndex((part) => part.label === label);
    if (twin !== -1) {
      if (body.length > parts[twin].chars) {
        parts[twin].chars = body.length;
        parts[twin].weight = partWeight(label, body);
      }
      continue;
    }

    if (parts.length >= MAX_PLAN_PARTS) break;
    parts.push({
      key: uniqueKey(canonical || `part${parts.length + 1}`, taken),
      label,
      chars: body.length,
      weight: partWeight(label, body)
    });
  }

  if (parts.length) return parts;

  // بلا عناوين: تقسيم بالحجم ⇒ الأسئلة تظل متناسبة مع حجم البحث.
  return chunkBySize(raw);
}

/**
 * تقسيم احتياطي بالحجم: كل FALLBACK_CHUNK_CHARS حرفاً جزءاً، ويأخذ كل جزء
 * مفتاحه المنطقي من كلماته إن أمكن (منهج/نتائج…) وإلا «partN».
 */
function chunkBySize(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const chunks = [];
  for (let start = 0; start < raw.length && chunks.length < MAX_PLAN_PARTS; start += FALLBACK_CHUNK_CHARS) {
    chunks.push(raw.slice(start, start + FALLBACK_CHUNK_CHARS));
  }

  const taken = new Set();
  return chunks.map((slice, index) => {
    const canonical = keyOf('', slice);
    const label = (
      SECTION_PATTERNS.find((pattern) => pattern.key === canonical)?.label || `الجزء ${index + 1}`
    ).slice(0, 90);
    return {
      key: uniqueKey(canonical || `part${index + 1}`, taken),
      label,
      chars: slice.length,
      weight: partWeight(label, slice)
    };
  });
}

/**
 * خطة الجلسة من نصّ البحث: الأجزاء + تقدير عدد الصفحات (لإعلام المناقِش والواجهة
 * بأصل العدد المحسوب: «بحثك ≈ ١٢٠ صفحة ⇒ خطة ٣٠ سؤالاً»).
 */
export function buildDefensePlan(text) {
  const raw = String(text || '');
  const parts = planParts(raw);
  return { parts, pages: raw.trim() ? estimatePages(raw) : 0 };
}


/** يقدّر كثافة محتوى الجزء: يزيد «وزن» الجزء إذا وُجدت في عنوانه أو نصّه
 *  كلمات تشير إلى منهج أو نتائج أو إحصاء أو نموذج أو فرضية أو عينة. */
function partWeight(label, text) {
  const t = String(label || '') + ' ' + String(text || '');
  let w = 0;
  const words = ['منهج','طرائق','إجراءات','أسلوب البحث','عينة','مجتمع','إحصاء','تحليل','نتائج','جداول','معاملات','بيانات','فرضية','فرضيات','تساؤل','غرض','نتيجة','أهمية البحث','نموذج','مناقش','توصيات'];
  for (const w_ of words) {
    if (new RegExp(w_, 'i').test(t)) w++;
  }
  return w;
}

/**
 * حصّة الأسئلة في الجزء: مشتقّة من **حجم متنه** (سؤال لكل ~٢٨٠٠ حرف ≈ ٣ صفحات)،
 * ويُضاف سؤال إذا كان الجزء علمياً كثيفاً (منهج/نتائج/إحصاء/مناقشة).
 *
 * هذه هي وحدة الحساب الوحيدة لعدد الأسئلة: مجموع حصص الأجزاء = سقف الجلسة
 * (انظر maxQuestionsFor) — فلا يوجد رقم ثابت يخالف حجم البحث.
 */
export function quotaForPart(part = {}) {
  if (!part || typeof part !== 'object') return 1;
  const chars = Math.max(0, Number(part.chars) || 0);
  const weight = Math.max(0, Number(part.weight) || 0);
  const bySize = Math.ceil(chars / CHARS_PER_QUESTION);
  const byWeight = weight >= 4 ? 1 : 0;
  return Math.max(1, Math.min(MAX_QUOTA_PER_PART, bySize + byWeight));
}

/** عدّاد الأسئلة لكل جزء من الحالة ({} إن لم تكن مُهيّأة). */
function askedCounts(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const byPart = raw.askedByPart && typeof raw.askedByPart === 'object' ? raw.askedByPart : {};
  const counts = {};
  for (const [key, value] of Object.entries(byPart)) counts[key] = Math.max(0, Number(value) || 0);
  return counts;
}

/** هل استُنفدت حصّة الجزء؟ (يُحترم التتبّع القديم القائم على coveredParts) */
export function partCovered(state = {}, part = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const key = String(part?.key || '');
  if (!key) return false;

  if (!raw.askedByPart || typeof raw.askedByPart !== 'object') {
    return (Array.isArray(raw.coveredParts) ? raw.coveredParts : []).includes(key);
  }
  return (askedCounts(raw)[key] || 0) >= quotaForPart(part);
}

/** الأجزاء المغطّاة فعلاً (حصّتها مستنفدة) — بمفاتيح الخطة. */
function coveredPartsOf(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  if (!raw.askedByPart || typeof raw.askedByPart !== 'object') {
    return Array.isArray(raw.coveredParts) ? [...raw.coveredParts] : [];
  }
  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  const counts = askedCounts(raw);
  const covered = plan.filter((part) => (counts[part?.key] || 0) >= quotaForPart(part)).map((part) => part.key);
  const planKeys = new Set(plan.map((part) => part?.key));
  for (const key of Object.keys(counts)) {
    if (!planKeys.has(key) && counts[key] > 0) covered.push(key);
  }
  return covered;
}

/** الجزء المطلوب الآن: أول جزء لم تُستنفد حصّته من الأسئلة. */
export function nextPendingPart(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  if (!plan.length) return null;
  return plan.find((part) => !partCovered(raw, part)) || null;
}

/**
 * يسجّل سؤالاً جديداً في حالة المناقشة: يزيد العدّاد العام، يحفظ نصّ السؤال،
 * ويزيد عدّاد الجزء الذي جاء منه السؤال.
 *
 * الجزء يُغلق عند **استنفاد حصّته** لا بعد سؤال واحد (جزء المنهجية مثلاً قد
 * يستحق سؤالين) — هذا ما يجعل المناقشة «جزءاً جزءاً» بمعناها الحقيقي.
 */
export function applyQuestionToState(state = {}, { question = '', partKey = '' } = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const asked = Number(raw.asked) || 0;
  const askedQuestions = Array.isArray(raw.askedQuestions) ? [...raw.askedQuestions] : [];
  const plan = Array.isArray(raw.parts) ? raw.parts : [];

  const text = String(question || '').trim();
  if (text) askedQuestions.push(text.slice(0, 400));

  const askedByPart = askedCounts(raw);
  // ترحيل جلسة قديمة: `coveredParts` كانت تعني «سؤال واحد فيه» ⇒ نعتبر حصّته مستنفدة.
  if (!raw.askedByPart && Array.isArray(raw.coveredParts)) {
    for (const key of raw.coveredParts) {
      const part = plan.find((item) => item?.key === key);
      askedByPart[key] = Math.max(askedByPart[key] || 0, quotaForPart(part || {}));
    }
  }
  if (partKey) askedByPart[partKey] = Math.max(0, Number(askedByPart[partKey]) || 0) + 1;

  const next = { ...raw, asked: asked + 1, askedQuestions, askedByPart };
  next.coveredParts = coveredPartsOf(next);
  return next;
}


/**
 * يستخرج كل أسئلة المناقِش من رسائل الجلسة (كل استفهام في ردّ assistant).
 * يُستخدم لترحيل العدّاد للجلسات القديمة التي سُئلت قبل وجود التتبّع.
 */
/**
 * يستخرج نصّ السؤال من ردّ المناقِش: آخر جملة تنتهي بعلامة استفهام.
 * يعيد '' إن لم يكن في الردّ استفهام (ردّ تقييمي بلا سؤال جديد).
 */
export function extractQuestionFromReply(reply = '') {
  const text = String(reply || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[؟؟])\s*/u).filter((part) => /[؟؟]/.test(part));
  if (!sentences.length) return '';
  // آخر جملة استفهامية — نستخرج ما قبلها («السؤال التالي: …»).
  let question = sentences[sentences.length - 1].trim();
  const marker = question.match(/^(?:[^؟؟]{0,40}?(?:السؤال التالي|السؤال|سؤال)\s*[:：]\s*)/);
  if (marker) question = question.slice(marker[0].length).trim();
  return question;
}

export function extractQuestionsFromMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const questions = [];
  for (const message of list) {
    if (message?.role !== 'assistant') continue;
    const question = extractQuestionFromReply(message?.content);
    if (question) questions.push(question);
  }
  return questions;
}

/**
 * يستنتج عدّاد الأسئلة لكل جزء من عدد الأسئلة الكلي والخطة: نملأ حصّة كل جزء
 * بالترتيب حتى ينتهي العدد. تقدير معقول لجلسة لا تحمل `askedByPart`.
 */
export function inferAskedByPart(plan = [], questionCount = 0) {
  const list = Array.isArray(plan) ? plan : [];
  let remaining = Math.max(0, Number(questionCount) || 0);
  const counts = {};
  for (const part of list) {
    if (remaining <= 0) break;
    const take = Math.min(quotaForPart(part), remaining);
    counts[part.key] = take;
    remaining -= take;
  }
  return counts;
}

/**
 * يستنتج الأجزاء المغطّاة من عدد الأسئلة والخطة (حصّة كل جزء = quotaForPart).
 */
export function inferCoveredParts(plan = [], questionCount = 0) {
  const list = Array.isArray(plan) ? plan : [];
  const counts = inferAskedByPart(list, questionCount);
  return list.filter((part) => (counts[part.key] || 0) >= quotaForPart(part)).map((part) => part.key);
}

/**
 * يوفّق حالة المناقشة مع ما يُوجد فعلاً في الرسائل: إن كانت الجلسة قد سُئلت
 * قبل وجود التتبّع (العدّاد صفر) نرحّل العدّاد والأسئلة وأجزاء التغطية.
 *
 * يعيد الحالة الجديدة أو null إن لم تكن هناك فجوة تستوجب التحديث.
 */
export function reconcileDefenseState(state = {}, messages = []) {
  const raw = state && typeof state === 'object' ? state : {};
  const questions = extractQuestionsFromMessages(messages);
  const asked = Number(raw.asked) || 0;
  if (questions.length <= asked) return null;

  const stored = Array.isArray(raw.askedQuestions) ? raw.askedQuestions : [];
  const merged = [...stored];
  for (const question of questions) {
    if (!merged.includes(question)) merged.push(question);
  }

  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  const askedByPart = raw.askedByPart && typeof raw.askedByPart === 'object'
    ? raw.askedByPart
    : inferAskedByPart(plan, questions.length);
  const next = { ...raw, asked: questions.length, askedQuestions: merged, askedByPart };
  next.coveredParts = coveredPartsOf(next);

  return next;
}

/** بدء جلسة مناقشة مستقلة جديدة (mode='defense' + ملف بحث ثابت اختياري). */
export async function startDefense({ userId, title = 'محاكاة مناقشة', thesisFileId = null }) {
  const state = {
    asked: 0,
    thesisFileId: thesisFileId || null,
    coveredParts: [],
    askedQuestions: [],
    askedByPart: {},
    parts: [],
    pages: 0
  };
  const { rows } = await pool.query(
    `INSERT INTO conversations (user_id, title, mode, defense_state)
     VALUES ($1, $2, 'defense', $3::jsonb)
     RETURNING *`,
    [userId, String(title).slice(0, 200), JSON.stringify(state)]
  );

  return rows[0];
}

/** تثبيت ملف البحث للجلسة (يبقى ثابتاً طوال المناقشة) — يبنِ الخطة دفعة واحدة. */
export async function setDefenseThesisFile(conversationId, fileId) {
  const { rows } = await pool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  if (!rows.length) return false;
  const raw = rows[0].defense_state;
  const state = raw && typeof raw === 'object' ? raw : {};
  state.thesisFileId = fileId || null;
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(state)
  ]);
  return true;
}

/**
 * صورة المناقشة كما يحتاجها **موجّه المناقِش**: الخطة (لكل جزء حصّته وعدّاده
 * وهل غُطّي)، السقف الإجمالي، ما طُرح، الجزء المطلوب الآن، وأسئلته السابقة.
 *
 * كانت هذه الصورة **غير موجودة**: `defensePlanSection` في supervisor-prompt.js
 * يقرأ `c.defenseParts/defenseTotal/defenseAsked…` ولم يضبطها أي كود ⇒ قسم
 * «خطة المناقشة» لم يُحقن أبداً ⇒ المناقِش لا يعرف سقفاً ولا خطة فيسأل بلا
 * حساب (وهو سبب «٦ أسئلة ثم يكمل ٧ و ٨»). الآن تُحقن في buildSupervisorContext.
 */
export function defenseStateView(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  const asked = Number(raw.asked) || 0;
  const counts = askedCounts(raw);

  return {
    parts: plan.map((part) => ({
      ...part,
      quota: quotaForPart(part),
      asked: Math.max(0, Number(counts[part?.key]) || 0),
      covered: partCovered(raw, part)
    })),
    total: maxQuestionsFor(plan, asked),
    asked,
    covered: coveredPartsOf(raw),
    current: nextPendingPart(raw),
    askedQuestions: Array.isArray(raw.askedQuestions) ? raw.askedQuestions : [],
    pages: Math.max(0, Number(raw.pages) || 0)
  };
}

/**
 * صورة الجلسة: عدد الأسئلة + السقف + الأجزاء المغطاة + هل انتهت.
 *
 * total = سقف أسئلة الجلسة المحسوب من **حجم البحث وأجزائه** (حصة كل جزء من
 * متنه) ⇒ بحث من ١٠٠ صفحة يعرض «سؤال ٣ من ٣٠» لا «من ٦».
 */
export function defenseProgress(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const asked = Number(raw.asked) || 0;
  const coveredParts = Array.isArray(raw.coveredParts) ? raw.coveredParts : [];
  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  const counts = askedCounts(raw);
  // نُثري الأجزاء بحصّتها وعدّادها لعرضها في الواجهة (وأصل الحجم chars/weight يبقى).
  const parts = plan.map((part) => ({
    ...part,
    quota: quotaForPart(part),
    asked: Math.max(0, Number(counts[part?.key]) || 0),
    covered: partCovered(raw, part)
  }));
  const done = Boolean(raw.done);
  const total = maxQuestionsFor(plan, asked);
  const remaining = Math.max(0, total - asked);
  const scope = parts.length ? `موزّعة على ${parts.length} جزءاً من بحثك` : 'على أجزاء بحثك';

  return {
    asked,
    total,
    remaining,
    done,
    parts,
    currentPart: nextPendingPart(raw),
    // المرحلة: هل انتهت (التقييم النهائي) · هل المناقشة جارية (ملف مثبّت) · بانتظار رفع
    stageKey: done ? 'final' : raw.thesisFileId ? 'discussing' : 'upload',
    stageLabel: done ? 'انتهت المناقشة' : raw.thesisFileId ? 'المناقشة جارية' : 'بانتظار رفع البحث',
    stageHint: done
      ? 'انتهت المناقشة — اقرأ التقييم النهائي.'
      : raw.thesisFileId
        ? remaining > 0
          ? `المناقِش يناقشك جزءاً جزءاً — ${total} سؤالاً ${scope} (باقي ${remaining}).`
          : 'انتهت حصة الأسئلة — اطلب التقييم النهائي أو أنهِ المناقشة.'
        : 'ارفع ملف البحث (PDF أو Word) ليبدأ المناقِش قراءته ومناقشتك فيه.',
    stageQuestions: total,
    coveredParts,
    thesisFileId: raw.thesisFileId || null,
    pages: Math.max(0, Number(raw.pages) || 0),
    stages: []
  };
}

/**
 * يحفظ خطة الأجزاء (وتقدير الصفحات) في حالة المناقشة عند تثبيت ملف البحث.
 * تُستدعى مرة واحدة: الخطة تُبنى من نصّ البحث وتُخزَّن ليقرأها المناقِش في
 * كل ردّ (عبر defenseStateView) ولا يحتاج إعادة حساب.
 */
export async function setDefensePlan(conversationId, parts = [], pages = 0) {
  const { rows } = await pool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  if (!rows.length) return false;
  const raw = rows[0].defense_state;
  const state = raw && typeof raw === 'object' ? raw : {};
  state.parts = Array.isArray(parts) ? parts : [];
  state.pages = Math.max(0, Number(pages) || 0);
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(state)
  ]);
  return true;
}

/**
 * يسجّل سؤال المناقِش في الحالة: يزيد العدّاد، يحفظ نصّ السؤال والجزء.
 * يُستدعى بعد كل ردّ من المناقِش في /defense.
 */
export async function recordDefenseQuestion(conversationId, { question = '', partKey = '' } = {}) {
  const { rows } = await pool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  if (!rows.length) return null;
  const raw = rows[0].defense_state;
  const state = raw && typeof raw === 'object' ? raw : {};
  const next = applyQuestionToState(state, { question, partKey });
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(next)
  ]);
  return next;
}

/**
 * يوفّق حالة المناقشة مع الرسائل الفعلية ويكتبها إن تغيّرت.
 * يُستدعى عند فتح الجلسة: يرحّل عدّاد الجلسات القديمة (سُئلت قبل التتبّع).
 */
export async function syncDefenseState(conversationId, messages = []) {
  const { rows } = await pool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  if (!rows.length) return null;
  const raw = rows[0].defense_state;
  const state = raw && typeof raw === 'object' ? raw : {};
  const next = reconcileDefenseState(state, messages);
  if (!next) return state;
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(next)
  ]);
  return next;
}

/** كل جلسات المحاكاة للمستخدم. */
export async function listDefenses(userId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, title, defense_state, created_at, updated_at,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS messages_count
       FROM conversations c
      WHERE user_id = $1 AND mode = 'defense'
      ORDER BY updated_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 20, 1), 50)]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messagesCount: Number(row.messages_count || 0),
    progress: defenseProgress(row.defense_state)
  }));
}

/** أسئلة مقترحة للباحث يجهّز نفسه لها (نص ثابت يأتي من المشرف نفسه في البداية). */
export function defenseChecklist(progress) {
  return [
    'لخّص البحث في ثلاث جمل: المشكلة، المنهج، أهم نتيجة.',
    'لماذا اخترت هذا المنهج وليس غيره؟',
    'ما حدود بحثك وأهم قيوده؟',
    'كيف تبرر نتائجك علمياً؟',
    progress?.done ? 'لخّص نقاط القوة والضعف التي ظهرت في المحاكاة.' : 'استعد لسؤال ختامي عن الفجوة البحثية.'
  ];
}

/**
 * يقدّر عدد الصفحات من محتوى النص: كل 900 حرف ≈ صفحة واحدة، ويُكثر من التقدير
 * إذا لم تظهر علامات الصفحة (هذا يدل على أن الملف «طويل» حتى لو لم تُرقَم). */
export function estimatePages(text) {
  const raw = String(text || '');
  if (!raw.trim()) return 1;
  const chars = raw.length;
  const pageMarks = (raw.match(/صفحة|Pg|Page|ص\//) || []).length;
  const base = Math.max(1, Math.round(chars / 900));
  const pages = pageMarks > 0 ? base : Math.max(base, Math.ceil(chars / 700));
  return Math.min(9999, pages);
}

/**
 * سقف أسئلة الجلسة = مجموع حصص الأجزاء، ضمن حدّ أدنى/أقصى.
 *
 * كل جزء له حصّة تت ramps حسب كثافة محتواه وعلميته (كلما زاد المحتوى و
 * علميته، زاد عدد الأسئلة). لا يوجد سقف كلي ثابت: العدد يساوي أو يتجاوز
 * الخطة، ويُظهر «سؤال X من Y» وفق التجزئة الفعلية للملف (الصفحات والأقسام).
 */
export function maxQuestionsFor(parts = [], actualAsked = 0) {
  const list = Array.isArray(parts) ? parts : [];
  const asked = Math.max(0, Number(actualAsked) || 0);
  if (!list.length) return Math.max(5, asked);

  // السقف = مجموع حصص الأجزاء الحقيقية (كل جزء ≈ متنه/٢٨٠٠ سؤال + كثافة علمية)،
  // مقيداً بالحد الأدنى ٦ والأعلى ٣٦ — بحث ١٠٠ صفحة ⇒ ~٣٠ سؤالاً، لا ٦ ثابتة.
  const planned = list.reduce((sum, part) => sum + quotaForPart(part || {}), 0);
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, planned, asked));
}
