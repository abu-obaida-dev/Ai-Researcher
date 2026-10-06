import { readSessionCookie, verifySessionCookie } from '../auth/google.js';
import { getUserById, syncUserRole } from '../services/users.js';
import { can, permissionsFor, servicesFor } from '../services/access.js';
import { PLATFORM_SERVICES } from '../constants.js';
import { renderServiceNotice } from '../views/layout.js';

/**
 * جلسة المستخدم: كوكي موقّع (HMAC) يحتوي معرّف الحساب، والبيانات نفسها في PostgreSQL.
 * يُثبَّت هذا الوسيط قبل كل المسارات في server.js فيصبح req.account متاحاً للجميع.
 *
 * يُحمَّل معه services = الخدمات المفتوحة لهذا الحساب (حسب دور باقته أو دور المشرف)
 * مرة واحدة لكل طلب، فالسايدبار والصفحات تعرض المتاح فقط بلا استعلام إضافي.
 */
export async function attachAccount(req, _res, next) {
  req.account = null;

  const payload = verifySessionCookie(readSessionCookie(req));
  if (!payload) {
    next();
    return;
  }

  try {
    const user = await getUserById(payload.uid);
    // الحسابات الموقوفة أو المحذوفة لا تُفتح لها جلسة
    if (user && user.is_active !== false && user.deleted !== true) {
      const account = await syncUserRole(user);
      req.account = {
        ...account,
        services: await loadServices(account),
        adminPermissions: await loadAdminPermissions(account)
      };
    }
  } catch (error) {
    // الصفحات العامة تظل تعمل حتى لو تعذّرت قراءة الحساب من قاعدة البيانات
    console.warn(`تعذّر تحميل حساب الجلسة: ${error.code || error.message}`);
  }

  next();
}

/** الخدمات المفتوحة للحساب، وكلها مفتوحة احتياطاً لو تعذّرت القراءة. */
async function loadServices(account) {
  try {
    const list = await servicesFor(account);
    return list.map((item) => ({ ...item, enabled: item.enabled }));
  } catch (error) {
    console.warn(`تعذّر حساب خدمات الحساب: ${error.code || error.message}`);
    return PLATFORM_SERVICES.map((item) => ({ ...item, enabled: true, reason: '' }));
  }
}

/**
 * صلاحيات اللوحة للحساب: المدير كل الصلاحيات، والمشرف ما أعطاه المدير فقط.
 * تُحمَّل مع الحساب لتصفية سايدبار الإدارة بلا استعلام إضافي لكل صفحة.
 */
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

/** يحمي الصفحات التي تتطلب تسجيل دخول ويعيد الزائر إلى صفحة الدخول مع المسار المطلوب. */
export function requireAccount(req, res, next) {
  if (req.account) {
    next();
    return;
  }

  res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
}

/**
 * بوابة الخدمات: تمنع فتح صفحة خدمة لا تسمح بها صلاحيات دور الحساب
 * (دور الباقة أو دور المشرف) — وتعرض صفحة عربية تشرح الخدمة والباقة المطلوبة.
 * تُستخدم في /references (المكتبة) و /notes (المفكرة) و /files (الملفات)
 * و /defense (المناقشة) و /journey (مسار البحث).
 * /chat خارج هذه البوابة قصداً (الشات متاح لكل الباقات بمجرد التسجيل) — حمايته
 * من بوابة الملف الجزئية requireCoreOnboarding على الإرسال فقط (قراءة مفتوحة).
 */
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
      // الفشل يُغلق الباب (fail-closed): لا نفتح خدمةً مقفولة لأحد بسبب خطأ قراءة مؤقت.
      // الاستثناء الوحيد المدير: دوره فوق كل البوابات فلا فحص أصلاً.
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

/** الصفحة التي ينتهي إليها الحساب بعد الدخول: لوحة الإدارة (للمدير/المشرف)، أو الملف، أو الإحصائية. */
export function homePathFor(account) {
  if (!account) return '/login';
  if (account.role === 'admin' || hasPanelAccess(account)) return '/admin';
  return account.onboarding_complete ? '/dashboard' : '/onboarding';
}

/** دخول لوحة الإدارة متاح للمدير، وللمشرف الحامل صلاحية admin:panel. */
function hasPanelAccess(account) {
  return (
    Array.isArray(account?.adminPermissions) &&
    (account.adminPermissions.includes('*') || account.adminPermissions.includes('admin:panel'))
  );
}

/** هل يحتاج الحساب لإكمال ملفه البحثي؟ (المدير لا يحتاج) */
export function needsOnboarding(account) {
  if (!account) return false;
  if (account.role === 'admin' || hasPanelAccess(account)) return false;
  return account.onboarding_complete !== true;
}

/**
 * البوابة الجزئية التدريجية: الملف الأكاديمي نقطة بداية ضرورية للإشراف
 * المخصص — لا حاجزاً على كل النظام.
 *
 * القاعدة: الوظائف التي تحتاج سياقاً بحثياً (الشات/المراجع/مسار البحث/المناقشة)
 * تتطلب إكمال الأساسيات الثلاث (المرحلة الأكاديمية + التخصص + الهدف الحالي).
 * من لم يكملها يُحوَّل إلى /onboarding مع حفظ وجهته (?next=) ليعود بعد الإكمال.
 * القراءة العامة (لوحة الباحث/الحساب/الدفع) تبقى مفتوحة دائماً.
 */
export function requireCoreOnboarding(req, res, next) {
  if (!req.account) {
    res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
    return;
  }
  if (needsOnboarding(req.account)) {
    res.redirect(302, `/onboarding?next=${encodeURIComponent(req.originalUrl || '/dashboard')}`);
    return;
  }
  next();
}
