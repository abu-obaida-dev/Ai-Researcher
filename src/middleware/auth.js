import { readSessionCookie, verifySessionCookie } from '../auth/google.js';
import { getUserById, syncUserRole } from '../services/users.js';

/**
 * جلسة المستخدم: كوكي موقّع (HMAC) يحتوي معرّف الحساب، والبيانات نفسها في PostgreSQL.
 * يُثبَّت هذا الوسيط قبل كل المسارات في server.js فيصبح req.account متاحاً للجميع.
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
      req.account = await syncUserRole(user);
    }
  } catch (error) {
    // الصفحات العامة تظل تعمل حتى لو تعذّرت قراءة الحساب من قاعدة البيانات
    console.warn(`تعذّر تحميل حساب الجلسة: ${error.code || error.message}`);
  }

  next();
}

/** يحمي الصفحات التي تتطلب تسجيل دخول ويعيد الزائر إلى صفحة الدخول مع المسار المطلوب. */
export function requireAccount(req, res, next) {
  if (req.account) {
    next();
    return;
  }

  res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || '/account')}`);
}

/** الصفحة التي ينتهي إليها الحساب بعد الدخول: لوحة المدير، أو إكمال الملف، أو الحساب. */
export function homePathFor(account) {
  if (!account) return '/login';
  if (account.role === 'admin') return '/admin';
  return account.onboarding_complete ? '/account' : '/onboarding';
}

/** هل يحتاج الحساب لإكمال ملفه البحثي؟ (المدير لا يحتاج) */
export function needsOnboarding(account) {
  if (!account) return false;
  if (account.role === 'admin') return false;
  return account.onboarding_complete !== true;
}
