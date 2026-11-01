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
  GENDER_OPTIONS,
  PREFERRED_LANGUAGES,
  PROGRESS_LEVELS,
  RESEARCH_STAGES,
  SPECIALIZATIONS,
  UNIVERSITIES,
  WHATSAPP_COUNTRIES
} from '../constants.js';
import { homePathFor, requireAccount } from '../middleware/auth.js';
import { getJourneySummary } from '../services/journey.js';
import { getDashboardStats } from '../services/dashboard.js';
import { freeTrialTokens, getPlanByCode } from '../services/plans.js';
import { ensureUserFromGoogle, getProfile, getUsageOverview, saveOnboarding } from '../services/users.js';
import { notifyUser, unreadCount } from '../services/notifications.js';
import { renderAccountPage, renderAuthNotice, renderDashboardPage, renderLoginPage, renderOnboardingPage } from '../views/auth.js';

/** Authentication, OAuth, onboarding, account, and dashboard routes. */

const router = express.Router();
const COOKIE_PATH = '/';
const STATE_TTL_MS = 10 * 60 * 1000;

/** Login errors are passed as codes to prevent HTML injection. */
const LOGIN_ERRORS = {
  denied: 'تم إلغاء تسجيل الدخول من نافذة جوجل.',
  state: 'انتهت صلاحية محاولة الدخول، أعد المحاولة من جديد.',
  google: 'تعذّر إكمال الدخول من جوجل، حاول مرة أخرى.',
  email: 'حساب جوجل هذا لا يحتوي بريداً إلكترونياً صالحاً.',
  config: 'الدخول بحساب جوجل غير مُفعّل على هذا الخادم بعد.'
};

/** Sets an HttpOnly cookie with a bounded lifetime. */
function setCookie(res, name, value, { maxAgeMs } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${COOKIE_PATH}`, 'SameSite=Lax', 'HttpOnly'];
  if (maxAgeMs) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** Clears a browser cookie. */
function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=${COOKIE_PATH}; Max-Age=0; SameSite=Lax; HttpOnly`);
}

/** Reads a named cookie from the request. */
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return '';
}

/** Allows internal destinations only, preventing open redirects. */
function safeNextPath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw.slice(0, 300);
}

/** Resolves the post-login destination. */
function redirectAfterLogin(res, user, nextPath) {
  const target = nextPath && !nextPath.startsWith('/login') ? nextPath : homePathFor(user);
  res.redirect(302, target);
}

/** Redirects authenticated users away from the login page. */
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

/** Starts Google OAuth using a short-lived state cookie. */
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
  // Preserve the requested destination across the OAuth callback.
  setCookie(res, OAUTH_STATE_COOKIE, `${state}|${safeNextPath(req.query.next)}`, { maxAgeMs: STATE_TTL_MS });
  res.redirect(302, buildGoogleAuthUrl(req, state));
});

/** Validates the OAuth state, upserts the user, and opens a session. */
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

    // Send an in-app welcome notification and push when enabled.
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

/** Ends the session and redirects to the home page. */
router.get('/logout', (_req, res) => {
  clearCookie(res, SESSION_COOKIE_NAME);
  res.redirect(302, '/');
});

/** Splits a stored WhatsApp number into country code and national number. */
function splitStoredWhatsapp(stored) {
  const raw = String(stored || '').trim();
  if (!raw) return { country: 'LY', number: '' };

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Try the longest country code first to avoid ambiguous prefixes.
  const sorted = [...WHATSAPP_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of sorted) {
    if (!digits.startsWith(country.dial)) continue;
    const local = digits.slice(country.dial.length).replace(/^0+(?=\d)/, '');
    if (country.lengths.includes(local.length)) return { country: country.code, number: local };
  }

  // Treat numbers without a country code as Libyan local numbers.
  const local = digits.replace(/^0+(?=\d)/, '');
  const ly = WHATSAPP_COUNTRIES.find((country) => country.code === 'LY');
  if (ly.lengths.includes(local.length)) return { country: 'LY', number: local };

  return { country: 'LY', number: digits };
}

/** Builds onboarding values from the saved profile and account defaults. */
function onboardingValues(profile, account = null) {
  const knownFields = SPECIALIZATIONS.filter((item) => item !== 'أخرى');
  const field = profile?.research_field || '';
  const isCustom = Boolean(field) && !knownFields.includes(field);
  const whatsapp = splitStoredWhatsapp(profile?.whatsapp_number);

  return {
    full_name: profile?.full_name || account?.full_name || '',
    gender: profile?.gender || '',
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
    research_title: profile?.research_title || '',
    wa_country: whatsapp.country,
    whatsapp_number: whatsapp.number
  };
}

/** Reads and bounds POSTed onboarding values. */
function readValues(body) {
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

  // Accept known countries and a single alphabetic name only.
  const waCountryCode = pick(body.wa_country, WHATSAPP_COUNTRIES.map((item) => item.code), 'LY');
  const fullName = text(body.full_name, 100).replace(/\p{M}/gu, '');

  return {
    full_name: fullName,
    gender: pick(body.gender, GENDER_OPTIONS.map((item) => item.value), ''),
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
    research_title: text(body.research_title, 250),
    wa_country: waCountryCode,
    // Normalize digits and remove a pasted international prefix.
    whatsapp_number: sanitizeWhatsappDigits(body.whatsapp_number, waCountryCode)
  };
}

