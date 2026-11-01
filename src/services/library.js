import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/client.js';
import { FILE_UPLOAD_LIMITS, isUuid } from '../constants.js';
import { citationText, normalizeArabic } from './workspace.js';
import { assertContentMatchesExtension } from './upload-guard.js';
import { isEphemeralStorage } from './files.js';

/** Shared scientific library metadata and file storage. */

const STORAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage');
const LIBRARY_DIR = 'library/references';

/** Maximum library-file size. */
export const LIBRARY_MAX_FILE_BYTES = 200 * 1024 * 1024;

/** Allowed library file extensions. */
export const LIBRARY_EXTENSIONS = [...new Set([...FILE_UPLOAD_LIMITS.allowedExtensions, 'epub'])];

/** Returns a lowercase extension or null. */
function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : null;
}

/** Sanitizes a filename while preserving its extension. */
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

/** Resolves a library path and rejects traversal outside storage/. */
function absolutePath(storedPath) {
  const absolute = path.resolve(STORAGE_ROOT, String(storedPath || ''));
  if (!absolute.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
    const error = new Error('مسار ملف غير صالح.');
    error.code = 'BAD_PATH';
    throw error;
  }
  return absolute;
}

/** Trims text to a maximum length. */
function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

/** Validates a publication year. */
function cleanYear(value) {
  const year = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(year) && year >= 1000 && year <= 2999 ? year : null;
}

/** Escapes wildcard characters in ILIKE search text. */
function likeTerm(q) {
  const term = clean(q, 120);
  return {
    term,
    like: `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  };
}

/** Removes HTML markup from external abstracts. */
export function stripHtml(value) {
  return clean(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), 1200);
}

/** Normalizes a library row for display. */
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

/** Lists library items for administration. */
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
    // Keep global counts independent from active filters.
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

/** Loads one library item by ID. */
export async function getLibraryItem(id) {
  // Validate UUIDs before querying PostgreSQL.
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(`SELECT ${LIBRARY_COLUMNS} FROM library_items WHERE id = $1`, [String(id)]);
  return rows[0] ? normalizeLibraryItem(rows[0]) : null;
}

/** Stores a library file and removes any previous file. */
async function writeLibraryFile(item, { buffer, fileName, mime }) {
  // Reject uploads where the filesystem is ephemeral.
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

  // Verify file signatures before writing bytes.
  assertContentMatchesExtension(extension, buffer);

  const previousPath = item.storedPath;

  const storedPath = `${LIBRARY_DIR}/${item.id}-${safeName(fileName, item.id)}.${extension}`;
  const absolute = absolutePath(storedPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);

  // Update metadata before deleting the previous file.
  const updated = await pool.query(
    `UPDATE library_items SET stored_path = $2, file_name = $3, mime = $4, size_bytes = $5 WHERE id = $1
      RETURNING ${LIBRARY_COLUMNS}`,
    [item.id, storedPath, clean(fileName, 255), clean(mime, 100) || null, buffer.length]
  );

  if (previousPath && previousPath !== storedPath) {
    try {
      await unlink(absolutePath(previousPath));
    } catch {
      /* The previous file is already absent. */
    }
  }

  return normalizeLibraryItem(updated.rows[0]);
}

/** Adds a library item with optional file and generated citation. */
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
      // Normalize Arabic search text to tolerate spelling variants.
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

/** Updates a library item and regenerates its citation when omitted. */
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

/** Enables or disables a library item. */
export async function setLibraryItemActive(id, active) {
  if (!isUuid(id)) return false;
  const { rowCount } = await pool.query('UPDATE library_items SET is_active = $2 WHERE id = $1', [
    String(id),
    Boolean(active)
  ]);
  return rowCount > 0;
}

/** Deletes the library file and row while preserving user references. */
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

/** Reads a library file, optionally requiring the item to be active. */
export async function readLibraryItem(id, { activeOnly = false } = {}) {
  // Validate UUIDs before querying PostgreSQL.
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