import { pool } from '../db/client.js';
import { READING_STATUSES } from '../constants.js';
import { isValidStepKeyForUser } from './journey.js';

/**
 * مراجع الباحث ومفكرته (1E).
 * - المكتبة العلمية مركزية في جدول library_items، والمراجع الخاصة بالباحث في
 *   user_references: إما رابط لعنصر مكتبة أو بيانات يدوية (عنوان/مؤلف/سنة/مصدر).
 * - المفكرة في جدول notes مع تثبيت ووسوم وربط اختياري بخطوة من مسار البحث.
 * كل الاستعلامات مقيدة بـ user_id حتى لا يطّلع باحث على بيانات باحث آخر.
 */

const REFERENCE_STATUSES = new Set(READING_STATUSES.map((item) => item.value));
const REFERENCE_LIMIT = 200;
const NOTE_LIMIT = 200;

/** نص ببليوغرافي جاهز للعرض (APA مبسّط من الحقول نفسها — بدون توليد ذكي). */
export function citationText(row) {
  const title = String(row.title || '').trim();
  if (!title) return '—';

  const authors = String(row.authors || '').trim();
  const year = row.year ? `(${row.year})` : '(د.ت)';
  const source = String(row.source || '').trim();

  return [authors || '—', year, title, source && source !== title ? source : '']
    .filter(Boolean)
    .join('. ');
}

/** مفتاح الخطوة بعد التحقق من انتمائه لمسار الباحث (null بلا ربط). */
async function cleanStepKey(userId, stepKey) {
  const key = String(stepKey || '').trim().slice(0, 100);
  if (!key) return null;

  if (!(await isValidStepKeyForUser(userId, key))) {
    const error = new Error('هذه الخطوة غير موجودة في مسار بحثك.');
    error.code = 'BAD_STEP';
    throw error;
  }

  return key;
}

/** مرجع جاهز للعرض: دمج بيانات المكتبة مع البيانات اليدوية + نص التوثيق. */
function normalizeReference(row) {
  const title = row.title || row.custom_title || 'بدون عنوان';
  const authors = row.authors || row.custom_authors || '';
  const year = row.year ?? row.custom_year ?? null;
  const source = row.source || row.custom_source || '';

  return {
    id: row.id,
    libraryItemId: row.library_item_id || null,
    stepKey: row.step_key || '',
    status: REFERENCE_STATUSES.has(row.status) ? row.status : 'to_read',
    statusLabel: READING_STATUSES.find((item) => item.value === row.status)?.label || 'مرشّح للقراءة',
    note: row.note || '',
    createdAt: row.created_at,
    notesCount: Number(row.notes_count || 0),
    title,
    authors,
    year,
    source,
    citation: row.citation_text || citationText({ title, authors, year, source })
  };
}

/**
 * بحث في المكتبة العلمية المركزية + إشارة «في مراجعي» لكل نتيجة.
 * البحث ILIKE على العنوان/المؤلف/المصدر/الملخص (FTS الكامل في المرحلة الثالثة).
 */
export async function searchLibraryItems({ userId, q = '', limit = 30 } = {}) {
  const term = String(q || '').trim().slice(0, 120);
  const max = Math.min(Math.max(Number(limit) || 30, 1), 60);

  const { rows } = await pool.query(
    `SELECT li.id, li.title, li.authors, li.year, li.source, li.field, li.degree_level,
            li.citation_text,
            (ur.id IS NOT NULL) AS added,
            COALESCE(ur.status, '') AS my_status
       FROM library_items li
       LEFT JOIN user_references ur ON ur.library_item_id = li.id AND ur.user_id = $2
      WHERE li.is_active = true
        AND ($1 = '' OR li.title ILIKE '%' || $1 || '%' OR li.authors ILIKE '%' || $1 || '%'
             OR li.source ILIKE '%' || $1 || '%' OR li.abstract ILIKE '%' || $1 || '%')
      ORDER BY li.year DESC NULLS LAST, li.created_at DESC
      LIMIT $3`,
    [term, userId, max]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    authors: row.authors || '',
    year: row.year,
    source: row.source || '',
    field: row.field || '',
    degreeLevel: row.degree_level || '',
    added: Boolean(row.added),
    myStatus: row.my_status || '',
    citation: row.citation_text || citationText(row)
  }));
}

