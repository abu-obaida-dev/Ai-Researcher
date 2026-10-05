import express from 'express';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  buildGoogleAuthUrl,
  createSessionCookie,
  exchangeCodeForTokens,
  fetchGoogleProfile,
  isGoogleAuthConfigured,
  newOAuthState
} from '../auth/google.js';
import { rateLimit } from '../middleware/security.js';
import {
  ACADEMIC_YEARS,
  CITATION_STYLES,
  DEGREE_LEVELS,
  FREE_PLAN_CODE,
  GOAL_OPTIONS,
  PREFERRED_LANGUAGES,
  PROGRESS_LEVELS,
  RESEARCH_STAGES,
  SPECIALIZATIONS,
  UNIVERSITIES
} from '../constants.js';
import { homePathFor, requireAccount } from '../middleware/auth.js';
import { getJourneySummary } from '../services/journey.js';
import { getDashboardStats } from '../services/dashboard.js';
import { freeTrialTokens, getPlanByCode } from '../services/plans.js';
import { ensureUserFromGoogle, getProfile, getUsageOverview, saveOnboarding } from '../services/users.js';
import { notifyUser, unreadCount } from '../services/notifications.js';
import { renderAccountPage, renderAuthNotice, renderDashboardPage, renderLoginPage, renderOnboardingPage } from '../views/auth.js';

/**
 * صفحات المصادقة والحساب:
 * - /login          صفحة الدخول (زر جوجل)
 * - /auth/google    بدء دخول جوجل (OAuth 2.0 code flow)
 * - /auth/google/callback  معالجة العودة: تحقق من الـ state ثم إنشاء/تحديث المستخدم في PostgreSQL
 * - /logout         إنهاء الجلسة
 * - /onboarding     إكمال/تعديل الملف البحثي داخل لوحة الباحث (area:'app' + سايدبار)
 * - /account        صفحة الحساب والرصيد داخل لوحة الباحث (area:'app' + سايدبار)
 * - /dashboard      الصفحة الرئيسية للوحة الباحث: الإحصائية (الرصيد + الباقة + آخر العمليات + روابط سريعة)
 */

const router = express.Router();
const COOKIE_PATH = '/';
const STATE_TTL_MS = 10 * 60 * 1000;

/** رسائل أخطاء الدخول المعروضة — تُمرَّر بالكود فقط لمنع أي حقن في الصفحة. */
const LOGIN_ERRORS = {
  denied: 'تم إلغاء تسجيل الدخول من نافذة جوجل.',
  state: 'انتهت صلاحية محاولة الدخول، أعد المحاولة من جديد.',
  google: 'تعذّر إكمال الدخول من جوجل، حاول مرة أخرى.',
  email: 'حساب جوجل هذا لا يحتوي بريداً إلكترونياً صالحاً.',
  config: 'الدخول بحساب جوجل غير مُفعّل على هذا الخادم بعد.'
};

/** يضبط كوكي httpOnly مع عمر محدّد (تُستخدم للجلسة وحالة OAuth). */
function setCookie(res, name, value, { maxAgeMs } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${COOKIE_PATH}`, 'SameSite=Lax', 'HttpOnly'];
  if (maxAgeMs) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** يحذف كوكي من المتصفح. */
function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=${COOKIE_PATH}; Max-Age=0; SameSite=Lax; HttpOnly`);
}

/** يقرأ كوكي معيّنة من ترويسة الطلب. */
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return '';
}

/** يقبل المسارات الداخلية فقط في ?next= (منع إعادة التوجيه المفتوحة). */
function safeNextPath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw.slice(0, 300);
}

/** الصفحة الرئيسية أو المسار المطلوب بعد الدخول. */
function redirectAfterLogin(res, user, nextPath) {
  const target = nextPath && !nextPath.startsWith('/login') ? nextPath : homePathFor(user);
  res.redirect(302, target);
}

/** صفحة الدخول — إن وُجدت جلسة فعّالة تُحوَّل مباشرة إلى الحساب. */
router.get('/login', rateLimit('login_page', { limit: 60, windowMs: 5 * 60 * 1000 }), async (req, res) => {
  if (req.account) {
    res.redirect(302, homePathFor(req.account));
    return;
  }

  const freeTokens = await freeTrialTokens();
  const errorCode = String(req.query.error || '');
  const googleReady = isGoogleAuthConfigured();

  res.type('html').send(
    renderLoginPage({
      freeTokens,
      next: safeNextPath(req.query.next),
      googleReady,
      error: errorCode ? LOGIN_ERRORS[errorCode] || LOGIN_ERRORS.google : ''
    })
  );
});

