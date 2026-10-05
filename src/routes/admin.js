import express from 'express';
import { Readable } from 'node:stream';
import { pool } from '../db/client.js';
import { hintForDatabaseError } from '../db/errors.js';
import { ADMIN_PERMISSIONS, FREE_PLAN_CODE, PLAN_STORAGE_DEFAULT_MB, PLAN_STORAGE_MAX_MB } from '../constants.js';
import { rateLimit, concurrencyLimit, safeEqual } from '../middleware/security.js';
import { renderNotice } from '../views/layout.js';
import { notifyUser } from '../services/notifications.js';
import {
  currentSupportWhatsapp,
  saveStorageLimits,
  saveSupportWhatsapp,
  storageLimits
} from '../services/settings.js';
import {
  renderAdminHome,
  renderAdminLibrary,
  renderAdminPlans,
  renderAdminSettings,
  renderAdminUsage,
  renderAdminUserDetail,
  renderAdminUsers
} from '../views/admin.js';
import { deleteFile } from '../services/files.js';

/** دور المشرف الأكاديمي — مرجع واحد لكل ما يخصّه في اللوحة. */
const SUPERVISOR_ROLE = 'supervisor';
import {
  addRolePermission,
  addSupervisor,
  can,
  clearAccessCache,
  listSupervisors,
  removeRolePermission,
  removeSupervisor,
  storedPermissionsOfRole
} from '../services/access.js';
import {
  confirmPaymentRequest,
  listPaymentRequests,
  listPaymentMethods,
  removePaymentMethod,
  rejectPaymentRequest,
  savePaymentMethod,
  setSiteCurrency,
  siteCurrency
} from '../services/payments.js';
import { renderAdminPayments } from '../views/admin-payments.js';
import {
  addLibraryItem,
  deleteLibraryItem,
  LIBRARY_MAX_FILE_BYTES,
  listLibraryItems,
  readLibraryItem,
  setLibraryItemActive,
  updateLibraryItem
} from '../services/library.js';
import { downloadExternalFile, LIBRARY_SOURCES, searchExternalLibrary } from '../services/library-sources.js';

/**
 * لوحة الإدارة: صفحات HTML مولَّدة على الخادم بديلاً عن واجهة /admin القديمة (React).
 * كل الصفحات قراءة فقط من PostgreSQL، وحمايتها تُقرأ من ADMIN_TOKEN في .env.
 */
const router = express.Router();

const PAGE_SIZE = 20;
const ALLOWED_FILTERS = new Set(['all', 'active', 'disabled']);

/** معرّف UUID صالح (لوحة تفصيل الباحث) + بريد صالح + صلاحية صالحة. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PERMISSION_RE = /^[A-Za-z0-9:_-]{1,100}$/;

/**
 * يبني دالة عودة للصفحة نفسها بعد عملية POST مع الحفاظ على رمز الإدارة (?token=).
 * الاستخدام: const back = tokenBack(req); res.redirect(302, back('/admin/users', { ok: '...' }));
 */
function tokenBack(req) {
  const token = String(req.query.token || '').slice(0, 200);
  return (path, extra = {}) => {
    const params = new URLSearchParams(extra);
    if (token) params.set('token', token);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
}

/**
 * يقرأ فلتر عمليات الاستهلاك من الطلب: تاريخ YYYY-MM-DD اختياري + من/إلى ساعة
 * (0–23) + عدد نتائج محدود. يعيد قيماً نقية (null للفراغ) آمنة للاستعلام
 * وإعادة العرض في النموذج.
 */
function readOpsFilter(req, { defaultLimit = 8, maxLimit = 500 } = {}) {
  const dateRaw = String(req.query.date || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  const hour = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null;
  };
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(req.query.limit, 10) || defaultLimit));
  return { date, h1: hour(req.query.h1), h2: hour(req.query.h2), limit };
}

/** يقرأ كلمة المرور من ترويسة Basic Auth إن وُجدت. */
function basicAuthPassword(req) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Basic ')) return '';

  try {
    return Buffer.from(header.slice(6), 'base64').toString('utf8').split(':')[1] || '';
  } catch {
    return '';
  }
}

/** كوكي دخول لوحة الإدارة (يُستبدل به الرمز بعد أول تحقق) — الاسم ثابت في كل المشروع. */
const ADMIN_COOKIE = 'zena_admin';

/** يقرأ قيمة كوكي من الطلب. */
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return '';
}

