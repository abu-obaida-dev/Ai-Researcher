import { pool } from '../db/client.js';
import { CHAT_REPLY_CAPS, DEGREE_LEVELS, GOAL_OPTIONS, PREFERRED_LANGUAGES, PROGRESS_LEVELS, RESEARCH_STAGES } from '../constants.js';
import { getJourney } from './journey.js';
import { getStrikes } from './supervisor-memory.js';
import { readOwnedFile } from './files.js';
import { extractFileText } from './documents.js';

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

/**
 * سقف نصّ الملف في وضع المناقشة (defense): أصغر من الوضع الإرشادي.
 *
 * السبب: في defense يُحقن نصّ الملف في موجّه المناقِش (15.4 ألف حرف) ومعه
 * 12 ألف حرف من الملف ⇒ ~8.1 ألف token ⇒ Groq يرفض بـ 413/400-length.
 * للمناقشة (المناقش يقرأ ما فيه) وتُبقي الحمولة دون حدّ النموذج.
 */
const MAX_FILE_CHARS_DEFENSE = 6000;

/** تقدير «أيام منذ آخر نشاط» من أعلى طابع زمني بين الأنشطة — محادثات
 * المناقشة (defense) مستثناة: للمشرف ذاكرته من إرشاده وحده (لكل شخصية ذاكرتها). */
async function daysSinceLastActivity(userId) {
  const { rows } = await pool.query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(updated_at) FROM conversations WHERE user_id = $1 AND mode <> 'defense'), '-infinity'::timestamptz),
       COALESCE((SELECT MAX(created_at) FROM files WHERE user_id = $1), '-infinity'::timestamptz),
       COALESCE((SELECT MAX(completed_at) FROM user_step_progress WHERE user_id = $1), '-infinity'::timestamptz)
     ) AS last_activity`,
    [userId]
  );

  const last = rows[0]?.last_activity;
  if (!last || Number.isNaN(new Date(last).getTime())) return null;

  return Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 864e5));
}

/** أول رسالة إرشادية في تاريخ الباحث مع المشرف (محادثات المناقشة/المعلم
 * مستثناة — لكل شخصية ذاكرتها وبدايتها). */
async function isFirstMessageEver(userId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1 AND c.mode <> 'defense' AND m.role = 'user'`,
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
 * جزء من نص الملف المحفوظ عند إكمال الـ onboarding:
 * profiles.about = «الهدف الحالي: … | حالة المشروع: …» (يكتبه routes/auth.js).
 */
function extractAboutPart(about, key) {
  const text = String(about || '');
  const marker = `${key}:`;
  const index = text.indexOf(marker);
  if (index === -1) return '';
  return text.slice(index + marker.length).split('|')[0].trim();
}

/**
 * يبني كتلة الملفات المرفقة بالرسالة: PDF و Word و txt/md/csv و Excel.
 * تُلفّ بوسوم <file name="…"> مع تعليمات صريحة بأنها بيانات فقط.
 * يعتمد على services/documents.js — الذي يقرأ PDF و DOCX؛ فكان سابقاً يفشل
 * معهما فيخرج «تعذّر استخراج نصّ» فلا يعرف المشرف شيئاً عمّا أرفقه الباحث.
 */
async function buildFilesBlock(userId, fileIds = [], options = {}) {
  const maxFileChars = Number(options.maxFileChars) > 0 ? Number(options.maxFileChars) : MAX_FILE_CHARS;
  const ids = [
    ...new Set(
      (Array.isArray(fileIds) ? fileIds : String(fileIds || '').split(','))
        .map((id) => String(id || '').trim())
        .filter((id) => /^[\w-]{8,64}$/.test(id))
    )
  ].slice(0, MAX_ATTACHED_FILES);

  if (!ids.length) return { block: '', names: [], unreadable: [] };

  const parts = [];
  const names = [];
  const unreadable = [];

  for (const id of ids) {
    const found = await readOwnedFile(userId, id);
    if (!found || !found.buffer) continue;

    const name = found.row.file_name;
    const { text, kind } = await extractFileText(found.buffer, name);

    // PDF ممسوح ضوئياً أو صيغة غير مدعومة ⇒ نسمّي ذلك صراحةً بدل صمت.
    if (!text.trim()) {
      const reason =
        kind === 'pdf'
          ? 'PDF بلا نصّ قابل للقراءة (غالباً صور ممسوحة ضوئياً) — اطلب نسخة Word أو txt.'
          : 'صيغة غير مدعومة للقراءة النصية — اطلب نسخة txt أو docx.';
      unreadable.push({ name, reason });
      names.push(name);
      parts.push(`<file name="${name}">\n[تعذّرت قراءة محتوى هذا الملف: ${reason}]\n</file>`);
      continue;
    }

    names.push(name);
    parts.push(`<file name="${name}">\n${text.slice(0, maxFileChars)}\n</file>`);
  }

  if (!parts.length) return { block: '', names: [], unreadable };

  // لا نقطع الكتلة في منتصف وسم <file> (كان يُنتج <file> بلا </file> فيُفقد
  // محتوى الملف ويُربك محلّل التقصير). نُسقط الملفات الزائدة بدل بتر النص.
  const kept = [];
  let used = 0;
  for (const part of parts) {
    const cost = part.length + 1;
    if (used + cost > MAX_FILES_BLOCK_CHARS && kept.length) break;
    kept.push(part);
    used += cost;
  }

  return {
    block: `<files>\n${kept.join('\n')}\n</files>`,
    names,
    unreadable
  };
}

/**
 * يبني كل سياق المشرف لمحادثة واحدة.
 * conversation: الصف الحالي (أو null لمحادثة جديدة) — يحدّد الوضع وسقف الرد.
 */
