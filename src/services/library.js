import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/client.js';
import { FILE_UPLOAD_LIMITS, isUuid } from '../constants.js';
import { citationText, normalizeArabic } from './workspace.js';
import { assertContentMatchesExtension } from './upload-guard.js';
import { isEphemeralStorage } from './files.js';

/**
 * المكتبة العلمية المركزية (P3): جدول library_items + بايتات الملف على القرص
 * تحت storage/library/references/{id}-{slug}.{ext} كما في storage/README.md.
 * - المدير يرفع كتاباً (ملف + بيانات) أو يستوردها من مواقع مرجعية مجانية.
 * - التوثيق (APA مبسّط) يُولَّد تلقائياً من الحقول إن لم يكتبه المدير.
 * - الحذف النهائي يزيل الملف والصف مع بقاء مراجع الباحثين (SET NULL).
 */

const STORAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage');
const LIBRARY_DIR = 'library/references';

/** أقصى حجم لملف كتاب (رفع أو جلب) — 200 ميجابايت. */
export const LIBRARY_MAX_FILE_BYTES = 200 * 1024 * 1024;

/** الأنواع المسموحة لملفات المكتبة: قائمة الموقع + EPUB للكتب الإلكترونية. */
export const LIBRARY_EXTENSIONS = [...new Set([...FILE_UPLOAD_LIMITS.allowedExtensions, 'epub'])];

/** امتداد بحروف صغيرة أو null. */
function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : null;
}

/** اسم ملف نظيف: حروف و/أرقام فقط مع الامتداد. */
function safeName(name, fallbackSlug) {
  const base = path.basename(String(name || 'file')).replace(/\.[^.]*$/, '');
  const slug =
    base
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallbackSlug || 'file';
  return slug.replace(/[\\/]/g, '-');
}

/** المسار المطلق للملف بعد التأكد أنه داخل storage/. */
function absolutePath(storedPath) {
  const absolute = path.resolve(STORAGE_ROOT, String(storedPath || ''));
  if (!absolute.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
    const error = new Error('مسار ملف غير صالح.');
    error.code = 'BAD_PATH';
    throw error;
  }
  return absolute;
}

/** نص نظيف بحد أقصى للطول. */
function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

/** سنة صحيحة أو null. */
function cleanYear(value) {
  const year = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(year) && year >= 1000 && year <= 2999 ? year : null;
}

