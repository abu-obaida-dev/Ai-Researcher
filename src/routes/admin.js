import express from 'express';
import { pool } from '../db/client.js';
import { hintForDatabaseError } from '../db/errors.js';
import { FREE_PLAN_CODE } from '../constants.js';
import { renderNotice } from '../views/layout.js';
import { notifyUser } from '../services/notifications.js';
import { adminEmailsFromEnv } from '../services/users.js';
import { saveStorageLimits, storageLimits } from '../services/settings.js';
import {
  renderAdminAdmins,
  renderAdminHome,
  renderAdminPlans,
  renderAdminProviders,
  renderAdminRoles,
  renderAdminSettings,
  renderAdminUsage,
  renderAdminUserDetail,
  renderAdminUsers
} from '../views/admin.js';
import { probeProvider, providerStatus, addCustomLink, customLinks, linkCatalog, removeCustomLink } from '../services/ai.js';

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

/** مدة تشغيل الخادم بصيغة عربية (أيام/ساعات/دقائق) لبطاقة حالة النظام. */
function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} يوم و${hours} ساعة`;
  if (hours) return `${hours} ساعة و${minutes} دقيقة`;
  return `${minutes} دقيقة`;
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

/**
 * حماية الصفحات:
 * - إن كان ADMIN_TOKEN معرّفاً في .env: يجب إرساله في x-admin-token أو ?token= أو Basic Auth.
 * - إن لم يكن معرّفاً: يُسمح بالوصول من الجهاز المحلي فقط (افتراض آمن للتطوير).
 */
function requireAdminAccess(req, res, next) {
  // مدير مسجّل بحساب جوجل مُدرج في قائمة المديرين يدخل مباشرة بدون رمز
  if (req.account?.role === 'admin') {
    next();
    return;
  }

  const token = process.env.ADMIN_TOKEN;

  if (token) {
    const provided = req.get('x-admin-token') || req.query.token || basicAuthPassword(req);
    if (provided === token) {
      next();
      return;
    }

    const { html } = renderNotice({
      title: 'الوصول مرفوض',
      message: 'لوحة الإدارة محمية برمز إداري. أرسل الرمز في الترويسة x-admin-token أو في ?token=.',
      details: 'ADMIN_TOKEN معرّف في ملف .env لهذا الخادم.'
    });
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

router.get('/', (req, res) => {
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
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminHome
  );
});

/**
 * حالة مزوّدي الذكاء الاصطناعي: من يعمل، من متوقّف، ولماذا بالضبط.
 * ?probe=1 يرسل نداءً صغيراً لكل مزوّد (يستهلك رصيداً ضئيلاً) ليرى المدير
 * السبب الحقيقي: 402 لا رصيد · 403 لا ترخيص · 429 حصة · 503 ازدحام.
 */
router.get('/providers', (req, res) =>
  renderPage(
    res,
    async () => {
      const status = providerStatus();
      const shouldProbe = ['1', 'true', 'yes'].includes(String(req.query.probe || '').toLowerCase());

      const probes = shouldProbe
        ? await Promise.all(status.filter((item) => item.configured).map((item) => probeProvider(item.key, { timeoutMs: 25000, perKey: true })))
        : [];

      return {
        status: status.map((item) => ({ ...item, probe: probes.find((p) => p.key === item.key) || null })),
        probed: shouldProbe,
        links: customLinks(),
        catalog: linkCatalog(),
        saved: String(req.query.saved || '').slice(0, 60),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminProviders
  )
);

/** ربط موديل بمفتاح خاص: يُحفظ في الإعدادات ويدخل الكاش فوراً (بلا إعادة تشغيل). */
router.post('/providers/link', async (req, res) => {
  const back = tokenBack(req);
  const result = await addCustomLink({
    provider: req.body?.provider,
    model: req.body?.model,
    api_key: req.body?.api_key
  });
  res.redirect(302, back('/admin/providers', result.ok ? { saved: 'link_added' } : { error: result.error }));
});

/** حذف رابط موديل بفهرسه: يخرج المفتاح من السباق ويحدّث الكاش فوراً. */
router.post('/providers/link/delete', async (req, res) => {
  const back = tokenBack(req);
  const result = await removeCustomLink(req.body?.index);
  res.redirect(302, back('/admin/providers', result.ok ? { saved: 'link_removed' } : { error: result.error }));
});

router.get('/plans', (req, res) =>
  renderPage(
    res,
    async () => {
      const { rows } = await pool.query(`SELECT p.code, p.title, p.tagline, p.price, p.tokens, p.period,
            p.features, p.popular, p.is_active, p.created_at,
            (SELECT count(*) FROM users u WHERE u.plan_code = p.code)::int AS subscribers
          FROM plans p
          ORDER BY p.price ASC, p.title ASC`);

      return {
        plans: rows,
        totalSubscribers: rows.reduce((total, plan) => total + Number(plan.subscribers), 0),
        saved: String(req.query.saved || '').slice(0, 100),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminPlans
  )
);

router.get('/usage', (req, res) => {
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

router.get('/users', (req, res) => {
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
router.get('/settings', (req, res) =>
  renderPage(
    res,
    async () => {
      const [limits, usage, systemRows] = await Promise.all([
        storageLimits(),
        pool.query(
          `SELECT count(*)::int AS files, COALESCE(sum(size_bytes), 0)::bigint AS bytes,
                  count(DISTINCT user_id)::int AS users
             FROM files`
        ),
        pool.query(`SELECT current_database() AS database,
            (SELECT count(*) FROM users)::int AS users,
            (SELECT count(*) FROM plans)::int AS plans,
            (SELECT count(*) FROM usage_logs)::int AS usage_events,
            (SELECT count(*) FROM notifications)::int AS notifications,
            (SELECT count(*) FROM settings)::int AS settings_rows`)
      ]);

      const status = providerStatus();
      const system = {
        ...systemRows.rows[0],
        node: process.version,
        uptime: formatUptime(process.uptime()),
        adminToken: process.env.ADMIN_TOKEN ? 'معرّف (متاحة من أي جهاز)' : 'غير معرّف (localhost فقط)',
        providers: `${status.filter((item) => item.configured).length} من ${status.length}`
      };

      return {
        limits,
        usage: usage.rows[0],
        system,
        saved: req.query.saved === '1',
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminSettings
  )
);

/** حفظ حدود التخزين بعد التحقق (المساحة الكلية ≥ حجم الملف). */
router.post('/settings/storage', async (req, res) => {
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
router.post('/notifications', async (req, res) => {
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
    await Promise.all(
      rows.map((user) =>
        notifyUser(user.id, { title, body: bodyText, kind: 'broadcast', url: '/' })
      )
    );
    redirectToHome(rows.length);
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
router.get('/users/:id', async (req, res) => {
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
router.post('/users/:id/status', async (req, res) => {
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
    await pool.query('UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1', [id, active]);
    const target = req.body?.return === 'users' ? '/admin/users' : `/admin/users/${id}`;
    res.redirect(302, back(target, { ok: active ? 'activated' : 'suspended' }));
  } catch (error) {
    res.redirect(302, back(`/admin/users/${id}`, { error: hintForDatabaseError(error) }));
  }
});

/** منح/خصم نقاط: موجب للمنح والسالب للخصم، ويُسجَّل في usage_logs كتعديل إداري. */
router.post('/users/:id/points', async (req, res) => {
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
router.post('/users/:id/plan', async (req, res) => {
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
router.post('/users/:id/notify', async (req, res) => {
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

/** حذف حساب (soft delete): يمنع الدخول فوراً ويبقى السجل في القاعدة. */
router.post('/users/:id/delete', async (req, res) => {
  const id = String(req.params.id);
  const back = tokenBack(req);

  if (!UUID_RE.test(id)) {
    res.redirect(302, back('/admin/users', { error: 'معرّف باحث غير صالح.' }));
    return;
  }
  if (req.account && req.account.id === id) {
    res.redirect(302, back('/admin/users', { error: 'لا يمكنك حذف حسابك أنت.' }));
    return;
  }

  try {
    const found = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (!found.rows.length) {
      res.redirect(302, back('/admin/users', { error: 'هذا الباحث غير موجود.' }));
      return;
    }
    if (found.rows[0].role === 'admin') {
      res.redirect(
        302,
        back(`/admin/users/${id}`, { error: 'لا يمكن حذف حساب مدير من هنا — أزل إيميله من صفحة المديرين أولاً.' })
      );
      return;
    }

    await pool.query('UPDATE users SET deleted = true, is_active = false, updated_at = NOW() WHERE id = $1', [id]);
    res.redirect(302, back('/admin/users', { ok: 'user_deleted' }));
  } catch (error) {
    res.redirect(302, back('/admin/users', { error: hintForDatabaseError(error) }));
  }
});

/* ===================== إدارة المديرين (جدول admins) ===================== */

router.get('/admins', (req, res) =>
  renderPage(
    res,
    async () => {
      const { rows } = await pool.query('SELECT email, added_by, created_at FROM admins ORDER BY created_at DESC');
      return {
        dbAdmins: rows,
        saved: String(req.query.saved || '').slice(0, 60),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminAdmins
  )
);

/** تعديل بريد مدير موجود — يحدّث الجدول ويحتفظ بإضافة/تاريخ السطر. */
router.post('/admins/edit', async (req, res) => {
  const back = tokenBack(req);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);
  const newEmail = String(req.body?.new_email || '').trim().toLowerCase().slice(0, 255);

  if (!EMAIL_RE.test(email) || !EMAIL_RE.test(newEmail)) {
    res.redirect(302, back('/admin/admins', { error: 'بريد إلكتروني غير صالح.' }));
    return;
  }
  if (email === newEmail) {
    res.redirect(302, back('/admin/admins', { saved: 'admin_updated' }));
    return;
  }
  if (adminEmailsFromEnv().includes(newEmail)) {
    res.redirect(302, back('/admin/admins', { error: 'هذا البريد موجود في .env أصلاً — لا يحتاج إضافته هنا.' }));
    return;
  }

  try {
    const clash = await pool.query('SELECT 1 FROM admins WHERE lower(email) = $1 AND lower(email) <> $2', [
      newEmail,
      email
    ]);
    if (clash.rows.length) {
      res.redirect(302, back('/admin/admins', { error: 'البريد الجديد مستخدم لمدير آخر.' }));
      return;
    }

    const result = await pool.query('UPDATE admins SET email = $2 WHERE lower(email) = $1', [email, newEmail]);
    if (!result.rowCount) {
      res.redirect(302, back('/admin/admins', { error: 'هذا المدير غير موجود في الجدول.' }));
      return;
    }

    res.redirect(302, back('/admin/admins', { saved: 'admin_updated' }));
  } catch (error) {
    res.redirect(302, back('/admin/admins', { error: hintForDatabaseError(error) }));
  }
});

/** إضافة إيميل مدير إلى الجدول — يصبح صاحبه مديراً في طلبه القادم فوراً. */
router.post('/admins/add', async (req, res) => {
  const back = tokenBack(req);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);

  if (!EMAIL_RE.test(email)) {
    res.redirect(302, back('/admin/admins', { error: 'بريد إلكتروني غير صالح.' }));
    return;
  }

  try {
    await pool.query(
      'INSERT INTO admins (email, added_by, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (email) DO NOTHING',
      [email, req.account?.email || 'لوحة الإدارة']
    );
    res.redirect(302, back('/admin/admins', { saved: 'admin_added' }));
  } catch (error) {
    res.redirect(302, back('/admin/admins', { error: hintForDatabaseError(error) }));
  }
});

/** إزالة إيميل مدير من الجدول (إيميلات .env محمية ولا تُزال من اللوحة). */
router.post('/admins/delete', async (req, res) => {
  const back = tokenBack(req);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);

  if (!EMAIL_RE.test(email)) {
    res.redirect(302, back('/admin/admins', { error: 'بريد إلكتروني غير صالح.' }));
    return;
  }
  if (req.account && String(req.account.email || '').trim().toLowerCase() === email) {
    res.redirect(302, back('/admin/admins', { error: 'لا يمكنك إزالة إيميل حسابك أنت.' }));
    return;
  }
  if (adminEmailsFromEnv().includes(email)) {
    res.redirect(302, back('/admin/admins', { error: 'هذا الإيميل ثابت في ملف .env — يُزال من هناك وحده.' }));
    return;
  }

  try {
    await pool.query('DELETE FROM admins WHERE lower(email) = $1', [email]);
    res.redirect(302, back('/admin/admins', { saved: 'admin_removed' }));
  } catch (error) {
    res.redirect(302, back('/admin/admins', { error: hintForDatabaseError(error) }));
  }
});

/* ===================== الأدوار والصلاحيات (roles + role_permissions) ===================== */

router.get('/roles', (req, res) =>
  renderPage(
    res,
    async () => {
      const { rows } = await pool.query(
        `SELECT r.code, r.title, r.level,
             count(DISTINCT u.id)::int AS members,
             COALESCE(array_agg(DISTINCT rp.permission ORDER BY rp.permission)
               FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON rp.role_code = r.code
        LEFT JOIN users u ON u.role = r.code
       GROUP BY r.code
       ORDER BY r.level, r.code`
      );

      return {
        roles: rows,
        saved: String(req.query.saved || '').slice(0, 200),
        error: String(req.query.error || '').slice(0, 300),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminRoles
  )
);

/** إضافة صلاحية لدور — تُكتب مباشرة في role_permissions. */
router.post('/roles/:code/permissions', async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.params.code).slice(0, 50);
  const permission = String(req.body?.permission || '').trim().slice(0, 100);

  if (!PERMISSION_RE.test(permission)) {
    res.redirect(
      302,
      back('/admin/roles', { error: 'صلاحية غير صالحة: حروف لاتينية وأرقام و«:» و«_» و«-» فقط.' })
    );
    return;
  }

  try {
    const role = await pool.query('SELECT title FROM roles WHERE code = $1', [code]);
    if (!role.rows.length) {
      res.redirect(302, back('/admin/roles', { error: 'هذا الدور غير موجود في جدول roles.' }));
      return;
    }

    await pool.query(
      'INSERT INTO role_permissions (role_code, permission) VALUES ($1, $2) ON CONFLICT (role_code, permission) DO NOTHING',
      [code, permission]
    );
    res.redirect(
      302,
      back('/admin/roles', { saved: `أُضيفت الصلاحية «${permission}» إلى دور «${role.rows[0].title}».` })
    );
  } catch (error) {
    res.redirect(302, back('/admin/roles', { error: hintForDatabaseError(error) }));
  }
});

/** حذف صلاحية من دور — الصلاحية * (كل الصلاحيات) محمية. */
router.post('/roles/:code/permissions/delete', async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.params.code).slice(0, 50);
  const permission = String(req.body?.permission || '').trim().slice(0, 100);

  if (permission === '*') {
    res.redirect(302, back('/admin/roles', { error: 'صلاحية «*» (كل الصلاحيات) لا يمكن حذفها — فهي حماية دور المدير.' }));
    return;
  }
  if (!PERMISSION_RE.test(permission)) {
    res.redirect(302, back('/admin/roles', { error: 'صلاحية غير صالحة.' }));
    return;
  }

  try {
    const result = await pool.query(
      'DELETE FROM role_permissions WHERE role_code = $1 AND permission = $2',
      [code, permission]
    );
    if (!result.rowCount) {
      res.redirect(302, back('/admin/roles', { error: 'هذه الصلاحية غير موجودة في هذا الدور.' }));
      return;
    }

    res.redirect(302, back('/admin/roles', { saved: `حُذفت الصلاحية «${permission}» من الدور «${code}».` }));
  } catch (error) {
    res.redirect(302, back('/admin/roles', { error: hintForDatabaseError(error) }));
  }
});

/** إضافة باقة جديدة — تظهر فوراً في صفحة الهبوط وكل نصوص الموقع. يسبق مسار :code عمداً. */
router.post('/plans/add', async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.body?.code || '').trim().toLowerCase().slice(0, 50);
  const title = String(req.body?.title || '').trim().slice(0, 100);
  const tagline = String(req.body?.tagline || '').trim().slice(0, 160);
  const period = String(req.body?.period || '').trim().slice(0, 40) || 'شهرياً';
  const price = Number.parseInt(String(req.body?.price ?? '0'), 10);
  const tokens = Number.parseInt(String(req.body?.tokens ?? ''), 10);
  const features = String(req.body?.features || '')
    .split('\n')
    .map((line) => line.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 40)
    .join('\n');
  const popular = req.body?.popular === '1';
  const isActive = req.body?.is_active === '1';

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
      `INSERT INTO plans (code, title, tagline, period, price, tokens, features, popular, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [code, title, tagline, period, price, tokens, features, popular, isActive]
    );
    res.redirect(302, back('/admin/plans', { saved: code }));
  } catch (error) {
    return fail(hintForDatabaseError(error));
  }
});

