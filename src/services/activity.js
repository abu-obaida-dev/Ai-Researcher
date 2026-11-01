import { pool } from '../db/client.js';

/** Classifies account activity from login and plan-expiration timestamps. */

/** Days without login before an account becomes inactive. */
export const INACTIVE_LOGIN_DAYS = 7;

/** Grace period after plan expiration. */
export const PLAN_GRACE_HOURS = 48;

/** Days without login before an account is considered suspended. */
export const STOPPED_LOGIN_DAYS = 30;

/** Allowed activity filters and their display labels. */
export const ACTIVITY_FILTERS = {
  activity_active: 'نشط',
  activity_idle: 'خامل',
  activity_plan_expired: 'منتهي باقته',
  activity_stopped: 'متوقف'
};

/** Uses created_at for legacy accounts without last_login_at. */
const RECENT_LOGIN_SQL = `COALESCE(u.last_login_at, u.created_at) >= NOW() - make_interval(days => ${INACTIVE_LOGIN_DAYS})`;

/** Treats accounts without a plan as non-expiring. */
const PLAN_VALID_SQL = `(u.plan_expires_at IS NULL OR u.plan_expires_at >= NOW() - make_interval(hours => ${PLAN_GRACE_HOURS}))`;

/** Builds the long-absence condition regardless of plan status. */
const STOPPED_LOGIN_SQL = `COALESCE(u.last_login_at, u.created_at) < NOW() - make_interval(days => ${STOPPED_LOGIN_DAYS})`;

/** Shared SQL expression used by activity filtering and aggregation. */
const ACTIVITY_STATUS_SQL = `
  CASE
    WHEN ${STOPPED_LOGIN_SQL} THEN 'stopped'
    WHEN ${RECENT_LOGIN_SQL} AND ${PLAN_VALID_SQL} THEN 'active'
    WHEN ${RECENT_LOGIN_SQL} AND NOT ${PLAN_VALID_SQL} THEN 'plan_expired'
    ELSE 'idle'
  END`;

/** Returns activity statuses for admin filters. */
export const INACTIVE_REASONS = [
  { key: 'idle', label: 'خامل — لا دخول منذ أكثر من 7 أيام وباقته سارية' },
  { key: 'plan_expired', label: 'منتهي باقته — دخل حديثاً لكن مرّت أكثر من 48 ساعة دون تجديد' },
  { key: 'stopped', label: 'متوقف — لا دخول منذ أكثر من 30 يوماً' }
];

/** Validates the requested activity filter. */
export function readActivityFilter(value) {
  const key = String(value || '');
  return Object.hasOwn(ACTIVITY_FILTERS, key) ? key : '';
}

/** Builds the SQL predicate for an optional activity filter. */
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

/** SQL fields appended to user-list queries. */
export const ACTIVITY_COLUMNS_SQL = `
  ${ACTIVITY_STATUS_SQL} AS activity_status,
  COALESCE(u.last_login_at, u.created_at) AS last_login_at,
  u.plan_expires_at`;

/** Aggregates user activity states in one query, excluding administrators. */

/** Shared long-absence predicate for stale-file cleanup. */
const STOPPED_WHERE_SQL = `NOT COALESCE(u.deleted, false)
  AND COALESCE(u.role, 'user') <> 'admin'
  AND COALESCE(u.last_login_at, u.created_at) < NOW() - make_interval(days => ${STOPPED_LOGIN_DAYS})`;

/** Lists long-inactive users with file metadata only. */
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

/** Deletes only file rows and storage for one user. */
export async function deleteUserFiles(userId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(count(*), 0)::int AS n, COALESCE(sum(size_bytes), 0)::bigint AS bytes FROM files WHERE user_id = $1',
    [userId]
  );
  await pool.query('DELETE FROM files WHERE user_id = $1', [userId]);

  return { files: Number(rows[0]?.n || 0), bytes: Number(rows[0]?.bytes || 0) };
}

/** Cleans files for all long-inactive users. */
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
