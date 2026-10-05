import { pool } from '../db/client.js';

/**
 * خدمة المناقشة (defense): محاكاة مناقشة حقيقية بعد انتهاء البحث أو الرسالة.
 *
 * المنطق كله هنا (بما فيه منطق النقاط في askSupervisor) —Routes/View مجرد عرض.
 * الفكرة: بدء جلسة محاكاة (mode='defense')، ثم السؤال يتولّده المشرف الذكي
 * ويعيد الرد + السؤال التالي + ملاحظات تحضير. بعد N أسئلة يتقدّم إلى مرحلة
 * «التقييم النهائي» الذي يقدّم ملاحظات ونقاط ضعف وقوة في البحث.
 */

const STAGES = [
  { key: 'warmup', label: 'افتتاح', count: 2, hint: 'تحية وتقديم البحث وفتح المناقشة.' },
  { key: 'method', label: 'المنهجية', count: 3, hint: 'أسئلة عن المنهجية والعينة والتحليل.' },
  { key: 'results', label: 'النتائج', count: 3, hint: 'أسئلة عن النتائج ودلالتها وقابلية تعميمها.' },
  { key: 'literature', label: 'الأدبيات', count: 2, hint: 'أسئلة عن الدراسات السابقة والفجوة البحثية.' },
  { key: 'final', label: 'التقييم', count: 1, hint: 'تقييم نهائي: نقاط القوة والضعف والتوصيات.' }
];

const TOTAL_QUESTIONS = STAGES.reduce((sum, stage) => sum + stage.count, 0);

/** صورة الجلسة: المرحلة + الأسئلة المتبقية + هل انتهت. */
export function defenseProgress(state = {}) {
  const asked = Number(state.asked) || 0;
  const done = asked >= TOTAL_QUESTIONS;

  let index = 0;
  let counted = 0;
  for (const [i, stage] of STAGES.entries()) {
    if (asked < counted + stage.count) {
      index = i;
      break;
    }
    counted += stage.count;
    index = i;
  }

  const stage = STAGES[index];
  const stageQuestions = Math.max(1, Math.min(stage.count - (asked - counted), stage.count));
  const remaining = Math.max(0, TOTAL_QUESTIONS - asked);

  return {
    asked,
    total: TOTAL_QUESTIONS,
    remaining,
    done,
    stageKey: done ? 'final' : stage.key,
    stageLabel: done ? 'انتهت المحاكاة' : stage.label,
    stageHint: done ? 'انتهت أسئلة المحاكاة — اقرأ التقييم النهائي.' : stage.hint,
    stageQuestions,
    stages: STAGES
  };
}

/** بدء جلسة محاكاة جديدة (kind='defense'). */
export async function startDefense({ userId, title = 'محاكاة مناقشة' }) {
  const { rows } = await pool.query(
    `INSERT INTO conversations (user_id, title, mode, defense_state)
     VALUES ($1, $2, 'defense', '{"asked":0}'::jsonb)
     RETURNING *`,
    [userId, String(title).slice(0, 200)]
  );

  return rows[0];
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