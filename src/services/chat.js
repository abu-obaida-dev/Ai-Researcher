import { pool } from '../db/client.js';
import { CHAT_REPLY_CAPS, TOKEN_COSTS } from '../constants.js';
import { runSupervisor } from './ai.js';
import { isValidStepKeyForUser } from './journey.js';
import { buildSupervisorContext } from './supervisor-context.js';
import { buildSystemPrompt } from './supervisor-prompt.js';
import { addStrike, summarizeConversation } from './supervisor-memory.js';
import { balanceOf, chargeUsage, deductCredits, estimateReservation, logUsage, normalizeUsage, refundCredits } from './tokens.js';

/**
 * شات المشرف الذكي (1F): المحادثات ورسائلها في conversations/messages.
 *
 * التسعير صار متغيّراً بحسب الاستهلاك الفعلي (services/tokens.js):
 *   حجز قبل الإرسال ← نداء ← تسوية وردّ الفرق، وردّ كامل عند الفشل.
 *
 * ما يحسبه الكود لا البرومبت (services/supervisor-context.js):
 * أول رسالة في تاريخه، حالة خطواته، ملخّص ذاكرته، مهمته القادمة، عدد أيام
 * انقطاعه، عدّاد التنبيهات، وملفاته المرفقة.
 */

const CHAT_COST = TOKEN_COSTS.find((item) => item.type === 'chat')?.tokens || 30;
const HISTORY_LIMIT = 20;
const PROMPT_LIMIT = 8000;
const TITLE_LIMIT = 120;

/** وسم التنبيه الداخلي: المشرفة تكتبه، والكود يحذفه قبل العرض والعدّ. */
const STRIKE_TAG = /\[\[\s*strike\s*\]\]|\[\s*strike\s*\]/gi;

/**
 * ينظّف ردّ المشرفة: يحذف وسم التنبيه ويخبرك هل وُجد.
 * الوسم يوضع في آخر الرد فقط، ونتأكد أنه لم يُصِب ردودنا المخزّنة سابقاً.
 */
function stripStrikeTag(text) {
  const raw = String(text || '');
  const hadStrike = STRIKE_TAG.test(raw);
  STRIKE_TAG.lastIndex = 0;

  return { text: raw.replace(STRIKE_TAG, '').replace(/\s+$/, ''), hadStrike };
}

/** لا يُسمح للباحث بأن يحقن وسماً داخلياً فيردّ المشرفة تكرّره وتُحتسب له ضربة. */
function sanitizeUserText(text) {
  return String(text || '').replace(STRIKE_TAG, '').replace(/\s+$/, '');
}

/** تاريخ محادثات الباحث (الأحدث أولاً) مع عدد الرسائل. */
export async function listConversations(userId, { limit = 12 } = {}) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.step_key, c.mode, c.provider, c.created_at, c.updated_at,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS messages_count
       FROM conversations c
      WHERE c.user_id = $1
      ORDER BY c.updated_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 12, 1), 50)]
  );

  return rows;
}

/** محادثة واحدة بملكيتها + رسائلها بالترتيب الزمني + حالة المناقشة. */
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

  return { ...rows[0], messages, defense_state: rows[0].defense_state || {} };
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

/** عنوان مختصر للمحادثة من أول سؤال (أول ٦٠ حرفاً). */
function titleFromPrompt(prompt) {
  const line = String(prompt).split('\n').find((item) => item.trim()) || 'محادثة جديدة';
  return line.trim().slice(0, 60);
}

/** آخر محادثة سابقة لها رسائل، لاستخدامها في تلخيص الذاكرة عند بدء جلسة جديدة. */
async function lastRichConversation(userId, excludeId = null) {
  const { rows } = await pool.query(
    `SELECT c.id FROM conversations c
      WHERE c.user_id = $1 AND c.id IS DISTINCT FROM $2
        AND (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) >= 4
      ORDER BY c.updated_at DESC LIMIT 1`,
    [userId, excludeId || null]
  );

  return rows[0]?.id || null;
}

/** حالة المناقشة: عدّاد الأسئلة والمحاور (تُحفظ في conversations.defense_state). */
function readDefenseState(conversation) {
  const state = conversation?.defense_state;
  if (!state || typeof state !== 'object') return { asked: 0, startedAt: null };

  return {
    asked: Number(state.asked) || 0,
    startedAt: state.startedAt || null
  };
}

async function writeDefenseState(conversationId, state) {
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(state)
  ]);
}

/**
 * إرسال سؤال للمشرف الذكي.
 *
 * الترتيب مقصود وكل خطوة المالية ذرّية:
 *   1) تحقق من المدخلات والمحفظة (لا خصم بعد).
 *   2) بناء السياق من قاعدة البيانات ثم موجّه النظام.
 *   3) حجز الرصيد بسقف تقديري — إن لم يكن كافياً نرفض قبل الإرسال.
 *   4) النداء؛ عند الفشل: ردّ الحجز كاملاً بلا تسجيل استهلاك.
 *   5) التسوية: الفارق بين الحجز والاستهلاك الفعلي يُردّ فوراً.
 *   6) حذف وسم التنبيه قبل الحفظ، وزيادة العدّاد إن وُجد.
 *   7) عند بدء جلسة جديدة: تلخيص الجلسة السابقة لتحديث الذاكرة.
 *
 * الأكواد: NO_TOKENS / NO_PROVIDER / PROVIDERS_FAILED / EMPTY_PROMPT / NOT_FOUND / BAD_STEP.
 */
