import { pool } from '../db/client.js';

/**
 * إعدادات المنصة القابلة للتعديل من لوحة المدير — تُخزَّن في جدول settings
 * (مفتاح/قيمة نصية) حتى يسري التغيير فوراً بلا إعادة تشغيل الخادم.
 * لكل إعداد قيمة افتراضية هنا + متغيّر بيئة اختياري كسقوط آمن.
 */

/** الحدود الافتراضية لتخزين الملفات: حجم الملف الواحد + المساحة الكلية للمستخدم. */
export const STORAGE_DEFAULTS = {
  // أقصى حجم للملف الواحد بالميغابايت
  maxUploadMb: 100,
  // أقصى مساحة إجمالية لكل باحث بالميغابايت
  maxStorageMb: 500
};

/**
 * رقم واتساب الدعم الفني — يُعدّله المدير من **صفحة الإعدادات** (بلا لمس الكود
 * وبلا إعادة تشغيل): يُخزَّن في settings تحت المفتاح `support_whatsapp` مع كاش
 * في الذاكرة. لو تُرك فارغاً نرجع لمتغيّر البيئة `SUPPORT_WHATSAPP` (خط نجاة).
 */
let supportWhatsappCache = null;
const SUPPORT_KEY = 'support_whatsapp';

/** يحمّل الرقم من قاعدة البيانات إلى الكاش (مرة عند تشغيل الخادم). */
export async function loadSupportWhatsapp() {
  try {
    supportWhatsappCache = (await readSetting(SUPPORT_KEY)) || '';
  } catch {
    supportWhatsappCache = '';
  }
  return supportWhatsappCache;
}

/** الرقم الفعّال الآن: المخزَّن أولاً، ثم البيئة، ثم فارغ (لا رابط). */
export function currentSupportWhatsapp() {
  return String(supportWhatsappCache || '').trim() || String(process.env.SUPPORT_WHATSAPP || '').trim();
}

/**
 * يحفظ الرقم بعد تنظيفه: أرقام فقط مع `+` في الأول، بطول 8–15 رقماً.
 * الفارغ = تعطيل الزر (يُحفظ كسلسلة فارغة عمداً).
 */
export async function saveSupportWhatsapp(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    supportWhatsappCache = '';
    await writeSetting(SUPPORT_KEY, '');
    return { ok: true, value: '' };
  }

  const digits = raw.replace(/[^\d]/g, '');
  if (!/^\+?\d{8,15}$/.test(raw.replace(/[\s()-]/g, ''))) {
    return { ok: false, error: 'رقم غير صالح — اكتبه أرقاماً فقط (8 إلى 15 رقماً)، مثل 0912345678.' };
  }
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, error: `طول الرقم ${digits.length} رقماً — المطلوب 8 إلى 15.` };
  }

  const clean = raw.startsWith('+') ? `+${digits}` : digits;
  supportWhatsappCache = clean;
  await writeSetting(SUPPORT_KEY, clean);
  return { ok: true, value: clean };
}

/** يقرأ إعدادًا نصيًا من جدول settings (null إن لم يوجد). */
async function readSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

/** يحفظ إعدادًا (upsert). */
async function writeSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

/** يقرأ إعداداً مخزَّناً كـ JSON ويعيد قيمة افتراضية عند أي خلل (لا يفشل المستدعي أبداً). */
export async function readJsonSetting(key, fallback = null) {
  try {
    const stored = await readSetting(key);
    if (stored === null || stored === '') return fallback;
    const parsed = JSON.parse(stored);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** يحفظ قيمة إعداداً على هيئة JSON (upsert). */
export async function writeJsonSetting(key, value) {
  await writeSetting(key, JSON.stringify(value));
}

/** يحول نصًّا إلى عدد موجب صحيح ضمن [min, max] (سقوط آمن على default). */
function toPositiveInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** قراءة إعداد مرتبط بالتخزين: جدول settings أولاً ثم متغيّر البيئة ثم الافتراضي. */
async function readNumber(key, envName, fallback, bounds) {
  const stored = await readSetting(key);
  if (stored !== null) return toPositiveInt(stored, { fallback, ...bounds });
  return toPositiveInt(process.env[envName], { fallback, ...bounds });
}

/** أقصى حجم للملف الواحد بالبايت (افتراضي 100 MB — كان 10 MB). */
export async function maxUploadBytes() {
  const mb = await readNumber('max_upload_mb', 'MAX_UPLOAD_MB', STORAGE_DEFAULTS.maxUploadMb, { min: 1, max: 2048 });
  return mb * 1024 * 1024;
}

/** أقصى مساحة إجمالية لكل باحث بالبايت (افتراضي 500 MB). */
export async function maxStorageBytes() {
  const mb = await readNumber('max_storage_mb', 'MAX_STORAGE_MB', STORAGE_DEFAULTS.maxStorageMb, { min: 10, max: 102400 });
  return mb * 1024 * 1024;
}

/** حدود التخزين الحالية بالميغابايت (للعرض في لوحة المدير). */
export async function storageLimits() {
  const [maxUploadBytesValue, maxStorageBytesValue] = await Promise.all([maxUploadBytes(), maxStorageBytes()]);
  return {
    maxUploadMb: Math.round(maxUploadBytesValue / (1024 * 1024)),
    maxStorageMb: Math.round(maxStorageBytesValue / (1024 * 1024))
  };
}

/** يحفظ حدود التخزين بعد التحقق من صحتها ورابطتها (الكلية ≥ حجم الملف). */
export async function saveStorageLimits({ maxUploadMb, maxStorageMb }) {
  const upload = toPositiveInt(maxUploadMb, { min: 1, max: 2048, fallback: STORAGE_DEFAULTS.maxUploadMb });
  const storage = toPositiveInt(maxStorageMb, { min: 10, max: 102400, fallback: STORAGE_DEFAULTS.maxStorageMb });

  // المساحة الكلية يجب ألا تقل عن حجم الملف الواحد، وإلا لم يستطع الباحث رفع ملف واحد.
  if (storage < upload) {
    const error = new Error('المساحة الكلية يجب أن تكون أكبر من أو تساوي حجم الملف الواحد.');
    error.code = 'INVALID_LIMITS';
    throw error;
  }

  await writeSetting('max_upload_mb', String(upload));
  await writeSetting('max_storage_mb', String(storage));

  return { maxUploadMb: upload, maxStorageMb: storage };
}
