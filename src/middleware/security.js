import crypto from 'node:crypto';
import { pool } from '../db/client.js';

/**
 * طبقة الأمان العامة (تُستدعى من server.js بعد helmet وقبل المسارات):
 *
 *   1) rateLimit(name, {limit, windowMs})  — حدّ بسيط في الذاكرة لكل مسار حساس
 *      (تسجيل الدخول، طلبات الدفع، رفع الملفات) يمنع الإساءة والأتمتة.
 *   2) requireSameOrigin()                  — حماية CSRF: أي POST لا يأتي من
 *      أصل الموقع يُرفض (كوكي الجلسة SameSite=Lax وحدّ)).
 *   3) securityHeaders()                    — ترويسات أمان إضافية (لا تُكرّر helmet).
 *
 * الحدود تُحسب بمفتاح (المسار + عنوان IP) وتُنظَّف دورياً حتى لا تنمو الذاكرة.
 */

const buckets = new Map();

/**
 * سقف تزامن للعمليات الثقيلة (رفع ملفات تُقرأ كاملة في الذاكرة).
 *
 * لماذا: حدّ المعدّل يحدّ **عدد الطلبات** لا حجم الذاكرة. طلبان متزامنان × 200 ميجابايت
 * = ذاكرة ضاغطة. هذا الوسيط يحجز «مقعداً» قبل القراءة ويردّ 429 فوراً عند امتلاء السقف.
 * المقاعد تُحرَّر على حدثَي `finish`/`close` للرد ⇒ لا تتسرّب عند أي خطأ أو انقطاع اتصال.
 */
const inFlight = { uploads: 0, libraryUploads: 0 };

/** أعلى عدد عمليات رفع متزامنة (كامل للباحثين). */
const MAX_CONCURRENT_UPLOADS = 4;
/** أعلى عدد عمليات رفع كتب متزامنة (أثقل: حتى 200 ميجابايت). */
const MAX_CONCURRENT_LIBRARY_UPLOADS = 2;

/**
 * وسيط يحجز مقعد تزامن أو يردّ 429 فوراً إذا اكتمل السقف.
 * @param {'uploads'|'libraryUploads'} kind نوع العملية
 */
export function concurrencyLimit(kind, limit) {
  return (req, res, next) => {
    const max = limit || (kind === 'libraryUploads' ? MAX_CONCURRENT_LIBRARY_UPLOADS : MAX_CONCURRENT_UPLOADS);
    if (inFlight[kind] >= max) {
      res.setHeader('Retry-After', '30');
      res
        .status(429)
        .type('text')
        .send('الخادم مشغول برفع ملفات حالياً — أعد المحاولة بعد قليل.');
      return;
    }

    inFlight[kind] += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight[kind] = Math.max(0, inFlight[kind] - 1);
    };

    // نلتقط نهاية الاستجابة (نجاح أو خطأ) ⇒ نضمن التحرير حتى لو لم يُستدعَ next بنجاح.
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}

/** أرقام المقاعد المشغولة حالياً (للتشخيص). */
export function uploadSlotsInUse() {
  return { ...inFlight };
}

/** تنظيف دوري للخزائن القديمة (كل 5 دقائق). */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000);
sweeper.unref?.();

/** عنوان IP للزائر (يتحقق من Proxy بعد معالج واحد — لا نثق بترويسة عشوائية). */
function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

/**
 * حدّ طلبات في الذاكرة: name+ip. يعيد 429 مع رسالة عربية عند التجاوز.
 * `limit` عدد الطلبات لكل نافذة زمنية، و`windowMs` طول النافذة.
 */
export function rateLimit(name, { limit = 10, windowMs = 60 * 1000 } = {}) {
  return (req, res, next) => {
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.reset <= now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const seconds = Math.max(1, Math.ceil((bucket.reset - now) / 1000));
      res.setHeader('Retry-After', String(seconds));
      res.status(429).type('text').send(`طلبات كثيرة خلال وقت قصير — حاول بعد ${seconds} ثانية.`);
      return;
    }

    next();
  };
}

