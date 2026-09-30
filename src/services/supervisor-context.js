import { pool } from '../db/client.js';
import { CHAT_REPLY_CAPS, DEGREE_LEVELS, PREFERRED_LANGUAGES, RESEARCH_STAGES } from '../constants.js';
import { getJourney } from './journey.js';
import { getStrikes } from './supervisor-memory.js';
import { readOwnedFile, textPreview } from './files.js';
import { readSpreadsheet } from './spreadsheet.js';

/**
 * سياق المشرف الذكي — كل متغيّرات {{…}} في موجّه النظام.
 *
 * الفكرة: البرومبت يقول «هذه القواعد»، والبيانات هنا. لا شيء من هذا يمرّ
 * عبر النموذج ولا يُحسب تقديرياً إلا ما لا يقبل الحسم:
 *   - is_first_message_ever: عدّ رسائل الباحث في كل محادثاته (لا الجلسة الحالية).
 *   - steps_status: حالات خطواته الحقيقية من user_step_progress.
 *   - open_task / memory_summary / strikes: من جدول supervisor_memory.
 *   - days_since_last: آخر نشاط حقيقي (محادثة/ملف/خطوة).
 *   - files: محتوى الملفات التي يرفقها للرسالة (بيانات فقط، بميزانية سياق).
 *
 * كل استعلام له try-catch: فشل أي مصدر يُعطي قيمة فارغة ولا يُفشل الرسالة.
 */

/** ميزانية السياق للملفات المرفقة: ٣ ملفات / ٤٠ كيلوبايت إجمالاً. */
const MAX_ATTACHED_FILES = 3;
const MAX_FILE_CHARS = 12000;
const MAX_FILES_BLOCK_CHARS = 40000;

/** تقدير «أيام منذ آخر نشاط» من أعلى طابع زمني بين الأنشطة. */
async function daysSinceLastActivity(userId) {
  const { rows } = await pool.query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(updated_at) FROM conversations WHERE user_id = $1), '-infinity'::timestamptz),
       COALESCE((SELECT MAX(created_at) FROM files WHERE user_id = $1), '-infinity'::timestamptz),
       COALESCE((SELECT MAX(completed_at) FROM user_step_progress WHERE user_id = $1), '-infinity'::timestamptz)
     ) AS last_activity`,
    [userId]
  );

  const last = rows[0]?.last_activity;
  if (!last || Number.isNaN(new Date(last).getTime())) return null;

  return Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 864e5));
}

/** أول رسالة في تاريخ الباحث مع المنصة (عبر كل محادثاته). */
async function isFirstMessageEver(userId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1 AND m.role = 'user'`,
    [userId]
  );

  return Number(rows[0]?.total || 0) === 0;
}

/** قائمة خطواته «العنوان: الحالة» مختصرة كما تُحقن في البرومبت. */
function stepsStatusLine(journey) {
  if (!journey?.steps?.length) return 'لم يُسجَّل مسار بعد';

  return journey.steps.map((step) => `${step.title}: ${step.statusLabel}`).join(' · ');
}

/** «غير محدد» بدل الحقل الفارغ حتى لا يظن النموذج أن المعلومة ناقصة. */
function orDash(value) {
  const text = String(value || '').trim();
  return text || 'غير محدد';
}

/**
 * يبني كتلة الملفات المرفقة بالرسالة: نصوص و csv/xlsx بشكل نصّي.
 * تُلفّ بوسوم <file name="…"> مع تعليمات صريحة بأنها بيانات فقط.
 */
async function buildFilesBlock(userId, fileIds = []) {
  const ids = [
    ...new Set(
      (Array.isArray(fileIds) ? fileIds : String(fileIds || '').split(','))
        .map((id) => String(id || '').trim())
        .filter((id) => /^[\w-]{8,64}$/.test(id))
    )
  ].slice(0, MAX_ATTACHED_FILES);

  if (!ids.length) return { block: '', names: [] };

  const parts = [];
  const names = [];

  for (const id of ids) {
    const found = await readOwnedFile(userId, id);
    if (!found || !found.buffer) continue;

    const name = found.row.file_name;
    let body = '';

    if (/\.(txt|md|csv)$/i.test(name)) {
      body = textPreview(found.buffer) || '';
    } else if (/\.(xlsx|xls)$/i.test(name)) {
      const parsed = await readSpreadsheet(found.buffer, name);
      body = parsed.sheets
        .map(
          (sheet) =>
            `ورقة «${sheet.name}»:\n${(sheet.rows || []).slice(0, 40).map((row) => row.join('\t')).join('\n')}`
        )
        .join('\n\n');


    }

    names.push(name);
    parts.push(
      body.trim()
        ? `<file name="${name}">\n${body.slice(0, MAX_FILE_CHARS)}\n</file>`
        : `<file name="${name}">تعذّر استخراج نصّ قابل للقراءة من هذا الملف.</file>`
    );
  }

  if (!parts.length) return { block: '', names: [] };

  return {
    block: `<files>\n${parts.join('\n').slice(0, MAX_FILES_BLOCK_CHARS)}\n</files>`,
    names
  };
}

/**
 * يبني كل سياق المشرف لمحادثة واحدة.
 * conversation: الصف الحالي (أو null لمحادثة جديدة) — يحدّد الوضع وسقف الرد.
 */
export async function buildSupervisorContext({ userId, profile = {}, conversation = null, fileIds = [] } = {}) {
  const [journey, strikes, memoryRow, files] = await Promise.all([
    getJourney(userId, profile.degree_level).catch(() => null),
    getStrikes(userId).catch(() => 0),
    pool
      .query('SELECT memory, open_task FROM supervisor_memory WHERE user_id = $1', [userId])
      .then(({ rows }) => rows[0] || {})
      .catch(() => ({})),
    buildFilesBlock(userId, fileIds)
  ]);

  const [firstEver, idleDays] = await Promise.all([
    isFirstMessageEver(userId).catch(() => false),
    daysSinceLastActivity(userId).catch(() => null)
  ]);

  const degree = DEGREE_LEVELS.find((item) => item.value === profile.degree_level)?.label || '';
  const stage = RESEARCH_STAGES.find((item) => item.value === profile.research_stage)?.label || '';
  const language = PREFERRED_LANGUAGES.find((item) => item.value === profile.preferred_language)?.label || 'العربية';
  const citationStyle = profile.citation_style === 'mla9' ? 'MLA 9' : 'APA 7';
  const isDefense = conversation?.mode === 'defense';

  return {
    userName: orDash(profile.full_name),
    degree: orDash(degree),
    field: orDash(profile.research_field),
    title: orDash(profile.research_title),
    university: orDash([profile.university, profile.faculty].filter(Boolean).join(' — ')),
    language,
    citationStyle,
    currentStage: orDash(journey?.current?.title || stage),
    stepsStatus: stepsStatusLine(journey),
    journeyCompleted: Boolean(journey?.completed),
    memorySummary: String(memoryRow.memory || ''),
    openTask: String(memoryRow.open_task || ''),
    daysSinceLast: idleDays,
    isFirstMessageEver: firstEver,
    strikes,
    mode: isDefense ? 'defense' : 'normal',
    files: files.block,
    fileNames: files.names,
    replyCap: isDefense ? CHAT_REPLY_CAPS.defense : CHAT_REPLY_CAPS.normal
  };
}