export async function buildSupervisorContext({ userId, profile = {}, conversation = null, fileIds = [] } = {}) {
  // جلسة المناقشة المستقلة: ملف البحث ثابت في defense_state ويُحقن تلقائياً
  // في كل رسالة — لا يحتاج الباحث لإعادة إرفاقه في كل مرة.
  const isDefenseConversation = conversation?.mode === 'defense';
  let defenseThesisId = null;
  if (isDefenseConversation) {
    const raw = conversation?.defense_state;
    const state = raw && typeof raw === 'object' ? raw : {};
    if (state.thesisFileId) defenseThesisId = String(state.thesisFileId);
  }
  const effectiveFileIds = defenseThesisId ? [defenseThesisId] : fileIds;

  // استقلال المناقِش عن المشرف: في defense لا تُقرأ ذاكرة المشرف ولا تنبيهاته
  // ولا رحلة البحث أصلاً — سياق المناقِش = ملف الباحث + رسائل هذه الجلسة وحدها.
  const [journey, strikes, memoryRow, files] = await Promise.all([
    isDefenseConversation ? Promise.resolve(null) : getJourney(userId, profile.degree_level).catch(() => null),
    isDefenseConversation ? Promise.resolve(0) : getStrikes(userId).catch(() => 0),
    isDefenseConversation
      ? Promise.resolve({})
      : pool
          .query('SELECT memory, open_task FROM supervisor_memory WHERE user_id = $1', [userId])
          .then(({ rows }) => rows[0] || {})
          .catch(() => ({})),
    buildFilesBlock(userId, effectiveFileIds, {
      maxFileChars: isDefenseConversation ? MAX_FILE_CHARS_DEFENSE : MAX_FILE_CHARS
    })
  ]);

  const [firstEver, idleDays] = await Promise.all([
    isDefenseConversation ? Promise.resolve(false) : isFirstMessageEver(userId).catch(() => false),
    isDefenseConversation ? Promise.resolve(null) : daysSinceLastActivity(userId).catch(() => null)
  ]);

  const degree = DEGREE_LEVELS.find((item) => item.value === profile.degree_level)?.label || '';
  const stage = RESEARCH_STAGES.find((item) => item.value === profile.research_stage)?.label || '';
  const language = PREFERRED_LANGUAGES.find((item) => item.value === profile.preferred_language)?.label || 'العربية';
  const citationStyle =
    { apa7: 'APA 7', mla9: 'MLA 9', chicago17: 'Chicago 17', ieee: 'IEEE', harvard: 'Harvard' }[
      String(profile.citation_style || '').trim().toLowerCase()
    ] || 'APA 7';
  const isDefense = conversation?.mode === 'defense';

  // هدف الـ onboarding («ماذا تريد إنجازه الآن») وحالة تقدّمه: يُحفظان نصاً في
  // profiles.about عند إكمال الملف، بينما العمود research_stage يحمل الحالة.
  const goalFromAbout = extractAboutPart(profile.about, 'الهدف الحالي');
  const progressFromAbout = extractAboutPart(profile.about, 'حالة المشروع');
  const goalMatched = GOAL_OPTIONS.find((item) => item.label === goalFromAbout);
  const goalFromColumn = GOAL_OPTIONS.find((item) => item.value === profile.research_stage);
  const researchGoal = orDash(goalFromAbout || goalFromColumn?.label || '');
  // مفتاح الهدف (topic/proposal/…) يستعمله البرومبت لاختيار أول خطوة مقترحة:
  // من نص الملف إن طابق تسمية النموذج، ومن العمود القديم إن كان الملف بلا نص.
  const researchGoalKey = goalMatched ? goalMatched.value : goalFromAbout ? '' : goalFromColumn?.value || '';
  const progressLevel = orDash(
    progressFromAbout ||
      PROGRESS_LEVELS.find((item) => item.value === profile.research_stage)?.label ||
      RESEARCH_STAGES.find((item) => item.value === profile.research_stage)?.label ||
      ''
  );

  return {
    userName: orDash(profile.full_name),
    degree: orDash(degree),
    field: orDash(profile.research_field),
    title: orDash(profile.research_title),
    researchGoal,
    researchGoalKey,
    progressLevel,
    university: orDash([profile.university, profile.faculty].filter(Boolean).join(' — ')),
    language,
    citationStyle,
    currentStage: isDefenseConversation ? 'مناقشة أكاديمية مستقلة' : orDash(journey?.current?.title || stage),
    // مفتاح خطوة المرحلة الحالية — تستخدمه الأدوات للبوابة (مثلاً أداة المراجع
    // لا تعمل إلا في مرحلة الدراسات السابقة). في المناقشة: لا خطوة ولا بوابة.
    currentStepKey: isDefenseConversation ? '' : journey?.current?.key || '',
    topicRecorded: isDefenseConversation
      ? ''
      : String(journey?.steps?.find((step) => step.key === 'topic')?.outputNote || '').trim(),
    stepsStatus: isDefenseConversation ? '' : stepsStatusLine(journey),
    journeyCompleted: isDefenseConversation ? false : Boolean(journey?.completed),
    // ذاكرة المشرفة والمهام والتنبيهات: لا شيء منها يصل المناقِش المستقل
    memorySummary: isDefenseConversation ? '' : String(memoryRow.memory || ''),
    openTask: isDefenseConversation ? '' : String(memoryRow.open_task || ''),
    daysSinceLast: idleDays,
    isFirstMessageEver: firstEver,
    strikes: isDefenseConversation ? 0 : strikes,
    mode: isDefense ? 'defense' : 'normal',
    files: files.block,
    fileNames: files.names,
    filesUnreadable: files.unreadable || [],
    replyCap: isDefense ? CHAT_REPLY_CAPS.defense : CHAT_REPLY_CAPS.normal
  };
}