/** نص البحث الآمن مع تهريب الرموز الخاصة بـ ILIKE. */
function likeTerm(q) {
  const term = clean(q, 120);
  return {
    term,
    like: `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  };
}

/** محتوى HTML إلى نص خالٍ (لملخصات المصادر الخارجية). */
export function stripHtml(value) {
  return clean(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), 1200);
}

/** صف مكتبة جاهز للعرض. */
export function normalizeLibraryItem(row) {
  return {
    id: row.id,
    title: row.title || '',
    authors: row.authors || '',
    year: row.year,
    source: row.source || '',
    abstract: row.abstract || '',
    subjects: row.subjects || '',
    field: row.field || '',
    degreeLevel: row.degree_level || '',
    citation: row.citation_text || '',
    hasFile: Boolean(row.stored_path),
    fileName: row.file_name || '',
    mime: row.mime || '',
    sizeBytes: Number(row.size_bytes || 0),
    sourceSystem: row.source_system || 'upload',
    externalUrl: row.external_url || '',
    storedPath: row.stored_path || '',
    isActive: row.is_active !== false,
    createdAt: row.created_at
  };
}

const LIBRARY_COLUMNS = `id, title, authors, year, source, abstract, subjects, degree_level, field,
  citation_text, stored_path, file_name, mime, size_bytes, external_url, source_system, is_active, created_at`;

/** عناصر المكتبة (للوحة الإدارة): بحث + فلترة الحالة + ترقيم صفحات. */
export async function listLibraryItems({ q = '', status = 'all', page = 1, pageSize = 20 } = {}) {
  const { term, like } = likeTerm(q);
  const safeStatus = ['all', 'active', 'off'].includes(String(status)) ? String(status) : 'all';
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
  const current = Math.max(1, Number(page) || 1);

  const where = `WHERE ($1 = '' OR title ILIKE $2 OR COALESCE(authors, '') ILIKE $2
        OR COALESCE(source, '') ILIKE $2 OR COALESCE(abstract, '') ILIKE $2
        OR COALESCE(subjects, '') ILIKE $2)
    AND ($3 = 'all' OR ($3 = 'active' AND is_active) OR ($3 = 'off' AND NOT is_active))`;

  const [count, items, stats] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total FROM library_items ${where}`, [term, like, safeStatus]),
    pool.query(
      `SELECT ${LIBRARY_COLUMNS} FROM library_items ${where}
        ORDER BY is_active DESC, created_at DESC
        LIMIT $4 OFFSET $5`,
      [term, like, safeStatus, size, (current - 1) * size]
    ),
    // شريط الإحصاءات أعلى الصفحة: أرقام عامة للكل (لا تتأثر بالفلاتر)
    pool.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE stored_path IS NOT NULL)::int AS with_file,
        count(*) FILTER (WHERE NOT is_active)::int AS inactive
      FROM library_items`)
  ]);

  const total = Number(count.rows[0]?.total || 0);
  return {
    items: items.rows.map(normalizeLibraryItem),
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / size)),
    counts: {
      total: Number(stats.rows[0]?.total || 0),
      withFile: Number(stats.rows[0]?.with_file || 0),
      inactive: Number(stats.rows[0]?.inactive || 0)
    }
  };
}

/** عنصر واحد بالمعرّف أو null. */
export async function getLibraryItem(id) {
  // حارس UUID: يمنع رمي Postgres على معرّف من المسار (وإلا انهار الخادم — DoS).
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(`SELECT ${LIBRARY_COLUMNS} FROM library_items WHERE id = $1`, [String(id)]);
  return rows[0] ? normalizeLibraryItem(rows[0]) : null;
}

/** حفظ بايتات ملف كتاب على القرص وتحديث صفّه — يزيل الملف السابق إن وُجد. */
async function writeLibraryFile(item, { buffer, fileName, mime }) {
  // منصّات Serverless: لا قرص دائم ⇒ نرفض برسالة عربية بدل فشل غامض.
  if (isEphemeralStorage()) {
    const error = new Error('رفع الكتب غير متاح على هذه المنصة حالياً (نظام الملفات مؤقّت).');
    error.code = 'NO_STORAGE';
    throw error;
  }

  const extension = extensionOf(fileName);
  if (!extension || !LIBRARY_EXTENSIONS.includes(extension)) {
    const error = new Error(`نوع الملف غير مسموح — المسموح: ${LIBRARY_EXTENSIONS.map((e) => `.${e}`).join(' · ')}`);
    error.code = 'BAD_TYPE';
    throw error;
  }
  if (!buffer?.length) {
    const error = new Error('ملف فارغ.');
    error.code = 'BAD_FILE';
    throw error;
  }
  if (buffer.length > LIBRARY_MAX_FILE_BYTES) {
    const error = new Error('حجم ملف أكبر من 200 ميجابايت.');
    error.code = 'TOO_LARGE';
    throw error;
  }

  // البصمة الثنائية قبل أي كتابة: كتاب باسم report.pdf قد يكون ملفاً آخر تماماً.
  assertContentMatchesExtension(extension, buffer);

  const previousPath = item.storedPath;

  const storedPath = `${LIBRARY_DIR}/${item.id}-${safeName(fileName, item.id)}.${extension}`;
  const absolute = absolutePath(storedPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);

  // تحديث الصف أولاً ثم حذف القديم: لو فشل حذف القديم لا يضيع الجديد.
  const updated = await pool.query(
    `UPDATE library_items SET stored_path = $2, file_name = $3, mime = $4, size_bytes = $5 WHERE id = $1
      RETURNING ${LIBRARY_COLUMNS}`,
    [item.id, storedPath, clean(fileName, 255), clean(mime, 100) || null, buffer.length]
  );

  if (previousPath && previousPath !== storedPath) {
    try {
      await unlink(absolutePath(previousPath));
    } catch {
      /* الملف القديم غير موجود — لا مشكلة */
    }
  }

  return normalizeLibraryItem(updated.rows[0]);
}

/**
 * إضافة عنصر إلى المكتبة: بيانات + توثيق (يُولَّد تلقائياً إن لم يُكتب) + ملف اختياري.
 * يرمي أكواد: BAD_TITLE / TOO_LARGE / BAD_TYPE لعرضها كرسائل عربية.
 */
export async function addLibraryItem({
  title,
  authors = '',
  year = null,
  source = '',
  abstract = '',
  subjects = '',
  field = '',
  degreeLevel = '',
  citation = '',
  file = null,
  externalUrl = '',
  sourceSystem = 'upload'
} = {}) {
  const cleanTitle = clean(title, 500);
  if (!cleanTitle) {
    const error = new Error('العنوان مطلوب.');
    error.code = 'BAD_TITLE';
    throw error;
  }

  const cleanAuthors = clean(authors, 1000);
  const cleanSource = clean(source, 255);
  const cleanYearValue = cleanYear(year);
  const cleanCitation =
    clean(citation, 2000) ||
    citationText({ title: cleanTitle, authors: cleanAuthors, year: cleanYearValue, source: cleanSource });

  const { rows } = await pool.query(
    `INSERT INTO library_items (title, authors, year, source, abstract, subjects, degree_level, field, citation_text,
                                external_url, source_system, search_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${LIBRARY_COLUMNS}`,
    [
      cleanTitle,
      cleanAuthors || null,
      cleanYearValue,
      cleanSource || null,
      clean(abstract, 5000) || null,
      clean(subjects, 500) || null,
      clean(degreeLevel, 100) || null,
      clean(field, 255) || null,
      cleanCitation,
      clean(externalUrl, 500) || null,
      clean(sourceSystem, 50) || 'upload',
      // نصّ البحث المطبَّع: يجعل البحث متسامحاً مع الهمزات والتاء المربوطة.
      normalizeArabic(
        [cleanTitle, cleanAuthors, cleanSource, clean(subjects, 500), clean(field, 255), clean(externalUrl, 500)]
          .filter(Boolean)
          .join(' ')
      )
    ]
  );

  const item = normalizeLibraryItem(rows[0]);
  return file ? writeLibraryFile(item, file) : item;
}

/** تعديل بيانات عنصر موجود — التوثيق يُعاد توليده إن لم يُقدَّم نصاً جديداً. */
export async function updateLibraryItem(id, fields = {}) {
  const current = await getLibraryItem(id);
  if (!current) return null;

  const title = clean(fields.title, 500) || current.title;
  const authors = 'authors' in fields ? clean(fields.authors, 1000) : current.authors;
  const year = 'year' in fields ? cleanYear(fields.year) : current.year;
  const source = 'source' in fields ? clean(fields.source, 255) : current.source;
  const abstract = 'abstract' in fields ? clean(fields.abstract, 5000) : current.abstract;
  const subjects = 'subjects' in fields ? clean(fields.subjects, 500) : current.subjects;
  const field = 'field' in fields ? clean(fields.field, 255) : current.field;
  const degreeLevel = 'degreeLevel' in fields ? clean(fields.degreeLevel, 100) : current.degreeLevel;
  const citation = clean(fields.citation, 2000) || citationText({ title, authors, year, source });

  const { rows } = await pool.query(
    `UPDATE library_items SET title = $2, authors = $3, year = $4, source = $5, abstract = $6, subjects = $7,
            field = $8, degree_level = $9, citation_text = $10
      WHERE id = $1
      RETURNING ${LIBRARY_COLUMNS}`,
    [
      id,
      title,
      authors || null,
      year,
      source || null,
      abstract || null,
      subjects || null,
      field || null,
      degreeLevel || null,
      citation
    ]
  );

  return rows[0] ? normalizeLibraryItem(rows[0]) : null;
}

/** تفعيل/تعطيل عنصر (يختفي فوراً من نتائج الباحثين عند التعطيل). */
export async function setLibraryItemActive(id, active) {
  if (!isUuid(id)) return false;
  const { rowCount } = await pool.query('UPDATE library_items SET is_active = $2 WHERE id = $1', [
    String(id),
    Boolean(active)
  ]);
  return rowCount > 0;
}

/** حذف نهائي: ملف الكتاب من القرص ثم الصف (مراجع الباحثين تبقى بدون رابط). */
export async function deleteLibraryItem(id) {
  const item = await getLibraryItem(id);
  if (!item) return false;

  if (item.storedPath) {
    try {
      await unlink(absolutePath(item.storedPath));
    } catch {
      /* الملف غير موجود أصلاً — المهم حذف الصف */
    }
  }

  const { rowCount } = await pool.query('DELETE FROM library_items WHERE id = $1', [item.id]);
  return rowCount > 0;
}

/** قراءة ملف عنصر من القرص (للتحميل) — activeOnly يمنع تحميل معطّل. */
export async function readLibraryItem(id, { activeOnly = false } = {}) {
  // حارس ضد الرمي من Postgres على معرّف غير UUID (وإلا انهار الخادم — DoS).
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT ${LIBRARY_COLUMNS} FROM library_items WHERE id = $1 ${activeOnly ? 'AND is_active' : ''}`,
    [String(id)]
  );
  const row = rows[0];
  if (!row || !row.stored_path) return null;

  try {
    return { row, buffer: await readFile(absolutePath(row.stored_path)) };
  } catch (error) {
    if (error.code === 'ENOENT') return { row, buffer: null };
    throw error;
  }
}