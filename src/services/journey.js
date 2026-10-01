import { pool } from '../db/client.js';
import { STEP_STATUSES, TOKEN_COSTS } from '../constants.js';
import { DEFAULT_RESEARCH_PATHS } from '../data/research-paths.js';

/**
 * خدمة «مسار البحث» (1D).
 *
 * المصدر المفضّل للخطوات: جدولا research_paths/research_path_steps في PostgreSQL
 * (يُملآن عند تشغيل npm run db:seed أو من لوحة المدير مستقبلاً). وإن كانا فارغين
 * نستخدم التعريفات في src/data/research-paths.js مباشرة، فتعمل الصفحة فوراّ بدون
 * أي خطوة إعداد. في الحالتين يبقى ربط التقدّم بـ step_key الدلالي للخطوة.
 */

const COST_BY_TYPE = new Map(TOKEN_COSTS.map((item) => [item.type, item]));
const STATUS_VALUES = new Set(STEP_STATUSES.map((item) => item.value));

/** سعر الخطوة بالنقاط من TOKEN_COSTS (سقوط آمن على سعر رسالة المشرف). */
export function costForType(type) {
  return COST_BY_TYPE.get(type)?.tokens ?? TOKEN_COSTS[0].tokens;
}

/** وصف نوع الاستهلاك الظاهر مع الخطوة (من TOKEN_COSTS). */
export function costLabelForType(type) {
  return COST_BY_TYPE.get(type)?.label || 'رسالة إلى المشرف الذكي';
}

/** عنوان خطوة بالمفتاح من التعريفات البرمجية (null إن لم تُعرف). */
export function stepTitleFromCode(stepKey) {
  for (const path of DEFAULT_RESEARCH_PATHS) {
    const found = path.steps.find((item) => item.key === stepKey);
    if (found) return found.title;
  }
  return null;
}

/** عنوان الخطوة بالمفتاح مع مراعاة الخطوات المخزّنة في قاعدة البيانات. */
export async function stepTitle(stepKey) {
  if (!stepKey) return null;

  try {
    const { rows } = await pool.query(
      'SELECT title FROM research_path_steps WHERE step_key = $1 ORDER BY created_at LIMIT 1',
      [stepKey]
    );
    if (rows.length) return rows[0].title;
  } catch (error) {
    console.warn(`تعذّر عنوان الخطوة ${stepKey}: ${error.code || error.message}`);
  }

  return stepTitleFromCode(stepKey);
}

/** مسار من التعريفات البرمجية لدرجة معيّنة (سقوط آمن على مسار البكالوريوس). */
function codePath(degreeLevel) {
  const found =
    DEFAULT_RESEARCH_PATHS.find((path) => path.degree_level === degreeLevel) || DEFAULT_RESEARCH_PATHS[0];

  return {
    source: 'code',
    degreeLevel: found.degree_level,
    title: found.title,
    description: found.description || '',
    steps: found.steps.map((item, index) => ({
      key: item.key,
      no: index + 1,
      title: item.title,
      description: item.description || '',
      costType: item.cost_type,
      required: item.is_required !== false,
      guidance: item.guidance || ''
    }))
  };
}

/** خطوات درجة معيّنة: من قاعدة البيانات إن وُجدت، وإلا من التعريفات البرمجية. */
export async function resolvePathForDegree(degreeLevel) {
  try {
    const { rows } = await pool.query(
      `SELECT p.title, p.description, s.step_no, s.step_key, s.title AS step_title,
              s.description AS step_description, s.cost_type, s.is_required, s.guidance
         FROM research_paths p
         JOIN research_path_steps s ON s.path_id = p.id
        WHERE p.degree_level = $1
        ORDER BY s.step_no ASC
        LIMIT 40`,
      [degreeLevel]
    );

    if (rows.length) {
      return {
        source: 'database',
        degreeLevel,
        title: rows[0].title,
        description: rows[0].description || '',
        steps: rows.map((row, index) => ({
          key: row.step_key || `step-${row.step_no}`,
          no: row.step_no ?? index + 1,
          title: row.step_title,
          description: row.step_description || '',
          costType: row.cost_type || 'chat',
          required: row.is_required !== false,
          guidance: row.guidance || ''
        }))
      };
    }
  } catch (error) {
    console.warn(
      `تعذّرت قراءة مسار البحث من قاعدة البيانات (${error.code || error.message}) — نستخدم التعريفات الافتراضية.`
    );
  }

  return codePath(degreeLevel);
}

/** خيارات الخطوة لدرجة معيّنة (تُستخدم في قوائم الربط داخل الملاحظات والمراجع والملفات). */
export async function stepOptionsForDegree(degreeLevel) {
  const path = await resolvePathForDegree(degreeLevel);
  return path.steps.map((step) => ({ value: step.key, label: `${step.no}. ${step.title}` }));
}

