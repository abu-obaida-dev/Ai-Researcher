import { pool } from '../db/client.js';
import { runSupervisor } from './ai.js';
import { logUsage } from './tokens.js';

/** Private memory for the teaching assistant; isolated from supervisor and defense state. */

/** Minimum conversation length worth summarizing. */
const MIN_MESSAGES_TO_SUMMARIZE = 4;

/** Returns the user's assistant memory. */
export async function getAssistantMemory(userId) {
  const { rows } = await pool.query('SELECT memory, open_task FROM assistant_memory WHERE user_id = $1', [userId]);
  return { memory: rows[0]?.memory || '', openTask: rows[0]?.open_task || '' };
}

/** Saves the summary and open teaching task. */
export async function saveAssistantMemory(userId, { memory = '', openTask = '' } = {}) {
  await pool.query(
    `INSERT INTO assistant_memory (user_id, memory, open_task, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET memory = EXCLUDED.memory, open_task = EXCLUDED.open_task, updated_at = NOW()`,
    [userId, String(memory || '').slice(0, 1500), String(openTask || '').slice(0, 300)]
  );
}

/** Finds the latest substantial assistant conversation. */
export async function lastRichAssistantConversation(userId, excludeId = null) {
  const { rows } = await pool.query(
    `SELECT c.id FROM assistant_conversations c
      WHERE c.user_id = $1 AND c.id IS DISTINCT FROM $2
        AND (SELECT count(*) FROM assistant_messages m WHERE m.conversation_id = c.id) >= 4
      ORDER BY c.updated_at DESC LIMIT 1`,
    [userId, excludeId || null]
  );
  return rows[0]?.id || null;
}

const SUMMARY_SYSTEM = `أنت مُحلِّل جلسات لمعلّم تعليمي لطلاب مبتدئين. اقرأ المحادثة واستخرج فقط:
- "memory": ثلاث نقاط قصوى تخص التعليم وحده (ماذا شُرِح وفهمه الباحث، وما زال غير مفهوم، وما قرّروه من هيكلة أو ترجمة أو بحث) — جمل قصيرة بالعربية.
- "open_task": مهمة تعليمية واحدة محددة يُفترض استكمالها في المرة القادمة، أو "" إن لم يُتفق على شيء.
أجيبي بـ JSON فقط: {"memory": ["…","…","…"], "open_task": "…"}.
لا تضيفي نصاً خارج JSON. لا تكتب شيئاً عن المشرف أو مراحل رحلة البحث — هذه ذاكرة المعلم وحده.`;

/** Parses model JSON, including fenced JSON responses. */
function parseJsonLoose(text) {
  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Summarizes an earlier assistant session without failing the current request. */
export async function summarizeAssistantConversation(userId, { messages = [], profile = {} } = {}) {
  const transcript = messages
    .slice(-24)
    .map((message) => `${message.role === 'assistant' ? 'المعلم' : 'الباحث'}: ${String(message.content).slice(0, 600)}`)
    .join('\n');

  if (!transcript.trim() || messages.length < MIN_MESSAGES_TO_SUMMARIZE) return null;

  try {
    const reply = await runSupervisor({
      userId,
      system: SUMMARY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `تخصص الباحث: ${profile.research_field || 'غير محدد'}\n\nالمحادثة:\n${transcript}`
        }
      ],
      temperature: 0.2,
      maxTokens: 500
    });

    const parsed = parseJsonLoose(reply.text);
    if (!parsed) return null;

    const memory = Array.isArray(parsed.memory)
      ? parsed.memory.map((item) => String(item).trim()).filter(Boolean).slice(0, 3).join(' · ')
      : '';

    const result = { memory: memory.slice(0, 1500), openTask: String(parsed.open_task || '').trim().slice(0, 300) };
    if (!result.memory && !result.openTask) return null;

    await saveAssistantMemory(userId, result);
    await logUsage(userId, { type: 'assistant_summary', tokens: 0, summary: 'تلخيص جلسة سابقة لتحديث ذاكرة المعلم' });
    return result;
  } catch (error) {
    console.warn(`تعذّر تلخيص جلسة المعلم: ${error.code || error.message}`);
    return null;
  }
}