export async function askSupervisor({ userId, prompt, conversationId = null, stepKey = null, profile = {}, fileIds = [] }) {
  const question = sanitizeUserText(String(prompt || '').trim().slice(0, PROMPT_LIMIT));
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

  let conversation = conversationId ? await getConversation(userId, conversationId) : null;
  if (conversationId && !conversation) {
    const error = new Error('المحادثة غير موجودة.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  // محادثة جديدة: ننشئها أولاً لنعرف وضعها، ونتذكّر السابقة لتلخيص ذاكرتها
  const previousId = conversation ? null : await lastRichConversation(userId);
  if (!conversation) {
    const created = await createConversation(userId, { title: titleFromPrompt(question), stepKey });
    conversation = { ...created, messages: [], mode: 'normal', defense_state: {} };
  }

  const context = await buildSupervisorContext({ userId, profile, conversation, fileIds });
  const system = buildSystemPrompt(context);

  const history = conversation.messages
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content
    }));

  const messages = [...history, { role: 'user', content: question }];
  const replyCap = context.replyCap || CHAT_REPLY_CAPS.normal;

  // ٣) الحجز المسبق — أعلى تكلفة ممكنة لهذه الرسالة، يُردّ الفرق بعد الرد
  const reservation = estimateReservation({ system, messages, replyCap });
  if (!(await deductCredits(userId, reservation.credits))) {
    const balance = await balanceOf(userId);
    const error = new Error(
      `رصيدك (${balance}) لا يكفي لهذه الرسالة: نحتاج ${reservation.credits} نقطة كحدٍّ أقصى قبل الإرسال. اشترِ باقة أو ابدأ محادثة جديدة أقصر.`
    );
    error.code = 'NO_TOKENS';
    throw error;
  }

  let reply;
  try {
    reply = await runSupervisor({ userId, system, messages, maxTokens: replyCap });
  } catch (error) {
    await refundCredits(userId, reservation.credits);
    await logUsage(userId, { type: 'chat_failed', tokens: 0, summary: error.message });
    throw error;
  }

  // ٥) التسوية على الاستهلاك الحقيقي الذي أرجعه المزوّد
  const usage = normalizeUsage(reply.usage);
  const charge = usage.inputTokens || usage.outputTokens
    ? chargeUsage(usage)
    : { credits: reservation.credits, inputTokens: 0, outputTokens: 0, multiplier: chargeUsage(usage).multiplier };

  const charged = Math.min(charge.credits, reservation.credits);
  if (reservation.credits > charged) await refundCredits(userId, reservation.credits - charged);

  // ٦) وسم التنبيه: يُحذف قبل الحفظ والعرض، ويُحتسب في العدّاد
  const cleaned = stripStrikeTag(reply.text);
  let strikes = context.strikes;
  if (cleaned.hadStrike) strikes = await addStrike(userId);

  await appendMessage(conversation.id, { role: 'user', content: question, tokensUsed: charged });
  await appendMessage(conversation.id, { role: 'assistant', content: cleaned.text, model: reply.model });
  await pool.query('UPDATE conversations SET provider = $2 WHERE id = $1', [conversation.id, reply.provider]);

  await logUsage(userId, {
    type: 'chat',
    tokens: charged,
    inputTokens: charge.inputTokens,
    outputTokens: charge.outputTokens,
    provider: reply.provider,
    model: reply.model,
    multiplier: charge.multiplier,
    summary: titleFromPrompt(question)
  });

  // ٧) بدء جلسة جديدة ⇒ تلخيص الجلسة السابقة (على حساب المنصة، لا الباحث)
  if (previousId) {
    const previous = await getConversation(userId, previousId);
    if (previous) {
      const memory = await summarizeConversation(userId, { messages: previous.messages, profile });
      if (memory) {
        await logUsage(userId, { type: 'chat_summary', tokens: 0, summary: 'تلخيص جلسة سابقة لتحديث ذاكرة المشرف' });
      }
    }
  }

  // عدّاد أسئلة المناقشة (8–12 سؤالاً ⇒ تلخيص)
  if (conversation.mode === 'defense') {
    const state = readDefenseState(conversation);
    await writeDefenseState(conversation.id, { ...state, asked: state.asked + 1, startedAt: state.startedAt || new Date().toISOString() });
  }

  return {
    conversationId: conversation.id,
    title: conversation.title,
    answer: cleaned.text,
    provider: reply.provider,
    model: reply.model,
    tokensCharged: charged,
    reserved: reservation.credits,
    strikes,
    mode: conversation.mode
  };
}

/** تبديل وضع المحادثة بين الإرشاد العادي ووضع المناقشة. */
export async function setConversationMode(userId, conversationId, mode) {
  const next = mode === 'defense' ? 'defense' : 'normal';
  const { rowCount } = await pool.query(
    "UPDATE conversations SET mode = $3, defense_state = '{}'::jsonb WHERE id = $2 AND user_id = $1",
    [userId, conversationId, next]
  );

  return rowCount > 0;
}

/** تكلفة رسالة الشات التقديرية المعروضة في الواجهة قبل الإرسال. */
export function chatCost() {
  return CHAT_COST;
}