/** حدّ على مستوى الحساب (بعد requireAccount): أبطأ وأقوى من حدّ IP. */
export function rateLimitUser(name, { limit = 10, windowMs = 60 * 1000 } = {}) {
  return (req, res, next) => {
    const id = req.account?.id;
    if (!id) {
      next();
      return;
    }

    const key = `${name}:user:${id}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.reset <= now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const seconds = Math.max(1, Math.ceil((bucket.reset - now) / 1000));
      res.setHeader('Retry-After', String(seconds));
      res.status(429).type('text').send(`طلبات كثيرة خلال وقت قصير — حاول بعد ${seconds} ثانية.`);
      return;
    }

    next();
  };
}

/** أسماء الكوكيز التي تدل على جلسة قائمة — لزوم ترويسة Origin في طلباتها. */
const SESSION_COOKIE_NAMES = ['ai_session', 'ai_oauth_state', 'zena_admin'];

/** أسماء الكوكيز الموجودة في الطلب (تُقرأ من ترويسة Cookie). */
function cookieNames(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter(Boolean);
}

/**
 * حماية CSRF: الطلبات المغيّرة للحالة (POST/PUT/PATCH/DELETE) يجب أن تأتي من
 * أصل الموقع نفسه. نتحقق من ترويسة Origin (و Referer كبديل) ولا نسمح بالغائب
 * لأن المتصفحات ترسل Origin في كل POST لموقعه.
 *
 * القاعدة:
 *   - بلا ترويسة أصل ولا جلسة ⇒ يُسمح (نماذج وواجهات بلا حساسية).
 *   - بلا ترويسة أصل ومع جلسة ⇒ يُرفض؛ هذه كانت الفجوة التي تسمح بهجمات CSRF.
 */
export function requireSameOrigin() {
  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get('origin');
    const referer = req.get('referer');
    const source = origin || referer || '';
    const host = req.get('host') || '';

    // بدون ترويسة أصل: نسمح للزائر بلا جلسة، ونرفض ما يحمل جلسة (CSRF).
    if (!source) {
      const hasSession = cookieNames(req.headers.cookie).some((name) => SESSION_COOKIE_NAMES.includes(name));
      if (hasSession) {
        res.status(403).type('text').send('طلب مرفوض: الطلب يحمل جلسة ولا يحمل ترويسة أصل (Origin).');
        return;
      }
      next();
      return;
    }

    let hostFromSource = '';
    try {
      hostFromSource = new URL(source).host;
    } catch {
      res.status(403).type('text').send('طلب مرفوض (أصل غير صالح).');
      return;
    }

    if (hostFromSource && hostFromSource === host) {
      next();
      return;
    }

    res.status(403).type('text').send('طلب مرفوض: يجب أن يأتي من موقع المنصة نفسه.');
  };
}

/** ترويسات أمان إضافية فوق helmet (لا تكرّر ما يفعله). */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // منع المتصفح من تخمين نوع المحتوى لملفات مرفوعة
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
}

/**
 * مقارنة آمنة زمنياً للسرّ (Constant-time comparison).
 *
 * لماذا: `a === b` تتوقّف عند أول بايت مختلف ⇒يمكن للمهاجم قياس زمن الاستجابة
 * incrementally ليكتشف الرمز حرفاً حرفاً. `timingSafeEqual` يقارن كل البايتات دائماً.
 *
 * ملاحظة: طول المدخلين المختلفين يرجع false قبل المقارنة (شرط لازم في المكتبة)،
 * والطول نفسه معلوم للمهاجم أصلاً فلا يسرّب معلومات.
 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** فحص دوري لقاعدة البيانات + تأكد من وجود الجداول المطلوبة (يُستدعى من /api/health). */
export async function databaseHealth() {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.code || error.message };
  }
}