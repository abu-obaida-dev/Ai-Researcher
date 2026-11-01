import { pool } from '../db/client.js';
import { SUPPORT_WHATSAPP } from '../constants.js';

/** Administrator-managed settings persisted as key/value rows. */

/** Loads and caches the configured WhatsApp support number. */
let supportWhatsappCache = null;
const SUPPORT_KEY = 'support_whatsapp';
const REPLACED_SUPPORT_NUMBER = '01015240760';

function isReplacedSupportNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits === REPLACED_SUPPORT_NUMBER || digits === `218${REPLACED_SUPPORT_NUMBER}`;
}

/** Loads and caches the separate voice-defense WhatsApp numbers. */
let voiceWhatsappMaleCache = null;
let voiceWhatsappFemaleCache = null;
const VOICE_MALE_KEY = 'whatsapp_voice_male';
const VOICE_FEMALE_KEY = 'whatsapp_voice_female';

/** Loads and caches the male voice-defense number. */
export async function loadVoiceWhatsappMale() {
  try {
    voiceWhatsappMaleCache = (await readSetting(VOICE_MALE_KEY)) || '';
  } catch {
    voiceWhatsappMaleCache = '';
  }
  return voiceWhatsappMaleCache;
}

/** Loads and caches the female voice-defense number. */
export async function loadVoiceWhatsappFemale() {
  try {
    voiceWhatsappFemaleCache = (await readSetting(VOICE_FEMALE_KEY)) || '';
  } catch {
    voiceWhatsappFemaleCache = '';
  }
  return voiceWhatsappFemaleCache;
}

/** Returns the configured male voice-defense number. */
export function currentVoiceWhatsappMale() {
  return String(voiceWhatsappMaleCache || '').trim() || String(process.env.WHATSAPP_VOICE_MALE || '').trim();
}

/** Returns the configured female voice-defense number. */
export function currentVoiceWhatsappFemale() {
  return String(voiceWhatsappFemaleCache || '').trim() || String(process.env.WHATSAPP_VOICE_FEMALE || '').trim();
}

/** Selects the voice-defense number by gender. */
export function currentVoiceWhatsappByGender(gender = '') {
  const g = String(gender || '').trim().toLowerCase();
  if (g === 'female' || g === 'أنثى' || g === 'بنت') return currentVoiceWhatsappFemale();
  return currentVoiceWhatsappMale(); // الافتراضي: رقم الشباب
}

/** Validates and stores a voice-defense WhatsApp number. */
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

/** Loads the support number into memory during startup. */
export async function loadSupportWhatsapp() {
  try {
    supportWhatsappCache = (await readSetting(SUPPORT_KEY)) || '';
    if (isReplacedSupportNumber(supportWhatsappCache)) {
      supportWhatsappCache = SUPPORT_WHATSAPP;
      await writeSetting(SUPPORT_KEY, SUPPORT_WHATSAPP);
    }
  } catch {
    supportWhatsappCache = '';
  }
  return supportWhatsappCache;
}

/** Returns the current support number, falling back to the configured default. */
export function currentSupportWhatsapp() {
  const configured = String(supportWhatsappCache || process.env.SUPPORT_WHATSAPP || '').trim();
  return (isReplacedSupportNumber(configured) ? SUPPORT_WHATSAPP : configured) || SUPPORT_WHATSAPP;
}

/** Normalizes and stores the support number; an empty value disables the link. */
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

/** Reads a text setting or returns null when missing. */
async function readSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

/** Upserts a text setting. */
async function writeSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

/** Reads a JSON setting with a fallback on missing or invalid values. */
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

/** Upserts a JSON setting. */
export async function writeJsonSetting(key, value) {
  await writeSetting(key, JSON.stringify(value));
}
