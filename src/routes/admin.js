import express from 'express';
import { pool } from '../db/client.js';
import { hintForDatabaseError } from '../db/errors.js';
import { renderNotice } from '../views/layout.js';
import { notifyUser } from '../services/notifications.js';
import {
  renderAdminHome,
  renderAdminPlans,
  renderAdminUsage,
  renderAdminUsers
} from '../views/admin.js';

/**
 * لوحة الإدارة: صفحات HTML مولَّدة على الخادم بديلاً عن واجهة /admin القديمة (React).
 * كل الصفحات قراءة فقط من PostgreSQL، وحمايتها تُقرأ من ADMIN_TOKEN في .env.
 */
const router = express.Router();

const PAGE_SIZE = 20;
const ALLOWED_FILTERS = new Set(['all', 'active', 'disabled']);

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

/** يعرض صفحة HTML، وعند فشل قاعدة البيانات يعرض صفحة عربية واضحة بخطوات الحل. */
async function renderPage(res, load, view) {
  try {
    res.type('html').send(view(await load()));
  } catch (error) {
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
}

router.get('/', (req, res) =>
  renderPage(
    res,
    async () => {
      const [counts, latestUsers] = await Promise.all([
        pool.query(`SELECT
            (SELECT count(*) FROM users)::int AS users,
            (SELECT count(*) FROM users WHERE is_active)::int AS active_users,
            (SELECT count(*) FROM users WHERE role = 'admin')::int AS admins,
            (SELECT count(*) FROM profiles)::int AS profiles,
            (SELECT count(*) FROM plans)::int AS plans,
            (SELECT count(*) FROM usage_logs)::int AS usage_events,
            (SELECT COALESCE(SUM(tokens_used), 0) FROM usage_logs)::int AS tokens_used`),
        pool.query(`SELECT u.id, u.email, u.full_name, u.plan_code, u.tokens_balance, u.created_at, p.university
            FROM users u
            LEFT JOIN profiles p ON p.user_id = u.id
            ORDER BY u.created_at DESC
            LIMIT 5`)
      ]);

      return {
        counts: counts.rows[0],
        latestUsers: latestUsers.rows,
        sent: Math.max(0, Number.parseInt(req.query.sent, 10) || 0),
        adminToken: String(req.query.token || '').slice(0, 200)
      };
    },
    renderAdminHome
  )
);

router.get('/plans', (_req, res) =>
  renderPage(
    res,
    async () => {
      const { rows } = await pool.query(`SELECT p.code, p.title, p.price, p.tokens, p.is_active, p.created_at,
            (SELECT count(*) FROM users u WHERE u.plan_code = p.code)::int AS subscribers
          FROM plans p
          ORDER BY p.price ASC, p.title ASC`);

      return {
        plans: rows,
        totalSubscribers: rows.reduce((total, plan) => total + Number(plan.subscribers), 0)
      };
    },
    renderAdminPlans
  )
);

router.get('/usage', (_req, res) =>
  renderPage(
    res,
    async () => {
      const [summary, recent, totals] = await Promise.all([
        pool.query(`SELECT type, count(*)::int AS events, COALESCE(SUM(tokens_used), 0)::int AS tokens
            FROM usage_logs
            GROUP BY type
            ORDER BY tokens DESC`),
        pool.query(`SELECT l.created_at, l.type, l.tokens_used, l.summary, u.email
            FROM usage_logs l
            JOIN users u ON u.id = l.user_id
            ORDER BY l.created_at DESC
            LIMIT 100`),
        pool.query('SELECT COALESCE(SUM(tokens_used), 0)::int AS total FROM usage_logs')
      ]);

      return {
        summary: summary.rows,
        recent: recent.rows,
        totalTokens: totals.rows[0].total
      };
    },
    renderAdminUsage
  )
);

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
        filter
      };
    },
    renderAdminUsers
  );
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

export { router as adminRouter };