/** مراجع الباحث (كلها أو لخطوة معيّنة) مع عدد الملاحظات المرتبطة بكل مرجع. */
export async function listUserReferences(userId, { step = '', status = '' } = {}) {
  const stepKey = String(step || '').trim().slice(0, 100);
  const values = [userId];
  let stepFilter = '';
  let statusFilter = '';

  if (stepKey) {
    values.push(stepKey);
    stepFilter = `AND ur.step_key = $${values.length}`;
  }

  if (REFERENCE_STATUSES.has(status)) {
    values.push(status);
    statusFilter = `AND ur.status = $${values.length}`;
  }

  const { rows } = await pool.query(
    `SELECT ur.id, ur.library_item_id, ur.step_key, ur.status, ur.note, ur.created_at,
            ur.custom_title, ur.custom_authors, ur.custom_year, ur.custom_source,
            li.title, li.authors, li.year, li.source, li.citation_text,
            (SELECT count(*)::int FROM notes n WHERE n.reference_id = ur.id) AS notes_count
       FROM user_references ur
       LEFT JOIN library_items li ON li.id = ur.library_item_id
      WHERE ur.user_id = $1 ${stepFilter} ${statusFilter}
      ORDER BY ur.created_at DESC
      LIMIT ${REFERENCE_LIMIT}`,
    values
  );

  return rows.map(normalizeReference);
}

/** عدد المراجع لكل حالة قراءة (تلخيص أعلى صفحة المراجع). */
export async function referenceStatusCounts(userId) {
  const { rows } = await pool.query(
    'SELECT status, count(*)::int AS total FROM user_references WHERE user_id = $1 GROUP BY status',
    [userId]
  );

  const counts = { total: 0 };
  for (const item of READING_STATUSES) counts[item.value] = 0;
  for (const row of rows) {
    const key = REFERENCE_STATUSES.has(row.status) ? row.status : 'to_read';
    counts[key] = Number(row.total);
    counts.total += Number(row.total);
  }

  return counts;
}

/** إضافة مرجع من المكتبة المركزية إلى مراجع الباحث (تمنع التكرار لنفس العنصر). */
export async function addLibraryReference(userId, libraryItemId, { step = '', status = 'to_read' } = {}) {
  const stepKey = await cleanStepKey(userId, step);

  const { rows } = await pool.query(
    `INSERT INTO user_references (user_id, library_item_id, status, step_key)
     SELECT $1, li.id, $2, $3
       FROM library_items li
      WHERE li.id = $4 AND li.is_active = true
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [userId, REFERENCE_STATUSES.has(status) ? status : 'to_read', stepKey, libraryItemId]
  );

  if (!rows.length) {
    const error = new Error('لم يُضف المرجع: إما أنه غير موجود في المكتبة أو أضفته سابقاّ.');
    error.code = 'NOT_ADDED';
    throw error;
  }

  return rows[0];
}

/** إضافة مرجع يدوي (عنوان + مؤلف + سنة + مصدر) مع ربط اختياري بخطوة من المسار. */
export async function addCustomReference(
  userId,
  { title, authors = '', year = '', source = '', note = '', step = '' } = {}
) {
  const cleanTitle = String(title || '').trim().slice(0, 500);
  if (!cleanTitle) {
    const error = new Error('عنوان المرجع مطلوب.');
    error.code = 'MISSING_TITLE';
    throw error;
  }

  const rawYear = Number(String(year).replace(/\D/g, ''));
  const safeYear = Number.isFinite(rawYear) && rawYear >= 1000 && rawYear <= 2100 ? Math.trunc(rawYear) : null;
  const stepKey = await cleanStepKey(userId, step);

  const { rows } = await pool.query(
    `INSERT INTO user_references (user_id, custom_title, custom_authors, custom_year, custom_source, status, note, step_key)
     VALUES ($1, $2, $3, $4, $5, 'to_read', $6, $7)
     RETURNING *`,
    [
      userId,
      cleanTitle,
      String(authors || '').trim().slice(0, 500),
      safeYear,
      String(source || '').trim().slice(0, 255),
      String(note || '').trim().slice(0, 2000),
      stepKey
    ]
  );

  return rows[0];
}

/** تغيير حالة قراءة مرجع (مرشّح/قيد القراءة/مقروء/مستخدم في البحث). */
export async function updateReferenceStatus(userId, referenceId, status) {
  if (!REFERENCE_STATUSES.has(status)) {
    const error = new Error('حالة القراءة غير صالحة.');
    error.code = 'BAD_STATUS';
    throw error;
  }

  const { rows } = await pool.query(
    'UPDATE user_references SET status = $3 WHERE id = $2 AND user_id = $1 RETURNING *',
    [userId, referenceId, status]
  );

  if (!rows.length) {
    const error = new Error('المرجع غير موجود.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  return rows[0];
}

/** حذف مرجع من مراجع الباحث (بيانات المكتبة نفسها لا تتأثر). */
export async function deleteReference(userId, referenceId) {
  const { rowCount } = await pool.query('DELETE FROM user_references WHERE id = $2 AND user_id = $1', [
    userId,
    referenceId
  ]);

  return rowCount > 0;
}

/** ملاحظة جاهزة للعرض مع اسم خطوتها ومقتطف نصّي. */
function normalizeNote(row) {
  return {
    id: row.id,
    title: row.title || 'ملاحظة بلا عنوان',
    body: row.body || '',
    tags: String(row.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    pinned: Boolean(row.pinned),
    stepKey: row.step_key || '',
    stepTitle: row.step_title || '',
    referenceId: row.reference_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** ملاحظات الباحث مع بحث نصي وفلترة بخطوة أو بمرجع، والمثبّتة أولاً. */
export async function listNotes(userId, { q = '', step = '', referenceId = '', pinnedOnly = false } = {}) {
  const term = String(q || '').trim().slice(0, 120);
  const stepKey = String(step || '').trim().slice(0, 100);
  const refId = String(referenceId || '').trim();
  const values = [userId];
  const filters = ['n.user_id = $1'];

  if (term) {
    values.push(`%${term}%`);
    const index = `$${values.length}`;
    filters.push(`(n.title ILIKE ${index} OR n.body ILIKE ${index} OR n.tags ILIKE ${index})`);
  }

  if (stepKey) {
    values.push(stepKey);
    filters.push(`n.step_key = $${values.length}`);
  }

  if (/^[0-9a-f-]{36}$/i.test(refId)) {
    values.push(refId);
    filters.push(`n.reference_id = $${values.length}`);
  }

  if (pinnedOnly) filters.push('n.pinned = true');

  const { rows } = await pool.query(
    `SELECT n.*, s.title AS step_title
       FROM notes n
       LEFT JOIN research_path_steps s ON s.step_key = n.step_key
      WHERE ${filters.join(' AND ')}
      ORDER BY n.pinned DESC, n.updated_at DESC
      LIMIT ${NOTE_LIMIT}`,
    values
  );

  return rows.map(normalizeNote);
}

/** ملاحظة واحدة بملكيتها (null إن لم تكن له). */
export async function getNote(userId, noteId) {
  const { rows } = await pool.query('SELECT * FROM notes WHERE id = $2 AND user_id = $1', [userId, noteId]);

  return rows.length ? normalizeNote(rows[0]) : null;
}

/** وسوم الملاحظة: نص مفصول بفواصل، مقصوص بطول 12 وسمًا × 40 حرفًا. */
function cleanTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12)
    .join(', ');
}

/** إنشاء ملاحظة جديدة مع ربط اختياري بخطوة ومرجع. */
export async function createNote(
  userId,
  { title = '', body = '', tags = '', pinned = false, step = '', referenceId = null } = {}
) {
  const cleanTitle = String(title || '').trim().slice(0, 300);
  const cleanBody = String(body || '').trim().slice(0, 20000);

  if (!cleanTitle && !cleanBody) {
    const error = new Error('اكتب عنواناً أو نصاً للملاحظة.');
    error.code = 'EMPTY_NOTE';
    throw error;
  }

  const stepKey = await cleanStepKey(userId, step);

  const { rows } = await pool.query(
    `INSERT INTO notes (user_id, title, body, tags, pinned, step_key, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      cleanTitle || 'ملاحظة بلا عنوان',
      cleanBody,
      cleanTags(tags),
      Boolean(pinned),
      stepKey,
      referenceId || null
    ]
  );

  return normalizeNote(rows[0]);
}

