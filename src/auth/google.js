/**
 * مخطط المصادقة: دخول جوجل عبر OAuth 2.0 + جلسات موقّعة بـ HMAC.
 * البيانات تُخزّن في PostgreSQL الخاصة بنا — لا Firestore إطلاقاً.
 */

import crypto from 'node:crypto';

export const SESSION_COOKIE_NAME = 'ai_session';
export const OAUTH_STATE_COOKIE = 'ai_oauth_state';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** إعدادات جوجل من البيئة — فارغة تعني أن الدخول غير مُفعّل بعد. */
export function googleOAuthConfig() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const baseUrl = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  return { clientId, clientSecret, baseUrl, configured: Boolean(clientId && clientSecret) };
}

export function isGoogleAuthConfigured() {
  return googleOAuthConfig().configured;
}

/** الرابط العام للمنصة، أو مضيف الطلب الحالي عند التطوير المحلي. */
export function baseUrlFromRequest(req) {
  const configured = googleOAuthConfig().baseUrl;
  if (configured) return configured;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

/** عنوان العودة — يجب تسجيله حرفياً في Google Cloud Console. */
export function googleCallbackUrl(req) {
  return `${baseUrlFromRequest(req)}/auth/google/callback`;
}

/**
 * سر توقيع الجلسات — يُقرأ من البيئة، ويسقط على JWT_SECRET في التطوير المحلي.
 * في الإنتاج يرفض الإقلاع بلا سرّ حقيقي (يفحصه server.js أيضاً) لأن القيمة
 * الثابتة تجعل تزوير كوكي الجلسة ممكناً لمن يقرأ الكود.
 */
function sessionSecret() {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (secret && String(secret).trim()) return String(secret).trim();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET مطلوب في الإنتاج — راجع README (متغيّرات البيئة).');
  }
  return 'dev-secret-change-me';
}

/** توقيع HMAC-SHA256 للحمولة — يمنع تزوير كوكي الجلسة. */
function signPayload(payloadB64) {
  return crypto.createHmac('sha256', sessionSecret()).update(payloadB64).digest('base64url');
}

/** يبني كوكي جلسة موقّع: { uid, email, role, iat, exp } — لا يمكن تزويرها. */
export function createSessionCookie(user, { ttlMs = SESSION_TTL_MS } = {}) {
  const now = Date.now();
  const payload = {
    uid: user.id,
    email: user.email,
    role: user.role || 'user',
    iat: now,
    exp: now + ttlMs
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

/** يتحقق من كوكي الجلسة ويعيد الحمولة، أو null عند أي عبث أو انتهاء. */
export function verifySessionCookie(cookieValue) {
  try {
    if (!cookieValue || typeof cookieValue !== 'string') return null;
    const [payloadB64, signature] = cookieValue.split('.');
    if (!payloadB64 || !signature) return null;
    const expected = signPayload(payloadB64);
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload?.uid || !payload?.email) return null;
    if (typeof payload.exp === 'number' && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** يقرأ كوكي الجلسة من الترويسة بدون أي اعتماد إضافي. */
export function readSessionCookie(req) {
  const header = req.headers.cookie || '';
  const parts = header.split(';').map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return decodeURIComponent(part.slice(SESSION_COOKIE_NAME.length + 1));
    }
  }
  return '';
}

/** رابط بدء الدخول مع state عشوائي لمنع CSRF على الـ callback. */
export function buildGoogleAuthUrl(req, state) {
  const { clientId } = googleOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleCallbackUrl(req),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** يبدّل code الصادر من جوجل بـ access_token عبر نداء خلفي آمن. */
export async function exchangeCodeForTokens(code, req) {
  const { clientId, clientSecret } = googleOAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleCallbackUrl(req),
      grant_type: 'authorization_code'
    }).toString()
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`تعذّر تبديل رمز جوجل (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  if (!data.access_token) throw new Error('ردّ جوجل لا يحتوي access_token.');
  return data;
}

/** يجلب الملف الموثّق (email/name/picture) باستخدام access_token. */
export async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`تعذّر جلب الملف من جوجل (HTTP ${response.status}).`);
  const profile = await response.json();
  if (!profile.email) throw new Error('حساب جوجل لا يحتوي بريداً إلكترونياً.');
  return {
    googleSub: String(profile.sub || ''),
    email: String(profile.email || '').toLowerCase(),
    name: String(profile.name || ''),
    picture: String(profile.picture || '')
  };
}

/** state عشوائي لكل محاولة دخول (يُخزّن في كوكي httpOnly قصيرة). */
export function newOAuthState() {
  return crypto.randomBytes(16).toString('hex');
}