/** يضع كوكي دخول اللوحة (HttpOnly + SameSite=Strict) ليبقى الدخول بلا رمز في كل رابط. */
function setAdminCookie(res, value, maxAgeSeconds) {
  const parts = [`${ADMIN_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (maxAgeSeconds) parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * عدّاد محاولات الدخول الفاشلة لكل IP (منع تخمين ADMIN_TOKEN بلا حدود).
 * ينقص العدّاد نفسه بعد 15 دقيقة، ويُصفَّر عند دخول ناجح.
 */
const MAX_ADMIN_FAILURES = 10;
const ADMIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const adminFailures = new Map();

function adminFailureKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

/** يحصّل عدد الفشل الحالي (0 إن انتهت النافذة). */
function adminFailureCount(key) {
  const entry = adminFailures.get(key);
  if (!entry || entry.reset <= Date.now()) return 0;
  return entry.count;
}

/** يسجّل محاولة فاشلة واحدة. */
function noteAdminFailure(key) {
  const count = adminFailureCount(key) + 1;
  adminFailures.set(key, { count, reset: Date.now() + ADMIN_FAILURE_WINDOW_MS });
}

/**
 * من يدخل لوحة الإدارة:
 * 1) مدير المنصة: إيميل في ADMIN_EMAILS (.env) — كل الصلاحيات '*'.
 * 2) مشرف إداري: حساب دوره supervisor ويملك صلاحية admin:panel، فتدخل اللوحة
 *    لكن لا يرى إلا ما أعطاه المدير من صلاحيات (لا إعدادات ولا مشرفون).
 * 3) بدون ADMIN_EMAILS: من الجهاز المحلي فقط (افتراض آمن للتطوير).
 *
 * أمان إضافي: حدّ معدّل على المحاولات، والرمز المقبول في ?token= يُستبدل فوراً
 * بكوكي HttpOnly ويُعاد التوجيه إلى رابط نظيف (حتى لا يبقى في السجلات).
 */
function requireAdminAccess(req, res, next) {
  // مدير مسجّل بحساب جوجل مُدرج في ADMIN_EMAILS يدخل مباشرة بدون رمز
  if (req.account?.role === 'admin') {
    next();
    return;
  }

  // مشرف إداري: الدخول موقوف على صلاحية admin:panel التي يمنحها المدير
  if (req.account?.role === 'supervisor') {
    can(req.account, 'admin:panel')
      .then((allowed) => (allowed ? next() : denyAdminAccess(req, res)))
      .catch((error) => {
        console.warn(`تعذّر التحقق من صلاحية المشرف: ${error.code || error.message}`);
        denyAdminAccess(req, res);
      });
    return;
  }

  const token = process.env.ADMIN_TOKEN;
  const failKey = adminFailureKey(req);
  const failures = adminFailureCount(failKey);

  // بعدد محاولات فاشلة كثير يُمنع مؤقتاً قبل أي مقارنة للرمز (حماية من التخمين).
  if (failures >= MAX_ADMIN_FAILURES) {
    res.setHeader('Retry-After', '900');
    const { html } = renderNotice({
      title: 'محاولات كثيرة',
      message: 'تم إيقاف محاولات الدخول مؤقتاً بعد عدة محاولات فاشلة.',
      details: `الحد الأقصى ${MAX_ADMIN_FAILURES} محاولات كل 15 دقيقة. حاول بعد ربع ساعة.`
    });
    res.status(429).type('html').send(html);
    return;
  }

  if (token) {
    const queryToken = String(req.query.token || '');
    const cookieToken = readCookie(req, ADMIN_COOKIE);
    const provided = req.get('x-admin-token') || queryToken || basicAuthPassword(req) || cookieToken;

    if (provided && safeEqual(provided, token)) {
      // دخول بالرمز = صلاحية كاملة (بلا حساب) ⇒ يتجاوز كل بوابات الصلاحيات
      req.adminUnlocked = true;
      adminFailures.delete(failKey);

      // الرمز في الرابط: نحوله إلى كوكي HttpOnly ونعيد التوجيه بلا رمز،
      // حتى لا يبقى ظاهراً في سجلات الخادم ولا في ترويسة Referer.
      if (queryToken) {
        setAdminCookie(res, token, 8 * 60 * 60);
        const clean = new URL(req.originalUrl, 'http://localhost');
        clean.searchParams.delete('token');
        res.redirect(302, `${clean.pathname}${clean.search}`);
        return;
      }

      // تجديد صلاحية الكوكي طالما حيّ (نافذة 8 ساعات)
      if (cookieToken) setAdminCookie(res, token, 8 * 60 * 60);
      next();
      return;
    }

    const { html } = renderNotice({
      title: 'الوصول مرفوض',
      message: 'لوحة الإدارة محمية برمز إداري. أرسل الرمز في الترويسة x-admin-token أو في ?token=.',
      details: 'ADMIN_TOKEN معرّف في ملف .env لهذا الخادم. بعد أول دخول ناجح يُحفظ الرمز في كوكي آمن.'
    });
    noteAdminFailure(failKey);
    res.status(401).type('html').send(html);
    return;
  }

  const address = req.ip || req.socket.remoteAddress || '';
  const isLocal =
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.endsWith('127.0.0.1');

  if (isLocal) {
    // تطوير محلي بلا ADMIN_TOKEN: الدخول كامل كما كان (بلا حساب)
    req.adminUnlocked = true;
    next();
    return;
  }

  const { html } = renderNotice({
    title: 'الوصول مرفوض',
    message: 'لوحة الإدارة متاحة من localhost فقط. لفتحها من جهاز آخر عرّف ADMIN_TOKEN في .env.',
    details: 'مثال: ADMIN_TOKEN=secret-here ثم افتح /admin/users?token=secret-here'
  });
  res.status(403).type('html').send(html);
}

/** رسائل نجاح صفحة الطلبات (مع عدد النقاط الممنوحة عند التأكيد). */
const PAYMENT_OK = {
  rejected: 'رُفض الطلب وأُبلغ الباحث بالسبب.',
  'confirmed:0': 'أُكّد الطلب وفُعّلت الباقة.'
};

/** رسالة خطأ عربية موحّدة لطلبات الدفع. */
function paymentErrorMessage(error) {
  if (['NOT_FOUND', 'BAD_STATUS', 'BAD_INPUT'].includes(error?.code)) return error.message;
  return 'تعذّر تنفيذ العملية على الطلب — أعد المحاولة.';
}

/**
 * سبب رفض أي إجراء على حساب مدير (إيقاف/حذف).
 * إن لم يكن الحساب موجوداً ⇒ «غير موجود»، وإلا فهو مدير محمي.
 */
async function adminProtectedMessage(id) {
  try {
    const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (!rows.length) return 'هذا الحساب غير موجود.';
  } catch {
    return 'تعذّر التحقق من الحساب.';
  }
  return 'حساب المدير محمي: لا يمكن إيقافه أو حذفه. المدير يغيّر بريده بنفسه من الإعدادات.';
}

/**
 * بوابة حماية: ترفض أي إجراء يهدّد حساب المدير (إيقاف/حذف/تعطيل).
 * تُستدعى في مسارات الحالة والحذف، وفي الحذف الجماعي إن وُجد.
 */
async function blockIfAdmin(req, res, redirect) {
  const id = String(req.params.id || '');
  const found = await pool.query('SELECT role FROM users WHERE id = $1', [id]).catch(() => ({ rows: [] }));

  if (found.rows[0]?.role === 'admin') {
    res.redirect(302, redirect(adminProtectedMessage(id)));
    return true;
  }
  return false;
}

/**
 * بوابة صلاحيات لوحة الإدارة: المدير يتجاوزها دائماً، والمشرف لا يدخل الصفحة
 * إلا بصلاحيتها. تُستدعى في كل مسار إداري حسب مجموعته (باحثون/مكتبة/باقات…).
 */
function requireAdminPermission(permission) {
  const meta = ADMIN_PERMISSIONS.find((item) => item.key === permission);

  return async (req, res, next) => {
    // المدير، أو الدخول المفتوح (ADMIN_TOKEN / localhost) — يتجاوزان البوابة
    if (req.account?.role === 'admin' || req.adminUnlocked) {
      next();
      return;
    }

    let allowed = false;
    try {
      allowed = await can(req.account, permission);
    } catch (error) {
      console.warn(`تعذّر التحقق من ${permission}: ${error.code || error.message}`);
      allowed = false;
    }

    if (allowed) {
      next();
      return;
    }

    const { html } = renderNotice({
      title: 'صلاحية غير متاحة',
      message: `هذه الصفحة تحتاج صلاحية «${meta?.label || permission}». اطلبها من مدير المنصة.`,
      details: 'صلاحياتك الحالية تُقرأ من دورك في «الأدوار والصلاحيات».',
      extraHtml: '<div class="links"><a class="btn" href="/admin">رجوع للوحة</a></div>'
    });
    res.status(403).type('html').send(html);
  };
}

/** رفض الدخول للمشرف بلا صلاحية admin:panel. */
function denyAdminAccess(req, res) {
  const { html } = renderNotice({
    title: 'دخول اللوحة غير مفعّل',
    message: 'حسابك مشرف، لكن صلاحية «دخول لوحة الإدارة» غير ممنوحة لك. اطلبها من مدير المنصة.',
    details: 'منحها المدير من: لوحة الإدارة ← الأدوار والصلاحيات ← مشرف إداري.'
  });
  res.status(403).type('html').send(html);
}

// حدّ معدّل واسع على كل طلبات لوحة الإدارة (حماية من الإغراق/DoS فقط —
// لا يمنع التصفح العادي لأنه 120 طلباً لكل IP في 5 دقائق)، والتخمين الحقيقي
// يُمنع بعده بعدّاد محاولات الفشل أدناه (requireAdminAccess).
router.use(rateLimit('admin_panel', { limit: 120, windowMs: 5 * 60 * 1000 }));
router.use(requireAdminAccess);

/** يعرض صفحة عربية واضحة بخطوات الحل عند فشل قاعدة البيانات. */
function renderDbError(res, error) {
  const { html } = renderNotice({
    title: 'قاعدة البيانات غير جاهزة',
    message: hintForDatabaseError(error),
    details: error?.message || '',
    extraHtml: `<div class="links">
      <a class="btn btn-primary" href="/api/health">فحص الحالة /api/health</a>
      <a class="btn" href="/admin/users">إعادة المحاولة</a>
    </div>`
  });
  res.status(503).type('html').send(html);
}

/**
 * يعرض صفحة HTML مُمرَّراً لها حساب الجلسة (account) لتضعه في الترويسة والسايدبار.
 * res.req هو نفس كائن الطلب في Express — لذلك لا يتغير توقيع الدوال عند الاستدعاء.
 */
async function renderPage(res, load, view) {
  try {
    res.type('html').send(view({ ...(await load()), account: res.req?.account || null }));
  } catch (error) {
    renderDbError(res, error);
  }
}

router.get('/', requireAdminPermission('admin:panel'), (req, res) => {
  const filter = readOpsFilter(req, { defaultLimit: 8 });

  return renderPage(
    res,
    async () => {
      const [counts, days, latestUsers, recent, typeShare] = await Promise.all([
        pool.query(`SELECT
            (SELECT count(*) FROM users)::int AS users,
            (SELECT count(*) FROM users WHERE is_active)::int AS active_users,
            (SELECT count(*) FROM users WHERE NOT is_active)::int AS disabled_users,
            (SELECT count(*) FROM users WHERE role = 'admin')::int AS admins,
            (SELECT count(*) FROM profiles)::int AS profiles,
            (SELECT count(*) FROM plans)::int AS plans,
            (SELECT count(*) FROM users WHERE plan_code IS NOT NULL)::int AS subscribers,
            (SELECT count(*) FROM usage_logs)::int AS usage_events,
            (SELECT COALESCE(SUM(tokens_used), 0) FROM usage_logs)::int AS tokens_used,
            (SELECT count(*) FROM conversations)::int AS conversations,
            (SELECT count(*) FROM messages WHERE role = 'user')::int AS questions,
            (SELECT count(*) FROM ai_requests WHERE status = 'ok')::int AS ai_ok,
            (SELECT count(*) FROM ai_requests WHERE status <> 'ok')::int AS ai_failed,
            (SELECT count(*) FROM files)::int AS files`),
        pool.query(`SELECT to_char(gs::date, 'YYYY-MM-DD') AS day,
                   COALESCE(count(l.id), 0)::int AS events,
                   COALESCE(sum(l.tokens_used), 0)::int AS tokens
              FROM generate_series(current_date - interval '6 days', current_date::timestamp, interval '1 day') AS gs
         LEFT JOIN usage_logs l ON l.created_at::date = gs::date
          GROUP BY gs::date
          ORDER BY gs::date`),
        pool.query(`SELECT u.id, u.email, u.full_name, u.plan_code, u.tokens_balance, u.created_at, p.university
            FROM users u
            LEFT JOIN profiles p ON p.user_id = u.id
            ORDER BY u.created_at DESC
            LIMIT 5`),
        // آخر العمليات مع فلتر التاريخ/الساعات + عدد النتائج المختار
        pool.query(
          `SELECT l.created_at, l.type, l.tokens_used, l.summary, u.email
             FROM usage_logs l
             JOIN users u ON u.id = l.user_id
            WHERE ($1::date IS NULL OR l.created_at::date = $1::date)
              AND ($2::int IS NULL OR date_part('hour', l.created_at) >= $2::int)
              AND ($3::int IS NULL OR date_part('hour', l.created_at) <= $3::int)
            ORDER BY l.created_at DESC
            LIMIT $4`,
          [filter.date, filter.h1, filter.h2, filter.limit]
        ),
        // توزيع نقاط الأسبوع على الأنواع للمخطط الدائري
        pool.query(`SELECT type, COALESCE(SUM(tokens_used), 0)::int AS tokens, count(*)::int AS events
            FROM usage_logs
           WHERE created_at::date >= current_date - interval '6 days'
           GROUP BY type
           ORDER BY SUM(tokens_used) DESC`)
      ]);

      return {
        counts: counts.rows[0],
        days: days.rows,
        typeShare: typeShare.rows,
        latestUsers: latestUsers.rows,
        recent: recent.rows,
        filter,
        sent: Math.max(0, Number.parseInt(req.query.sent, 10) || 0),
        // تقرير وصول الإشعار للهاتف (يملؤه مسار الإرسال بعد كل بث)
        push: Math.max(0, Number.parseInt(req.query.push, 10) || 0),
        pushFailed: Math.max(0, Number.parseInt(req.query.push_failed, 10) || 0),
        pushNone: Math.max(0, Number.parseInt(req.query.push_none, 10) || 0),
        pushError: String(req.query.push_error || '').slice(0, 200),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminHome
  );
});

router.get('/plans', requireAdminPermission('admin:plans'), (req, res) =>
  renderPage(
    res,
    async () => {
      const { rows } = await pool.query(`SELECT p.code, p.title, p.tagline, p.price, p.tokens, p.storage_mb, p.period,
            p.features, p.popular, p.is_active, p.created_at, p.role_code,
            (SELECT count(*) FROM users u WHERE u.plan_code = p.code)::int AS subscribers
          FROM plans p
          ORDER BY p.price ASC, p.title ASC`);

      // صلاحيات دور كل باقة = الخدمات التي تُمنح لمشتركيها (تظهر داخل كرت الباقة)
      const permissionsByRole = new Map();
      for (const role of new Set(rows.map((row) => row.role_code).filter(Boolean))) {
        permissionsByRole.set(role, await storedPermissionsOfRole(role));
      }

      return {
        plans: rows,
        permissionsByRole: Object.fromEntries(permissionsByRole),
        totalSubscribers: rows.reduce((total, plan) => total + Number(plan.subscribers), 0),
        saved: String(req.query.saved || '').slice(0, 100),
        note: String(req.query.note || '').slice(0, 200),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminPlans
  )
);

/**
 * [P3] المكتبة العلمية: قائمة العناصر (بحث/فلترة/ترقيم) + نتائج الجلب الخارجي
 * عند تحديد مصدر وكلمة بحث (?esrc=&eq=&subject=).
 */
router.get('/library', requireAdminPermission('admin:library'), (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  const status = ['all', 'active', 'off'].includes(String(req.query.status)) ? String(req.query.status) : 'all';
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const esrc = String(req.query.esrc || '');
  const eq = String(req.query.eq || '').trim().slice(0, 120);
  const subject = String(req.query.subject || '').trim().slice(0, 80);

  return renderPage(
    res,
    async () => {
      const [list, external] = await Promise.all([
        listLibraryItems({ q, status, page }),
        eq || subject
          ? searchExternalLibrary({ source: LIBRARY_SOURCES.some((item) => item.id === esrc) ? esrc : 'openlibrary', q: eq, subject })
          : Promise.resolve(null)
      ]);

      return {
        ...list,
        q,
        status,
        external,
        sources: LIBRARY_SOURCES,
        search: {
          source: LIBRARY_SOURCES.some((item) => item.id === esrc) ? esrc : 'openlibrary',
          q: eq,
          subject
        },
        ok: String(req.query.ok || '').slice(0, 60),
        note: String(req.query.note || '').slice(0, 300),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminLibrary
  );
});

/** بناء رابط العودة إلى صفحة المكتبة مع الحفاظ على توكن الإدارة. */
function libraryBack(req) {
  const token = String(req.query.token || '').slice(0, 200);
  return (extra = {}) => {
    const query = new URLSearchParams(extra);
    if (token) query.set('token', token);
    return `/admin/library?${query.toString()}`;
  };
}

/** حدّ الطلب في رفع كتاب = حدّ الملف + 2MB لحدود النموذج (رفض مبكر قبل القراءة). */
const LIBRARY_UPLOAD_LIMIT_BYTES = LIBRARY_MAX_FILE_BYTES + 2 * 1024 * 1024;

/** رسالة خطأ عربية حسب كود الخدمة. */
function libraryErrorMessage(error) {
  if (error?.code === 'BAD_CONTENT') return 'محتوى الملف لا يطابق امتداده (تنكّر في الصيغة) — تم الرفض.';
  if (error?.code === 'NO_STORAGE') return error.message;
  if (['TOO_LARGE', 'BAD_TYPE', 'BAD_FILE', 'BAD_TITLE'].includes(error?.code)) return error.message;
  return 'تعذّر تنفيذ العملية — أعد المحاولة.';
}

/**
 * إضافة كتاب: multipart (ملف اختياري + بيانات) بنفس نمط رفع الملفات في الموقع.
 *
 * الحماية: صلاحية admin:library + حدّ معدّل لكل IP + سقف تزامن (الملف حتى 200
 * ميجابايت يُقرأ كاملاً في الذاكرة، فبدون السقف يمكن لـ ٤ طلبات متوازية استنزاف الخادم).
 */
router.post(
  '/library/add',
  requireAdminPermission('admin:library'),
  rateLimit('library_upload', { limit: 20, windowMs: 10 * 60 * 1000 }),
  concurrencyLimit('libraryUploads'),
  async (req, res) => {
    const back = libraryBack(req);

    try {
      // رفض مبكر بحجم الطلب قبل قراءة الجسم في الذاكرة (books تُقرأ كاملة كـ Buffer).
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > LIBRARY_UPLOAD_LIMIT_BYTES) {
        console.warn(`رُفض رفع كتاب ضخم بلا قراءة: ${declared} بايت`);
        res.redirect(302, back({ error: 'حجم الملف يتجاوز الحد المسموح للمكتبة (200 ميجابايت).' }));
        return;
      }

    const request = new Request('http://localhost/admin/library/add', {
        method: 'POST',
        body: Readable.toWeb(req),
        headers: { 'content-type': req.headers['content-type'] || '' },
        duplex: 'half'
      });
      const form = await request.formData();
      const file = form.get('file');

      let attachment = null;
      if (file instanceof File && file.size) {
        attachment = {
          buffer: Buffer.from(await file.arrayBuffer()),
          fileName: String(file.name || 'book'),
          mime: String(file.type || '')
        };
      }

      await addLibraryItem({
        title: form.get('title'),
        authors: form.get('authors'),
        year: form.get('year'),
        source: form.get('source'),
        abstract: form.get('abstract'),
        subjects: form.get('subjects'),
        field: form.get('field'),
        degreeLevel: form.get('degree_level'),
        citation: form.get('citation'),
        file: attachment
      });

      res.redirect(303, back({ ok: 'library_added' }));
    } catch (error) {
      console.warn(`فشل إضافة كتاب للمكتبة: ${error?.code || error?.message}`);
      res.redirect(303, back({ error: libraryErrorMessage(error) }));
    }
  }
);

/**
 * استيراد نتيجة بحث خارجي إلى المكتبة: يجلب الملف (إن وُجد) ثم يحفظ البيانات
 * مع مصدر الاستيراد ورابط المصدر الأصلي.
 */
router.post('/library/import', requireAdminPermission('admin:library'), async (req, res) => {
  const back = libraryBack(req);
  const body = req.body || {};
  const provider = String(body.provider || '');

  if (!LIBRARY_SOURCES.some((item) => item.id === provider)) {
    res.redirect(303, back({ error: 'مصدر غير معروف.' }));
    return;
  }

  try {
    const downloaded = await downloadExternalFile({ source: provider, locator: body.locator });
    await addLibraryItem({
      title: body.title,
      authors: body.authors,
      year: body.year,
      source: body.source_label,
      abstract: body.abstract,
      subjects: body.subjects,
      file: downloaded.buffer
        ? { buffer: downloaded.buffer, fileName: downloaded.fileName, mime: downloaded.mime }
        : null,
      externalUrl: body.item_url,
      sourceSystem: provider
    });

    res.redirect(
      303,
      back(downloaded.buffer ? { ok: 'library_imported' } : { ok: 'library_imported', note: downloaded.note || '' })
    );
  } catch (error) {
    console.warn(`فشل استيراد عنصر إلى المكتبة: ${error?.code || error?.message}`);
    res.redirect(303, back({ error: libraryErrorMessage(error) }));
  }
});

/** تعديل بيانات عنصر (مودال التعديل في الصفحة). */
router.post('/library/:id/edit', requireAdminPermission('admin:library'), async (req, res) => {
  const back = libraryBack(req);
  const body = req.body || {};

  try {
    const updated = await updateLibraryItem(String(req.params.id), {
      title: body.title,
      authors: body.authors,
      year: body.year,
      source: body.source,
      abstract: body.abstract,
      subjects: body.subjects,
      field: body.field,
      degreeLevel: body.degree_level,
      citation: body.citation
    });
    res.redirect(303, back(updated ? { ok: 'library_updated' } : { error: 'العنصر غير موجود.' }));
  } catch (error) {
    console.warn(`فشل تعديل عنصر المكتبة: ${error?.code || error?.message}`);
    res.redirect(303, back({ error: libraryErrorMessage(error) }));
  }
});

/** تفعيل/تعطيل عنصر — التعطيل يخفيه فوراً من نتائج الباحثين. */
router.post('/library/:id/toggle', requireAdminPermission('admin:library'), async (req, res) => {
  const back = libraryBack(req);
  const active = String(req.body?.active || '') === '1';
  const changed = await setLibraryItemActive(String(req.params.id), active);
  res.redirect(303, back(changed ? { ok: 'library_toggled' } : { error: 'العنصر غير موجود.' }));
});

/** حذف نهائي لعنصر المكتبة مع ملفه من القرص. */
router.post('/library/:id/delete', requireAdminPermission('admin:library'), async (req, res) => {
  const back = libraryBack(req);
  const deleted = await deleteLibraryItem(String(req.params.id));
  res.redirect(303, back(deleted ? { ok: 'library_deleted' } : { error: 'العنصر غير موجود.' }));
});

/** تحميل ملف عنصر المكتبة (للإدارة) — مرفق مع نص أمان مثل مسارات الملفات. */
router.get('/library/:id/file', requireAdminPermission('admin:library'), async (req, res) => {
  try {
    const found = await readLibraryItem(String(req.params.id));
    if (!found) {
      res.status(404).type('text').send('الملف غير موجود.');
      return;
    }
    if (!found.buffer) {
      res.status(410).type('text').send('بايتات الملف مفقودة على القرص.');
      return;
    }

    const name = encodeURIComponent(found.row.file_name || 'library-file');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('content-type', found.row.mime || 'application/octet-stream');
    res.setHeader('content-length', found.buffer.length);
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${name}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.send(found.buffer);
  } catch (error) {
    console.warn(`فشل تحميل ملف مكتبة: ${error?.code || error?.message}`);
    res.status(500).type('text').send('تعذّر قراءة الملف.');
  }
});



/**
 * رقم واتساب الدعم الفني — يضبطه المدير من الإعدادات ويسري فوراً بلا إعادة تشغيل
 * (كاش في الذاكرة + قيمة محفوظة). فارغ = تعطيل زر الواتساب في كل الصفحات.
 */
router.post('/settings/support-whatsapp', requireAdminPermission('admin:settings'), async (req, res) => {
  const back = tokenBack(req);
  try {
    const result = await saveSupportWhatsapp(req.body?.whatsapp);
    res.redirect(
      302,
      back('/admin/settings', result.ok
        ? { saved: '1', note: result.value ? 'wa_saved' : 'wa_cleared' }
        : { error: result.error })
    );
  } catch (error) {
    res.redirect(302, back('/admin/settings', { error: hintForDatabaseError(error) }));
  }
});

/** حفظ عملة الموقع (دينار ليبي / دولار) — تسري على كل الأسعار فوراً. */
router.post('/settings/currency', requireAdminPermission('admin:settings'), async (req, res) => {
  const back = tokenBack(req);
  try {
    const code = await setSiteCurrency(req.body?.currency);
    res.redirect(302, back('/admin/settings', { saved: '1', note: `currency:${code}` }));
  } catch (error) {
    res.redirect(302, back('/admin/settings', { error: hintForDatabaseError(error) }));
  }
});

/** إضافة/تعديل طريقة دفع (الاسم، العملة، التفاصيل، الترتيب، التفعيل). */
router.post('/settings/payment-methods', requireAdminPermission('admin:settings'), async (req, res) => {
  const back = tokenBack(req);
  try {
    await savePaymentMethod(req.body || {});
    res.redirect(302, back('/admin/settings', { saved: '1', note: 'method_saved' }));
  } catch (error) {
    console.warn(`فشل حفظ طريقة الدفع: ${error?.code || error?.message}`);
    res.redirect(302, back('/admin/settings', { error: error.message || hintForDatabaseError(error) }));
  }
});

/** حذف/تعطيل طريقة دفع (من لها طلبات تُعطَّل بدل حذفها). */
router.post('/settings/payment-methods/delete', requireAdminPermission('admin:settings'), async (req, res) => {
  const back = tokenBack(req);
  try {
    const result = await removePaymentMethod(req.body?.code);
    res.redirect(302, back('/admin/settings', { saved: '1', note: result }));
  } catch (error) {
    res.redirect(302, back('/admin/settings', { error: hintForDatabaseError(error) }));
  }
});

/* ===================== طلبات الدفع (صلاحية admin:payments) ===================== */

/** صندوق مراجعة طلبات الدفع: بحث + فلترة الحالة + ترقيم. */
router.get('/payments', requireAdminPermission('admin:payments'), (req, res) =>
  renderPage(
    res,
    async () => ({
      ...(await listPaymentRequests({
        status: String(req.query.status || 'pending'),
        q: String(req.query.q || '').slice(0, 100),
        page: req.query.page
      })),
      status: ['pending', 'confirmed', 'rejected', 'all'].includes(String(req.query.status))
        ? String(req.query.status)
        : 'pending',
      q: String(req.query.q || '').slice(0, 100),
      ok: PAYMENT_OK[String(req.query.ok || '')] || '',
      error: String(req.query.error || '').slice(0, 300),
      adminToken: String(req.query.token || '').slice(0, 200)
    }),
    renderAdminPayments
  )
);

/** تأكيد طلب: يفعّل الباقة ويضيف النقاط (عملية ذرّية في services/payments.js). */
router.post('/payments/:id/confirm', requireAdminPermission('admin:payments'), async (req, res) => {
  const back = tokenBack(req);
  try {
    const result = await confirmPaymentRequest(String(req.params.id), {
      adminNote: req.body?.admin_note,
      by: req.account?.email || 'لوحة الإدارة'
    });
    res.redirect(302, back('/admin/payments', { ok: `confirmed:${result.tokens}` }));
  } catch (error) {
    console.warn(`فشل تأكيد طلب الدفع: ${error?.code || error?.message}`);
    res.redirect(302, back('/admin/payments', { error: paymentErrorMessage(error) }));
  }
});

/** رفض طلب بملاحظة. */
router.post('/payments/:id/reject', requireAdminPermission('admin:payments'), async (req, res) => {
  const back = tokenBack(req);
  try {
    await rejectPaymentRequest(String(req.params.id), {
      adminNote: req.body?.admin_note,
      by: req.account?.email || 'لوحة الإدارة'
    });
    res.redirect(302, back('/admin/payments', { ok: 'rejected' }));
  } catch (error) {
    console.warn(`فشل رفض طلب الدفع: ${error?.code || error?.message}`);
    res.redirect(302, back('/admin/payments', { error: paymentErrorMessage(error) }));
  }
});

router.get('/usage', requireAdminPermission('admin:usage'), (req, res) => {
  const filter = readOpsFilter(req, { defaultLimit: 100 });
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  const term = `%${q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;

  return renderPage(
    res,
    async () => {
      const [summary, recent, totals, days14] = await Promise.all([
        pool.query(`SELECT type, count(*)::int AS events, COALESCE(SUM(tokens_used), 0)::int AS tokens
            FROM usage_logs
            GROUP BY type
            ORDER BY tokens DESC`),
        // بحث ?q= (إيميل/نوع/ملخص) + فلتر التاريخ/الساعات + عدد النتائج
        pool.query(
          `SELECT l.created_at, l.type, l.tokens_used, l.summary, u.email
             FROM usage_logs l
             JOIN users u ON u.id = l.user_id
            WHERE ($1::date IS NULL OR l.created_at::date = $1::date)
              AND ($2::int IS NULL OR date_part('hour', l.created_at) >= $2::int)
              AND ($3::int IS NULL OR date_part('hour', l.created_at) <= $3::int)
              AND ($4 = '' OR u.email ILIKE $5 OR l.type ILIKE $5 OR COALESCE(l.summary, '') ILIKE $5)
            ORDER BY l.created_at DESC
            LIMIT $6`,
          [filter.date, filter.h1, filter.h2, q, term, filter.limit]
        ),
        pool.query('SELECT COALESCE(SUM(tokens_used), 0)::int AS total FROM usage_logs'),
        pool.query(`SELECT to_char(gs::date, 'YYYY-MM-DD') AS day,
             COALESCE(count(l.id), 0)::int AS events,
             COALESCE(sum(l.tokens_used), 0)::int AS tokens
        FROM generate_series(current_date - interval '13 days', current_date::timestamp, interval '1 day') AS gs
   LEFT JOIN usage_logs l ON l.created_at::date = gs::date
    GROUP BY gs::date
    ORDER BY gs::date`)
      ]);

      return {
        summary: summary.rows,
        recent: recent.rows,
        totalTokens: totals.rows[0].total,
        days14: days14.rows,
        q,
        filter,
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminUsage
  );
});

router.get('/users', requireAdminPermission('admin:users'), (req, res) => {
  const search = String(req.query.q ?? '').trim().slice(0, 100);
  const filter = ALLOWED_FILTERS.has(String(req.query.filter)) ? String(req.query.filter) : 'all';
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const term = `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;

  // شرط البحث والفلترة مشترك بين استعلام البيانات واستعلام العدد
  const where = `WHERE ($1 = '' OR u.email ILIKE $2 OR COALESCE(u.full_name, '') ILIKE $2
      OR COALESCE(p.university, '') ILIKE $2 OR COALESCE(p.research_field, '') ILIKE $2)
    AND ($3 = 'all' OR ($3 = 'active' AND u.is_active) OR ($3 = 'disabled' AND NOT u.is_active))`;

  return renderPage(
    res,
    async () => {
      const [users, count] = await Promise.all([
        pool.query(
          `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.plan_code, u.tokens_balance, u.created_at,
              p.university, p.research_field, p.degree_level,
              COALESCE(SUM(l.tokens_used), 0)::int AS tokens_used
            FROM users u
            LEFT JOIN profiles p ON p.user_id = u.id
            LEFT JOIN usage_logs l ON l.user_id = u.id
            ${where}
            GROUP BY u.id, p.university, p.research_field, p.degree_level
            ORDER BY u.created_at DESC
            LIMIT $4 OFFSET $5`,
          [search, term, filter, PAGE_SIZE, (page - 1) * PAGE_SIZE]
        ),
        pool.query(
          `SELECT count(*)::int AS total
            FROM users u
            LEFT JOIN profiles p ON p.user_id = u.id
            ${where}`,
          [search, term, filter]
        )
      ]);

      return {
        users: users.rows,
        total: count.rows[0].total,
        page,
        pageSize: PAGE_SIZE,
        search,
        filter,
        ok: String(req.query.ok || '').slice(0, 60),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminUsers
  );
});

/**
 * إعدادات التخزين: يضبط المدير أقصى حجم للملف الواحد وأقصى مساحة إجمالية
 * لكل باحث. تُحفظ في جدول settings فتُطبَّق فوراً على كل الحسابات بلا إعادة تشغيل.
 */
router.get('/settings', requireAdminPermission('admin:settings'), (req, res) =>
  renderPage(
    res,
    async () => {
      const [limits, usage, supervisors, currency, methods] = await Promise.all([
        storageLimits(),
        pool.query(
          `SELECT count(*)::int AS files, COALESCE(sum(size_bytes), 0)::bigint AS bytes,
                  count(DISTINCT user_id)::int AS users
             FROM files`
        ),
        listSupervisors(),
        siteCurrency(),
        listPaymentMethods({ includeInactive: true })
      ]);

      return {
        limits,
        usage: usage.rows[0],
        supervisors,
        supervisorPermissions: await storedPermissionsOfRole(SUPERVISOR_ROLE),
        supportWhatsapp: currentSupportWhatsapp(),
        currency,
        methods,
        saved: req.query.saved === '1',
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminSettings
  )
);

/* ===================== المشرفون (بديل صفحة المديرين — من الإعدادات) ===================== */

router.post('/settings/supervisors/add', requireAdminPermission('admin:settings'), async (req, res) => {
  const back = tokenBack(req);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);

  if (!EMAIL_RE.test(email)) {
    res.redirect(302, back('/admin/settings', { error: 'بريد إلكتروني غير صالح.' }));
    return;
  }

  try {
    await addSupervisor(email, req.account?.email || 'لوحة الإدارة');
    res.redirect(302, back('/admin/settings', { saved: 'supervisor_added' }));
  } catch (error) {
    res.redirect(302, back('/admin/settings', { error: hintForDatabaseError(error) }));
  }
});

router.post('/settings/supervisors/delete', requireAdminPermission('admin:settings'), async (req, res) => {
  const back = tokenBack(req);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);

  if (!EMAIL_RE.test(email)) {
    res.redirect(302, back('/admin/settings', { error: 'بريد إلكتروني غير صالح.' }));
    return;
  }

  try {
    const removed = await removeSupervisor(email);
    res.redirect(302, back('/admin/settings', { saved: removed ? 'supervisor_removed' : 'supervisor_missing' }));
  } catch (error) {
    res.redirect(302, back('/admin/settings', { error: hintForDatabaseError(error) }));
  }
});

/** حفظ حدود التخزين بعد التحقق (المساحة الكلية ≥ حجم الملف). */
router.post('/settings/storage', requireAdminPermission('admin:settings'), async (req, res) => {
  const backToken = String(req.query.token || '').slice(0, 200);
  const params = (extra) => {
    const query = new URLSearchParams(extra);
    if (backToken) query.set('token', backToken);
    return `/admin/settings?${query.toString()}`;
  };

  try {
    await saveStorageLimits({
      maxUploadMb: req.body?.max_upload_mb,
      maxStorageMb: req.body?.max_storage_mb
    });
    res.redirect(302, params({ saved: '1' }));
  } catch (error) {
    res.redirect(302, params({ error: error?.message || 'تعذّر الحفظ' }));
  }
});

/**
 * إرسال إشعار لكل الباحثين النشطين: يُحفظ داخل موقع كل حساب فوراً،
 * ويرسل push لمن سجّل توكن هاتفه (أو يبقى داخلياً لو FCM غير مضبوط).
 */
router.post('/notifications', requireAdminPermission('admin:notify'), async (req, res) => {
  const backToken = String(req.query.token || '').slice(0, 200);
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const bodyText = String(req.body?.body || '').trim().slice(0, 500);

  const redirectToHome = (sent) => {
    const params = new URLSearchParams();
    params.set('sent', String(sent));
    if (backToken) params.set('token', backToken);
    res.redirect(302, `/admin?${params.toString()}`);
  };

  if (!title) {
    redirectToHome(0);
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE NOT COALESCE(deleted, false) AND COALESCE(is_active, true)`
    );

    // نجمع نتيجة كل مستخدم حتى **يعرف المدير ما الذي وصل فعلاً**:
    // من تحقّق الهاتف · من لا جهاز له · من فشل عند المزوّد (بلا رصيد/شبكة) · وما خطأه.
    const results = await Promise.all(
      rows.map((user) =>
        notifyUser(user.id, { title, body: bodyText, kind: 'broadcast', url: '/' })
      )
    );

    const delivered = results.filter((row) => (row.push?.sent || 0) > 0).length;
    const failed = results.filter((row) => (row.push?.failed || 0) > 0).length;
    const noDevice = results.filter((row) => (row.push?.skipped || 0) > 0).length;
    const firstError = results.find((row) => row.push?.error)?.push?.error || '';

    const params = new URLSearchParams();
    params.set('sent', String(rows.length));
    params.set('push', String(delivered));
    if (failed) params.set('push_failed', String(failed));
    if (noDevice) params.set('push_none', String(noDevice));
    if (firstError) params.set('push_error', firstError.slice(0, 160));
    if (backToken) params.set('token', backToken);
    res.redirect(302, `/admin?${params.toString()}`);
  } catch (error) {
    const { html } = renderNotice({
      title: 'تعذّر إرسال الإشعار',
      message: hintForDatabaseError(error),
      details: error?.message || ''
    });
    res.status(500).type('html').send(html);
  }
});

/* ===================== تفصيل باحث + إجراءات التحكم ===================== */

/** صفحة باحث واحدة: الحساب والملف والأرقام والإجراءات — كلها من PostgreSQL. */
router.get('/users/:id', requireAdminPermission('admin:users'), async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    const { html } = renderNotice({ title: 'معرّف غير صالح', message: 'مسار تفصيل الباحث يتطلب معرّفاً صحيحاً.', status: 404 });
    res.status(404).type('html').send(html);
    return;
  }

  try {
    const [userRes, profileRes, summaryRes, recentRes, plansRes] = await Promise.all([
      pool.query('SELECT * FROM users WHERE id = $1', [id]),
      pool.query('SELECT * FROM profiles WHERE user_id = $1', [id]),
      pool.query(
        `SELECT
           (SELECT count(*) FROM usage_logs WHERE user_id = $1)::int AS events,
           (SELECT COALESCE(sum(tokens_used), 0) FROM usage_logs WHERE user_id = $1)::int AS tokens_used,
           (SELECT count(*) FROM conversations WHERE user_id = $1)::int AS conversations,
           (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = $1)::int AS messages,
           (SELECT count(*) FROM files WHERE user_id = $1)::int AS files,
           (SELECT count(*) FROM notes WHERE user_id = $1)::int AS notes,
           (SELECT count(*) FROM user_references WHERE user_id = $1)::int AS refs`,
        [id]
      ),
      pool.query(
        'SELECT type, tokens_used, summary, created_at FROM usage_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
        [id]
      ),
      pool.query(`SELECT code, title, tokens FROM plans WHERE is_active = true ORDER BY (price = 0) DESC, price ASC`)
    ]);

    if (!userRes.rows.length) {
      const { html } = renderNotice({ title: 'غير موجود', message: 'لا يوجد باحث بهذا المعرّف.', status: 404 });
      res.status(404).type('html').send(html);
      return;
    }

    res.type('html').send(
      renderAdminUserDetail({
        user: userRes.rows[0],
        profile: profileRes.rows[0] || null,
        plans: plansRes.rows,
        summary: summaryRes.rows[0] || {},
        recent: recentRes.rows,
        ok: String(req.query.ok || '').slice(0, 60),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200),
        account: req.account || null
      })
    );
  } catch (error) {
    renderDbError(res, error);
  }
});

