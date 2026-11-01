import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/client.js';
import { FILE_UPLOAD_LIMITS, PLAN_FILE_DEFAULT_MB, PLAN_STORAGE_DEFAULT_MB, isUuid } from '../constants.js';
import { isValidStepKeyForUser } from './journey.js';
import { normalizeFileMaxMb, normalizeStorageMb } from './plans.js';
import { assertContentMatchesExtension } from './upload-guard.js';

/** Stores user file metadata in PostgreSQL and file bytes under storage/users/. */

const STORAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage');

/** Maximum text-preview size. */
const TEXT_PREVIEW_LIMIT = 400 * 1024;

/** Detects serverless platforms where local storage is read-only. */
export function isEphemeralStorage() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Formats allowed file extensions for display. */
export function allowedTypesLabel() {
  return FILE_UPLOAD_LIMITS.allowedExtensions.map((item) => `.${item}`).join(' · ');
}

/** Sanitizes a filename while preserving its extension. */
function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/\.[^.]*$/, '');
  const slug =
    base
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file';
  return slug.replace(/[\\/]/g, '-');
}

/** Returns a lowercase extension or null. */
function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : null;
}

/** Returns a short display label for a file type. */
function kindOf(extension) {
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'صورة';
  if (extension === 'pdf') return 'مستند PDF';
  if (['xls', 'xlsx', 'csv'].includes(extension)) return 'جدول بيانات';
  if (['doc', 'docx', 'txt', 'md'].includes(extension)) return 'مستند نصي';
  if (['ppt', 'pptx'].includes(extension)) return 'عرض تقديمي';
  if (extension === 'zip') return 'ملف مضغوط';
  return 'مستند';
}

/** Normalizes a database file row for rendering. */
export function normalizeFile(row) {
  const extension = extensionOf(row.file_name);

  return {
    id: row.id,
    title: row.title || row.file_name,
    fileName: row.file_name,
    extension: extension || '',
    kind: kindOf(extension),
    mime: row.mime || '',
    sizeBytes: Number(row.size_bytes || 0),
    stepKey: row.step_key || '',
    source: row.source || 'upload',
    createdAt: row.created_at,
    previewable: previewKind(row.file_name, row.mime) !== 'none'
  };
}

/** Formats a file size for display. */
export function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1073741824) return `${(size / 1073741824).toFixed(2)} GB`;
  if (size >= 1048576) return `${(size / 1048576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} بايت`;
}

/** Resolves a stored path and rejects traversal outside storage/. */
function absolutePath(storedPath) {
  const absolute = path.resolve(STORAGE_ROOT, String(storedPath || ''));
  if (!absolute.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
    const error = new Error('مسار ملف غير صالح.');
    error.code = 'BAD_PATH';
    throw error;
  }
  return absolute;
}

/** Lists owned files, optionally filtered by step. */
export async function listFiles(userId, { step = '', limit = 100 } = {}) {
  const stepKey = String(step || '').trim().slice(0, 100);
  const values = [userId];
  let stepFilter = '';

  if (stepKey) {
    values.push(stepKey);
    stepFilter = `AND step_key = $${values.length}`;
  }

  values.push(Math.min(Math.max(Number(limit) || 100, 1), 200));

  const { rows } = await pool.query(
    `SELECT * FROM files
      WHERE user_id = $1 ${stepFilter}
      ORDER BY created_at DESC
      LIMIT $${values.length}`,
    values
  );

  return rows.map(normalizeFile);
}

