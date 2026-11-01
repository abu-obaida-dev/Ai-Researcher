import { readSessionCookie, verifySessionCookie } from '../auth/google.js';
import { getUserById, syncUserRole } from '../services/users.js';
import { can, permissionsFor, servicesFor } from '../services/access.js';
import { PLATFORM_SERVICES } from '../constants.js';
import { renderServiceNotice } from '../views/layout.js';

/** Loads the signed user session and account permissions for each request. */
export async function attachAccount(req, _res, next) {
  req.account = null;

  const payload = verifySessionCookie(readSessionCookie(req));
  if (!payload) {
    next();
    return;
  }

  try {
    const user = await getUserById(payload.uid);
    // Suspended or deleted accounts cannot open a session.
    if (user && user.is_active !== false && user.deleted !== true) {
      const account = await syncUserRole(user);
      req.account = {
        ...account,
        services: await loadServices(account),
        adminPermissions: await loadAdminPermissions(account)
      };
    }
  } catch (error) {
    // Public pages remain available if the account lookup fails.
    console.warn(`تعذّر تحميل حساب الجلسة: ${error.code || error.message}`);
  }

  next();
}

/** Returns the account's enabled services, defaulting to all if unavailable. */
async function loadServices(account) {
  try {
    const list = await servicesFor(account);
    return list.map((item) => ({ ...item, enabled: item.enabled }));
  } catch (error) {
    console.warn(`تعذّر حساب خدمات الحساب: ${error.code || error.message}`);
    return PLATFORM_SERVICES.map((item) => ({ ...item, enabled: true, reason: '' }));
  }
}

/** Loads admin permissions once so each page can filter its sidebar. */
async function loadAdminPermissions(account) {
  if (!account || account.role === 'admin') return ['*'];

  try {
    const permissions = await permissionsFor(account);
    return [...permissions];
  } catch (error) {
    console.warn(`تعذّر حساب صلاحيات اللوحة: ${error.code || error.message}`);
    return [];
  }
}

/** Requires authentication and preserves the requested destination. */
export function requireAccount(req, res, next) {
  if (req.account) {
    next();
    return;
  }

  const wantsJson = String(req.get?.('accept') || '').includes('application/json');
  if (wantsJson) {
    res.status(401).json({ ok: false, error: { code: 'auth', message: 'سجّل الدخول أولاً.' } });
    return;
  }
  res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
}

/** Enforces plan- and role-based access to protected services. */
export function requireService(serviceKey) {
  const service = PLATFORM_SERVICES.find((item) => item.key === serviceKey);

  return async (req, res, next) => {
    if (!req.account) {
      res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
      return;
    }

    let allowed = false;
    try {
      allowed = await can(req.account, service?.permission || serviceKey);
    } catch (error) {
      // Fail closed on permission lookup errors; administrators bypass service gates.
      console.warn(`تعذّر التحقق من خدمة ${serviceKey}: ${error.code || error.message}`);
      allowed = req.account.role === 'admin';
    }

    if (allowed) {
      next();
      return;
    }

    const label = service?.label || 'هذه الخدمة';
    let services = [];
    try {
      services = await servicesFor(req.account);
    } catch {
      services = [];
    }
    const { html } = renderServiceNotice({ service: label, account: req.account, services });
    res.status(403).type('html').send(html);
  };
}

/** Selects the post-login destination. */
export function homePathFor(account) {
  if (!account) return '/login';
  if (account.role === 'admin' || hasPanelAccess(account)) return '/admin';
  return account.onboarding_complete ? '/dashboard' : '/onboarding';
}

/** Checks whether an account may access the admin panel. */
function hasPanelAccess(account) {
  return (
    Array.isArray(account?.adminPermissions) &&
    (account.adminPermissions.includes('*') || account.adminPermissions.includes('admin:panel'))
  );
}

/** Checks whether the user must complete onboarding. */
export function needsOnboarding(account) {
  if (!account) return false;
  if (account.role === 'admin' || hasPanelAccess(account)) return false;
  return account.onboarding_complete !== true;
}

/** Requires core research-profile fields only for context-dependent actions. */
export function requireCoreOnboarding(req, res, next) {
  // Return JSON to fetch callers instead of redirecting.
  const wantsJson = String(req.get?.('accept') || '').includes('application/json');

  if (!req.account) {
    if (wantsJson) {
      res.status(401).json({ ok: false, error: { code: 'auth', message: 'سجّل الدخول أولاً.' } });
      return;
    }
    res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
    return;
  }
  if (needsOnboarding(req.account)) {
    if (wantsJson) {
      res.status(403).json({
        ok: false,
        error: { code: 'onboarding', message: 'أكمل ملفك البحثي أولاً (المرحلة والتخصص والهدف الحالي).' }
      });
      return;
    }
    res.redirect(302, `/onboarding?next=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
    return;
  }
  next();
}
