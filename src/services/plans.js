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

/**
 * باقة/باقات المنصة من PostgreSQL (جدول plans) — بدون أي Firestore.
 * كل الصفحات العامة تقرأ من هنا، والسقوط الآمن هو القيم الافتراضية في src/constants.js
 * حتى تعمل صفحة الهبوط قبل تهيئة قاعدة البيانات.
 *
 * مصدران حقيقيان لبيانات البطاقة:
 *   - role_code   → صلاحيات الدور في role_permissions ⇒ الخدمات المفتوحة فعلياً.
 *   - storage_mb  → حصة التخزين التي يمنحها المدير لهذه الباقة.
 *   - max_file_mb → أقصى حجم للملف الواحد الذي يسمح به مشتركي الباقة.
 * لذلك تُولَّد «المزايا» المعروضة من الصلاحيات نفسها (planFeatures) فلا تُخالف
 * الواجهة ما يفتحه الباحث فعلاً باقته.
 */

/** يفصل نص المزايا المخزّن بأسطر متعددة إلى قائمة. */
export function splitFeatures(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** يحوّل أي قيمة إلى ميجابايت صالحة ضمن [0, PLAN_STORAGE_MAX_MB] مع سقوط آمن. */
export function normalizeStorageMb(value, fallback = PLAN_STORAGE_DEFAULT_MB) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, PLAN_STORAGE_MAX_MB);
}

/** يحوّل أي قيمة إلى أقصى حجم ملف (MB) صالح ضمن [1, PLAN_FILE_MAX_MB] مع سقوط آمن. */
export function normalizeFileMaxMb(value, fallback = PLAN_FILE_DEFAULT_MB) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(n, 1), PLAN_FILE_MAX_MB);
}

/** فاصل آلاف بنفس صيغة الواجهة (بدون استيراد views لتفادي دورة). */
function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/** 500 → «500 MB» ، 2048 → «2 GB» (للحصة الكبيرة فقط). */
export function formatStorageMb(mb) {
  const value = Number(mb) || 0;
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024} GB`;
  return `${formatNumber(value)} MB`;
}

/** سطر الميزة الخاص بحصة التخزين (يُعرض في بطاقة الباقة). */
export function storageLabel(mb) {
  return `${formatStorageMb(mb)} مساحة تخزين لملفاتك (رفع · معاينة · تحميل)`;
}

/** سطر الميزة الخاص بأقصى حجم للملف الواحد (يُعرض في بطاقة الباقة). */
export function fileMaxLabel(mb) {
  return `رفع الملفات حتى ${formatStorageMb(mb)} في الملف الواحد`;
}

/**
 * مزايا الباقة كما تُعرض للباحث: تُولَّد من صلاحيات دورها في قاعدة البيانات
 * (كل خدمة مفتوحة سطر واحد بنصها من PLATFORM_SERVICES.planFeature)،
 * ثم تُضاف الأسطر الاختيارية التي كتبها المدير في plans.features.
 */
export function planFeaturesFromPermissions(permissions, { extras = [] } = {}) {
  const set = permissions instanceof Set ? permissions : new Set(permissions || []);
  const open = (service) => set.has('*') || set.has(service.permission);

  return [...PLATFORM_SERVICES.filter(open).map((service) => service.planFeature || service.label), ...extras];
}

/**
 * يقرأ صلاحيات أدوار الباقات دفعة واحدة ثم يبني features + services لكل باقة،
 * فلا يحتاج عرض صفحة الهبوط أكثر من استعلام واحد لكل دور (مع كاش 30 ثانية).
 */
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

/** يحوّل صف جدول plans إلى شكل جاهز لعرض بطاقات الأسعار (قبل توليد المزايا). */
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
    //Features تُبنى من الصلاحيات الحقيقية في decoratePlans (القيمة هنا فقط احتياط).
    features: extraFeatures
  };
}

/** الباقات الافتراضية بنفس شكل صفوف قاعدة البيانات (سقوط آمن). */
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

/** الباقات المعروضة في الموقع: المجانية أولاً ثم المدفوعة بترتيب العرض. */
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

/** باقة واحدة بالكود (مثل الباقة المجانية) مع سقوط آمن على الباقة الافتراضية. */
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

/**
 * حصة التخزين بالبايت لباقة — تُقرأ من plans.storage_mb وتُطبَّق عند رفع الملفات.
 * السقوط المتدرّج: قيمة الباقة ← الحدّ الافتراضي الثابت (PLAN_STORAGE_DEFAULT_MB).
 */
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

/**
 * عدد نقاط التجربة المجانية المعلن في كل صفحات الموقع.
 * المصدر الوحيد: حقل tokens في الباقة المجانية (plans.free_trial) — يغيّره المدير
 * من صفحة الباقات فيسري فوراً على كل النصوص، والسقوط الآمن FREE_TRIAL_TOKENS.
 */
export async function freeTrialTokens() {
  const plan = await getPlanByCode(FREE_PLAN_CODE);
  const value = Number(plan?.tokens);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : FREE_TRIAL_TOKENS;
}
