import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/client.js';
import { FILE_UPLOAD_LIMITS, FREE_PLAN_CODE, isUuid } from '../constants.js';
import { isValidStepKeyForUser } from './journey.js';
import { maxStorageBytes, maxUploadBytes } from './settings.js';
import { planStorageBytes } from './plans.js';
import { assertContentMatchesExtension } from './upload-guard.js';

/**
 * ملفات الباحث (1E): الميتاداتا في جدول files والبايتات على القرص تحت
 * storage/users/{userId}/files/ كما هو موصوف في storage/README.md.
 * كل عملية تتأكد أن الملف مملوك لصاحب الجلسة، والرفع محدود بـ:
 *   - حجم الملف الواحد  (حدّ يضبطه المدير من لوحة الإدارة)
 *   - المساحة الكلية للمستخدم (حدّ يضبطه المدير من لوحة الإدارة)
 *   - قائمة الأنواع المسموحة (constants.js → FILE_UPLOAD_LIMITS)
 * مع اسم ملف نظيف داخل المجلد.
 */

const STORAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage');

/** أقصى حجم نعرضه كنص داخل صفحة المعاينة (كبير كفاية، صغير يحمي المتصفح). */
const TEXT_PREVIEW_LIMIT = 400 * 1024;

/**
 * هل التخزين المحلي متاح؟ على Vercel/AWS Functions نظام الملفات للقراءة فقط،
 * فكتابة الملفات المرفوعة تفشل دائماً. نكتشف المنصة بمتغيّر بيئة بدل محاولة
 * الكتابة ثم الفشل (والمحاولة تقرأ الملف كله في الذاكرة قبل أن ترفضه).
 */
export function isEphemeralStorage() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export { maxUploadBytes, maxStorageBytes };

/** نص الأنواع المسموحة للعرض في الصفحة. */
export function allowedTypesLabel() {
  return FILE_UPLOAD_LIMITS.allowedExtensions.map((item) => `.${item}`).join(' · ');
}

/** اسم ملف آمن للتخزين: حروف وأرقام وشرطات فقط، مع الاحتفاظ بالامتداد. */
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

/** الامتداد بحروف صغيرة أو null. */
function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : null;
}

/** وصف مختصر لنوع الملف بالعرض. */
function kindOf(extension) {
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'صورة';
  if (extension === 'pdf') return 'مستند PDF';
  if (['xls', 'xlsx', 'csv'].includes(extension)) return 'جدول بيانات';
  if (['doc', 'docx', 'txt', 'md'].includes(extension)) return 'مستند نصي';
  if (['ppt', 'pptx'].includes(extension)) return 'عرض تقديمي';
  if (extension === 'zip') return 'ملف مضغوط';
  return 'مستند';
}

/** صف ملف جاهز للعرض (يُستخدم في القائمة وصفحة المعاينة). */
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

/** حجم مقروء للعرض (KB/MB/GB). */
export function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1073741824) return `${(size / 1073741824).toFixed(2)} GB`;
  if (size >= 1048576) return `${(size / 1048576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} بايت`;
}

/** المسار المطلق للملف على القرص بعد التأكد أنه داخل storage/. */
function absolutePath(storedPath) {
  const absolute = path.resolve(STORAGE_ROOT, String(storedPath || ''));
  if (!absolute.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
    const error = new Error('مسار ملف غير صالح.');
    error.code = 'BAD_PATH';
    throw error;
  }
  return absolute;
}

/** ملفات الباحث (كلها أو لخطوة معيّنة) — الأحدث أولاً. */
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

/**
 * حصة تخزين الباحث بالبايت: القيمة الحقيقية من باقته في قاعدة البيانات
 * (plans.storage_mb — يضبطها المدير من صفحة الباقات)، مع سقوط آمن على
 * حدّ المنصة العام (settings.max_storage_mb) إن تعذّرت القراءة.
 */
export async function userQuotaBytes(userId) {
  try {
    const { rows } = await pool.query('SELECT plan_code FROM users WHERE id = $1', [userId]);
    return await planStorageBytes(rows[0]?.plan_code || FREE_PLAN_CODE);
  } catch (error) {
    console.warn(`تعذّرت قراءة حصة التخزين للمستخدم: ${error.code || error.message}`);
    return maxStorageBytes();
  }
}

/**
 * ملخّص مساحة الباحث: عدد الملفات + المستخدم + الحصة + المتبقي + نسبة الاستخدام.
 * يُستخدم في شريط المساحة أعلى صفحة «ملفاتى».
 *
 * ملاحظة عن الدقة: مع حصة 500 MB ورفع ملف صغير (18 KB) تكون النسبة 0.04% —
 * لذلك نحتفظ بالبايت الدقيق، ونحسب النسبة بمنزلة عشرية، ونضمن حداً أدنى
 * مرئياً للشريط (1.2%) ما دام المستخدم لم يفرغ، وإلا بدا الشريط معطّلاً.
 */
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
  // شريط مرئي دائماً عند وجود استخدام، مهما صغر
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
    // حقول بالميغابايت للتوافق مع أي استهلاك سابق
    usedMb: Math.round((usedBytes / (1024 * 1024)) * 10) / 10,
    quotaMb: Math.round(quotaBytes / (1024 * 1024)),
    remainingMb: Math.round((remainingBytes / (1024 * 1024)) * 10) / 10
  };
}