/** درجة الباحث من جدول profiles (بكالوريوس افتراضياً). */
export async function degreeOfUser(userId) {
  try {
    const { rows } = await pool.query('SELECT degree_level FROM profiles WHERE user_id = $1', [userId]);
    return rows[0]?.degree_level || 'bachelor';
  } catch (error) {
    console.warn(`تعذّرت قراءة درجة الباحث (${error.code || error.message})`);
    return 'bachelor';
  }
}

/** يتأكد أن مفتاح الخطوة ينتمي لمسار الباحث (قبل ربط مرجع أو ملاحظة أو ملف بخطوة). */
export async function isValidStepKeyForUser(userId, stepKey) {
  if (!stepKey) return true;
  const path = await resolvePathForDegree(await degreeOfUser(userId));
  return path.steps.some((step) => step.key === stepKey);
}

/**
 * مسار الباحث مع حالته الحالية: دمج تعريف الخطوات مع صفوف user_step_progress.
 * يعيد أيضاّ ملخصاّ (done/total/percent/current) تستخدمه صفحة الإحصائية والسايدبار.
 */
export async function getJourney(userId, degreeLevel) {
  const path = await resolvePathForDegree(degreeLevel);

  let progressRows = [];
  try {
    const { rows } = await pool.query(
      'SELECT step_key, status, output_note, completed_at FROM user_step_progress WHERE user_id = $1',
      [userId]
    );
    progressRows = rows;
  } catch (error) {
    console.warn(`تعذّرت قراءة تقدّم الباحث (${error.code || error.message}) — يُعرض المسار بلا تقدّم.`);
  }

  const byKey = new Map(progressRows.map((row) => [row.step_key, row]));

  const steps = path.steps.map((step) => {
    const row = byKey.get(step.key);
    const status = STATUS_VALUES.has(row?.status) ? row.status : 'not_started';

    return {
      ...step,
      status,
      statusLabel: STEP_STATUSES.find((item) => item.value === status)?.label || 'لم يبدأ',
      outputNote: row?.output_note || '',
      completedAt: row?.completed_at || null,
      cost: costForType(step.costType),
      costLabel: costLabelForType(step.costType)
    };
  });

  const total = steps.length;
  const done = steps.filter((step) => step.status === 'done').length;
  const requiredTotal = steps.filter((step) => step.required).length;
  const requiredDone = steps.filter((step) => step.required && step.status === 'done').length;

  return {
    ...path,
    steps,
    total,
    done,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    requiredTotal,
    requiredDone,
    current: steps.find((step) => step.status === 'in_progress') || steps.find((step) => step.status !== 'done') || null,
    completed: total > 0 && done === total,
    statuses: STEP_STATUSES
  };
}

/** ملخص تقدّم مختصر لصفحة الإحصائية — لا يفشل أبداً (يعيد null عند الخطأ). */
export async function getJourneySummary(userId, degreeLevel) {
  try {
    const journey = await getJourney(userId, degreeLevel);
    return {
      title: journey.title,
      total: journey.total,
      done: journey.done,
      percent: journey.percent,
      currentKey: journey.current?.key || '',
      currentTitle: journey.current ? journey.current.title : 'اكتمل المسار',
      source: journey.source
    };
  } catch (error) {
    console.warn(`تعذّر حساب تقدّم المسار (${error.code || error.message})`);
    return null;
  }
}

/**
 * تغيير حالة خطوة (لم يبدأ / جاري / تم) مع ملاحظة المخرجات.
 * يرفض مفاتيح الخطوات التي لا توجد في مسار الدرجة نفسها، وتُحفظ completed_at
 * أول مرة فقط عند الحالة 'done' وتُمسح إن رجع الباحث عن الإنجاز.
 */
export async function setStepStatus(userId, stepKey, { status = 'not_started', outputNote = '' } = {}) {
  if (!STATUS_VALUES.has(status)) {
    const error = new Error('حالة غير صالحة للخطوة.');
    error.code = 'BAD_STATUS';
    throw error;
  }

  const path = await resolvePathForDegree(await degreeOfUser(userId));
  if (!path.steps.some((step) => step.key === stepKey)) {
    const error = new Error('هذه الخطوة غير موجودة في مسارك.');
    error.code = 'BAD_STEP';
    throw error;
  }

  const note = String(outputNote || '').slice(0, 4000);

  const { rows } = await pool.query(
    `INSERT INTO user_step_progress (user_id, step_key, status, output_note, completed_at, updated_at)
     VALUES ($1, $2, $3::varchar, NULLIF($4, ''), CASE WHEN $3::varchar = 'done' THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (user_id, step_key) DO UPDATE SET
       status = EXCLUDED.status,
       output_note = NULLIF($4, ''),
       completed_at = CASE
         WHEN EXCLUDED.status = 'done' THEN COALESCE(user_step_progress.completed_at, NOW())
         ELSE NULL
       END,
       updated_at = NOW()
     RETURNING *`,
    [userId, stepKey, status, note]
  );

  return rows[0];
}
