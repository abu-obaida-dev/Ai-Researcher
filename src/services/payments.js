import { pool } from '../db/client.js';
import { DEFAULT_CURRENCY, DEFAULT_PAYMENT_METHODS, SITE_CURRENCIES, isUuid } from '../constants.js';

/**
 * الدفع اليدوي خارج المنصة + إدارة الطلبات:
 *
 *   - الباحث يختار طريقة ويقدّم طلباً (باقة + مبلغ + رقم عملية + ملاحظة).
 *   - المدير (أو مشرف يحمل صلاحية admin:payments) يؤكّد الطلب فيُمنح الباحث
 *     باقة الطلب ونقاطها، أو يرفضه بملاحظة.
 *   - الأسعار تُقرأ من جدول plans وقت الطلب (لا يُرسل السعر من المتصفح).
 */

const STATUSES = ['pending', 'confirmed', 'rejected'];
const MAX_PENDING_PER_USER = 5;

function badInput(message, code = 'BAD_INPUT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** عملة صالحة من القائمة المدعومة. */
export function normalizeCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return SITE_CURRENCIES.some((item) => item.code === code) ? code : DEFAULT_CURRENCY;
}

/** عملة الموقع من الإعدادات (سقوط آمن على الافتراضي). */
export async function siteCurrency() {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'site_currency'");
    return normalizeCurrency(rows[0]?.value);
  } catch {
    return DEFAULT_CURRENCY;
  }
}

/** تغيير عملة الموقع (من الإعدادات). */
export async function setSiteCurrency(code) {
  const next = normalizeCurrency(code);
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('site_currency', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [next]
  );
  return next;
}

function normalizeMethod(row) {
  return {
    code: row.code,
    label: row.label,
    note: row.note || '',
    details: row.details || '',
    currency: normalizeCurrency(row.currency),
    isActive: row.is_active !== false,
    displayOrder: Number(row.display_order || 0)
  };
}

