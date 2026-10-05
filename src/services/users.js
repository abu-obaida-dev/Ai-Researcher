import { pool } from '../db/client.js';
import { FREE_PLAN_CODE } from '../constants.js';
import { freeTrialTokens } from './plans.js';
import { isSupervisorEmail, planRoles } from './access.js';

/**
 * كل بيانات المستخدمين تُقرأ وتُكتب في PostgreSQL (جدولا users وprofiles) — لا Firestore.
 * المنطق منقول من النسخة القديمة (src/lib/userService.ts) بعد إسقاط جزء Firestore.
 */

/** الملف البحثي الافتراضي لأي حساب جديد (يقابل DEFAULT_PROFILE في النسخة القديمة). */
export const DEFAULT_PROFILE = {
  full_name: '',
  age: null,
  research_field: '',
  research_title: '',
  degree_level: 'bachelor',
  academic_year: '',
  university: '',
  faculty: '',
  research_interests: '',
  preferred_language: 'ar',
  about: '',
  research_stage: 'topic',
  methodology: '',
  citation_style: 'apa7',
  supervisor_name: '',
  supervisor_notes: ''
};

/** إيميلات مديري المنصة من .env — خطة نجاة ثابتة لا يمكن حذفها من اللوحة. */
export function adminEmailsFromEnv() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * مصدر صلاحية لوحة الإدارة: ADMIN_EMAILS في .env (خطة نجاة) + جدول admins
 * الذي يعدّله **المدير نفسه** من الإعدادات (إضافة بريده الجديد أو إزالته).
 * لا يستطيع أي مشرف أو باحث لمس هذا الجدول.
 */
export async function isAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (adminEmailsFromEnv().includes(normalized)) return true;

  try {
    const { rowCount } = await pool.query('SELECT 1 FROM admins WHERE lower(email) = $1', [normalized]);
    return rowCount > 0;
  } catch {
    return false;
  }
}

/** إيميلات المديرين: من .env + جدول admins (لعرضها في الإعدادات). */
export async function adminEmails() {
  const fromEnv = adminEmailsFromEnv();
  try {
    const { rows } = await pool.query('SELECT email, added_by, created_at FROM admins ORDER BY created_at DESC');
    const merged = [...fromEnv.map((email) => ({ email, source: '.env', created_at: null }))];
    for (const row of rows) {
      const email = String(row.email || '').toLowerCase();
      if (!merged.some((item) => item.email === email)) {
        merged.push({ email, source: 'اللوحة', created_at: row.created_at, added_by: row.added_by });
      }
    }
    return merged;
  } catch (error) {
    console.warn(`تعذّرت قراءة إيميلات المديرين: ${error.code || error.message}`);
    return fromEnv.map((email) => ({ email, source: '.env', created_at: null }));
  }
}

/**
 * المدير يغيّر بريده: ينقل دوره admin إلى بريده الجديد ويحدّث الجدول.
 * `oldEmail` بريده الحالي، `newEmail` الجديد. لا تغيير لدور أي حساب آخر.
 */

/**
 * إنشاء حساب جديد بعد تسجيل الدخول بجوجل (مع منح نقاط التجربة المجانية)
 * أو تحديث الحساب الموجود بنفس البريد — البيانات في PostgreSQL فقط.
 * ملاحظة: الدور يُزامَن مع قائمة المديرين في كل دخول (كما في النسخة القديمة).
 */
