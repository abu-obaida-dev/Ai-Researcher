import { pool } from '../db/client.js';

/**
 * إحصاءات صفحة الإحصائية (لوحة الباحث) — كل الأرقام من بيانات المستخدم نفسه فقط.
 *
 * تُجمَّع في استعلامات مجمّعة (aggregate) بدل تحميل الصفوف ثم العدّ في JS:
 * - days:    نشاط آخر ٧ أيام (نقاط + عدد عمليات) مع الأيام الفارغة مملوءة بصفر
 * - byType:  توزيع النقاط المستهلكة على أنواع العمليات (لمخطط دائري)
 * - counts:  أعداد المراجع والملاحظات والملفات والمحادثات وأسئلة المشرف
 *
 * لا يفشل أبداً: أي خطأ في قاعدة البيانات يعيد بنية فارغة (الصفحة تبقى تعمل).
 */

/** عدد أيام مخطط النشاط. */
const DAY_COUNT = 7;

/** بنية فارغة متسقة مع النجاح — يستخدمها العرض مباشرة إن تعذّر الاستعلام. */
function emptyStats() {
  return {
    days: [],
    maxTokens: 0,
    maxEvents: 0,
    weekTokens: 0,
    weekEvents: 0,
    byType: [],
    totalByType: 0,
    counts: { references: 0, notes: 0, files: 0, conversations: 0, questions: 0, failed: 0 },
    firstActivity: null,
    lastActivity: null
  };
}

/** تسمية اليوم بالأحرف العربية (تُحسب في JS لتفادي اختلافات لغة قاعدة البيانات). */
function weekdayLabel(isoDay) {
  const date = new Date(`${isoDay}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'short' }).format(date);
}

/** تسمية اليوم والشهر للعرض المختصر (مثل «1 أكتوبر»). */
function dateLabel(isoDay) {
  const date = new Date(`${isoDay}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(date);
}

/**
 * كل إحصاءات الصفحة في نداء واحد (٣ استعلامات متوازية).
 * @param {string} userId معرّف المستخدم من الجلسة.
 */
export async function getDashboardStats(userId) {
  if (!userId) return emptyStats();

  try {
    const [dailyResult, typeResult, countsResult] = await Promise.all([
      // نشاط آخر ٧ أيام: generate_series يضمن ظهور الأيام الفارغة بصفر
      pool.query(
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                COALESCE(u.events, 0)::int AS events,
                COALESCE(u.tokens, 0)::int AS tokens
           FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') AS d(day)
           LEFT JOIN (
                 SELECT date_trunc('day', created_at)::date AS day,
                        count(*)::int AS events,
                        COALESCE(sum(tokens_used), 0)::int AS tokens
                   FROM usage_logs
                  WHERE user_id = $1
                    AND created_at >= current_date - ($2::int - 1)
               GROUP BY 1
           ) u ON u.day = d.day::date
          ORDER BY d.day ASC`,
        [userId, DAY_COUNT]
      ),
      // توزيع النقاط على الأنواع (نستثني المحاولات الفاشلة — نقاطها صفر)
      pool.query(
        `SELECT type,
                count(*)::int AS events,
                COALESCE(sum(tokens_used), 0)::int AS tokens
           FROM usage_logs
          WHERE user_id = $1 AND type <> 'chat_failed'
       GROUP BY type
       ORDER BY tokens DESC, events DESC`,
        [userId]
      ),
      // أعداد المحتوى البحثي للمستخدم (كل جدول مقيّد بـ user_id)
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM user_references WHERE user_id = $1) AS references,
           (SELECT count(*)::int FROM notes WHERE user_id = $1) AS notes,
           (SELECT count(*)::int FROM files WHERE user_id = $1) AS files,
           (SELECT count(*)::int FROM conversations WHERE user_id = $1) AS conversations,
           (SELECT count(*)::int FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
             WHERE c.user_id = $1 AND m.role = 'user') AS questions,
           (SELECT count(*)::int FROM usage_logs WHERE user_id = $1 AND type = 'chat_failed') AS failed,
           (SELECT min(created_at) FROM usage_logs WHERE user_id = $1) AS first_activity,
           (SELECT max(created_at) FROM usage_logs WHERE user_id = $1) AS last_activity`,
        [userId]
      )
    ]);

    const days = dailyResult.rows.map((row) => ({
      date: row.day,
      weekday: weekdayLabel(row.day),
      dateLabel: dateLabel(row.day),
      events: row.events,
      tokens: row.tokens
    }));

    const weekTokens = days.reduce((sum, day) => sum + day.tokens, 0);
    const weekEvents = days.reduce((sum, day) => sum + day.events, 0);

    const byType = typeResult.rows.map((row) => ({
      type: row.type,
      events: row.events,
      tokens: row.tokens
    }));
    const totalByType = byType.reduce((sum, row) => sum + row.tokens, 0);

    const counts = countsResult.rows[0] || {};

    return {
      days,
      maxTokens: days.reduce((max, day) => Math.max(max, day.tokens), 0),
      maxEvents: days.reduce((max, day) => Math.max(max, day.events), 0),
      weekTokens,
      weekEvents,
      byType,
      totalByType,
      counts: {
        references: counts.references ?? 0,
        notes: counts.notes ?? 0,
        files: counts.files ?? 0,
        conversations: counts.conversations ?? 0,
        questions: counts.questions ?? 0,
        failed: counts.failed ?? 0
      },
      firstActivity: counts.first_activity || null,
      lastActivity: counts.last_activity || null
    };
  } catch (error) {
    console.warn(`تعذّر حساب إحصاءات الصفحة الرئيسية: ${error.code || error.message}`);
    return emptyStats();
  }
}