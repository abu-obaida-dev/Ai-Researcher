import { pool } from '../db/client.js';
import { DEGREE_LEVELS, PREFERRED_LANGUAGES, RESEARCH_STAGES, TOKEN_COSTS } from '../constants.js';
import { runSupervisor } from './ai.js';
import { isValidStepKeyForUser, stepTitle } from './journey.js';

/**
 * شات المشرف الذكي (1F): المحادثات ورسائلها في conversations/messages،
 * وخصم التوكنز من رصيد الباحث في نفس جملة SQL (شرط الرصيد الكافي)،
 * وتسجيل كل استهلاك في usage_logs. المزوّدون يتبدّلون تلقائياً في services/ai.js.
 */

const CHAT_COST = TOKEN_COSTS.find((item) => item.type === 'chat')?.tokens || 30;
const HISTORY_LIMIT = 20;
const PROMPT_LIMIT = 8000;
const TITLE_LIMIT = 120;

/** تاريخ محادثات الباحث (الأحدث أولاً) مع عدد الرسائل. */
export async function listConversations(userId, { limit = 12 } = {}) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.step_key, c.provider, c.created_at, c.updated_at,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS messages_count
       FROM conversations c
      WHERE c.user_id = $1
      ORDER BY c.updated_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 12, 1), 50)]
  );

  return rows;
}

/** محادثة واحدة بملكيتها + رسائلها بالترتيب الزمني. */
export async function getConversation(userId, conversationId) {
  const { rows } = await pool.query('SELECT * FROM conversations WHERE id = $2 AND user_id = $1', [
    userId,
    conversationId
  ]);
  if (!rows.length) return null;

  const { rows: messages } = await pool.query(
    'SELECT id, role, content, tokens_used, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId]
  );

  return { ...rows[0], messages };
}

/** إنشاء محادثة جديدة باسم مختصر من أول سؤال. */
export async function createConversation(userId, { title = '', stepKey = null } = {}) {
  const { rows } = await pool.query(
    'INSERT INTO conversations (user_id, title, step_key) VALUES ($1, $2, $3) RETURNING *',
    [userId, String(title || 'محادثة جديدة').trim().slice(0, TITLE_LIMIT), stepKey || null]
  );

  return rows[0];
}

/** إضافة رسالة إلى محادثة (تحدّث updated_at لظهورها في الأعلى). */
export async function appendMessage(conversationId, { role, content, tokensUsed = 0, model = null }) {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, role, content, tokens_used, model)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [conversationId, role, String(content || ''), Number(tokensUsed) || 0, model]
  );

  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

  return rows[0];
}

/** حذف محادثة كاملة برسائلها. */
export async function deleteConversation(userId, conversationId) {
  const { rowCount } = await pool.query('DELETE FROM conversations WHERE id = $2 AND user_id = $1', [
    userId,
    conversationId
  ]);

  return rowCount > 0;
}

/**
 * خصم التوكنز بشرط توفّر الرصيد: ذرّي بالكامل في جملة واحدة
 * (أمان ضد الطلبات المتزامنة) — يرجع false إذا كان الرصيد غير كافٍ.
 */
export async function deductTokens(userId, tokens) {
  const { rows } = await pool.query(
    `UPDATE users SET tokens_balance = tokens_balance - $2, tokens_used = tokens_used + $2
      WHERE id = $1 AND tokens_balance >= $2
      RETURNING tokens_balance`,
    [userId, tokens]
  );

  return rows.length > 0;
}

/** تسجيل الاستهلاك في usage_logs (نوع الإجراء + التوكنز + ملخص ما طُلب). */
async function logUsage(userId, { type, tokens, model, provider, summary = '' }) {
  try {
    await pool.query(
      'INSERT INTO usage_logs (user_id, type, tokens_used, summary) VALUES ($1, $2, $3, $4)',
      [
        userId,
        type,
        tokens,
        [summary, `model=${model || '-'}`, `provider=${provider || '-'}`].filter(Boolean).join(' · ').slice(0, 500)
      ]
    );
  } catch (error) {
    console.warn(`تعذّر تسجيل الاستهلاك: ${error.code || error.message}`);
  }
}

/** عنوان مختصر للمحادثة من أول سؤال (أول ٦٠ حرفاً). */
function titleFromPrompt(prompt) {
  const line = String(prompt).split('\n').find((item) => item.trim()) || 'محادثة جديدة';
  return line.trim().slice(0, 60);
}

/**
 * موجّه النظام: شخصية مشرف بحثي + سياق ملف الباحث + قواعد مهنية أساسية
 * (صدق علمي، عدم اختلاق مراجع، توثيق APA، لغة المستخدم).
 */
