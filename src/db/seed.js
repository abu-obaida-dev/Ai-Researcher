import pg from 'pg';
import dotenv from 'dotenv';
import { resolveDatabaseTarget, describeDatabaseError } from './errors.js';
import { DEFAULT_PLANS, DEFAULT_SETTINGS, DEFAULT_ROLES } from '../constants.js';
import { DEFAULT_RESEARCH_PATHS } from '../data/research-paths.js';

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

/** أدوار النظام + صلاحياتها (تٌفعَّل في requireRole مع المرحلة الثانية). */
const ROLES_SEED = `
  INSERT INTO roles (code, title, level, is_system)
  VALUES ($1, $2, $3, true)
  ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, level = EXCLUDED.level;
`;

const ROLE_PERMISSIONS_SEED = `
  INSERT INTO role_permissions (role_code, permission)
  VALUES ($1, $2)
  ON CONFLICT (role_code, permission) DO NOTHING;
`;

/**
 * مسارات البحث وخطواتها — نفس التعريفات في src/data/research-paths.js.
 * البذرة اختيارية: صفحة «مسار البحث» تستخدم التعريفات نفسها مباشرة إن لم تُشغَّل.
 * is_default لا يُحدَّث حتى لا نُلغي اختيار المدير للمسار الافتراضي.
 */
const PATH_SEED = `
  INSERT INTO research_paths (degree_level, title, description, is_default)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (degree_level) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description
  RETURNING id;
`;

const STEP_SEED = `
  INSERT INTO research_path_steps (path_id, step_no, step_key, title, description, cost_type, is_required, guidance)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (path_id, step_no) DO UPDATE SET
    step_key = EXCLUDED.step_key,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    cost_type = EXCLUDED.cost_type,
    is_required = EXCLUDED.is_required,
    guidance = EXCLUDED.guidance;
`;

/** يٌزرع الأدوار مع صلاحياتها — يعيد عدد الأدوار. */
async function seedRoles(pool) {
  for (const role of DEFAULT_ROLES) {
    await pool.query(ROLES_SEED, [role.code, role.title, role.level]);
    for (const permission of role.permissions || []) {
      await pool.query(ROLE_PERMISSIONS_SEED, [role.code, permission]);
    }
  }
  return DEFAULT_ROLES.length;
}

/** يٌزرع المسارات وخطواتها — يعيد { paths, steps }. */
async function seedResearchPaths(pool) {
  let steps = 0;

  for (const path of DEFAULT_RESEARCH_PATHS) {
    const { rows } = await pool.query(PATH_SEED, [
      path.degree_level,
      path.title,
      path.description,
      Boolean(path.is_default)
    ]);
    const pathId = rows[0].id;

    for (const [index, item] of path.steps.entries()) {
      await pool.query(STEP_SEED, [
        pathId,
        index + 1,
        item.key,
        item.title,
        item.description,
        item.cost_type,
        item.is_required,
        item.guidance
      ]);
      steps += 1;
    }
  }

  return { paths: DEFAULT_RESEARCH_PATHS.length, steps };
}

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

    const roles = await seedRoles(pool);
    const paths = await seedResearchPaths(pool);

    console.log(
      `Seed data loaded successfully: ${DEFAULT_PLANS.length} plans + ${DEFAULT_SETTINGS.length} settings + ${roles} roles + ${paths.paths} research paths (${paths.steps} steps).`
    );
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
