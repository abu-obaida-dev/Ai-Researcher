import { pool } from '../db/client.js';

/**
 * إعدادات المنصة القابلة للتعديل من لوحة المدير — تُخزَّن في جدول settings
 * (مفتاح/قيمة نصية) حتى يسري التغيير فوراً بلا إعادة تشغيل الخادم.
 * لكل إعداد قيمة افتراضية هنا + متغيّر بيئة اختياري كسقوط آمن.
 *
 * ملاحظة: حدود تخزين الملفات لم تعد من هنا — صارت لكل باقة على حدة في
 * جدول plans (storage_mb + max_file_mb) يضبطها المدير من صفحة «الباقات».
 */

/**
 * رقم واتساب الدعم الفني — يُعدّله المدير من **صفحة الإعدادات** (بلا لمس الكود
 * وبلا إعادة تشغيل): يُخزَّن في settings تحت المفتاح `support_whatsapp` مع كاش
 * في الذاكرة. لو تُرك فارغاً نرجع لمتغيّر البيئة `SUPPORT_WHATSAPP` (خط نجاة).
 */
let supportWhatsappCache = null;
const SUPPORT_KEY = 'support_whatsapp';

/** أرقام الواتساب للصوت (مناقشة صوتية): رقم للشباب ورقم للبنات.
 * يُحدّدهما المدير من لوحة الإدارة ويُخزَّنان في settings تحت
 * `whatsapp_voice_male` و `whatsapp_voice_female`. كاش في الذاكرة لكل منهما.
 */
let voiceWhatsappMaleCache = null;
let voiceWhatsappFemaleCache = null;
const VOICE_MALE_KEY = 'whatsapp_voice_male';
const VOICE_FEMALE_KEY = 'whatsapp_voice_female';

/** يحمل رقم WhatsApp للصوت للشباب من قاعدة البيانات إلى الكاش. */
export async function loadVoiceWhatsappMale() {
  try {
    voiceWhatsappMaleCache = (await readSetting(VOICE_MALE_KEY)) || '';
  } catch {
    voiceWhatsappMaleCache = '';
  }
  return voiceWhatsappMaleCache;
}

/** يحمل رقم WhatsApp للصوت للبنات من قاعدة البيانات إلى الكاش. */
export async function loadVoiceWhatsappFemale() {
  try {
    voiceWhatsappFemaleCache = (await readSetting(VOICE_FEMALE_KEY)) || '';
  } catch {
    voiceWhatsappFemaleCache = '';
  }
  return voiceWhatsappFemaleCache;
}

/** رقم الصوت الفعّال للشباب: المخزّن أولاً، ثم البيئة، ثم فارغ. */
export function currentVoiceWhatsappMale() {
  return String(voiceWhatsappMaleCache || '').trim() || String(process.env.WHATSAPP_VOICE_MALE || '').trim();
}

/** رقم الصوت الفعّال للبنات: المخزّن أولاً، ثم البيئة، ثم فارغ. */
export function currentVoiceWhatsappFemale() {
  return String(voiceWhatsappFemaleCache || '').trim() || String(process.env.WHATSAPP_VOICE_FEMALE || '').trim();
}

/** رقم الصوت حسب الجنس: 'male' ⇒ رقم الشباب، 'female' ⇒ رقم البنات. */
export function currentVoiceWhatsappByGender(gender = '') {
  const g = String(gender || '').trim().toLowerCase();
  if (g === 'female' || g === 'أنثى' || g === 'بنت') return currentVoiceWhatsappFemale();
  return currentVoiceWhatsappMale(); // الافتراضي: رقم الشباب
}

/** يحفظ رقم واتساب الصوت بعد التحقق من صحته (نفس تنسيق دعم الواتساب). */
export async function saveVoiceWhatsapp(key, value) {
  const raw = String(value || '').trim();
  if (!raw) {
    if (key === VOICE_MALE_KEY) voiceWhatsappMaleCache = '';
    else voiceWhatsappFemaleCache = '';
    await writeSetting(key, '');
    return { ok: true, value: '' };
  }

  const digits = raw.replace(/\D/g, '');
  if (!/^\+?\d{8,15}$/.test(raw.replace(/[\s()-]/g, ''))) {
    return { ok: false, error: 'رقم غير صالح — اكتبه أرقاماً فقط (8 إلى 15 رقماً)، مثل 0912345678.' };
  }
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, error: `طول الرقم ${digits.length} رقماً — المطلوب 8 إلى 15.` };
  }

  const clean = raw.startsWith('+') ? `+${digits}` : digits;
  if (key === VOICE_MALE_KEY) voiceWhatsappMaleCache = clean;
  else voiceWhatsappFemaleCache = clean;
  await writeSetting(key, clean);
  return { ok: true, value: clean };
}

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