/** إيقاف/تفعيل حساب — يسري فوراً: الجلسة القادمة ترفض الموقوف. */
/**
 * إيقاف/تفعيل حساب.
 *
 * حماية صارمة لحساب المدير: لا يُوقَف ولا يُحذف ولا يُعطَّل — من أي حساب،
 * بمن فيهم المدير نفسه ومشرف يحمل صلاحية admin:users. الحماية عند المصدر
 * (SQL) لا في الواجهة فقط، فحتى أي استعلام لاحق لا يستطيع إيقافه.
 */
router.post('/users/:id/status', requireAdminPermission('admin:users'), async (req, res) => {
  const id = String(req.params.id);
  const back = tokenBack(req);
  const active = req.body?.active !== '0';

  if (!UUID_RE.test(id)) {
    res.redirect(302, back('/admin/users', { error: 'معرّف باحث غير صالح.' }));
    return;
  }
  if (req.account && req.account.id === id) {
    res.redirect(302, back(`/admin/users/${id}`, { error: 'لا يمكنك إيقاف حسابك أنت — اطلب ذلك من مدير آخر.' }));
    return;
  }

  try {
    // `role <> 'admin'` في الاستعلام نفسه: طبقة أمان ثانية في قاعدة البيانات
    const result = await pool.query(
      `UPDATE users SET is_active = $2, updated_at = NOW()
        WHERE id = $1 AND COALESCE(role, 'user') <> 'admin'`,
      [id, active]
    );

    if (!result.rowCount) {
      res.redirect(302, back(`/admin/users/${id}`, { error: adminProtectedMessage(id) }));
      return;
    }

    const target = req.body?.return === 'users' ? '/admin/users' : `/admin/users/${id}`;
    res.redirect(302, back(target, { ok: active ? 'activated' : 'suspended' }));
  } catch (error) {
    res.redirect(302, back(`/admin/users/${id}`, { error: hintForDatabaseError(error) }));
  }
});