/** Reads per-file and total-storage limits from the user's plan in one query. */
export async function userUploadLimits(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT p.storage_mb, p.max_file_mb
         FROM users u
         JOIN plans p ON p.code = u.plan_code
        WHERE u.id = $1`,
      [userId]
    );
    if (rows.length) {
      return {
        quotaBytes: normalizeStorageMb(rows[0].storage_mb) * 1024 * 1024,
        fileMaxBytes: normalizeFileMaxMb(rows[0].max_file_mb) * 1024 * 1024
      };
    }
  } catch (error) {
    console.warn(`تعذّرت قراءة حدود الباقة للمستخدم: ${error.code || error.message}`);
  }
  return {
    quotaBytes: PLAN_STORAGE_DEFAULT_MB * 1024 * 1024,
    fileMaxBytes: PLAN_FILE_DEFAULT_MB * 1024 * 1024
  };
}

/** Returns the user's storage quota in bytes. */
export async function userQuotaBytes(userId) {
  return (await userUploadLimits(userId)).quotaBytes;
}

/** Returns the per-file size limit in bytes. */
export async function userFileMaxBytes(userId) {
  return (await userUploadLimits(userId)).fileMaxBytes;
}

/** Summarizes storage use and keeps small uploads visible in the usage bar. */
export async function filesSummary(userId) {
  const [{ rows }, quotaBytes] = await Promise.all([
    pool.query(
      'SELECT count(*)::int AS total, COALESCE(sum(size_bytes), 0)::bigint AS bytes FROM files WHERE user_id = $1',
      [userId]
    ),
    userQuotaBytes(userId)
  ]);

  const usedBytes = Number(rows[0]?.bytes || 0);
  const total = Number(rows[0]?.total || 0);
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);

  const rawPercent = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;
  const percent = Math.min(100, Math.round(rawPercent * 10) / 10);
  // Keep the bar visible for any nonzero usage.
  const barWidth = usedBytes > 0 ? Math.max(1.2, percent) : 0;

  return {
    total,
    bytes: usedBytes,
    quotaBytes,
    remainingBytes,
    usedLabel: formatFileSize(usedBytes),
    quotaLabel: formatFileSize(quotaBytes),
    remainingLabel: formatFileSize(remainingBytes),
    percent,
    barWidth,
    isFull: remainingBytes <= 0,
    isNearFull: rawPercent >= 90,
    // Keep megabyte fields for compatibility.
    usedMb: Math.round((usedBytes / (1024 * 1024)) * 10) / 10,
    quotaMb: Math.round(quotaBytes / (1024 * 1024)),
    remainingMb: Math.round((remainingBytes / (1024 * 1024)) * 10) / 10
  };
}

/** Determines the supported inline preview type; text is always served as plain text. */
export function previewKind(fileName = '', mime = '') {
  const ext = extensionOf(fileName);
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  // Preview spreadsheets as tables.
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  if (['txt', 'md'].includes(ext)) return 'text';
  if (mime === 'text/plain' || mime === 'text/markdown') return 'text';
  if (mime === 'text/csv' || mime === 'application/vnd.ms-excel' || (mime || '').includes('spreadsheetml')) return 'sheet';
  return 'none';
}

/** Checks whether a file has an inline preview. */
export function isPreviewable(file) {
  return previewKind(file?.file_name, file?.mime) !== 'none';
}

/** Returns bounded text content for inline preview. */
export function textPreview(buffer, maxBytes = TEXT_PREVIEW_LIMIT) {
  if (!buffer || buffer.length > maxBytes) return null;

  // Reject binary content even when its extension is textual.
  const slice = buffer.subarray(0, 2048);
  if (slice.includes(0)) return null;

  return buffer.toString('utf8');
}

/** Loads a file row only when owned by the user. */
export async function getFileRow(userId, fileId) {
  // Reject invalid IDs before querying UUID columns.
  if (!isUuid(fileId)) return null;
  const { rows } = await pool.query('SELECT * FROM files WHERE id = $2 AND user_id = $1', [userId, fileId]);
  return rows[0] || null;
}

/** Validates, stores, and records an upload; failed inserts clean up written bytes. */
export async function saveUpload(userId, { file, title = '', step = '' } = {}) {
  // Reject uploads before reading the body on read-only serverless filesystems.
  if (isEphemeralStorage()) {
    const error = new Error('رفع الملفات غير متاح على هذه المنصة حالياً (نظام الملفات مؤقّت).');
    error.code = 'NO_STORAGE';
    throw error;
  }

  const extension = extensionOf(file?.name);
  if (!extension || !FILE_UPLOAD_LIMITS.allowedExtensions.includes(extension)) {
    const error = new Error(`نوع الملف غير مسموح. المسموح: ${allowedTypesLabel()}`);
    error.code = 'BAD_TYPE';
    throw error;
  }

  const { fileMaxBytes: limit, quotaBytes } = await userUploadLimits(userId);
  if (Number(file.size || 0) > limit) {
    const error = new Error(`حجم الملف أكبر من الحد المسموح (${Math.round(limit / (1024 * 1024))} MB).`);
    error.code = 'TOO_LARGE';
    throw error;
  }

  // Check the declared size against the remaining quota before reading bytes.
  const usedBefore = await filesSummary(userId);
  if (usedBefore.bytes + Number(file.size || 0) > quotaBytes) {
    const error = new Error(
      `مساحتك لا تكفي: المستخدم ${usedBefore.usedMb} MB من ${usedBefore.quotaMb} MB. احذف ملفاً أو احجز مساحة أكبر.`
    );
    error.code = 'QUOTA_EXCEEDED';
    throw error;
  }

  const mime = String(file.type || '').slice(0, 100);
  const isGenericText = ['txt', 'md', 'csv'].includes(extension) && mime.startsWith('text/');
  if (mime && !isGenericText && !FILE_UPLOAD_LIMITS.allowedMimeTypes.includes(mime)) {
    const error = new Error('نوع المحتوى لا يطابق امتداد الملف.');
    error.code = 'BAD_MIME';
    throw error;
  }

  const stepKey = String(step || '').trim().slice(0, 100);
  if (!(await isValidStepKeyForUser(userId, stepKey))) {
    const error = new Error('هذه الخطوة غير موجودة في مسار بحثك.');
    error.code = 'BAD_STEP';
    throw error;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > limit) {
    const error = new Error('حجم الملف أكبر من الحد المسموح.');
    error.code = 'TOO_LARGE';
    throw error;
  }

  // Verify file signatures; browser-provided extensions and MIME types are untrusted.
  assertContentMatchesExtension(extension, bytes);

  // Recheck the actual byte count in case the declared size was understated.
  if (usedBefore.bytes + bytes.length > quotaBytes) {
    const error = new Error(
      `مساحتك لا تكفي: المستخدم ${usedBefore.usedMb} MB من ${usedBefore.quotaMb} MB. احذف ملفاً أو احجز مساحة أكبر.`
    );
    error.code = 'QUOTA_EXCEEDED';
    throw error;
  }

  const relativeDir = path.join('users', String(userId), 'files');
  const absoluteDir = absolutePath(relativeDir);
  await mkdir(absoluteDir, { recursive: true });

  const fileName = `${safeName(file.name)}.${extension}`;
  const storedPath = path.join(relativeDir, fileName);
  await writeFile(absolutePath(storedPath), bytes);

  try {
    const { rows } = await pool.query(
      `INSERT INTO files (user_id, title, file_name, stored_path, mime, size_bytes, source, step_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'upload', NULLIF($7, ''))
       RETURNING *`,
      [
        userId,
        String(title || file.name).trim().slice(0, 255) || fileName,
        fileName,
        storedPath,
        mime,
        bytes.length,
        stepKey
      ]
    );

    return normalizeFile(rows[0]);
  } catch (error) {
    // Remove the stored file if its metadata insert fails.
    try {
      await unlink(absolutePath(storedPath));
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.warn(`تعذّر تنظيف الملف اليتيم: ${cleanupError.code}`);
    }
    throw error;
  }
}

/** Reads an owned file for download or preview. */
export async function readOwnedFile(userId, fileId) {
  const row = await getFileRow(userId, fileId);
  if (!row) return null;

  try {
    return { row, buffer: await readFile(absolutePath(row.stored_path)) };
  } catch (error) {
    console.warn(`تعذّرت قراءة الملف ${row.file_name}: ${error.code || error.message}`);
    return { row, buffer: null };
  }
}

/** Deletes the file bytes and then its metadata row. */
export async function deleteFile(userId, fileId) {
  const row = await getFileRow(userId, fileId);
  if (!row) return false;

  try {
    await unlink(absolutePath(row.stored_path));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`تعذّر حذف الملف ${row.file_name}: ${error.code || error.message}`);
  }

  await pool.query('DELETE FROM files WHERE id = $2 AND user_id = $1', [userId, fileId]);
  return true;
}

/** Returns the storage root for diagnostics. */
export function storageRoot() {
  return path.resolve(STORAGE_ROOT);
}