/** طرق الدفع النشطة للباحث (من الجدول، مع سقوط آمن لقائمة الثوابت). */
export async function listPaymentMethods({ includeInactive = false } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT code, label, note, details, currency, is_active, display_order
         FROM payment_methods ${includeInactive ? '' : 'WHERE is_active'}
        ORDER BY display_order ASC, label ASC`
    );
    if (rows.length) return rows.map(normalizeMethod);
  } catch (error) {
    console.warn(`تعذّرت قراءة طرق الدفع: ${error.code || error.message}`);
  }
  return DEFAULT_PAYMENT_METHODS.map((item) => ({ ...item, isActive: true, displayOrder: 0 }));
}

/** إضافة/تعديل طريقة دفع (المدير من الإعدادات). */
export async function savePaymentMethod(input = {}) {
  const code = String(input.code || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 50);
  const label = String(input.label || '').trim().slice(0, 120);

  if (!code) throw badInput('كود الطريقة مطلوب (حروف إنجليزية صغيرة وأرقام فقط).');
  if (!label) throw badInput('اسم طريقة الدفع مطلوب.');

  await pool.query(
    `INSERT INTO payment_methods (code, label, note, details, currency, is_active, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (code) DO UPDATE SET
       label = EXCLUDED.label,
       note = EXCLUDED.note,
       details = EXCLUDED.details,
       currency = EXCLUDED.currency,
       is_active = EXCLUDED.is_active,
       display_order = EXCLUDED.display_order`,
    [
      code,
      label,
      String(input.note || '').trim().slice(0, 255),
      String(input.details || '').trim().slice(0, 2000),
      normalizeCurrency(input.currency),
      input.is_active !== false && input.is_active !== '0',
      Math.min(Math.max(Number(input.display_order) || 0, 0), 999)
    ]
  );

  return code;
}

/** تعطيل/حذف طريقة (من لها طلبات سابقة تُعطَّل بدل حذفها). */
export async function removePaymentMethod(code) {
  const key = String(code || '').trim().toLowerCase().slice(0, 50);
  const used = await pool.query('SELECT 1 FROM payment_requests WHERE method_code = $1 LIMIT 1', [key]);
  if (used.rows.length) {
    await pool.query('UPDATE payment_methods SET is_active = false WHERE code = $1', [key]);
    return 'disabled';
  }
  const { rowCount } = await pool.query('DELETE FROM payment_methods WHERE code = $1', [key]);
  return rowCount > 0 ? 'deleted' : 'missing';
}

/**
 * تقديم طلب دفع. السعر يؤخذ من جدول plans (لا يُرسل من المتصفح)،
 * والحد الأقصى للطلبات المعلّقة يمنع التزاحم على صندوق المراجعة.
 */
export async function createPaymentRequest(userId, input = {}) {
  const planCode = String(input.plan_code || '').trim().slice(0, 100);
  const methodCode = String(input.method_code || '').trim().toLowerCase().slice(0, 50);
  const referenceNo = String(input.reference_no || '').trim().slice(0, 120);
  const note = String(input.note || '').trim().slice(0, 1000);

  const [{ rows: planRows }, methods] = await Promise.all([
    pool.query('SELECT code, title, price, tokens FROM plans WHERE code = $1 AND is_active = true', [planCode]),
    listPaymentMethods()
  ]);
  const plan = planRows[0];
  if (!plan) throw badInput('الباقة المطلوبة غير موجودة أو معطّلة.', 'BAD_PLAN');

  const method = methods.find((item) => item.code === methodCode);
  if (!method) throw badInput('طريقة الدفع غير متاحة — حدّث الصفحة.', 'BAD_METHOD');
  if (Number(plan.price) <= 0) throw badInput('هذه الباقة مجانية — لا تحتاج طلب دفع.', 'BAD_PLAN');
  if (!referenceNo) throw badInput('اكتب رقم عملية التحويل أو رقم الإيصال.', 'BAD_REFERENCE');

  const { rows: pending } = await pool.query(
    "SELECT count(*)::int AS c FROM payment_requests WHERE user_id = $1 AND status = 'pending'",
    [userId]
  );
  if (pending[0].c >= MAX_PENDING_PER_USER) {
    throw badInput(`لديك ${pending[0].c} طلبات قيد المراجعة — انتظر رد الإدارة قبل إرسال طلب جديد.`, 'TOO_MANY');
  }

  const { rows } = await pool.query(
    `INSERT INTO payment_requests (user_id, plan_code, method_code, amount, currency, reference_no, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, plan.code, method.code, plan.price, method.currency, referenceNo, note || null]
  );

  return rows[0];
}

function normalizeRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.email || '',
    userName: row.full_name || '',
    planCode: row.plan_code || '',
    planTitle: row.plan_title || row.plan_code || '—',
    planTokens: Number(row.plan_tokens || 0),
    methodCode: row.method_code || '',
    methodLabel: row.method_label || row.method_code || '—',
    amount: Number(row.amount || 0),
    currency: normalizeCurrency(row.currency),
    referenceNo: row.reference_no || '',
    note: row.note || '',
    status: STATUSES.includes(row.status) ? row.status : 'pending',
    statusLabel: { pending: 'قيد المراجعة', confirmed: 'مؤكّد', rejected: 'مرفوض' }[row.status] || 'قيد المراجعة',
    adminNote: row.admin_note || '',
    handledBy: row.handled_by || '',
    handledAt: row.handled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** طلبات الباحث (الأحدث أولاً). */
export async function listUserPaymentRequests(userId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT pr.*, p.title AS plan_title, pm.label AS method_label
       FROM payment_requests pr
       LEFT JOIN plans p ON p.code = pr.plan_code
       LEFT JOIN payment_methods pm ON pm.code = pr.method_code
      WHERE pr.user_id = $1
      ORDER BY pr.created_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 20, 1), 100)]
  );
  return rows.map(normalizeRequest);
}

