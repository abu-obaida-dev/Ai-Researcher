import crypto from 'node:crypto';
import { pool } from '../db/client.js';

/** Shared rate limiting, same-origin checks, and security headers. */

const buckets = new Map();

/** Limits concurrent uploads because request bodies are buffered in memory. */
const inFlight = { uploads: 0, libraryUploads: 0 };

/** Maximum concurrent user uploads. */
const MAX_CONCURRENT_UPLOADS = 4;
/** Maximum concurrent library uploads. */
const MAX_CONCURRENT_LIBRARY_UPLOADS = 2;

/** Reserves an upload slot or returns 429 when the limit is reached. */
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

    // Release the slot on success, error, or connection close.
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}

/** Returns the current concurrent-upload counts. */
export function uploadSlotsInUse() {
  return { ...inFlight };
}

/** Removes expired rate-limit buckets every five minutes. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000);
sweeper.unref?.();

/** Returns the client IP after Express proxy handling. */
function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

/** Applies an in-memory request limit keyed by operation and client IP. */
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

/** Applies a per-account request limit after authentication. */
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

/** Cookie names that indicate an active session. */
const SESSION_COOKIE_NAMES = ['ai_session', 'ai_oauth_state', 'zena_admin'];

/** Parses cookie names from the request header. */
function cookieNames(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter(Boolean);
}

/** Rejects state-changing requests from other origins, especially authenticated requests without Origin. */
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

    // Allow anonymous requests without an origin; reject requests carrying a session cookie.
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

/** Adds security headers not covered by Helmet. */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Disable MIME-type sniffing for uploaded files.
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
}

/** Compares secrets in constant time after rejecting empty or unequal-length inputs. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Checks database connectivity for the health endpoint. */
export async function databaseHealth() {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.code || error.message };
  }
}