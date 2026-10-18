import { pool } from '../db/client.js';

/**
 * تصنيف حالات الحسابات (تلقائي بالكامل — بلا تدخل من المدير).
 *
 * القواعد المتفق عليها:
 *   نشط    = دخل خلال آخر 7 أيام  AND  باقته سارية (بما فيها فترة سماح 48 ساعة بعد الانتهاء)
 *   خامل    = لم يدخل منذ أكثر من 7 أيام  AND  باقته سارية
 *   منتهي   = دخل خلال آخر 7 أيام  AND  باقته منتهية (تجاوزت 48 ساعة سماح دون تجديد)
 *   متوقف   = لم يدخل منذ أكثر من 30 يوماً (بغض النظر عن الباقة — غياب طويل)
 *
 * الأولوية: متوقف أولاً (30+ يوم غياب)، ثم نشط (شرطان معاً)، ثم منتهي
 * (دخول حديث + باقة منتهية)، ثم خامل (الباقي).
 *
 * التواريخ تُملأ تلقائياً: last_login_at مع كل دخول بجوجل،
 * plan_expires_at عند تأكيد المدير لطلب دفع (مدة الباقة من plans.period_days).
 *
 * كل الاستعلامات تُبني من SQL هنا (مصدر واحد للمنطق) فلا يتكرر بين لوحة الإدارة
 * وصفحة الباحثين والإحصائيات.
 */

/** أيام الخمول: من لم يدخل منذ أكثر منها = غير نشط. */
export const INACTIVE_LOGIN_DAYS = 7;

/** ساعات السماح بعد انتهاء الباقة: خلالها يبقى الباحث نشطاً لمنحه فرصة التجديد. */
export const PLAN_GRACE_HOURS = 48;

/** أيام الغياب الطويل: من لم يدخل منذ أكثر منها = متوقف. */
export const STOPPED_LOGIN_DAYS = 30;

/** فلتر صفحة الباحثين: قيم مسموحة مع تسمياتها العربية. */
export const ACTIVITY_FILTERS = {
  activity_active: 'نشط',
  activity_idle: 'خامل',
  activity_plan_expired: 'منتهي باقته',
  activity_stopped: 'متوقف'
};

/**
 * شرط «دخل خلال آخر N أيام»: يستخدم last_login_at، ويسقط آمناً على created_at
 * للحسابات القديمة التي أُنشأت قبل وجود هذا العمود (فلا تُصنَّف كلها خاملة فجأة).
 */
const RECENT_LOGIN_SQL = `COALESCE(u.last_login_at, u.created_at) >= NOW() - make_interval(days => ${INACTIVE_LOGIN_DAYS})`;

/** شرط «باقته سارية الآن أو في فترة السماح»: لا باقة (NULL) = لا تنتهي = سارية. */
const PLAN_VALID_SQL = `(u.plan_expires_at IS NULL OR u.plan_expires_at >= NOW() - make_interval(hours => ${PLAN_GRACE_HOURS}))`;

/** شرط «غائب منذ أكثر من N أيام» (للمتوقف): لا دخول منذ 30+ يوماً بغض النظر عن الباقة. */
const STOPPED_LOGIN_SQL = `COALESCE(u.last_login_at, u.created_at) < NOW() - make_interval(days => ${STOPPED_LOGIN_DAYS})`;

/**
 * تعبير حالة الحساب في SQL — مصدر واحد يُستخدم في الفلترة والتجميع معاً
 * فلا يمكن أن يختلف المعنى بين الاستعلامين.
 */
const ACTIVITY_STATUS_SQL = `
  CASE
    WHEN ${STOPPED_LOGIN_SQL} THEN 'stopped'
    WHEN ${RECENT_LOGIN_SQL} AND ${PLAN_VALID_SQL} THEN 'active'
    WHEN ${RECENT_LOGIN_SQL} AND NOT ${PLAN_VALID_SQL} THEN 'plan_expired'
    ELSE 'idle'
  END`;

/** مصفوفة الحالات مرتبة (لعرضها في لوحة الإدارة). */
export const INACTIVE_REASONS = [
  { key: 'idle', label: 'خامل — لا دخول منذ أكثر من 7 أيام وباقته سارية' },
  { key: 'plan_expired', label: 'منتهي باقته — دخل حديثاً لكن مرّت أكثر من 48 ساعة دون تجديد' },
  { key: 'stopped', label: 'متوقف — لا دخول منذ أكثر من 30 يوماً' }
];

/** يقرأ فلتر النشاط من قيمة ?filter= ويُبقي فقط ما هو مسموح (والافتراضي «الكل»). */
export function readActivityFilter(value) {
  const key = String(value || '');
  return Object.hasOwn(ACTIVITY_FILTERS, key) ? key : '';
}

/**
 * يضيف شرط الفلترة إلى WHERE حسب فلتر النشاط (إن وُجد).
 * @param {string} filter مفتاح من ACTIVITY_FILTERS أو '' لعرض الكل.
 * @returns {string} جملة SQL فرعية تبدأ بـ AND أو فارغة.
 */
