import { pool } from '../db/client.js';
import { DEFAULT_ROLES, PLATFORM_SERVICES } from '../constants.js';

/**
 * خدمة الوصول واحدة لكل المنصة (خدمات × باقات × أدوار):
 *
 *   1) الدور: مدير (ADMIN_EMAILS في .env) ← مشرف (جدول supervisors) ← دور الباقة.
 *   2) الصلاحيات: من جدولي roles + role_permissions مع سقوط آمن إلى DEFAULT_ROLES.
 *   3) الخدمات: كل خدمة في PLATFORM_SERVICES لها صلاحية واحدة، فمفتوحة إن امتلك
 *      الدور صلاحيتها. الدردشة (chat:use) متاحة لكل الباقات بمجرد التسجيل.
 *
 * لا شيء هنا ثابت في الكود: المدير يضبط الخدمات من «الأدوار والصلاحيات» والباقات
 * تربط الباحثين بدور من «الباقات»، والتغيير يسري في الطلب التالي مباشرةً.
 */

const ROLE_CACHE_TTL_MS = 30000;
let cache = { at: 0, roles: new Map(), planRoles: new Map() };

/** ذاكرة قصيرة للصلاحيات (استعلامان سريعان بدل استعلام لكل رابط). */
function cached(getter) {
  const now = Date.now();
  if (now - cache.at > ROLE_CACHE_TTL_MS) {
    cache = { at: now, roles: new Map(), planRoles: new Map() };
  }
  return getter();
}

/** إعادة بناء الذاكرة (بعد تعديل الأدوار أو الباقات من اللوحة). */
export function clearAccessCache() {
  cache = { at: 0, roles: new Map(), planRoles: new Map() };
}

/** صلاحيات دور من قاعدة البيانات، مع DEFAULT_ROLES كسقوط آمن. */
async function permissionsOfRole(code) {
  return cached(async () => {
    const role = String(code || '').trim();
    if (!role) return new Set(['dashboard:view', 'chat:use']);
    if (cache.roles.has(role)) return cache.roles.get(role);

    let permissions = null;
    try {
      const { rows } = await pool.query('SELECT permission FROM role_permissions WHERE role_code = $1', [role]);
      permissions = new Set(rows.map((row) => row.permission));
    } catch (error) {
      console.warn(`تعذّرت قراءة صلاحيات الدور ${role}: ${error.code || error.message}`);
    }

    // لا صف في الجدول ⇒ نستخدم الافتراضي (النظام يعمل قبل تشغيل db:seed)
    if (!permissions || permissions.size === 0) {
      const fallback = DEFAULT_ROLES.find((item) => item.code === role);
      permissions = new Set(fallback?.permissions || ['dashboard:view', 'chat:use']);
    }

    cache.roles.set(role, permissions);
    return permissions;
  });
}

/**
 * صلاحيات عدة أدوار دفعة واحدة — تُستخدم في صفحة الباقات العامة لتوليد
 * قائمة مزايا كل باقة من صلاحيات دورها الحقيقي (استعلام لكل دور مع كاش 30 ثانية).
 * يعيد Map: roleCode → Set<permission>.
 */
export async function permissionsForRoles(codes) {
  const unique = [...new Set((Array.isArray(codes) ? codes : [codes]).map((code) => String(code || '').trim()))].filter(
    Boolean
  );

  const entries = await Promise.all(unique.map(async (role) => [role, await permissionsOfRole(role)]));
  return new Map(entries);
}

/**
 * صلاحيات دور كما هي محفوظة (بلا كاش وبلا سقوط افتراضي) — لعرضها في
 * لوحة الإدارة قبل التعديل (الباقات · صلاحيات المشرفين).
 */
export async function storedPermissionsOfRole(code) {
  const role = String(code || '').trim();
  if (!role) return [];
  try {
    const { rows } = await pool.query(
      'SELECT permission FROM role_permissions WHERE role_code = $1 ORDER BY permission',
      [role]
    );
    return rows.map((row) => row.permission);
  } catch (error) {
    console.warn(`تعذّرت قراءة صلاحيات الدور ${role}: ${error.code || error.message}`);
    return [];
  }
}

/** أسماء أدوار النظام التي قد تُستعمل كوجهة للتعديل. */
export async function roleExists(code) {
  const role = String(code || '').trim();
  if (!role) return false;
  const { rows } = await pool.query('SELECT code FROM roles WHERE code = $1', [role]);
  return rows.length > 0;
}

/**
 * إضافة صلاحية لدور. تُستدعى من **صفحة الباقات** (صلاحيات الخدمات التي تمنحها
 * الباقة لمشتركيها) ومن **صفحة الإعدادات** (صلاحيات دور المشرف) — فالمنطق واحد.
 * الصلاحية `*` (كل الصلاحيات) حماية لدور المدير فلا تُضاف ولا تُحذف.
 */
export async function addRolePermission(code, permission) {
  const role = String(code || '').trim();
  const value = String(permission || '').trim();

  if (!(await roleExists(role))) return { ok: false, error: 'هذا الدور غير موجود.' };
  if (!/^[a-z][a-z0-9]*:[a-z][a-z0-9_-]*$/i.test(value)) {
    return { ok: false, error: 'صلاحية غير صالحة — مثال: notes:use' };
  }
  if (value === '*') return { ok: false, error: 'صلاحية «*» محمية لدور المدير.' };

  await pool.query(
    'INSERT INTO role_permissions (role_code, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [role, value]
  );
  clearAccessCache();
  return { ok: true, role, permission: value };
}