/**
 * نوع المعاينة المدعومة للمتصفح لهذا الملف:
 * - 'image' → صور (img)
 * - 'pdf'   → PDF (iframe)
 * - 'sheet' → xlsx / xls / csv ⇒ جدول داخل الصفحة (services/spreadsheet.js)
 * - 'text'  → txt و md (نعرضها كنصّ داخل <pre>)
 * - 'none'  → doc / pptx / zip … لا عارض في المتصفح ⇒ تحميل فقط
 * ملاحظة أمنية: 'text' تُقدَّم دائماً كنص عادي مع nosniff — لا HTML مطلقاً.
 */
export function previewKind(fileName = '', mime = '') {
  const ext = extensionOf(fileName);
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  // جداول البيانات: xlsx / xls / csv ⇒ معاينة كجدول (services/spreadsheet.js)
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  if (['txt', 'md'].includes(ext)) return 'text';
  if (mime === 'text/plain' || mime === 'text/markdown') return 'text';
  if (mime === 'text/csv' || mime === 'application/vnd.ms-excel' || (mime || '').includes('spreadsheetml')) return 'sheet';
  return 'none';
}

/** هل لهذا الملف معاينة في المتصفح؟ (لعرض زر «عرض» في الجدول) */
export function isPreviewable(file) {
  return previewKind(file?.file_name, file?.mime) !== 'none';
}

/**
 * محتوى نصّي للمعاينة (بحد أقصى TEXT_PREVIEW_LIMIT بايت لتفادي الصفحات الثقيلة).
 * يعيد string أو null إن لم يكن الملف نصياً أو تجاوز الحد.
 */
export function textPreview(buffer, maxBytes = TEXT_PREVIEW_LIMIT) {
  if (!buffer || buffer.length > maxBytes) return null;

  // نتجنّب بايتات NUL (تشيّر على ملف ثنائي حتى لو امتداده نصي)
  const slice = buffer.subarray(0, 2048);
  if (slice.includes(0)) return null;

  return buffer.toString('utf8');
}

/** صف واحد بملكيته (null إن لم يكن له) — يُستخدم للتحميل والحذف. */
export async function getFileRow(userId, fileId) {
  // حارس: معرّف غير UUID يجعل Postgres يرمي ⇒ بلا هذا يتحوّل الرمي إلى
  // unhandledRejection داخل معالج async فتنهار عملية الخادم كاملة (DoS).
  if (!isUuid(fileId)) return null;
  const { rows } = await pool.query('SELECT * FROM files WHERE id = $2 AND user_id = $1', [userId, fileId]);
  return rows[0] || null;
}

/**
 * رفع ملف: يتحقق من الامتداد وحجم الملف الواحد ونوع المحتوى، ثم يتأكد أن
 * المساحة الكلية للمستخدم تكفي، ثم يكتب البايتات في مجلد الباحث ويسجّل صف
 * metadata. أي فشل بعد الكتابة ينظّف الملف جزئياٌ.
 */
export async function saveUpload(userId, { file, title = '', step = '' } = {}) {
  // منصّات Serverless (Vercel): نظام الملفات للقراءة فقط ⇒ لا مكان لحفظ الملف.
  // نرفض مبكراً برسالة عربية مفهومة بدل خطأ 500 غامض أو ضياع الملف بعد قراءته.
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

  const [limit, quotaBytes] = await Promise.all([maxUploadBytes(), userQuotaBytes(userId)]);
  if (Number(file.size || 0) > limit) {
    const error = new Error(`حجم الملف أكبر من الحد المسموح (${Math.round(limit / (1024 * 1024))} MB).`);
    error.code = 'TOO_LARGE';
    throw error;
  }

  // الحصة الكلية: نرفض الرفع إن لم تتسع للملف بحجمه المُعلن.
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

  // البصمة الثنائية: نتأكد أن بايتات الملف تطابق امتداده قبل أي كتابة على القرص.
  // (الامتداد وContent-Type يرسلهما المتصفح ⇒ لا يصلحان كدليل وحدهما).
  assertContentMatchesExtension(extension, bytes);

  // إعادة الفحص بالحجم الحقيقي (بعد قراءة البايتات) في حال أخبر المتصفح بحجم أقل
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
    // لا نُبقي بايتات بلا صف metadata (يتيمة على القرص)
    try {
      await unlink(absolutePath(storedPath));
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.warn(`تعذّر تنظيف الملف اليتيم: ${cleanupError.code}`);
    }
    throw error;
  }
}

/** قراءة بايتات ملف مملوك للباحث (لتحميله أو عرضه) — null إن لم يوجد. */
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

/** حذف ملف من مراجعات الباحث: البايتات أولاً ثم صف metadata. */
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

/** مجلد التخزين على القرص (للتشخيص فقط). */
export function storageRoot() {
  return path.resolve(STORAGE_ROOT);
}
