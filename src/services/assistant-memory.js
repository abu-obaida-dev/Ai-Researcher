import { pool } from '../db/client.js';
import { runSupervisor } from './ai.js';
import { logUsage } from './tokens.js';

/**
 * ذاكرة «المعلم» — منفصلة تماماً عن ذاكرة المشرف (supervisor_memory).
 *
 * قرار صاحب المنتج: لكل شخصية ذاكرته:
 *   - المشرف الذكي → supervisor_memory (ملخص + مهمة + تنبيهات)
 *   - المعلم       → assistant_memory (هذه — ملخص تعليمي + مهمة تعليمية)
 *   - المناقِش     → لا ذاكرة خارج جلسته (رسائل الدردشة وحدها)
 * لا يقرأ هذا الجدول أحد غير خدمات المعلم — العزل على مستوى الجداول لا
 * على مستوى البرومبت فقط. التلخيص استدعاء داخلي رخيص على حساب المنصة
 * (usage_logs بنقاط صفر، مثل تلخيص المشرف تماماً).
 */

/** أقل عدد رسائل في جلسة تستحق تلخيصاً (وإلا فلا فائدة). */
const MIN_MESSAGES_TO_SUMMARIZE = 4;

/** ذاكرة المعلم: صف واحد لكل مستخدم (تنشأ عند أول كتابة). */
export async function getAssistantMemory(userId) {
  const { rows } = await pool.query('SELECT memory, open_task FROM assistant_memory WHERE user_id = $1', [userId]);
  return { memory: rows[0]?.memory || '', openTask: rows[0]?.open_task || '' };
}

/** يحفظ الملخّص والمهمة التعليمية (يستبدل المحتوى السابق ولا يمسّ شيئاً آخر). */
export async function saveAssistantMemory(userId, { memory = '', openTask = '' } = {}) {
  await pool.query(
    `INSERT INTO assistant_memory (user_id, memory, open_task, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET memory = EXCLUDED.memory, open_task = EXCLUDED.open_task, updated_at = NOW()`,
    [userId, String(memory || '').slice(0, 1500), String(openTask || '').slice(0, 300)]
  );
}

/** آخر محادثة تعليمية غنية — لتُلخَّص عند بدء محادثة جديدة (جداول المعلم وحدها). */
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

/** يحلّل نص JSON آمناً (الموديل قد يغلّفه بـ \`\`\`json). */
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

/**
 * تلخيص جلسة تعليمية منتهية: نموذج رخيص → assistant_memory.
 * يفشل بصمت (null) حتى لا يُفشل ختام الجلسة ولا يُكلّف الباحث شيئاً.
 */
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