/** حفظ تعديلات باقة — يسري فوراً على صفحة الهبوط وكل نصوص الموقع. */
router.post('/plans/:code', async (req, res) => {
  const back = tokenBack(req);
  const code = String(req.params.code).slice(0, 100);
  const title = String(req.body?.title || '').trim().slice(0, 100);
  const tagline = String(req.body?.tagline || '').trim().slice(0, 160);
  const period = String(req.body?.period || '').trim().slice(0, 40) || 'شهرياً';
  const price = Number.parseInt(String(req.body?.price ?? ''), 10);
  const tokens = Number.parseInt(String(req.body?.tokens ?? ''), 10);
  const features = String(req.body?.features || '')
    .split('\n')
    .map((line) => line.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 40)
    .join('\n');
  const popular = req.body?.popular === '1';
  const isActive = req.body?.is_active === '1';

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
          SET title = $2, tagline = $3, period = $4, price = $5, tokens = $6,
              features = $7, popular = $8, is_active = $9
        WHERE code = $1`,
      [code, title, tagline, period, code === FREE_PLAN_CODE ? 0 : price, tokens, features, popular, isActive]
    );

    if (!result.rowCount) return fail('الباقة غير موجودة في جدول plans.');
    res.redirect(302, back('/admin/plans', { saved: code }));
  } catch (error) {
    return fail(hintForDatabaseError(error));
  }
});

export { router as adminRouter };