/** منح/خصم نقاط: موجب للمنح والسالب للخصم، ويُسجَّل في usage_logs كتعديل إداري. */
router.post('/users/:id/points', requireAdminPermission('admin:users'), async (req, res) => {
  const id = String(req.params.id);
  const back = tokenBack(req);
  const amount = Number.parseInt(String(req.body?.amount ?? ''), 10);
  const note = String(req.body?.note || '').trim().slice(0, 120);

  if (!UUID_RE.test(id)) {
    res.redirect(302, back('/admin/users', { error: 'معرّف باحث غير صالح.' }));
    return;
  }
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) {
    res.redirect(
      302,
      back(`/admin/users/${id}`, { error: 'أدخل مقداراً صحيحاً مختلفاً من الصفر (بين -1000000 و1000000 نقطة).' })
    );
    return;
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET tokens_balance = GREATEST(tokens_balance + $2, 0), updated_at = NOW()
        WHERE id = $1
        RETURNING tokens_balance`,
      [id, amount]
    );
    if (!rows.length) {
      res.redirect(302, back('/admin/users', { error: 'هذا الباحث غير موجود.' }));
      return;
    }

    await pool.query(`INSERT INTO usage_logs (user_id, type, tokens_used, summary) VALUES ($1, 'admin_adjust', 0, $2)`, [
      id,
      `تعديل إداري ${amount > 0 ? '+' : ''}${amount} نقطة — الرصيد بعد التعديل ${rows[0].tokens_balance}${note ? ` · ${note}` : ''}`
    ]);

    res.redirect(302, back(`/admin/users/${id}`, { ok: 'points_adjusted' }));
  } catch (error) {
    res.redirect(302, back(`/admin/users/${id}`, { error: hintForDatabaseError(error) }));
  }
});

/** تغيير باقة الباحث — تتحقق من وجود الباقة وفعّلها في جدول plans. */
router.post('/users/:id/plan', requireAdminPermission('admin:users'), async (req, res) => {
  const id = String(req.params.id);
  const back = tokenBack(req);
  const code = String(req.body?.plan_code || '').trim().slice(0, 100);

  if (!UUID_RE.test(id)) {
    res.redirect(302, back('/admin/users', { error: 'معرّف باحث غير صالح.' }));
    return;
  }

  try {
    const plan = await pool.query('SELECT 1 FROM plans WHERE code = $1 AND is_active = true', [code]);
    if (!plan.rows.length) {
      res.redirect(302, back(`/admin/users/${id}`, { error: 'الباقة غير موجودة أو معطّلة في جدول plans.' }));
      return;
    }

    const result = await pool.query('UPDATE users SET plan_code = $2, updated_at = NOW() WHERE id = $1', [id, code]);
    if (!result.rowCount) {
      res.redirect(302, back('/admin/users', { error: 'هذا الباحث غير موجود.' }));
      return;
    }

    res.redirect(302, back(`/admin/users/${id}`, { ok: 'plan_updated' }));
  } catch (error) {
    res.redirect(302, back(`/admin/users/${id}`, { error: hintForDatabaseError(error) }));
  }
});

/** إشعار مخصص لباحث واحد: يُحفظ داخل موقعه فوراً + push إن كان مسجّلاً. */
router.post('/users/:id/notify', requireAdminPermission('admin:users'), async (req, res) => {
  const id = String(req.params.id);
  const back = tokenBack(req);
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const bodyText = String(req.body?.body || '').trim().slice(0, 500);

  if (!UUID_RE.test(id)) {
    res.redirect(302, back('/admin/users', { error: 'معرّف باحث غير صالح.' }));
    return;
  }
  if (!title) {
    res.redirect(302, back(`/admin/users/${id}`, { error: 'عنوان الإشعار مطلوب.' }));
    return;
  }

  try {
    await notifyUser(id, { title, body: bodyText, kind: 'admin', url: '/dashboard' });
    res.redirect(302, back(`/admin/users/${id}`, { ok: 'notified' }));
  } catch (error) {
    res.redirect(302, back(`/admin/users/${id}`, { error: hintForDatabaseError(error) }));
  }
});

/** حذف حساب نهائياً من قاعدة البيانات: بايتات الملفات أولاً ثم صف المستخدم — وكل سجلاته بـ CASCADE. */
/**
 * صلاحيات الخدمات التي تمنحها الباقة لمشتركيها — تعديلها من **صفحة الباقات**
 * نفسها (لا صفحة أدوار منفصلة): الباقة ودورها وجه واحد في نظر المدير.
 */
router.post('/plans/:code/permissions', requireAdminPermission('admin:plans'), async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.params.code).slice(0, 100);

  try {
    const { rows } = await pool.query('SELECT role_code, title FROM plans WHERE code = $1', [code]);
    if (!rows.length) {
      res.redirect(302, back('/admin/plans', { error: 'هذه الباقة غير موجودة.' }));
      return;
    }
    if (!rows[0].role_code) {
      res.redirect(302, back('/admin/plans', { error: `الباقة «${rows[0].title}» غير مربوطة بدور بعد.` }));
      return;
    }

    const result = await addRolePermission(rows[0].role_code, req.body?.permission);
    res.redirect(
      302,
      back('/admin/plans', result.ok ? { saved: `أُضيفت الصلاحية «${result.permission}» لباقة «${rows[0].title}».` } : { error: result.error })
    );
  } catch (error) {
    res.redirect(302, back('/admin/plans', { error: hintForDatabaseError(error) }));
  }
});

/** حذف صلاحية من باقة — نفس الصفحة، فوراً. */
router.post('/plans/:code/permissions/delete', requireAdminPermission('admin:plans'), async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.params.code).slice(0, 100);

  try {
    const { rows } = await pool.query('SELECT role_code, title FROM plans WHERE code = $1', [code]);
    if (!rows.length) {
      res.redirect(302, back('/admin/plans', { error: 'هذه الباقة غير موجودة.' }));
      return;
    }

    const result = await removeRolePermission(rows[0].role_code, req.body?.permission);
    res.redirect(
      302,
      back('/admin/plans', result.ok ? { saved: `حُذفت الصلاحية «${result.permission}» من باقة «${rows[0].title}».` } : { error: result.error })
    );
  } catch (error) {
    res.redirect(302, back('/admin/plans', { error: hintForDatabaseError(error) }));
  }
});

/**
 * صلاحيات دور المشرف — تعديلها من **صفحة الإعدادات** بجوار «إضافة مشرف»:
 * من يُدير المشرفون هو من يحدّد ما يستطيعون فعله، فنجمع الأمرين في مكان واحد.
 */
router.post('/settings/supervisors/permissions', requireAdminPermission('admin:roles'), async (req, res) => {
  const back = tokenBack(req);
  const result = await addRolePermission(SUPERVISOR_ROLE, req.body?.permission);
  res.redirect(
    302,
    back('/admin/settings', result.ok ? { saved: `أُضيفت الصلاحية «${result.permission}» للمشرفين.` } : { error: result.error })
  );
});

/** حذف صلاحية من دور المشرف. */
router.post('/settings/supervisors/permissions/delete', requireAdminPermission('admin:roles'), async (req, res) => {
  const back = tokenBack(req);
  const result = await removeRolePermission(SUPERVISOR_ROLE, req.body?.permission);
  res.redirect(
    302,
    back('/admin/settings', result.ok ? { saved: `حُذفت الصلاحية «${result.permission}» من المشرفين.` } : { error: result.error })
  );
});

/**
 * يقرأ حصة التخزين (MB) من نموذج الباقة ويحدّها ضمن [10, PLAN_STORAGE_MAX_MB].
 * القيمة الفارغة أو غير الرقمية ⇒ PLAN_STORAGE_DEFAULT_MB (500) دون رفض النموذج.
 */
function readStorageMb(body) {
  const raw = String(body?.storage_mb ?? '').trim();
  if (!raw) return PLAN_STORAGE_DEFAULT_MB;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) return PLAN_STORAGE_DEFAULT_MB;
  return Math.min(Math.max(n, 10), PLAN_STORAGE_MAX_MB);
}

/** إضافة باقة جديدة — تظهر فوراً في صفحة الهبوط وكل نصوص الموقع. يسبق مسار :code عمداً. */
router.post('/plans/add', requireAdminPermission('admin:plans'), async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.body?.code || '').trim().toLowerCase().slice(0, 50);
  const title = String(req.body?.title || '').trim().slice(0, 100);
  const tagline = String(req.body?.tagline || '').trim().slice(0, 160);
  const period = String(req.body?.period || '').trim().slice(0, 40) || 'شهرياً';
  const price = Number.parseInt(String(req.body?.price ?? '0'), 10);
  const tokens = Number.parseInt(String(req.body?.tokens ?? ''), 10);
  const storageMb = readStorageMb(req.body);
  const features = String(req.body?.features || '')
    .split('\n')
    .map((line) => line.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 40)
    .join('\n');
  const popular = req.body?.popular === '1';
  const isActive = req.body?.is_active === '1';
  const roleCode = String(req.body?.role_code || '').trim().slice(0, 50);

  const fail = (message) => {
    res.redirect(302, back('/admin/plans', { error: message }));
  };

  if (!/^[a-z0-9_-]{2,50}$/.test(code)) return fail('كود الباقة: حروف صغيرة وأرقام و _ و - فقط (من 2 إلى 50 حرفاً).');
  if (code === FREE_PLAN_CODE) return fail('كود باقة التجربة محجوز — اختر كوداً آخر.');
  if (!title) return fail('اسم الباقة مطلوب.');
  if (!Number.isInteger(price) || price < 0 || price > 10000000) {
    return fail('السعر يجب أن يكون رقماً صحيحاً بين 0 و10000000.');
  }
  if (!Number.isInteger(tokens) || tokens < 0 || tokens > 100000000) {
    return fail('النقاط يجب أن تكون رقمًا صحيحاً بين 0 و100000000.');
  }

  try {
    const exists = await pool.query('SELECT 1 FROM plans WHERE code = $1', [code]);
    if (exists.rows.length) return fail('هذا الكود مستخدم لباقة أخرى — اختر كوداً مختلفاً.');

    await pool.query(
      `INSERT INTO plans (code, title, tagline, period, price, tokens, storage_mb, features, popular, is_active, role_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [code, title, tagline, period, price, tokens, storageMb, features, popular, isActive, roleCode || 'free']
    );
    clearAccessCache();
    res.redirect(302, back('/admin/plans', { saved: code }));
  } catch (error) {
    return fail(hintForDatabaseError(error));
  }
});

