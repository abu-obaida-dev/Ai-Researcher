import { pool } from '../db/client.js';
import { CHAT_REPLY_CAPS, TOKEN_COSTS, isUuid } from '../constants.js';
import { runSupervisor } from './ai.js';
import { extractAnswerCorrectness, extractDefenseFinalTag, stripAnswerCorrectnessTag } from './defense.js';
import { extractStatedTopic } from './literature.js';
import { isValidStepKeyForUser, recordTopic } from './journey.js';
import { buildSupervisorContext } from './supervisor-context.js';
import { buildSystemPrompt } from './supervisor-prompt.js';
import { addStrike, summarizeConversation } from './supervisor-memory.js';
import { balanceOf, chargeUsage, deductCredits, estimateReservation, logUsage, normalizeUsage, refundCredits } from './tokens.js';
import { detectStepCompletion } from './step-review.js';

/** Supervisor conversations, billing, and response orchestration. */

const CHAT_COST = TOKEN_COSTS.find((item) => item.type === 'chat')?.tokens || 30;
const HISTORY_LIMIT = 8;
const PROMPT_LIMIT = 8000;
const TITLE_LIMIT = 120;

/** Internal strike marker removed before display and counting. */
const STRIKE_TAG = /\[\[\s*strike\s*\]\]|\[\s*strike\s*\]/gi;

/** Removes the internal strike marker and reports whether it was present. */
function stripStrikeTag(text) {
  const raw = String(text || '');
  const hadStrike = STRIKE_TAG.test(raw);
  STRIKE_TAG.lastIndex = 0;

  return { text: raw.replace(STRIKE_TAG, '').replace(/\s+$/, ''), hadStrike };
}

/** Prevents users from injecting internal strike markers into their messages. */
function sanitizeUserText(text) {
  return String(text || '').replace(STRIKE_TAG, '').replace(/\s+$/, '');
}

/** Lists guidance conversations; defense sessions use a separate route. */
export async function listConversations(userId, { limit = 12 } = {}) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.step_key, c.mode, c.provider, c.created_at, c.updated_at,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS messages_count
       FROM conversations c
      WHERE c.user_id = $1 AND c.mode <> 'defense'
      ORDER BY c.updated_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 12, 1), 50)]
  );

  return rows;
}

/** Loads an owned conversation, its messages, and defense state. */
export async function getConversation(userId, conversationId) {
  if (!isUuid(conversationId)) return null;
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

/** Creates a guidance conversation with a title derived from the first prompt. */
export async function createConversation(userId, { title = '', stepKey = null, mode = 'normal' } = {}) {
  // Defense sessions must be created and updated only by the defense service.
  const nextMode = 'normal';
  const { rows } = await pool.query(
    'INSERT INTO conversations (user_id, title, step_key, mode) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, String(title || 'محادثة جديدة').trim().slice(0, TITLE_LIMIT), stepKey || null, nextMode]
  );

  return { ...rows[0], messages: [] };
}

/** Appends a message and updates the conversation timestamp. */
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

/** Deletes a conversation and its messages. */
export async function deleteConversation(userId, conversationId) {
  if (!isUuid(conversationId)) return false;
  const { rowCount } = await pool.query('DELETE FROM conversations WHERE id = $2 AND user_id = $1', [
    userId,
    conversationId
  ]);

  return rowCount > 0;
}

/** Builds a short title from the first prompt. */
function titleFromPrompt(prompt) {
  const line = String(prompt).split('\n').find((item) => item.trim()) || 'محادثة جديدة';
  return line.trim().slice(0, 60);
}

/** Finds a previous guidance conversation for memory summarization. */
async function lastRichConversation(userId, excludeId = null) {
  const { rows } = await pool.query(
    `SELECT c.id FROM conversations c
      WHERE c.user_id = $1 AND c.id IS DISTINCT FROM $2
        AND c.mode <> 'defense'
        AND (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) >= 4
      ORDER BY c.updated_at DESC LIMIT 1`,
    [userId, excludeId || null]
  );

  return rows[0]?.id || null;
}

/** Normalizes stored defense state while preserving all session fields. */
function readDefenseState(conversation) {
  const state = conversation?.defense_state;
  if (!state || typeof state !== 'object') return { asked: 0, startedAt: null };

  return {
    ...state,
    asked: Number(state.asked) || 0,
    startedAt: state.startedAt || null,
    thesisFileId: state.thesisFileId || null,
    coveredParts: Array.isArray(state.coveredParts) ? state.coveredParts : [],
    askedQuestions: Array.isArray(state.askedQuestions) ? state.askedQuestions : [],
    done: Boolean(state.done)
  };
}

async function writeDefenseState(conversationId, state) {
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(state)
  ]);
}

