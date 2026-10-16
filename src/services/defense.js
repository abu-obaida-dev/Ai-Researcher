import { pool } from '../db/client.js';

/**
 * خدمة المناقشة المستقلة (defense): دردشة مستقلة تماماً بملف بحث ثابت.
 *
 * الفكرة الجديدة: جلسة المناقشة = دردشة مستقلة تُفتح بملف بحث واحد ثابت
 * (thesis_file_id في defense_state)، والمناقِش يقرأ البحث ويقسّمه ذهنياً إلى
 * أجزائه الطبيعية ويناقش جزءاً جزءاً (سؤال أو سؤالان في كل جزء حسب أهميته)
 * بلا تكرار — لا عدد أسئلة ثابت، بل تغطية كاملة للأجزاء ثم تقييم نهائي.
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

/** بدء جلسة مناقشة مستقلة جديدة (mode='defense' + ملف بحث ثابت اختياري). */
export async function startDefense({ userId, title = 'محاكاة مناقشة', thesisFileId = null }) {
  const state = { asked: 0, thesisFileId: thesisFileId || null, coveredParts: [], askedQuestions: [] };
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

/** صورة الجلسة: عدد الأسئلة + الأجزاء المغطاة + هل انتهت (يُنهيها المناقِش أو الباحث). */
export function defenseProgress(state = {}) {
  const raw = state && typeof state === 'object' ? state : {};
  const asked = Number(raw.asked) || 0;
  const coveredParts = Array.isArray(raw.coveredParts) ? raw.coveredParts : [];
  const done = Boolean(raw.done);

  return {
    asked,
    total: null,
    remaining: null,
    done,
    // المرحلة: هل انتهت (التقييم النهائي) · هل المناقشة جارية (ملف مثبّت) · بانتظار رفع
    stageKey: done ? 'final' : raw.thesisFileId ? 'discussing' : 'upload',
    stageLabel: done ? 'انتهت المناقشة' : raw.thesisFileId ? 'المناقشة جارية' : 'بانتظار رفع البحث',
    stageHint: done
      ? 'انتهت المناقشة — اقرأ التقييم النهائي.'
      : raw.thesisFileId
        ? 'المناقِش يقرأ بحثك ويناقشك جزءاً جزءاً — سؤال أو سؤالان في كل جزء.'
        : 'ارفع ملف البحث (PDF أو Word) ليبدأ المناقِش قراءته ومناقشتك فيه.',
    stageQuestions: null,
    coveredParts,
    thesisFileId: raw.thesisFileId || null,
    stages: []
  };
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