/** حذف صلاحية من دور — نفس الاستعمال، و«*» محمية. */
export async function removeRolePermission(code, permission) {
  const role = String(code || '').trim();
  const value = String(permission || '').trim();

  if (value === '*') return { ok: false, error: 'صلاحية «*» محمية لدور المدير.' };

  const result = await pool.query(
    'DELETE FROM role_permissions WHERE role_code = $1 AND permission = $2',
    [role, value]
  );
  clearAccessCache();
  if (!result.rowCount) return { ok: false, error: 'الصلاحية غير موجودة أصلاً في هذا الدور.' };
  return { ok: true, role, permission: value };
}

/** دور كل باقة: plans.role_code (يربط الباقة بدور من جدول الأدوار). */
export async function planRoles() {
  return cached(async () => {
    if (cache.planRoles.size) return cache.planRoles;

    try {
      const { rows } = await pool.query('SELECT code, role_code FROM plans');
      for (const row of rows) {
        cache.planRoles.set(row.code, row.role_code || null);
      }
    } catch (error) {
      console.warn(`تعذّرت قراءة أدوار الباقات: ${error.code || error.message}`);
    }

    // سقوط آمن: ترتيب الباقات في الثوابت
    if (!cache.planRoles.size) {
      ['free_trial', 'student', 'researcher', 'thesis'].forEach((code, index) => {
        cache.planRoles.set(code, ['free', 'student', 'researcher', 'thesis'][index]);
      });
    }

    return cache.planRoles;
  });
}
/** هل هذا البريد مشرف أكاديمي (جدول supervisors)؟ */
export async function isSupervisorEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;

  try {
    const { rowCount } = await pool.query('SELECT 1 FROM supervisors WHERE lower(email) = $1', [normalized]);
    return rowCount > 0;
  } catch {
    return false;
  }
}

/** المشرفون المسجّلون في المنصة (لصفحة الإعدادات). */
export async function listSupervisors() {
  try {
    const { rows } = await pool.query(
      `SELECT s.email, s.added_by, s.created_at,
              u.full_name, u.updated_at, u.is_active, u.plan_code
         FROM supervisors s
         LEFT JOIN users u ON lower(u.email) = lower(s.email)
        ORDER BY s.created_at DESC`
    );
    return rows;
  } catch (error) {
    console.warn(`تعذّرت قراءة المشرفين: ${error.code || error.message}`);
    return [];
  }
}

/** إضافة مشرف بريده (يصبح دوره supervisor في طلبه القادم). */
export async function addSupervisor(email, addedBy = 'لوحة الإدارة') {
  const normalized = String(email || '').trim().toLowerCase().slice(0, 255);
  await pool.query(
    'INSERT INTO supervisors (email, added_by, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (email) DO NOTHING',
    [normalized, String(addedBy || '').slice(0, 255)]
  );

  // إن كان الحساب موجوداً بالفعل نحدّث دوره فوراً بلا انتظار الدخول
  await pool.query(
    "UPDATE users SET role = 'supervisor', updated_at = NOW() WHERE lower(email) = $1 AND role <> 'admin'",
    [normalized]
  );

  clearAccessCache();
  return normalized;
}

/**
 * دور الحساب: ما هو مكتوب في users.role بعد المزامنة، وإلا دور باقته.
 * حساب بلا باقة (بيانات قديمة أو حساب جديد لم تُضبط باقته) ⇒ دور «باحث»
 * حتى لا تُقفل خدمات المنصة عليه فجأة؛ أما من له باقة فدورها هو الفيصل.
 */
export async function resolveRole(account) {
  if (!account) return null;
  if (account.role === 'admin') return 'admin';
  if (account.role === 'supervisor') return 'supervisor';

  const map = await planRoles();
  return map.get(account.plan_code) || (account.plan_code ? 'free' : 'researcher');
}

/** صلاحيات الحساب. المدير يملك '*' فكل شيء مفتوح له. */
export async function permissionsFor(account) {
  if (!account) return new Set();
  if (account.role === 'admin') return new Set(['*']);

  return permissionsOfRole(await resolveRole(account));
}

/** هل الحساب يملك صلاحية (أو خدمة) محددة؟ */
export async function can(account, permission) {
  const permissions = await permissionsFor(account);
  return permissions.has('*') || permissions.has(permission);
}

/**
 * خدمات الحساب المفتوحة: مصفوفة خدمات من PLATFORM_SERVICES مع enabled + سبب الإغلاق.
 * تُستخدم في السايدبار وفي صفحة الحساب وفي بوابة المسارات.
 */
export async function servicesFor(account) {
  const permissions = await permissionsFor(account);
  const allowed = (service) => permissions.has('*') || permissions.has(service.permission);

  return PLATFORM_SERVICES.map((service) => ({
    ...service,
    enabled: allowed(service),
    // سبب الإغلاق يظهر للباحث: خدمته ليست ضمن صلاحيات دور باقته
    reason: allowed(service) ? '' : `غير متاحة في باقتك الحالية — دور باقتك لا يسمح بـ ${service.label}.`
  }));
}

/** مفاتيح الخدمات المفتوحة (للسايدبار والفحوص). */
export async function enabledServiceKeys(account) {
  const list = await servicesFor(account);
  return list.filter((item) => item.enabled).map((item) => item.key);
}

/** إزالة مشرف (يعود دوره إلى دور باقته). */
export async function removeSupervisor(email) {
  const normalized = String(email || '').trim().toLowerCase().slice(0, 255);
  const { rowCount } = await pool.query('DELETE FROM supervisors WHERE lower(email) = $1', [normalized]);
  await pool.query(
    "UPDATE users SET role = 'researcher', updated_at = NOW() WHERE lower(email) = $1 AND role = 'supervisor'",
    [normalized]
  );
  clearAccessCache();
  return rowCount > 0;
}