import { pool } from '../db/client.js';
import {
  DEFAULT_PLANS,
  FREE_PLAN_CODE,
  FREE_TRIAL_TOKENS,
  PLAN_FILE_DEFAULT_MB,
  PLAN_FILE_MAX_MB,
  PLAN_STORAGE_DEFAULT_MB,
  PLAN_STORAGE_MAX_MB,
  PLATFORM_SERVICES
} from '../constants.js';
import { permissionsForRoles } from './access.js';

/** Loads plan data and derives visible features from role permissions and storage limits. */

/** Splits stored multiline features into a list. */
export function splitFeatures(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Clamps storage size to the supported range. */
export function normalizeStorageMb(value, fallback = PLAN_STORAGE_DEFAULT_MB) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, PLAN_STORAGE_MAX_MB);
}

/** Clamps the per-file limit to the supported range. */
export function normalizeFileMaxMb(value, fallback = PLAN_FILE_DEFAULT_MB) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(n, 1), PLAN_FILE_MAX_MB);
}

/** Formats numbers without importing view modules. */
function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/** Formats storage quotas in megabytes or gigabytes. */
export function formatStorageMb(mb) {
  const value = Number(mb) || 0;
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024} GB`;
  return `${formatNumber(value)} MB`;
}

/** Builds the storage-quota feature line. */
export function storageLabel(mb) {
  return `${formatStorageMb(mb)} مساحة تخزين لملفاتك (رفع · معاينة · تحميل)`;
}

/** Builds the per-file-limit feature line. */
export function fileMaxLabel(mb) {
  return `رفع الملفات حتى ${formatStorageMb(mb)} في الملف الواحد`;
}

/** Derives displayed plan features from permissions and administrator-defined text. */
export function planFeaturesFromPermissions(permissions, { extras = [] } = {}) {
  const set = permissions instanceof Set ? permissions : new Set(permissions || []);
  const open = (service) => set.has('*') || set.has(service.permission);

  return [...PLATFORM_SERVICES.filter(open).map((service) => service.planFeature || service.label), ...extras];
}

/** Loads role permissions in batches and caches decorated plans. */
export async function decoratePlans(plans) {
  const roles = await permissionsForRoles(plans.map((plan) => plan.roleCode));

  return plans.map((plan) => {
    const permissions = roles.get(plan.roleCode) || new Set();
    const services = PLATFORM_SERVICES.filter(
      (service) => permissions.has('*') || permissions.has(service.permission)
    );

    return {
      ...plan,
      services: services.map((service) => service.key),
      features: [
        ...planFeaturesFromPermissions(permissions),
        storageLabel(plan.storageMb),
        fileMaxLabel(plan.maxFileMb),
        ...plan.extraFeatures
      ]
    };
  });
}

/** Converts a plan row to the public display shape. */
export function normalizePlan(row) {
  const price = Number(row.price ?? 0);
  const tokens = Number(row.tokens ?? 0);
  const extraFeatures = splitFeatures(row.features);

  return {
    code: row.code,
    title: row.title,
    tagline: row.tagline || '',
    price,
    tokens,
    storageMb: normalizeStorageMb(row.storage_mb),
    maxFileMb: normalizeFileMaxMb(row.max_file_mb),
    period: row.period || 'شهرياً',
    cta: row.cta || (price > 0 ? 'اشترك الآن' : 'ابدأ مجاناً'),
    popular: Boolean(row.popular),
    isActive: row.is_active !== false,
    roleCode: String(row.role_code || '').trim(),
    extraFeatures,
    // Features are derived from permissions in decoratePlans.
    features: extraFeatures
  };
}

/** Returns default plans when database reads fail. */
export function fallbackPlans() {
  return decoratePlans(
    DEFAULT_PLANS.map((plan) =>
      normalizePlan({
        code: plan.code,
        title: plan.title,
        tagline: plan.tagline,
        price: plan.price,
        tokens: plan.tokens,
        storage_mb: plan.storageMb,
        max_file_mb: plan.fileMaxMb,
        period: plan.period,
        cta: plan.cta,
        popular: plan.popular,
        is_active: true,
        role_code: plan.roleCode || 'free',
        features: (plan.features || []).join('\n')
      })
    )
  );
}

/** Lists public plans with the free plan first. */
export async function listPublicPlans() {
  try {
    const { rows } = await pool.query(
      `SELECT code, title, tagline, price, tokens, storage_mb, max_file_mb, period, features, cta, popular, is_active, role_code
         FROM plans
        WHERE is_active = true
        ORDER BY (price = 0) DESC, display_order ASC, price ASC`
    );

    if (!rows.length) return fallbackPlans();
    return decoratePlans(rows.map(normalizePlan));
  } catch (error) {
    console.warn(`تعذّرت قراءة الباقات من قاعدة البيانات (${error.code || error.message}) — سيتم استخدام الباقات الافتراضية.`);
    return fallbackPlans();
  }
}

/** Loads one plan by code with a defaults fallback. */
export async function getPlanByCode(code) {
  try {
    const { rows } = await pool.query('SELECT * FROM plans WHERE code = $1', [code]);
    if (rows.length) {
      const [plan] = await decoratePlans([normalizePlan(rows[0])]);
      return plan;
    }
  } catch (error) {
    console.warn(`تعذّرت قراءة الباقة ${code}: ${error.code || error.message}`);
  }

  const [fallback] = (await fallbackPlans()).filter((plan) => plan.code === code);
  return fallback || null;
}

/** Returns the storage quota for a plan in bytes. */
export async function planStorageBytes(planCode) {
  const code = String(planCode || '').trim() || FREE_PLAN_CODE;
  try {
    const { rows } = await pool.query('SELECT storage_mb FROM plans WHERE code = $1', [code]);
    if (rows.length) return normalizeStorageMb(rows[0].storage_mb) * 1024 * 1024;
  } catch (error) {
    console.warn(`تعذّرت قراءة حصة التخزين للباقة ${code}: ${error.code || error.message}`);
  }
  return PLAN_STORAGE_DEFAULT_MB * 1024 * 1024;
}

/** Returns the configured free-trial token grant with a constants fallback. */
export async function freeTrialTokens() {
  const plan = await getPlanByCode(FREE_PLAN_CODE);
  const value = Number(plan?.tokens);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : FREE_TRIAL_TOKENS;
}