/** بدء دخول جوجل: state عشوائي في كوكي قصير العمر + تحويل إلى شاشة جوجل. */
router.get('/auth/google', rateLimit('oauth_start', { limit: 20, windowMs: 5 * 60 * 1000 }), (req, res) => {
  if (!isGoogleAuthConfigured()) {
    res.status(503).type('html').send(
      renderAuthNotice({
        title: 'الدخول بحساب جوجل غير مُفعّل',
        message: 'أضف بيانات تطبيق OAuth في ملف .env ثم أعد تشغيل الخادم لتفعيل الدخول.',
        details:
          '<b>الخطوات:</b><ol><li>أنشئ OAuth Client ID (Web application) في Google Cloud Console.</li>' +
          '<li>سجّل عنوان العودة <code>/auth/google/callback</code> على نطاق الموقع.</li>' +
          '<li>ضع <code>GOOGLE_CLIENT_ID</code> و<code>GOOGLE_CLIENT_SECRET</code> في <code>.env</code>.</li></ol>'
      })
    );
    return;
  }

  const state = newOAuthState();
  // نحتفظ بالمسار المطلوب داخل كوكي الحالة حتى نُكمل التوجيه بعد العودة من جوجل
  setCookie(res, OAUTH_STATE_COOKIE, `${state}|${safeNextPath(req.query.next)}`, { maxAgeMs: STATE_TTL_MS });
  res.redirect(302, buildGoogleAuthUrl(req, state));
});

/** العودة من جوجل: تحقق من الحالة، ثم إنشاء/تحديث المستخدم في PostgreSQL وفتح جلسة. */
router.get('/auth/google/callback', rateLimit('oauth_callback', { limit: 30, windowMs: 5 * 60 * 1000 }), async (req, res) => {
  const [expectedState, nextPath = ''] = readCookie(req, OAUTH_STATE_COOKIE).split('|');
  clearCookie(res, OAUTH_STATE_COOKIE);

  if (req.query.error) {
    res.redirect(302, '/login?error=denied');
    return;
  }

  const state = String(req.query.state || '');
  const code = String(req.query.code || '');

  if (!code || !state || !expectedState || state !== expectedState) {
    res.redirect(302, '/login?error=state');
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, req);
    const googleProfile = await fetchGoogleProfile(tokens.access_token);
    const user = await ensureUserFromGoogle(googleProfile);

    // إشعار ترحيبي لأي حساب جديد — يُحفظ داخل الموقع فوراً، وpush لو كان هاتفه مفعّلاً
    if (user.is_new) {
      notifyUser(user.id, {
        title: 'أهلاً بك في Zena AI',
        body: `رصيدك الترحيبي ${user.tokens_granted} نقطة — أكمل ملفك البحثي وابدأ مع المشرف الذكي.`,
        kind: 'welcome',
        url: user.onboarding_complete ? '/dashboard' : '/onboarding'
      }).catch(() => {});
    }

    setCookie(res, SESSION_COOKIE_NAME, createSessionCookie(user), { maxAgeMs: SESSION_TTL_MS });
    redirectAfterLogin(res, user, nextPath);
  } catch (error) {
    console.error('فشل الدخول بحساب جوجل:', error.message);
    res.redirect(302, `/login?error=${/بريد/.test(error.message) ? 'email' : 'google'}`);
  }
});

/** إنهاء الجلسة والعودة للصفحة الرئيسية. */
router.get('/logout', (_req, res) => {
  clearCookie(res, SESSION_COOKIE_NAME);
  res.redirect(302, '/');
});

/** قيم نموذج التسجيل: الملف المحفوظ إن وُجد، ثم القيم الافتراضية. */
function onboardingValues(profile) {
  const knownFields = SPECIALIZATIONS.filter((item) => item !== 'أخرى');
  const field = profile?.research_field || '';
  const isCustom = Boolean(field) && !knownFields.includes(field);

  return {
    degree_level: profile?.degree_level || 'bachelor',
    research_field: isCustom ? 'أخرى' : field || 'أخرى',
    custom_field: isCustom ? field : '',
    research_stage: profile?.research_stage || 'topic',
    progress_stage: profile?.research_stage || 'topic',
    university: profile?.university || '',
    faculty: profile?.faculty || '',
    academic_year: profile?.academic_year || '',
    preferred_language: profile?.preferred_language || 'ar',
    citation_style: profile?.citation_style || 'apa7',
    research_title: profile?.research_title || ''
  };
}