/** حفظ تعديلات باقة — يسري فوراً على صفحة الهبوط وكل نصوص الموقع. */
router.post('/plans/:code', requireAdminPermission('admin:plans'), async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.params.code).slice(0, 100);
  const title = String(req.body?.title || '').trim().slice(0, 100);
  const tagline = String(req.body?.tagline || '').trim().slice(0, 160);
  const period = String(req.body?.period || '').trim().slice(0, 40) || 'شهرياً';
  const price = Number.parseInt(String(req.body?.price ?? ''), 10);
  const tokens = Number.parseInt(String(req.body?.tokens ?? ''), 10);
  const storageMb = readStorageMb(req.body);
  const features = String(req.body?.features || '')
    .split('\n')
    .map((line) => line.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 40)
    .join('\n');
  const popular = req.body?.popular === '1';
  const isActive = req.body?.is_active === '1';
  const roleCode = String(req.body?.role_code || '').trim().slice(0, 50);

  const fail = (message) => {
    res.redirect(302, back('/admin/plans', { error: message }));
  };

  if (!title) return fail('اسم الباقة مطلوب.');
  if (!Number.isInteger(price) || price < 0 || price > 10000000) {
    return fail('السعر يجب أن يكون رقماً صحيحاً بين 0 و10000000.');
  }
  if (!Number.isInteger(tokens) || tokens < 0 || tokens > 100000000) {
    return fail('النقاط يجب أن تكون رقمًا صحيحاً بين 0 و100000000.');
  }

  try {
    const result = await pool.query(
      `UPDATE plans
          SET title = $2, tagline = $3, period = $4, price = $5, tokens = $6, storage_mb = $11,
              features = $7, popular = $8, is_active = $9, role_code = $10
        WHERE code = $1`,
      [
        code,
        title,
        tagline,
        period,
        code === FREE_PLAN_CODE ? 0 : price,
        tokens,
        features,
        popular,
        isActive,
        roleCode || null,
        storageMb
      ]
    );

    if (!result.rowCount) return fail('الباقة غير موجودة في جدول plans.');
    clearAccessCache();
    res.redirect(302, back('/admin/plans', { saved: code }));
  } catch (error) {
    return fail(hintForDatabaseError(error));
  }
});