/** كل الطلبات للمراجع (صفحة المدير) مع بحث وفلترة. */
export async function listPaymentRequests({ status = 'pending', q = '', page = 1, pageSize = 25 } = {}) {
  const safeStatus = STATUSES.includes(String(status)) || status === 'all' ? String(status) : 'pending';
  const term = String(q || '').trim().slice(0, 100);
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const current = Math.max(1, Number(page) || 1);
  const like = `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const where = `WHERE ($1 = 'all' OR pr.status = $1)
      AND ($2 = '' OR u.email ILIKE $3 OR pr.reference_no ILIKE $3 OR p.title ILIKE $3)`;

  const [count, rows] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total FROM payment_requests pr
         JOIN users u ON u.id = pr.user_id
         LEFT JOIN plans p ON p.code = pr.plan_code ${where}`,
      [safeStatus, term, like]
    ),
    pool.query(
      `SELECT pr.*, u.email, u.full_name, p.title AS plan_title, p.tokens AS plan_tokens,
              pm.label AS method_label
         FROM payment_requests pr
         JOIN users u ON u.id = pr.user_id
         LEFT JOIN plans p ON p.code = pr.plan_code
         LEFT JOIN payment_methods pm ON pm.code = pr.method_code
         ${where}
        ORDER BY (pr.status = 'pending') DESC, pr.created_at DESC
        LIMIT $4 OFFSET $5`,
      [safeStatus, term, like, size, (current - 1) * size]
    )
  ]);

  const total = Number(count.rows[0]?.total || 0);
  return {
    requests: rows.rows.map(normalizeRequest),
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / size)),
    counts: await paymentCounts()
  };
}
/**
 * تأكيد طلب: ينقل الباحث لباقة الطلب ويضيف نقاطها.
 * ذرّي (معاملة واحدة): إما أن يُؤكّد الطلب وتُضاف النقاط، أو لا يحدث شيء.
 */
export async function confirmPaymentRequest(requestId, { adminNote = '', by = '' } = {}) {
  if (!isUuid(requestId)) throw badInput('الطلب غير موجود.', 'NOT_FOUND');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [requestId]);
    const request = rows[0];
    if (!request) throw badInput('الطلب غير موجود.', 'NOT_FOUND');
    if (request.status !== 'pending') throw badInput('تمت معالجة هذا الطلب مسبقاً.', 'BAD_STATUS');

    const plan = await client.query('SELECT code, tokens FROM plans WHERE code = $1', [request.plan_code]);
    const tokens = Number(plan.rows[0]?.tokens || 0);

    await client.query(
      `UPDATE payment_requests
          SET status = 'confirmed', admin_note = $2, handled_by = $3, handled_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [requestId, String(adminNote || '').slice(0, 500), String(by || '').slice(0, 255)]
    );

    await client.query(
      `UPDATE users
          SET plan_code = $2,
              tokens_balance = tokens_balance + $3,
              tokens_granted = tokens_granted + $3,
              updated_at = NOW()
        WHERE id = $1`,
      [request.user_id, request.plan_code, tokens]
    );

    await client.query('INSERT INTO usage_logs (user_id, type, tokens_used, summary) VALUES ($1, $2, 0, $3)', [
      request.user_id,
      'payment_confirmed',
      `تأكيد طلب دفع: ${request.plan_code}`
    ]);

    await client.query('COMMIT');
    return { ok: true, tokens };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** رفض طلب بملاحظة للباحث (لا خصم ولا تغيير باقة). */
export async function rejectPaymentRequest(requestId, { adminNote = '', by = '' } = {}) {
  if (!isUuid(requestId)) throw badInput('الطلب غير موجود.', 'NOT_FOUND');
  const { rows } = await pool.query('SELECT status FROM payment_requests WHERE id = $1', [requestId]);
  if (!rows[0]) throw badInput('الطلب غير موجود.', 'NOT_FOUND');
  if (rows[0].status !== 'pending') throw badInput('تمت معالجة هذا الطلب مسبقاً.', 'BAD_STATUS');

  await pool.query(
    `UPDATE payment_requests
        SET status = 'rejected', admin_note = $2, handled_by = $3, handled_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [requestId, String(adminNote || '').slice(0, 500), String(by || '').slice(0, 255)]
  );

  return { ok: true };
}

/** عدّادات سريعة (معلّق / مؤكّد / مرفوض) لشريط الصفحة. */
export async function paymentCounts() {
  try {
    const { rows } = await pool.query('SELECT status, count(*)::int AS c FROM payment_requests GROUP BY status');
    const map = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of rows) map[row.status] = Number(row.c || 0);
    return map;
  } catch {
    return { pending: 0, confirmed: 0, rejected: 0 };
  }
}