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

/** حصّة الأسئلة لكل جزء حسب كثافة محتواه وعلمهيته. */
const QUESTIONS_PER_PART = {
  intro: 1,
  problem: 2,
  method: 3,
  results: 3,
  discussion: 2,
  references: 1
};

/** الحد الأدنى لعدد الأسئلة في الجلسة كلها (حتى لو كان الملف صغيراً). */
const MIN_QUESTIONS = 6;

/** لا يوجد سقف أعلى كلي ثابت: العدد يُحدَّد من خطة الأقسام (لا يُغلِق عند 9 أو 15). */
const MAX_QUESTIONS = Infinity;

/** ترتيب العرض: الترتيب المنطقي للبحث لا ترتيب ظهوره في الملف. */
const PART_ORDER = ['intro', 'problem', 'method', 'results', 'discussion', 'references'];

function isChapterLine(line) {
  const l = String(line || '').trim();
  return l.startsWith('الفصل ') || l.startsWith('الباب ') || l.startsWith('المبحث ') || l.startsWith('الجزء ');
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
 * يقسّم نص البحث إلى أجزاء منطقية (مقدمة، مشكلة، منهج، نتائج، مناقشة، مراجع)
 * استناداً إلى عناوين الفصول/المقاطع، مع اعتبار على الكلمات الدالة في المتن إذا لم توجد عناوين.
 * يعيد الأجزاء حسب الترتيب المنطقي PART_ORDER، كل جزء له key و label.
 */
export function planParts(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const lines = raw.split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (isChapterLine(line)) {
      if (current) blocks.push(current);
      current = { title: line.trim(), body: '' };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current) blocks.push(current);

  const seen = new Set();
  const parts = [];
  for (const b of blocks) {
    const key = keyOf(b.title, b.body);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const def = SECTION_PATTERNS.find((p) => p.key === key);
    parts.push({ key, label: b.title || def?.label || key, text: b.body });
  }

  if (parts.length) {
    return PART_ORDER.filter((k) => parts.some((p) => p.key === k)).map((k) => parts.find((p) => p.key === k));
  }

  const bodyKeys = PART_ORDER.filter((k) => SECTION_PATTERNS.find((p) => p.key === k)?.re.test(raw));
  return bodyKeys.map((k) => ({ key: k, label: SECTION_PATTERNS.find((p) => p.key === k)?.label || k }));
}

/**

/** يقدّر كثافة محتوى الجزء: يزيد «وزن» السؤال إذا وُجدت في العنوان أو النص
 *  كلمات تشير إلى منهج، نتائج، إحصاء، نموذج، فرضية، أو عينة. */
function partWeight(label, text) {
  const t = String(label || '') + ' ' + String(text || '');
  let w = 0;
  const words = ['منهج','طرائق','إجراءات','أسلوب البحث','عينة','مجتمع','إحصاء','تحليل','نتائج','جداول','معاملات','بيانات','فرضية','فرضيات','تساؤل','غرض','نتيجة','أهمية البحث','نموذج'];
  for (const w_ of words) {
    if (new RegExp(w_, 'i').test(t)) w++;
  }
  return w;
}

/**
 * يقدّر عدد الصفحات من محتوى النص: كل 900 حرف ≈ صفحة واحدة، ويُكثر من التقدير
 * إذا لم تظهر علامات الصفحة (هذا يدل على أن الملف «طويل» حتى لو لم تُرقَم). */
export function nextPendingPart(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  if (!plan.length) return null;
  const covered = new Set(Array.isArray(raw.coveredParts) ? raw.coveredParts : []);
  return plan.find((part) => !covered.has(part.key)) || null;
}

/**
 * يسجّل سؤالاً جديداً في حالة المناقشة: يزيد العدّاد، يحفظ نصّ السؤال،
 * وعلام الجزء الذي غطّاه. يعيد الحالة الجديدة (لا يكتب في القاعدة).
 */
export function applyQuestionToState(state = {}, { question = '', partKey = '' } = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const asked = Number(raw.asked) || 0;
  const askedQuestions = Array.isArray(raw.askedQuestions) ? [...raw.askedQuestions] : [];
  const coveredParts = Array.isArray(raw.coveredParts) ? [...raw.coveredParts] : [];

  const text = String(question || '').trim();
  if (text) askedQuestions.push(text.slice(0, 400));
  if (partKey && !coveredParts.includes(partKey)) coveredParts.push(partKey);

  return { ...raw, asked: asked + 1, askedQuestions, coveredParts };
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
 * يستنتج الأجزاء المغطّاة من عدد الأسئلة والخطة: نملأ كل جزء حصّته بالترتيب
 * حتى ينتهي العدد. تقدير معقول لجلسات قديمة لا تحمل `coveredParts`.
 */
export function inferCoveredParts(plan = [], questionCount = 0) {
  const list = Array.isArray(plan) ? plan : [];
  let remaining = Math.max(0, Number(questionCount) || 0);
  const covered = [];
  for (const part of list) {
    if (remaining <= 0) break;
    covered.push(part.key);
    remaining -= QUESTIONS_PER_PART[part.key] || 1;
  }
  return covered;
}

/**
 * يوفّق حالة المناقشة مع ما يُوجد فعلاً في الرسائل: إن كانت الجلسة قد سُئلت
 * قبل وجود التتبّع (العدّاد صفر) نرحّل العدّاد والأسئلة والأجزاء المغطّاة.
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
  const covered = Array.isArray(raw.coveredParts) && raw.coveredParts.length
    ? raw.coveredParts
    : inferCoveredParts(plan, questions.length);

  return { ...raw, asked: questions.length, askedQuestions: merged, coveredParts: covered };
}

/** بدء جلسة مناقشة مستقلة جديدة (mode='defense' + ملف بحث ثابت اختياري). */
export async function startDefense({ userId, title = 'محاكاة مناقشة', thesisFileId = null }) {
  const state = {
    asked: 0,
    thesisFileId: thesisFileId || null,
    coveredParts: [],
    askedQuestions: [],
    parts: []
  };
  const { rows } = await pool.query(
    `INSERT INTO conversations (user_id, title, mode, defense_state)
     VALUES ($1, $2, 'defense', $3::jsonb)
     RETURNING *`,
    [userId, String(title).slice(0, 200), JSON.stringify(state)]
  );

  return rows[0];
}

/** تثبيت/تبديل ملف البحث للجلسة (يبقى ثابتاً طوال المناقشة). */
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
 * صورة الجلسة: عدد الأسئلة + السقف + الأجزاء المغطاة + هل انتهت.
 *
 * total = سقف أسئلة الجلسة المحسوب من خطة الأجزاء (وليس null كما كان) ⇒
 * الواجهة تعرض «سؤال ٣ من ٨» بدل «٠ سؤالا».
 */
export function defenseProgress(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const asked = Number(raw.asked) || 0;
  const coveredParts = Array.isArray(raw.coveredParts) ? raw.coveredParts : [];
  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  const done = Boolean(raw.done);
  // لا تعرض عدداً لانهائياً: إذا لم توجد خطة، فإن العدد الإجمالي غير معروف بعد.
  const total = Number.isFinite(maxQuestionsFor(parts, asked)) ? maxQuestionsFor(parts, asked) : 0;
  const remaining = Math.max(0, total - asked);

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
          ? `المناقِش يناقشك جزءاً جزءاً — سؤال أو سؤالان في كل جزء (باقي ${remaining} من ${total}).`
          : 'انتهت حصة الأسئلة — اطلب التقييم النهائي أو أنهِ المناقشة.'
        : 'ارفع ملف البحث (PDF أو Word) ليبدأ المناقِش قراءته ومناقشتك فيه.',
    stageQuestions: total,
    coveredParts,
    thesisFileId: raw.thesisFileId || null,
    stages: []
  };
}

/**
 * يحفظ خطة الأجزاء في حالة المناقشة (عند تثبيت ملف البحث).
 * تُستدعى مرة واحدة: عند تثبيت الملف ⇒ نبني الخطة من نصّه ونحدّد السقف.
 */
export async function setDefensePlan(conversationId, parts = []) {
  const { rows } = await pool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  if (!rows.length) return false;
  const raw = rows[0].defense_state;
  const state = raw && typeof raw === 'object' ? raw : {};
  state.parts = Array.isArray(parts) ? parts : [];
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
function estimatePages(text) {
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

  // ميزانية الأسئلة تتناسب مع عدد الأجزاء في الخطة (لا سقف كلي ثابت).
  const planned = Math.max(MIN_QUESTIONS, list.length);
  // لا نصغر إلى 15/14: إذا كان الملف خائماً أو غنياً سؤالاً أكثر، نُعطيه.
  return Math.max(planned, asked);
}
