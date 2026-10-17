import { pool } from '../db/client.js';

/**
 * تصنيف نشاط الباحثين (نشط / غير نشط + سبب) — أساس قرارات الهدايا ومتابعة المشاكل.
 *
 * القواعد المتفق عليها:
 *   نشط   = دخل خلال آخر 7 أيام  AND  باقته سارية (بما فيها فترة سماح 48 ساعة بعد الانتهاء)
 *   غير نشط بسبب خمول      = لا دخول منذ أكثر من 7 أيام
 *   غير نشط بسبب انتهاء باقة = انتهت باقته ومرّت أكثر من 48 ساعة دون تجديد
 *   موقوف  = is_active = false (استثناء من التصنيفين — لا يُحسب هدية ولا متابعة)
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

/** فلتر صفحة الباحثين: قيم مسموحة مع تسمياتها العربية. */
export const ACTIVITY_FILTERS = {
  activity_active: 'النشطون',
  activity_idle: 'غير نشط — خمول',
  activity_plan_expired: 'غير نشط — باقة منتهية',
  activity_suspended: 'موقوفون'
};

/**
 * شرط «دخل خلال آخر N أيام»: يستخدم last_login_at، ويسقط آمناً على created_at
 * للحسابات القديمة التي أُنشأت قبل وجود هذا العمود (فلا تُصنَّف كلها خاملة فجأة).
 */
const RECENT_LOGIN_SQL = `COALESCE(u.last_login_at, u.created_at) >= NOW() - make_interval(days => ${INACTIVE_LOGIN_DAYS})`;

/** شرط «باقته سارية الآن أو في فترة السماح»: لا باقة (NULL) = لا تنتهي = سارية. */
const PLAN_VALID_SQL = `(u.plan_expires_at IS NULL OR u.plan_expires_at >= NOW() - make_interval(hours => ${PLAN_GRACE_HOURS}))`;

/**
 * تعبير حالة النشاط في SQL — مصدر واحد يُستخدم في الفلترة والتجميع معاً
 * فلا يمكن أن يختلف المعنى بين الاستعلامين.
 */
const ACTIVITY_STATUS_SQL = `
  CASE
    WHEN NOT COALESCE(u.is_active, true) THEN 'suspended'
    WHEN ${RECENT_LOGIN_SQL} AND ${PLAN_VALID_SQL} THEN 'active'
    WHEN NOT ${RECENT_LOGIN_SQL} THEN 'idle'
    ELSE 'plan_expired'
  END`;

/** مصفوفة أسباب عدم النشط مرتبة (لعرضها في لوحة الإدارة). */
export const INACTIVE_REASONS = [
  { key: 'idle', label: 'خمول — لا دخول منذ أكثر من 7 أيام' },
  { key: 'plan_expired', label: 'باقة منتهية — مرّت أكثر من 48 ساعة دون تجديد' }
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
    case 'activity_suspended':
      return ` AND ${ACTIVITY_STATUS_SQL} = 'suspended'`;
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
 * إحصائية التصنيف للوحة الإدارة: الإجمالي + النشطون + كل سبب غير نشط + الموقوفون.
 * استعلام واحد مجمّع (لا تحميل صفوف ثم عدّ في JS).
 * يستثني المديرين (role = 'admin') — تصنيف الباحثين يخصّ الباحثين فقط.
 */
export async function activityStats() {
  const empty = {
    total: 0,
    active: 0,
    inactive: 0,
    idle: 0,
    planExpired: 0,
    suspended: 0,
    rules: { days: INACTIVE_LOGIN_DAYS, graceHours: PLAN_GRACE_HOURS }
  };

  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status IN ('idle', 'plan_expired'))::int AS inactive,
              count(*) FILTER (WHERE status = 'idle')::int AS idle,
              count(*) FILTER (WHERE status = 'plan_expired')::int AS plan_expired,
              count(*) FILTER (WHERE status = 'suspended')::int AS suspended
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
      suspended: Number(row.suspended || 0),
      rules: { days: INACTIVE_LOGIN_DAYS, graceHours: PLAN_GRACE_HOURS }
    };
  } catch (error) {
    console.warn(`تعذّرت إحصائية نشاط الباحثين: ${error.code || error.message}`);
    return empty;
  }
}
