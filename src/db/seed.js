import pg from 'pg';
import dotenv from 'dotenv';
import { resolveDatabaseTarget, describeDatabaseError } from './errors.js';
import { DEFAULT_PLANS, DEFAULT_SETTINGS } from '../constants.js';

dotenv.config();

const { Pool } = pg;

/**
 * بذرة قاعدة البيانات: الباقات (بنفس نصوص الموقع وأسعاره) + إعدادات المنصة الافتراضية.
 * المزايا تُخزَّن نصاً بأسطر متعددة وتُعرض كقائمة في بطاقات الأسعار.
 * لا نلمس is_active عند التحديث حتى لا نُلغي تعطيل المدير لأي باقة.
 */
const PLANS_SEED = `
  INSERT INTO plans (code, title, tagline, price, tokens, period, cta, popular, display_order, features, is_active)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
  ON CONFLICT (code) DO UPDATE SET
    title = EXCLUDED.title,
    tagline = EXCLUDED.tagline,
    price = EXCLUDED.price,
    tokens = EXCLUDED.tokens,
    period = EXCLUDED.period,
    cta = EXCLUDED.cta,
    popular = EXCLUDED.popular,
    display_order = EXCLUDED.display_order,
    features = EXCLUDED.features;
`;

const SETTINGS_SEED = `
  INSERT INTO settings (key, value, updated_at)
  VALUES ($1, $2, NOW())
  ON CONFLICT (key) DO NOTHING;
`;

async function seedData() {
  let target;
  let pool;

  try {
    target = resolveDatabaseTarget();
    pool = new Pool({
      connectionString: target.connectionString,
      connectionTimeoutMillis: 5000
    });

    for (const plan of DEFAULT_PLANS) {
      await pool.query(PLANS_SEED, [
        plan.code,
        plan.title,
        plan.tagline,
        plan.price,
        plan.tokens,
        plan.period,
        plan.cta,
        plan.popular,
        plan.displayOrder,
        plan.features.join('\n')
      ]);
    }

    for (const [key, value] of DEFAULT_SETTINGS) {
      await pool.query(SETTINGS_SEED, [key, value]);
    }

    console.log(`Seed data loaded successfully: ${DEFAULT_PLANS.length} plans + ${DEFAULT_SETTINGS.length} settings.`);
  } catch (error) {
    console.error(describeDatabaseError(error, target, 'تحميل البيانات التجريبية'));
    process.exitCode = 1;
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

seedData();