export function activityFilterWhere(filter) {
  const key = readActivityFilter(filter);
  if (!key) return '';

  switch (key) {
    case 'activity_active':
      return ` AND ${ACTIVITY_STATUS_SQL} = 'active'`;
    case 'activity_idle':
      return ` AND ${ACTIVITY_STATUS_SQL} = 'idle'`;
    case 'activity_plan_expired':
      return ` AND ${ACTIVITY_STATUS_SQL} = 'plan_expired'`;
    case 'activity_stopped':
      return ` AND ${ACTIVITY_STATUS_SQL} = 'stopped'`;
    default:
      return '';
  }
}

/** أعمدة النشاط التي تُضاف إلى استعلام قائمة الباحثين (حالة + آخر دخول + انتهاء الباقة). */
export const ACTIVITY_COLUMNS_SQL = `
  ${ACTIVITY_STATUS_SQL} AS activity_status,
  COALESCE(u.last_login_at, u.created_at) AS last_login_at,
  u.plan_expires_at`;

/**
 * إحصائية التصنيف للوحة الإدارة: الإجمالي + كل حالة.
 * استعلام واحد مجمّع (لا تحميل صفوف ثم عدّ في JS).
 * يستثني المديرين (role = 'admin') — تصنيف الباحثين يخصّ الباحثين فقط.
 */

/** شرط «متوقف» مستقل (يُستخدم في تنظيف الملفات): نفس تعريف CASE أعلاه. */
const STOPPED_WHERE_SQL = `NOT COALESCE(u.deleted, false)
  AND COALESCE(u.role, 'user') <> 'admin'
  AND COALESCE(u.last_login_at, u.created_at) < NOW() - make_interval(days => ${STOPPED_LOGIN_DAYS})`;

/**
 * مستخدمون متوقفون ما زالت لهم ملفات على المنصة (للتنظيف التلقائي/اليدوي).
 * يعيد [{ id, email, fileCount, fileBytes }] — بلا بايتات، ميتاداتا فقط.
 */
export async function stoppedUsersWithFiles() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email,
            count(f.id)::int AS file_count,
            COALESCE(sum(f.size_bytes), 0)::bigint AS file_bytes
       FROM users u
       JOIN files f ON f.user_id = u.id
      WHERE ${STOPPED_WHERE_SQL}
      GROUP BY u.id, u.email
      ORDER BY file_bytes DESC`
  );

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    fileCount: Number(row.file_count || 0),
    fileBytes: Number(row.file_bytes || 0)
  }));
}

/**
 * حذف ملفات مستخدم واحد (سطور files فقط — بلا مساس بأي جدول آخر).
 * يعيد { files, bytes } — عدد الملفات وحجمها المحذوف.
 */
export async function deleteUserFiles(userId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(count(*), 0)::int AS n, COALESCE(sum(size_bytes), 0)::bigint AS bytes FROM files WHERE user_id = $1',
    [userId]
  );
  await pool.query('DELETE FROM files WHERE user_id = $1', [userId]);

  return { files: Number(rows[0]?.n || 0), bytes: Number(rows[0]?.bytes || 0) };
}

/**
 * تنظيف ملفات كل الحسابات المتوقفة (30+ يوم غياب): سطور files فقط.
 * تُستدعى دورياً من الخادم + يدوياً من لوحة الإدارة.
 * تعيد { users, files, bytes }.
 */
export async function purgeStoppedUserFiles() {
  const targets = await stoppedUsersWithFiles();
  let files = 0;
  let bytes = 0;

  for (const target of targets) {
    const done = await deleteUserFiles(target.id);
    files += done.files;
    bytes += done.bytes;
  }

  if (targets.length) {
    console.log(`تنظيف المتوقفين: حُذفت ملفات ${targets.length} حساب (${files} ملف، ${bytes} بايت) — سطور files فقط.`);
  }

  return { users: targets.length, files, bytes };
}
export async function activityStats() {
  const empty = {
    total: 0,
    active: 0,
    inactive: 0,
    idle: 0,
    planExpired: 0,
    stopped: 0,
    rules: { days: INACTIVE_LOGIN_DAYS, graceHours: PLAN_GRACE_HOURS, stoppedDays: STOPPED_LOGIN_DAYS }
  };

  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status IN ('idle', 'plan_expired', 'stopped'))::int AS inactive,
              count(*) FILTER (WHERE status = 'idle')::int AS idle,
              count(*) FILTER (WHERE status = 'plan_expired')::int AS plan_expired,
              count(*) FILTER (WHERE status = 'stopped')::int AS stopped
         FROM (SELECT ${ACTIVITY_STATUS_SQL} AS status
                 FROM users u
                WHERE NOT COALESCE(u.deleted, false)
                  AND u.role <> 'admin') t`
    );

    const row = rows[0] || {};
    return {
      total: Number(row.total || 0),
      active: Number(row.active || 0),
      inactive: Number(row.inactive || 0),
      idle: Number(row.idle || 0),
      planExpired: Number(row.plan_expired || 0),
      stopped: Number(row.stopped || 0),
      rules: { days: INACTIVE_LOGIN_DAYS, graceHours: PLAN_GRACE_HOURS, stoppedDays: STOPPED_LOGIN_DAYS }
    };
  } catch (error) {
    console.warn(`تعذّرت إحصائية نشاط الباحثين: ${error.code || error.message}`);
    return empty;
  }
}
