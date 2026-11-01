import { pool } from '../db/client.js';

/** Defense-session planning, state tracking, scoring, and progress helpers. */

/** Internal marker removed from final reports before they are stored or displayed. */
const DEFENSE_FINAL_RE = /\[\[\s*defense-final\s*\]\]/i;
const DEFENSE_FINAL_GLOBAL_RE = /\s*\[\[\s*defense-final\s*\]\]/gi;

export function extractDefenseFinalTag(text) {
  const raw = String(text || '');
  return {
    text: raw.replace(DEFENSE_FINAL_GLOBAL_RE, '').replace(/\s+$/, ''),
    ended: DEFENSE_FINAL_RE.test(raw)
  };
}

/* Defense plan: section detection, question limits, and coverage tracking. */

/** Common thesis sections, ordered from specific headings to broader matches. */
const SECTION_PATTERNS = [
  { key: 'intro', label: 'المقدمة والخلفية والمشكلة', re: /مقدم|تمهيد|المشكلة|الفرضية|الفكرة العامة/i },
  { key: 'problem', label: 'المشكلة البحثية والأهداف والفرضيات', re: /أهد[اف]|مشكلة البحث|فرضي|تساؤل|قائمة الفرضيات/i },
  { key: 'method', label: 'المنهجية والإجراءات والتحليل الإحصائي', re: /منهج|طرائق|إجراءات|أسلوب البحث|مجتمع|عيّن|الإحصاء|النموذج|عينة/i },
  { key: 'results', label: 'النتائج والتحليل الإحصائي وجدول البيانات', re: /نتائج|جداول|تحليل البيانات|الإحصاء|المعاملات|الجدول الرئيسي/i },
  { key: 'discussion', label: 'المناقشة والتوصيات والخلاصة', re: /مناقش[ةه]|توصيات|الخلاص|النتيجة الرئيسية|أهمية البحث/i },
  { key: 'references', label: 'المراجع وقائمة المصادر', re: /مراجع|قائمة المصادر/i }
];

/** Minimum questions per session, including short documents. */
const MIN_QUESTIONS = 6;

/** Hard limit to prevent unbounded sessions. */
const MAX_QUESTIONS = 36;

/** Approximate characters per question, calibrated to about three pages. */
const CHARS_PER_QUESTION = 2800;

/** Maximum question quota for a single section. */
const MAX_QUOTA_PER_PART = 5;

/** Maximum section count for documents with repetitive headings. */
const MAX_PLAN_PARTS = 60;

/** Fallback chunk size when extracted text has no headings. */
const FALLBACK_CHUNK_CHARS = CHARS_PER_QUESTION * 2;

/** Common Arabic chapter-heading prefixes. */
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

/** Matches numbered headings but excludes hyphenated list items. */
const NUMBERED_HEADING_RE = /^(?:[\(\[]?\s*[\d٠-٩]{1,3}\s*[\)\].:]\s*\S|[\d٠-٩]{1,3}(?:\.[\d٠-٩]{1,3})+\s+\S)/u;

/** Detects table-of-contents entries. */
function looksLikeToc(line) {
  const l = String(line || '');
  return /\.{3,}|…/.test(l) || /\s[\d٠-٩]{1,4}\s*$/u.test(l.trim());
}

function isChapterLine(line) {
  const l = String(line || '').trim();
  return CHAPTER_WORDS.some((word) => l.startsWith(word));
}

/** Rejects table-of-contents entries, data rows, and long prose from heading matches. */
function isHeadingLine(line) {
  const l = String(line || '').trim();
  if (!l || l.length > 120) return false;
  if (isChapterLine(l)) return true; // Chapter headings take precedence over trailing-number checks.
  if (looksLikeToc(l)) return false; // Exclude table-of-contents entries.
  if (!NUMBERED_HEADING_RE.test(l)) return false;

  const body = l.replace(NUMBERED_HEADING_RE, '').trim();
  if (body.length < 3) return false;
  const separators = (l.match(/[,،|؛]/gu) || []).length;
  if (separators >= 3) return false; // Exclude data rows.
  if (/^[\d٠-٩\s.\-–↑%]+$/u.test(body)) return false; // Exclude numeric-only headings.
  return true;
}

/** Adds a suffix when the same logical section appears more than once. */
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

