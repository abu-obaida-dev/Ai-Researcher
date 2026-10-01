import { pool } from '../db/client.js';
import { DEFAULT_PLANS, FREE_PLAN_CODE, FREE_TRIAL_TOKENS } from '../constants.js';

/**
 * باقة/باقات المنصة من PostgreSQL (جدول plans) — بدون أي Firestore.
 * كل الصفحات العامة تقرأ من هنا، والسقوط الآمن هو القيم الافتراضية في src/constants.js
 * حتى تعمل صفحة الهبوط قبل تهيئة قاعدة البيانات.
 */

/** يفصل نص المزايا المخزّن بأسطر متعددة إلى قائمة. */
export function splitFeatures(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** يحوّل صف جدول plans إلى شكل جاهز لعرض بطاقات الأسعار. */
export function normalizePlan(row) {
  const price = Number(row.price ?? 0);
  const tokens = Number(row.tokens ?? 0);

  return {
    code: row.code,
    title: row.title,
    tagline: row.tagline || '',
    price,
    tokens,
    period: row.period || 'شهرياً',
    cta: row.cta || (price > 0 ? 'اشترك الآن' : 'ابدأ مجاناً'),
    popular: Boolean(row.popular),
    isActive: row.is_active !== false,
    features: splitFeatures(row.features)
  };
}

/** الباقات الافتراضية بنفس شكل صفوف قاعدة البيانات (سقوط آمن). */
export function fallbackPlans() {
  return DEFAULT_PLANS.map((plan) => ({
    code: plan.code,
    title: plan.title,
    tagline: plan.tagline,
    price: plan.price,
    tokens: plan.tokens,
    period: plan.period,
    cta: plan.cta,
    popular: plan.popular,
    isActive: true,
    features: [...plan.features]
  }));
}

/** الباقات المعروضة في الموقع: المجانية أولاً ثم المدفوعة بترتيب العرض. */
export async function listPublicPlans() {
  try {
    const { rows } = await pool.query(
      `SELECT code, title, tagline, price, tokens, period, features, cta, popular, is_active
         FROM plans
        WHERE is_active = true
        ORDER BY (price = 0) DESC, display_order ASC, price ASC`
    );

    if (!rows.length) return fallbackPlans();
    return rows.map(normalizePlan);
  } catch (error) {
    console.warn(`تعذّرت قراءة الباقات من قاعدة البيانات (${error.code || error.message}) — سيتم استخدام الباقات الافتراضية.`);
    return fallbackPlans();
  }
}

/** باقة واحدة بالكود (مثل الباقة المجانية) مع سقوط آمن على الباقة الافتراضية. */
export async function getPlanByCode(code) {
  try {
    const { rows } = await pool.query('SELECT * FROM plans WHERE code = $1', [code]);
    if (rows.length) return normalizePlan(rows[0]);
  } catch (error) {
    console.warn(`تعذّرت قراءة الباقة ${code}: ${error.code || error.message}`);
  }

  return fallbackPlans().find((plan) => plan.code === code) || null;
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