/** يقرأ قيم النموذج القادمة من POST بشكل محدود وآمن (لا تُقبل أي قيمة خارج القوائم). */
function readValues(body) {
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

  return {
    degree_level: pick(body.degree_level, DEGREE_LEVELS.map((item) => item.value), 'bachelor'),
    research_field: pick(body.research_field, SPECIALIZATIONS, 'أخرى'),
    custom_field: text(body.custom_field, 120),
    research_stage: pick(body.research_stage, GOAL_OPTIONS.map((item) => item.value), 'topic'),
    progress_stage: pick(body.progress_stage, PROGRESS_LEVELS.map((item) => item.value), 'topic'),
    university: pick(body.university, UNIVERSITIES, ''),
    faculty: text(body.faculty, 160),
    academic_year: pick(body.academic_year, ACADEMIC_YEARS, ''),
    preferred_language: pick(body.preferred_language, PREFERRED_LANGUAGES.map((item) => item.value), 'ar'),
    citation_style: pick(body.citation_style, CITATION_STYLES.map((item) => item.value), 'apa7'),
    research_title: text(body.research_title, 250)
  };
}

/** تحقّق من الحقول الإلزامية (نفس شروط خطوة التسجيل في النسخة القديمة). */
function validateValues(values) {
  const errors = [];

  if (!values.degree_level) errors.push('اختر مرحلتك الأكاديمية أولاً.');
  if (!values.research_field) errors.push('اختر تخصصك الأكاديمي.');
  if (values.research_field === 'أخرى' && !values.custom_field) errors.push('اكتب تخصصك الأكاديمي في الحقل المخصص.');
  if (!values.research_stage) errors.push('اختر ما الذي تريد إنجازه الآن.');

  return errors;
}

/** نموذج إكمال الملف البحثي — يُستخدم أيضاً للتعديل لاحقاً. */
router.get('/onboarding', requireAccount, async (req, res) => {
  const profile = await getProfile(req.account.id);
  res
    .type('html')
    .send(renderOnboardingPage({ account: req.account, profile, values: onboardingValues(profile) }));
});

/** حفظ الملف البحثي في PostgreSQL ثم التحويل إلى صفحة الحساب. */
router.post('/onboarding', requireAccount, async (req, res) => {
  const values = readValues(req.body || {});
  const errors = validateValues(values);

  if (errors.length) {
    const profile = await getProfile(req.account.id);
    res.status(400).type('html').send(renderOnboardingPage({ account: req.account, profile, values, errors }));
    return;
  }

  const researchField = values.research_field === 'أخرى' ? values.custom_field : values.research_field;
  const goalLabel = GOAL_OPTIONS.find((item) => item.value === values.research_stage)?.label || '';
  const progressLabel =
    PROGRESS_LEVELS.find((item) => item.value === values.progress_stage)?.label ||
    RESEARCH_STAGES.find((item) => item.value === values.progress_stage)?.label ||
    '';

  await saveOnboarding(req.account.id, {
    full_name: req.account.full_name || '',
    research_field: researchField,
    research_title: values.research_title,
    degree_level: values.degree_level,
    academic_year: values.academic_year,
    university: values.university,
    faculty: values.faculty,
    preferred_language: values.preferred_language,
    citation_style: values.citation_style,
    research_stage: values.progress_stage || values.research_stage,
    about: `الهدف الحالي: ${goalLabel} | حالة المشروع: ${progressLabel}`.trim()
  });

  res.redirect(302, '/dashboard');
});

/** الإحصائية — الصفحة الرئيسية للوحة الباحث بعد الدخول. */
router.get('/dashboard', requireAccount, async (req, res) => {
  // المدير له لوحته الخاصة — لا يدخل إحصائية الباحث
  if (req.account.role === 'admin') {
    res.redirect(302, '/admin');
    return;
  }

  // من لم يُكمل ملفه يُوجَّه لإكماله أولاً (حماية إضافية فوق requireOnboarding)
  if (req.account.onboarding_complete !== true) {
    res.redirect(302, '/onboarding');
    return;
  }

  // الملف البحثي أولاً لأن درجته هي التي تختار مسار البحث المعروض في الإحصائية
  const profile = await getProfile(req.account.id);
  const [plan, usage, journey, unread, stats] = await Promise.all([
    getPlanByCode(req.account.plan_code || FREE_PLAN_CODE),
    getUsageOverview(req.account.id),
    getJourneySummary(req.account.id, profile?.degree_level || 'bachelor'),
    unreadCount(req.account.id),
    getDashboardStats(req.account.id)
  ]);

  res.type('html').send(
    renderDashboardPage({
      account: req.account,
      profile,
      plan,
      usage,
      journey,
      unread,
      stats
    })
  );
});

/** صفحة الحساب: البيانات + الباقة + الرصيد + آخر العمليات. */
router.get('/account', requireAccount, async (req, res) => {
  const [profile, plan, usage, unread] = await Promise.all([
    getProfile(req.account.id),
    getPlanByCode(req.account.plan_code || FREE_PLAN_CODE),
    getUsageOverview(req.account.id),
    unreadCount(req.account.id)
  ]);

  res.type('html').send(
    renderAccountPage({
      account: req.account,
      profile,
      plan,
      usage,
      unread
    })
  );
});

export { router as authRouter };