/** Splits extracted thesis text into ordered sections and ignores contents and list entries. */
export function planParts(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  // Fall back to size-based chunks when no usable headings are found.
  return chunkBySize(raw);
}
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

/** Builds the session plan and estimates the thesis page count. */
export function buildDefensePlan(text) {
  const raw = String(text || '');
  const parts = planParts(raw);
  return { parts, pages: raw.trim() ? estimatePages(raw) : 0 };
}


/** Raises section weight when its title or text signals methodological density. */
function partWeight(label, text) {
  const t = String(label || '') + ' ' + String(text || '');
  let w = 0;
  const words = ['منهج','طرائق','إجراءات','أسلوب البحث','عينة','مجتمع','إحصاء','تحليل','نتائج','جداول','معاملات','بيانات','فرضية','فرضيات','تساؤل','غرض','نتيجة','أهمية البحث','نموذج','مناقش','توصيات'];
  for (const w_ of words) {
    if (new RegExp(w_, 'i').test(t)) w++;
  }
  return w;
}

/** Derives each section's question quota from its size and academic density. */
export function quotaForPart(part = {}) {
  if (!part || typeof part !== 'object') return 1;
  const chars = Math.max(0, Number(part.chars) || 0);
  const weight = Math.max(0, Number(part.weight) || 0);
  const bySize = Math.ceil(chars / CHARS_PER_QUESTION);
  const byWeight = weight >= 4 ? 1 : 0;
  return Math.max(1, Math.min(MAX_QUOTA_PER_PART, bySize + byWeight));
}

/** Returns per-section question counts. */
function askedCounts(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const byPart = raw.askedByPart && typeof raw.askedByPart === 'object' ? raw.askedByPart : {};
  const counts = {};
  for (const [key, value] of Object.entries(byPart)) counts[key] = Math.max(0, Number(value) || 0);
  return counts;
}

/** Supports current counts and legacy coveredParts state. */
export function partCovered(state = {}, part = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const key = String(part?.key || '');
  if (!key) return false;

  if (!raw.askedByPart || typeof raw.askedByPart !== 'object') {
    return (Array.isArray(raw.coveredParts) ? raw.coveredParts : []).includes(key);
  }
  return (askedCounts(raw)[key] || 0) >= quotaForPart(part);
}

/** Returns section keys whose quotas have been met. */
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

/** Returns the first section with remaining questions. */
export function nextPendingPart(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  if (!plan.length) return null;
  return plan.find((part) => !partCovered(raw, part)) || null;
}

/** Records a question, its section, and any grade for the previous answer. */
export function applyQuestionToState(state = {}, {
  question = '',
  partKey = '',
  isCorrect,
  grade = null,
  gradeIssue = null
} = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const asked = Number(raw.asked) || 0;
  let correctCount = Number(raw.correctCount) || 0;
  let wrongCount = Number(raw.wrongCount) || 0;
  let partialCount = Number(raw.partialCount) || 0;
  const answerGrades = Array.isArray(raw.answerGrades) ? [...raw.answerGrades] : [];
  const askedQuestions = Array.isArray(raw.askedQuestions) ? [...raw.askedQuestions] : [];
  const plan = Array.isArray(raw.parts) ? raw.parts : [];

  const text = String(question || '').trim();
  if (text) askedQuestions.push(text.slice(0, 400));

  const askedByPart = askedCounts(raw);
  // Migrate legacy coverage markers to their current section quotas.
  if (!raw.askedByPart && Array.isArray(raw.coveredParts)) {
    for (const key of raw.coveredParts) {
      const part = plan.find((item) => item?.key === key);
      askedByPart[key] = Math.max(askedByPart[key] || 0, quotaForPart(part || {}));
    }
  }
  if (text && partKey) askedByPart[partKey] = Math.max(0, Number(askedByPart[partKey]) || 0) + 1;

  // Update correct/wrong counters based on isCorrect
  if (isCorrect === true) {
    correctCount += 1;
  } else if (isCorrect === false) {
    wrongCount += 1;
  }
  if (grade && ['correct', 'partial', 'incorrect'].includes(grade.verdict)) {
    if (grade.verdict === 'correct') correctCount += 1;
    if (grade.verdict === 'partial') partialCount += 1;
    if (grade.verdict === 'incorrect') wrongCount += 1;
    answerGrades.push({
      question: Math.max(1, asked),
      verdict: grade.verdict,
      feedback: String(grade.feedback || '').slice(0, 600)
    });
  }

  const next = {
    ...raw,
    asked: asked + (text ? 1 : 0),
    correctCount,
    partialCount,
    wrongCount,
    answerGrades,
    gradeIssue: gradeIssue || raw.gradeIssue || null,
    askedQuestions,
    askedByPart
  };
  next.coveredParts = coveredPartsOf(next);
  return next;
}