/**
 * حذف باقة: الخيار الأخير حين تصبح الباقة بلا فائدة.
 *
 * قواعد الأمان:
 *   - الباقة المجانية (free_trial) لا تُحذف أبداً — هي أساس المنصة.
 *   - إن كان مشتركون عليها يُنقلون أولاً إلى الباقة المجانية (وليس
 *     plan_code = NULL) حتى لا يفقدوا خدماتهم.
 *   - لا يحدث شيء إلا بتأكيد صريح (confirm=1) من نموذج يحمل data-confirm.
 */
router.post('/plans/:code/delete', requireAdminPermission('admin:plans'), async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.params.code || '').trim().slice(0, 100);

  if (code === FREE_PLAN_CODE) {
    res.redirect(302, back('/admin/plans', { error: 'لا يمكن حذف الباقة المجانية — هي أساس المنصة.' }));
    return;
  }
  if (req.body?.confirm !== '1') {
    res.redirect(302, back('/admin/plans', { error: 'الحذف يحتاج تأكيداً صريحاً — لم يُنفَّذ.' }));
    return;
  }

  try {
    const found = await pool.query('SELECT code, title FROM plans WHERE code = $1', [code]);
    if (!found.rows.length) {
      res.redirect(302, back('/admin/plans', { error: 'الباقة غير موجودة.' }));
      return;
    }

    // نقل المشتركين إلى الباقة المجانية أولاً ( ضمن معاملة مع الحذف )
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const moved = await client.query(
        'UPDATE users SET plan_code = $2, updated_at = NOW() WHERE plan_code = $1',
        [code, FREE_PLAN_CODE]
      );
      const deleted = await client.query('DELETE FROM plans WHERE code = $1', [code]);
      await client.query('COMMIT');

      if (!deleted.rowCount) {
        await client.query('ROLLBACK').catch(() => {});
        res.redirect(302, back('/admin/plans', { error: 'تعذّر حذف الباقة.' }));
        return;
      }

      clearAccessCache();
      res.redirect(
        302,
        back('/admin/plans', {
          saved: 'plan_deleted',
          note: `${found.rows[0].title}${Number(moved.rowCount) ? ` · نُقل ${moved.rowCount} مشترك إلى الباقة المجانية` : ''}`
        })
      );
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn(`فشل حذف الباقة ${code}: ${error?.code || error?.message}`);
    res.redirect(302, back('/admin/plans', { error: hintForDatabaseError(error) }));
  }
});

export { router as adminRouter };
