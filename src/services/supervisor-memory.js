import { pool } from '../db/client.js';
import { runSupervisor } from './ai.js';

/**
 * ذاكرة المشرف الذكي — ما لا يحسبه البرومبت بل قاعدة البيانات.
 *
 * ثلاثة أشياء:
 *   1) memory + open_task: ملخّص ما استقرّ في جلسات سابقة + المهمة المتفق عليها
 *      المرة القادمة. تُبنى باستدعاء رخيص واحد عند إغلاق الجلسة.
 *   2) strikes: عدّاد التنبيه على الخروج عن النطاق/الاستهجار. المشرف نفسه
 *      يضع وسم [[strike]] في آخر ردّه، والكود يحذفه قبل العرض ويزيد العدّاد
 *      (فلا تكلفة استدعاء إضافي). يُصفَّر بعد فترة هدوء.
 *
 * الاستدعاءات الداخلية هنا (تلخيص الجلسة) تتحمّلها المنصة ولا تُخصم من
 * الباحث — تُسجَّل في usage_logs بنوع chat_summary وبنقاط صفر، حتى تبقى
 * تكلفة المنصة ظاهرة في سجل الاستهلاك.
 */

/** مدّة الهدوء التي تصفّر العدّاد (الساعات). */
const STRIKE_TTL_HOURS = Number(process.env.SUPERVISOR_STRIKE_TTL_HOURS || 24);
/** أقل عدد رسائل في الجلسة تستحق تلخيصاً (وإلا فلا فائدة). */
const MIN_MESSAGES_TO_SUMMARIZE = 4;

/** ذاكرة الباحث: صف واحد لكل مستخدم (ينشأ عند أول كتابة). */
export async function getMemory(userId) {
  const { rows } = await pool.query(
    'SELECT memory, open_task, strikes, strikes_updated_at FROM supervisor_memory WHERE user_id = $1',
    [userId]
  );

  const row = rows[0];
  if (!row) return { memory: '', openTask: '', strikes: 0, strikesUpdatedAt: null };

  return {
    memory: row.memory || '',
    openTask: row.open_task || '',
    strikes: Number(row.strikes || 0),
    strikesUpdatedAt: row.strikes_updated_at
  };
}

/**
 * عدّاد التنبيهات مع تصفير تلقائي بعد فترة هدوء: من عدّ مرتين وعاد
 * جدّياً بعد يوم يُعامل كبداية نظيفة.
 */
export async function getStrikes(userId) {
  const { strikes, strikesUpdatedAt } = await getMemory(userId);
  if (!strikes) return 0;
  if (!strikesUpdatedAt) return strikes;

  const idleHours = (Date.now() - new Date(strikesUpdatedAt).getTime()) / 36e5;
  if (idleHours < STRIKE_TTL_HOURS) return strikes;

  await pool.query(
    'UPDATE supervisor_memory SET strikes = 0, strikes_updated_at = NULL, updated_at = NOW() WHERE user_id = $1',
    [userId]
  );
  return 0;
}

/** يزيد عدّاد التنبيهات (يُستدعى عند وجود وسم [[strike]] في رد المشرف). */
export async function addStrike(userId) {
  const { rows } = await pool.query(
    `INSERT INTO supervisor_memory (user_id, strikes, strikes_updated_at, updated_at)
     VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET strikes = supervisor_memory.strikes + 1,
           strikes_updated_at = NOW(),
           updated_at = NOW()
     RETURNING strikes`,
    [userId]
  );

  return Number(rows[0]?.strikes || 0);
}

/**
 * تصفير يدوي للعدّاد — احتياط غير مستخدم حالياً في المسارات
 * (لا يستدعيه أحد في src/)؛ التصفير الفعلي الوحيد تلقائي بعد الهدوء 24 ساعة.
 * موجود لاستدعاء يدوي مستقبلاً (مثال المقترح في تعليقها: تصفير عند إنجاز خطوة).
 */
export async function resetStrikes(userId) {
  await pool.query(
    `INSERT INTO supervisor_memory (user_id, strikes, strikes_updated_at, updated_at)
     VALUES ($1, 0, NULL, NOW())
     ON CONFLICT (user_id) DO UPDATE SET strikes = 0, strikes_updated_at = NULL, updated_at = NOW()`,
    [userId]
  );
}

/** يحفظ الملخّص والمهمة القادمة (يستبدل memory، ولا يمسّ عدّاد التنبيهات). */
export async function saveMemory(userId, { memory = '', openTask = '' } = {}) {
  await pool.query(
    `INSERT INTO supervisor_memory (user_id, memory, open_task, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET memory = EXCLUDED.memory, open_task = EXCLUDED.open_task, updated_at = NOW()`,
    [userId, String(memory || '').slice(0, 1500), String(openTask || '').slice(0, 300)]
  );
}

const SUMMARY_SYSTEM = `أنت مُحلِّل جلسات لمشرفة بحثية ذكية. اقرأ المحادثة واستخرج فقط:
- "memory": ثلاث نقاط قصوى تخصّ حالة الباحث البحثية (قرارات اتُّخذت، نقاط ضعف رُصدت، التزامات) — جمل قصيرة بالعربية.
- "open_task": مهمة واحدة محدّدة اتُّفق عليها للمرة القادمة، أو "" إن لم يُتفق على شيء.
أجيبي بـ JSON فقط: {"memory": ["…","…","…"], "open_task": "…"}.
لا تضيفي نصاً خارج JSON. لا تحكمي على الباحث ولا نصائح.`;

/** يحلّل نص JSON آمناً (الموديل قد يغلّفه بـ ```json). */
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
 * تلخيص جلسة منتهية: يستدعي نموذجاً رخيصاً ويعيد { memory, openTask } أو null.
 * يفشل بصمت (null) حتى لا يُفشل ختام الجلسة ولا يُكلّف الباحث شيئاً.
 */
export async function summarizeConversation(userId, { messages = [], profile = {} } = {}) {
  const transcript = messages
    .slice(-24)
    .map((message) => `${message.role === 'assistant' ? 'المشرفة' : 'الباحث'}: ${String(message.content).slice(0, 600)}`)
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

    await saveMemory(userId, result);
    return result;
  } catch (error) {
    console.warn(`تعذّر تلخيص الجلسة: ${error.code || error.message}`);
    return null;
  }
}
