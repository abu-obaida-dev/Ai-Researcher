import { pool } from '../db/client.js';
import { DEFAULT_ROLES, PLATFORM_SERVICES } from '../constants.js';

/** Resolves service access from administrator, supervisor, and plan roles. */

const ROLE_CACHE_TTL_MS = 30000;
let cache = { at: 0, roles: new Map(), planRoles: new Map() };

/** Short-lived cache for role permissions. */
function cached(getter) {
  const now = Date.now();
  if (now - cache.at > ROLE_CACHE_TTL_MS) {
    cache = { at: now, roles: new Map(), planRoles: new Map() };
  }
  return getter();
}

/** Clears cached permissions after role or plan changes. */
export function clearAccessCache() {
  cache = { at: 0, roles: new Map(), planRoles: new Map() };
}

/** Loads role permissions with DEFAULT_ROLES as a fallback. */
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

    // Keep defaults available before database seeding.
    if (!permissions || permissions.size === 0) {
      const fallback = DEFAULT_ROLES.find((item) => item.code === role);
      permissions = new Set(fallback?.permissions || ['dashboard:view', 'chat:use']);
    }

    cache.roles.set(role, permissions);
    return permissions;
  });
}

/** Loads permissions for multiple roles and returns a role-to-permissions map. */
export async function permissionsForRoles(codes) {
  const unique = [...new Set((Array.isArray(codes) ? codes : [codes]).map((code) => String(code || '').trim()))].filter(
    Boolean
  );

  const entries = await Promise.all(unique.map(async (role) => [role, await permissionsOfRole(role)]));
  return new Map(entries);
}

/** Loads stored permissions without defaults for admin editing. */
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

/** Returns role codes available for assignment. */
export async function roleExists(code) {
  const role = String(code || '').trim();
  if (!role) return false;
  const { rows } = await pool.query('SELECT code FROM roles WHERE code = $1', [role]);
  return rows.length > 0;
}

/** Adds a role permission; wildcard permissions are reserved for administrators. */
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

/** Removes a role permission; wildcard permissions are protected. */
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

/** Resolves the role assigned to a plan. */
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

    // Fall back to the default plan order.
    if (!cache.planRoles.size) {
      ['free_trial', 'student', 'researcher', 'thesis'].forEach((code, index) => {
        cache.planRoles.set(code, ['free', 'student', 'researcher', 'thesis'][index]);
      });
    }

    return cache.planRoles;
  });
}
/** Checks whether an email belongs to an academic supervisor. */
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

/** Lists registered supervisors for the settings page. */
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

/** Adds a supervisor email. */
export async function addSupervisor(email, addedBy = 'لوحة الإدارة') {
  const normalized = String(email || '').trim().toLowerCase().slice(0, 255);
  await pool.query(
    'INSERT INTO supervisors (email, added_by, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (email) DO NOTHING',
    [normalized, String(addedBy || '').slice(0, 255)]
  );

  // Update the role immediately when the account already exists.
  await pool.query(
    "UPDATE users SET role = 'supervisor', updated_at = NOW() WHERE lower(email) = $1 AND role <> 'admin'",
    [normalized]
  );

  clearAccessCache();
  return normalized;
}

/** Resolves the synchronized account role, falling back to the plan role. */
export async function resolveRole(account) {
  if (!account) return null;
  if (account.role === 'admin') return 'admin';
  if (account.role === 'supervisor') return 'supervisor';

  const map = await planRoles();
  return map.get(account.plan_code) || (account.plan_code ? 'free' : 'researcher');
}

/** Returns account permissions; administrators receive the wildcard permission. */
export async function permissionsFor(account) {
  if (!account) return new Set();
  if (account.role === 'admin') return new Set(['*']);

  return permissionsOfRole(await resolveRole(account));
}

/** Checks whether an account has a permission or service. */
export async function can(account, permission) {
  const permissions = await permissionsFor(account);
  return permissions.has('*') || permissions.has(permission);
}

/** Returns available services and closure reasons for navigation and access gates. */
export async function servicesFor(account) {
  const permissions = await permissionsFor(account);
  const allowed = (service) =>
    service.always || permissions.has('*') || permissions.has(service.permission);

  return PLATFORM_SERVICES.map((service) => ({
    ...service,
    enabled: allowed(service),
    // Include a user-visible reason when the role does not grant a service.
    reason: allowed(service) ? '' : `غير متاحة في باقتك الحالية — دور باقتك لا يسمح بـ ${service.label}.`
  }));
}

/** Returns the keys of enabled services. */
export async function enabledServiceKeys(account) {
  const list = await servicesFor(account);
  return list.filter((item) => item.enabled).map((item) => item.key);
}

/** Removes a supervisor and restores the account's plan role. */
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