/** Sends a supervisor prompt using reserve, provider call, and usage settlement. */
export async function askSupervisor({
  userId,
  prompt,
  conversationId = null,
  stepKey = null,
  profile = {},
  fileIds = [],
  mode = null,
  internal = false,
  defenseFinalRequested = false
}) {
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

  // New conversations always start in guidance mode.
  if (!conversation) {
    const created = await createConversation(userId, { title: titleFromPrompt(question), stepKey, mode: 'normal' });
    conversation = created;
  }

  const context = await buildSupervisorContext({ userId, profile, conversation, fileIds });

  const history = (conversation.messages || [])
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content
    }));

  const messages = [...history, { role: 'user', content: question }];

  // Mention attachments in the user message so the model treats the request as in-scope.
  const attachedNames = Array.isArray(context.fileNames) ? context.fileNames : [];
  if (attachedNames.length && context.files) {
    messages[messages.length - 1] = {
      role: 'user',
      content: `${question}\n\n[مرفق مع هذه الرسالة: ${attachedNames.join('، ')} — مقتطفاتها كاملة في قسم «الملفات المرفقة»]`
    };
  }

  const baseCap = context.replyCap || CHAT_REPLY_CAPS.normal;

  // The supervisor does not search for references; the prompt directs users to the platform library.
  const inTopicStep = String(context.currentStepKey || stepKey || '') === 'topic';

  // Record an explicitly stated topic verbatim; completion remains the user's decision.
  let topicRecordedBySystem = '';
  if (inTopicStep) {
    const stated = extractStatedTopic(question);
    if (stated) {
      try {
        topicRecordedBySystem = await recordTopic(userId, stated, {
          degreeLevel: profile?.degree_level || '',
          stepKey: 'topic'
        });
      } catch (error) {
        console.warn(`تعذّر تسجيل موضوع البحث: ${error?.code || error?.message}`);
      }
    }
  }

  // Tell the model when the system recorded the user's topic.
  const system = buildSystemPrompt(
    { ...context, topicRecordedBySystem, defenseFinalRequested },
    { recordedTopic: topicRecordedBySystem }
  );
  const replyCap = attachedNames.length ? Math.max(baseCap, 1400) : baseCap;

  // Reserve the maximum expected cost before calling the provider.
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

  // Settle against the provider's actual token usage.
  const usage = normalizeUsage(reply.usage);
  const charge = usage.inputTokens || usage.outputTokens
    ? chargeUsage(usage)
    : { credits: reservation.credits, inputTokens: 0, outputTokens: 0, multiplier: chargeUsage(usage).multiplier };

  const charged = Math.min(charge.credits, reservation.credits);
  if (reservation.credits > charged) await refundCredits(userId, reservation.credits - charged);

  // Remove the internal strike marker before storing or displaying the reply.
  const cleaned = stripStrikeTag(reply.text);
  let strikes = context.strikes;
  if (cleaned.hadStrike) strikes = await addStrike(userId);

  // Return defense grading and completion metadata for the route to persist.
  let replyText = cleaned.text;
  let defenseEnded = false;
  let answerCorrectness = null;
  if (conversation.mode === 'defense') {
    const extracted = extractDefenseFinalTag(replyText);
    replyText = extracted.text;
    defenseEnded = extracted.ended;
    answerCorrectness = extractAnswerCorrectness(replyText);
    replyText = stripAnswerCorrectnessTag(replyText);
  }

  // Internal instructions are not stored as user messages.
  if (!internal) {
    await appendMessage(conversation.id, { role: 'user', content: question, tokensUsed: charged });
  }
  await appendMessage(conversation.id, { role: 'assistant', content: replyText, model: reply.model });
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

  // Summarize the previous conversation when a new one starts.
  if (conversationId) {
    const previous = await getConversation(userId, conversationId);
    if (previous) {
      const memory = await summarizeConversation(userId, { messages: previous.messages, profile });
      if (memory) {
        await logUsage(userId, { type: 'chat_summary', tokens: 0, summary: 'تلخيص جلسة سابقة لتحديث ذاكرة المشرف' });
      }
    }
  }

  // Step review only creates a pending card; users decide whether to save it.
  try {
    await detectStepCompletion({
      userId,
      conversation: { ...conversation, step_key: conversation.step_key || stepKey || '' }
    });
  } catch (error) {
    console.warn(`تعذّر كشف اكتمال الخطوة: ${error?.code || error?.message}`);
  }

  return {
    conversationId: conversation.id,
    title: conversation.title,
    answer: replyText,
    provider: reply.provider,
    model: reply.model,
    tokensCharged: charged,
    reserved: reservation.credits,
    strikes,
    defenseEnded,
    answerCorrectness,
    references: [],
    mode: conversation.mode,
    answer: replyText
  };
}

/** Returns the estimated chat cost shown before submission. */
export function chatCost() {
  return CHAT_COST;
}