export function buildSystemPrompt({ profile = {}, stepTitle: currentStep = '' } = {}) {
  const degree = DEGREE_LEVELS.find((item) => item.value === profile.degree_level)?.label || 'غير محددة';
  const stage = RESEARCH_STAGES.find((item) => item.value === profile.research_stage)?.label || 'غير محددة';
  const language = PREFERRED_LANGUAGES.find((item) => item.value === profile.preferred_language)?.label || 'العربية';
  const style = profile.citation_style === 'mla9' ? 'MLA 9' : 'APA 7';

  return [
    'أنت مشرف بحثي أكاديمي داخل منصة Zena AI. مهمتك مساعدة الباحث العربي في بحث التخرج أو الرسالة أو أطروحة الدكتوراه.',
    '',
    'قواعد إلزامية:',
    '1) لا تختلق مراجع أو أرقاماً أو إحصاءات أو أسماء باحثين. إن لم تكن متأكداً فقل ذلك صراحة ووضّح ما يحتاج الباحث للتحقق منه.',
    '2) اقترح عناوين مراجع بصيغة قابلة للتحقق واذكر أنها «اقتراحات للبحث في قواعد البيانات» لا مراجع مؤكدة إن لم تكن مؤكدة.',
    '3) أجب بلغة المستخدم (العربية افتراضياً) وبأسلوب أكاديمي واضح، منظّم بعناوين ونقاط وقوائم عند الحاجة.',
    `4) استخدم أسلوب التوثيق ${style} في الصياغات والتوثيق، واذكر كيف يتحقق الباحث من كل ادعاء.`,
    '5) كن عملياً: خطوات تنفيذية، قوالب جاهزة (مقترح/منهج/تحليل)، وملاحظات على ما قد يخطئ فيه الباحث.',
    '6) عند المراجعة: افصل بين (أ) خطأ منهجي، (ب) ضعف في الأدلة، (ج) صياغة لغوية، واقترح صياغة بديلة جاهزة.',
    '7) لا تكرر السؤال ولا تحشو كلاماً — ابدأ مباشرة بالمفيد.',
    '',
    'سياق الباحث:',
    `- الدرجة: ${degree}`,
    `- التخصص: ${profile.research_field || 'غير محدد'}`,
    `- عنوان البحث: ${profile.research_title || 'لم يُحدَّد بعد'}`,
    `- المرحلة البحثية: ${stage}`,
    `- الجامعة/الكلية: ${[profile.university, profile.faculty].filter(Boolean).join(' — ') || 'غير محددة'}`,
    `- اللغة المفضلة: ${language}`,
    currentStep ? `- الخطوة الحالية في مسار البحث: ${currentStep}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * إرسال سؤال للمشرف الذكي:
 * يتحقق من الرصيد، يخصم التوكنز ذرّياً، يبني السياق (آخر الرسائل + موجّه النظام)،
 * ينفّذ الطلب عبر سلسلة المزوّدين، يحفظ الرسائل، ويسجّل الاستهلاك.
 * عند فشل كل المزوّدين تُعاد التوكنات للباحث (لم يُكتب له رد).
 * الأكواد: NO_TOKENS / NO_PROVIDER / PROVIDERS_FAILED / EMPTY_PROMPT / NOT_FOUND.
 */
export async function askSupervisor({ userId, prompt, conversationId = null, stepKey = null, profile = {} }) {
  const question = String(prompt || '').trim().slice(0, PROMPT_LIMIT);
  if (!question) {
    const error = new Error('اكتب سؤالك أولاً.');
    error.code = 'EMPTY_PROMPT';
    throw error;
  }

  if (stepKey && !(await isValidStepKeyForUser(userId, stepKey))) {
    const error = new Error('هذه الخطوة غير موجودة في مسار بحثك.');
    error.code = 'BAD_STEP';
    throw error;
  }

  if (!(await deductTokens(userId, CHAT_COST))) {
    const error = new Error('رصيد التوكنز غير كافٍ — اشترِ باقة أو انتظر التجديد الشهري.');
    error.code = 'NO_TOKENS';
    throw error;
  }

  let conversation = conversationId ? await getConversation(userId, conversationId) : null;
  if (conversationId && !conversation) {
    const error = new Error('المحادثة غير موجودة.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (!conversation) {
    // المحادثة الجديدة لا تحمل رسائل بعد — نُهيّئ المصفوفة حتى يمرّ بناء السياق بأمان
    const created = await createConversation(userId, { title: titleFromPrompt(question), stepKey });
    conversation = { ...created, messages: [] };
  }

  const history = conversation.messages
    .slice(-HISTORY_LIMIT)
    .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }));

  const activeStep = stepKey || conversation.step_key;
  const currentStep = activeStep ? await stepTitle(activeStep) : '';
  const system = buildSystemPrompt({ profile, stepTitle: currentStep });

  let reply;
  try {
    reply = await runSupervisor({
      userId,
      system,
      messages: [...history, { role: 'user', content: question }]
    });
  } catch (error) {
    await refundTokens(userId, CHAT_COST);
    await logUsage(userId, { type: 'chat_failed', tokens: 0, model: null, provider: null, summary: error.message });
    throw error;
  }

  await appendMessage(conversation.id, { role: 'user', content: question, tokensUsed: CHAT_COST });
  await appendMessage(conversation.id, { role: 'assistant', content: reply.text, model: reply.model });
  await pool.query('UPDATE conversations SET provider = $2 WHERE id = $1', [conversation.id, reply.provider]);
  await logUsage(userId, {
    type: 'chat',
    tokens: CHAT_COST,
    model: reply.model,
    provider: reply.provider,
    summary: titleFromPrompt(question)
  });

  return {
    conversationId: conversation.id,
    title: conversation.title,
    answer: reply.text,
    provider: reply.provider,
    model: reply.model,
    tokensCharged: CHAT_COST
  };
}

/** إعادة التوكنات للباحث عند فشل المزوّدين (يبقى الاستهلاك صفراً في السجل). */
async function refundTokens(userId, tokens) {
  try {
    await pool.query(
      'UPDATE users SET tokens_balance = tokens_balance + $2, tokens_used = GREATEST(tokens_used - $2, 0) WHERE id = $1',
      [userId, tokens]
    );
  } catch (error) {
    console.warn(`تعذّرت إعادة التوكنات للباحث ${userId}: ${error.code || error.message}`);
  }
}

/** تكلفة رسالة الشات (تُعرض في الواجهة قبل الإرسال). */
export function chatCost() {
  return CHAT_COST;
}