/** Normalizes a WhatsApp number using the selected country. */
function sanitizeWhatsappDigits(value, countryCode) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  const country = WHATSAPP_COUNTRIES.find((item) => item.code === countryCode);
  if (country && digits.startsWith(country.dial)) {
    const local = digits.slice(country.dial.length).replace(/^0+(?=\d)/, '');
    if (country.lengths.includes(local.length)) return local.slice(0, Math.max(...country.lengths));
  }

  return digits.replace(/^0+(?=\d)/, '').slice(0, 15);
}

/** Validates required onboarding fields. */
function validateValues(values) {
  const errors = [];

  // Require a single Arabic or Latin name without digits or symbols.
  if (!values.full_name) {
    errors.push('اكتب اسم المستخدم.');
  } else if (/\s/.test(values.full_name)) {
    errors.push('اسم المستخدم اسم واحد فقط — بدون مسافات.');
  } else if (!/^[\p{L}][\p{L}-]*$/u.test(values.full_name)) {
    errors.push('اسم المستخدم يُكوَّن من حروف فقط (عربي أو إنجليزي) بدون أرقام أو رموز.');
  } else if (values.full_name.length < 2) {
    errors.push('اسم المستخدم حرفان على الأقل.');
  }

  if (!values.gender) errors.push('اختر نوعك (شاب/بنت).');
  if (!values.degree_level) errors.push('اختر مرحلتك الأكاديمية أولاً.');
  if (!values.research_field) errors.push('اختر تخصصك الأكاديمي.');
  if (values.research_field === 'أخرى' && !values.custom_field) errors.push('اكتب تخصصك الأكاديمي في الحقل المخصص.');
  if (!values.research_stage) errors.push('اختر ما الذي تريد إنجازه الآن.');

  const country = WHATSAPP_COUNTRIES.find((item) => item.code === values.wa_country);
  const wa = String(values.whatsapp_number || '');
  if (!country) {
    errors.push('اختر دولة رقم الواتساب.');
  } else if (!wa) {
    errors.push('رقم الواتساب مطلوب.');
  } else if (!country.lengths.includes(wa.length)) {
    errors.push(`رقم واتساب ${country.name} يتكون من ${country.lengths.join(' أو ')} أرقام بعد مفتاح الدولة +${country.dial}.`);
  } else if (country.pattern && !new RegExp(country.pattern).test(wa)) {
    errors.push(`أدخل رقم واتساب ${country.name} صحيحاً (مثال: ${country.sample}).`);
  }

  return errors;
}

/** Saves onboarding data and preserves the requested return destination. */
router.get('/onboarding', requireAccount, async (req, res) => {
  const profile = await getProfile(req.account.id);
  res
    .type('html')
    .send(renderOnboardingPage({ account: req.account, profile, values: onboardingValues(profile, req.account), next: safeNextPath(req.query.next) }));
});

/** Stores the research profile and returns to the saved destination. */
router.post('/onboarding', requireAccount, async (req, res) => {
  const values = readValues(req.body || {});
  const errors = validateValues(values);
  const backTarget = safeNextPath(req.query.next);

  if (errors.length) {
    const profile = await getProfile(req.account.id);
    res.status(400).type('html').send(renderOnboardingPage({ account: req.account, profile, values, errors, next: backTarget }));
    return;
  }

  const researchField = values.research_field === 'أخرى' ? values.custom_field : values.research_field;
  const goalLabel = GOAL_OPTIONS.find((item) => item.value === values.research_stage)?.label || '';
  const progressLabel =
    PROGRESS_LEVELS.find((item) => item.value === values.progress_stage)?.label ||
    RESEARCH_STAGES.find((item) => item.value === values.progress_stage)?.label ||
    '';
  // Rebuild the full international number before saving.
  const waCountry = WHATSAPP_COUNTRIES.find((item) => item.code === values.wa_country) || WHATSAPP_COUNTRIES[0];

  await saveOnboarding(req.account.id, {
    full_name: values.full_name,
    gender: values.gender,
    research_field: researchField,
    research_title: values.research_title,
    degree_level: values.degree_level,
    academic_year: values.academic_year,
    university: values.university,
    faculty: values.faculty,
    preferred_language: values.preferred_language,
    citation_style: values.citation_style,
    research_stage: values.progress_stage || values.research_stage,
    about: `الهدف الحالي: ${goalLabel} | حالة المشروع: ${progressLabel}`.trim(),
    whatsapp_number: `+${waCountry.dial}${values.whatsapp_number}`,
    wa_country: waCountry.code
  });

  res.redirect(302, backTarget || '/dashboard');
});

/** Renders the user's dashboard. */
router.get('/dashboard', requireAccount, async (req, res) => {
  // Administrators use the admin dashboard.
  if (req.account.role === 'admin') {
    res.redirect(302, '/admin');
    return;
  }

  // Redirect incomplete profiles to onboarding.
  if (req.account.onboarding_complete !== true) {
    res.redirect(302, '/onboarding');
    return;
  }

  // Ensure the profile exists before loading degree-specific progress.
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

/** Renders account details, plan, balance, and recent activity. */
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