/** Extracts the final question from a defense reply, if present. */
export function extractQuestionFromReply(reply = '') {
  const text = String(reply || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[؟?])\s*/u).filter((part) => /[؟?]/u.test(part));
  if (!sentences.length) return '';
  // Remove an optional question label from the extracted sentence.
  let question = sentences[sentences.length - 1].trim();
  const marker = question.match(/^(?:[^؟?]{0,40}?(?:السؤال التالي|السؤال|سؤال)\s*[:：]\s*)/u);
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

/** Reads the final-line grading marker from a model reply. */
export function extractAnswerCorrectness(reply = '') {
  const text = String(reply || '').trim();
  if (!text) return null;
  const marker = text.match(
    /(?:^|\n)[ \t]*\[\[\s*(correct|incorrect)\s*\]\][ \t]*(?:\r?\n|$)|\[\[\s*(correct|incorrect)\s*\]\][ \t]*$/i
  );
  return (marker?.[1] || marker?.[2] || '').toLowerCase() || null;
}

/** Parses a structured model grade and rejects incomplete or unknown results. */
export function parseDefenseGrade(raw = '') {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  const rawVerdict = String(parsed?.verdict || '').trim().toLowerCase();
  const verdict = ({
    correct: 'correct',
    صحيح: 'correct',
    صحيحة: 'correct',
    partial: 'partial',
    'partially correct': 'partial',
    partially_correct: 'partial',
    جزئي: 'partial',
    جزئية: 'partial',
    'صحيح جزئياً': 'partial',
    'صحيحة جزئياً': 'partial',
    incorrect: 'incorrect',
    خطأ: 'incorrect',
    خاطئ: 'incorrect',
    خاطئة: 'incorrect'
  })[rawVerdict];
  const feedback = String(parsed?.feedback || parsed?.reason || parsed?.explanation || '').trim().slice(0, 600);
  if (!verdict || !feedback) return null;
  return { verdict, feedback };
}

/** Removes the internal grading marker before storing or displaying a reply. */
export function stripAnswerCorrectnessTag(reply = '') {
  return String(reply || '').replace(/\s*\[\[\s*(?:correct|incorrect)\s*\]\]\s*/gi, '\n').trim();
}

/** Converts the grading marker to a boolean state. */
function inferAnswerState(reply = '') {
  const correctness = extractAnswerCorrectness(reply);
  if (correctness === 'correct') return true;
  if (correctness === 'incorrect') return false;
  return null;
}

/** Extracts the next question and grade from a single reply. */
function extractQuestionAndCorrectness(reply = '') {
  const question = extractQuestionFromReply(reply);
  const isCorrect = inferAnswerState(reply);
  return { question, isCorrect };
}

/** Reconstructs section counts for legacy sessions without askedByPart. */
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

/** Reconstructs covered sections from the total question count. */
export function inferCoveredParts(plan = [], questionCount = 0) {
  const list = Array.isArray(plan) ? plan : [];
  const counts = inferAskedByPart(list, questionCount);
  return list.filter((part) => (counts[part.key] || 0) >= quotaForPart(part)).map((part) => part.key);
}