/** تعديل ملاحظة قائمة (العنوان/النص/الوسوم/التثبيت/الخطوة). */
export async function updateNote(userId, noteId, { title, body, tags, pinned, step } = {}) {
  const existing = await getNote(userId, noteId);
  if (!existing) {
    const error = new Error('الملاحظة غير موجودة.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const cleanTitle = String(title ?? existing.title).trim().slice(0, 300);
  const cleanBody = String(body ?? existing.body).trim().slice(0, 20000);
  const cleanTagsValue = cleanTags(tags ?? existing.tags.join(', '));
  // step غير مُرسل = الإبقاء على الربط الحالي، و step فارغ = إزالة الربط.
  const stepKey = step === undefined ? existing.stepKey : await cleanStepKey(userId, step);

  const { rows } = await pool.query(
    `UPDATE notes SET title = $3, body = $4, tags = $5, pinned = $6, step_key = $7, updated_at = NOW()
      WHERE id = $2 AND user_id = $1
      RETURNING *`,
    [userId, noteId, cleanTitle || 'ملاحظة بلا عنوان', cleanBody, cleanTagsValue, Boolean(pinned), stepKey]
  );

  return normalizeNote(rows[0]);
}

/** تبديل تثبيت الملاحظة (قائمة الوصول السريع أعلى المفكرة). */
export async function toggleNotePin(userId, noteId) {
  const { rows } = await pool.query(
    'UPDATE notes SET pinned = NOT pinned, updated_at = NOW() WHERE id = $2 AND user_id = $1 RETURNING *',
    [userId, noteId]
  );

  if (!rows.length) {
    const error = new Error('الملاحظة غير موجودة.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  return normalizeNote(rows[0]);
}

/** حذف ملاحظة. */
export async function deleteNote(userId, noteId) {
  const { rowCount } = await pool.query('DELETE FROM notes WHERE id = $2 AND user_id = $1', [userId, noteId]);

  return rowCount > 0;
}