export async function ensureUserFromGoogle({ googleSub, email, name, picture }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('حساب جوجل لا يحتوي بريداً إلكترونياً.');

  const isAdmin = await isAdminEmail(normalizedEmail);
  const isSupervisor = !isAdmin && (await isSupervisorEmail(normalizedEmail));
  // الدور يُشتق من المصدر: مدير (.env) ← مشرف (جدول supervisors) ← دور الباقة.
  // أثناء التسجيل فقط تكون الباقة هي المجانية، بعدها يستقر الدور على plans.role_code.
  let role = 'free';
  if (isAdmin) role = 'admin';
  else if (isSupervisor) role = 'supervisor';
  else role = (await planRoles()).get(FREE_PLAN_CODE) || 'free';

  // حساب المدير لا يحتاج ملفاً بحثياً، فيبدأ الخطوة مكتملة
  const onboardingComplete = isAdmin;
  const sub = googleSub ? String(googleSub) : null;
  const freeTokens = await freeTrialTokens();

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, full_name, photo_url, google_sub, role, plan_code,
                          tokens_balance, tokens_granted, onboarding_complete, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), users.full_name),
         photo_url = COALESCE(NULLIF(EXCLUDED.photo_url, ''), users.photo_url),
         google_sub = COALESCE(EXCLUDED.google_sub, users.google_sub),
         role = EXCLUDED.role,
         onboarding_complete = users.onboarding_complete OR EXCLUDED.onboarding_complete,
         updated_at = NOW()
       RETURNING *, (xmax = 0) AS is_new`,
      [normalizedEmail, name || '', picture || '', sub, role, FREE_PLAN_CODE, freeTokens, onboardingComplete]
    );

    return rows[0];
  } catch (error) {
    // حالة نادرة: نفس حساب جوجل ببريد مختلف — نحدّث السجل المرتبط بـ google_sub
    if (error.code === '23505' && sub) {
      const { rows } = await pool.query(
        `UPDATE users
            SET email = $1,
                full_name = COALESCE(NULLIF($2, ''), full_name),
                photo_url = COALESCE(NULLIF($3, ''), photo_url),
                role = $4,
                onboarding_complete = onboarding_complete OR $5,
                updated_at = NOW()
          WHERE google_sub = $6
          RETURNING *, false AS is_new`,
        [normalizedEmail, name || '', picture || '', role, onboardingComplete, sub]
      );
      if (rows.length) return rows[0];
    }
    throw error;
  }
}

/**
 * يزامن دور الحساب مع مصدره الحقيقي (يُستدعى عند كل تحميل جلسة):
 *   مدير (ADMIN_EMAILS في .env) ← مشرف (جدول supervisors) ← دور باقته.
 * الباقة تربطه بدوره عبر plans.role_code، فتغيير الباقة يغيّر الخدمات المفتوحة فوراً.
 */
export async function syncUserRole(user) {
  if (!user) return null;

  const isAdmin = await isAdminEmail(user.email);
  const isSupervisor = !isAdmin && (await isSupervisorEmail(user.email));
  let expectedRole = 'researcher';

  if (isAdmin) {
    expectedRole = 'admin';
  } else if (isSupervisor) {
    expectedRole = 'supervisor';
  } else {
    const map = await planRoles();
    expectedRole = map.get(user.plan_code) || 'free';
  }

  // المدير لا يحتاج ملفاً بحثياً، فيبدأ الخطوة مكتملة
  const completeOnboarding = isAdmin && !user.onboarding_complete;
  if (user.role === expectedRole && !completeOnboarding) return user;

  try {
    const { rows } = await pool.query(
      `UPDATE users
          SET role = $1,
              onboarding_complete = onboarding_complete OR $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [expectedRole, completeOnboarding, user.id]
    );
    return rows[0] || user;
  } catch (error) {
    console.warn(`تعذّر تحديث صلاحية المستخدم: ${error.code || error.message}`);
    return user;
  }
}

/** مستخدم واحد بالمعرّف (تُستخدم عند تحميل الجلسة). */
export async function getUserById(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

/** الملف البحثي للمستخدم (إن لم يُكمل التسجيل بعد يعود null). */
export async function getProfile(userId) {
  const { rows } = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

/**
 * حفظ الملف البحثي في نهاية خطوة التسجيل (onboarding):
 * upsert في جدول profiles + تعليم المستخدم بأنه أكمل ملفه.
 */
export async function saveOnboarding(userId, data) {
  const values = [
    userId,
    data.full_name || '',
    data.research_field || '',
    data.research_title || '',
    data.degree_level || 'bachelor',
    data.academic_year || '',
    data.university || '',
    data.faculty || '',
    data.research_interests || '',
    data.preferred_language || 'ar',
    data.about || '',
    data.research_stage || 'topic',
    data.methodology || '',
    data.citation_style || 'apa7'
  ];

  const { rows } = await pool.query(
    `INSERT INTO profiles (user_id, full_name, research_field, research_title, degree_level,
                           academic_year, university, faculty, research_interests,
                           preferred_language, about, research_stage, methodology, citation_style,
                           created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       research_field = EXCLUDED.research_field,
       research_title = EXCLUDED.research_title,
       degree_level = EXCLUDED.degree_level,
       academic_year = EXCLUDED.academic_year,
       university = EXCLUDED.university,
       faculty = EXCLUDED.faculty,
       research_interests = EXCLUDED.research_interests,
       preferred_language = EXCLUDED.preferred_language,
       about = EXCLUDED.about,
       research_stage = EXCLUDED.research_stage,
       methodology = EXCLUDED.methodology,
       citation_style = EXCLUDED.citation_style,
       updated_at = NOW()
     RETURNING *`,
    values
  );

  await pool.query(
    `UPDATE users
        SET onboarding_complete = true,
            full_name = COALESCE(NULLIF($2, ''), full_name),
            updated_at = NOW()
      WHERE id = $1`,
    [userId, data.full_name || '']
  );

  return rows[0];
}

/** ملخص استهلاك المستخدم لصفحة الحساب (آخر العمليات + الإجماليات). */
export async function getUsageOverview(userId, limit = 8) {
  try {
    const [totals, recent] = await Promise.all([
      pool.query(
        'SELECT count(*)::int AS events, COALESCE(SUM(tokens_used), 0)::int AS tokens FROM usage_logs WHERE user_id = $1',
        [userId]
      ),
      pool.query(
        `SELECT type, tokens_used, summary, created_at
           FROM usage_logs
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, limit]
      )
    ]);

    return { events: totals.rows[0]?.events ?? 0, tokens: totals.rows[0]?.tokens ?? 0, recent: recent.rows };
  } catch (error) {
    console.warn(`تعذّرت قراءة سجل الاستهلاك: ${error.code || error.message}`);
    return { events: 0, tokens: 0, recent: [] };
  }
}