/** Reconciles legacy session state with questions found in stored messages. */
export function reconcileDefenseState(state = {}, messages = []) {
  const raw = state && typeof state === 'object' ? state : {};
  const list = Array.isArray(messages) ? messages : [];
  const lastAssistant = raw.done
    ? list.findLastIndex((message) => message?.role === 'assistant')
    : -1;
  const questionMessages = lastAssistant === -1
    ? list
    : list.filter((message, index) => index !== lastAssistant);
  const questions = extractQuestionsFromMessages(questionMessages);
  const asked = Number(raw.asked) || 0;
  if (raw.done && asked !== questions.length) {
    const plan = Array.isArray(raw.parts) ? raw.parts : [];
    const askedByPart = inferAskedByPart(plan, questions.length);
    const next = {
      ...raw,
      asked: questions.length,
      askedQuestions: questions,
      askedByPart
    };
    next.coveredParts = coveredPartsOf(next);
    return next;
  }
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

/** Creates an independent defense session. */
export async function startDefense({ userId, title = 'محاكاة مناقشة', thesisFileId = null }) {
  const state = {
    asked: 0,
    correctCount: 0,
    partialCount: 0,
    wrongCount: 0,
    gradeIssue: null,
    answerGrades: [],
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

/** Attaches the thesis and builds the plan once. */
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

/** Shapes session state for the defense prompt and UI. */
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

/** Builds progress, including question quotas and answer statistics. */
export function defenseProgress(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const asked = Number(raw.asked) || 0;
  const correctCount = Number(raw.correctCount) || 0;
  const partialCount = Number(raw.partialCount) || 0;
  const wrongCount = Number(raw.wrongCount) || 0;
  const gradedCount = correctCount + partialCount + wrongCount;
  const ungradedCount = Math.max(0, asked - gradedCount);
  const coveredParts = Array.isArray(raw.coveredParts) ? raw.coveredParts : [];
  const plan = Array.isArray(raw.parts) ? raw.parts : [];
  const counts = askedCounts(raw);
  // Add derived counts for the UI without changing stored section weights.
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
    correctCount,
    partialCount,
    wrongCount,
    gradedCount,
    ungradedCount,
    gradeIssue: raw.gradeIssue || null,
    successRate: gradedCount ? Math.round((correctCount / gradedCount) * 100) : null,
    total,
    remaining,
    done,
    parts,
    currentPart: nextPendingPart(raw),
    // Session stage: upload, active defense, or final report.
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

/** Persists the plan generated from the attached thesis. */
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

/** Records the next question and the previous answer's grade. */
export async function recordDefenseQuestion(conversationId, {
  question = '',
  partKey = '',
  isCorrect,
  grade = null,
  gradeIssue = null
} = {}) {
  const { rows } = await pool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  if (!rows.length) return null;
  const raw = rows[0].defense_state;
  const state = raw && typeof raw === 'object' ? raw : {};
  const next = applyQuestionToState(state, { question, partKey, isCorrect, grade, gradeIssue });
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(next)
  ]);
  return next;
}

/** Marks the session complete without changing its counters. */
export async function finishDefense(conversationId) {
  const { rows } = await pool.query('SELECT defense_state FROM conversations WHERE id = $1', [conversationId]);
  if (!rows.length) return null;
  const raw = rows[0].defense_state;
  const state = raw && typeof raw === 'object' ? raw : {};
  const next = { ...state, done: true };
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [conversationId, JSON.stringify(next)]);
  return next;
}

/** Reconciles and persists legacy state when a session is opened. */
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

/** Lists the user's defense sessions. */
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

/** Returns the static defense preparation checklist. */
export function defenseChecklist(progress) {
  return [
    'لخّص البحث في ثلاث جمل: المشكلة، المنهج، أهم نتيجة.',
    'لماذا اخترت هذا المنهج وليس غيره؟',
    'ما حدود بحثك وأهم قيوده؟',
    'كيف تبرر نتائجك علمياً؟',
    progress?.done ? 'لخّص نقاط القوة والضعف التي ظهرت في المحاكاة.' : 'استعد لسؤال ختامي عن الفجوة البحثية.'
  ];
}

/** Estimates page count from extracted text and page markers. */
export function estimatePages(text) {
  const raw = String(text || '');
  if (!raw.trim()) return 1;
  const chars = raw.length;
  const pageMarks = (raw.match(/صفحة|Pg|Page|ص\//) || []).length;
  const base = Math.max(1, Math.round(chars / 900));
  const pages = pageMarks > 0 ? base : Math.max(base, Math.ceil(chars / 700));
  return Math.min(9999, pages);
}

/** The session limit is the sum of section quotas, clamped to configured bounds. */
export function maxQuestionsFor(parts = [], actualAsked = 0) {
  const list = Array.isArray(parts) ? parts : [];
  const asked = Math.max(0, Number(actualAsked) || 0);
  if (!list.length) return Math.max(5, asked);

  // Derive the limit from actual section sizes and weights, then clamp it.
  const planned = list.reduce((sum, part) => sum + quotaForPart(part || {}), 0);
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, planned, asked));
}
