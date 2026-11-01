import { pool } from '../db/client.js';
import { CHAT_REPLY_CAPS, DEGREE_LEVELS, GOAL_OPTIONS, PREFERRED_LANGUAGES, PROGRESS_LEVELS, RESEARCH_STAGES } from '../constants.js';
import { getJourney } from './journey.js';
import { getStrikes } from './supervisor-memory.js';
import { readOwnedFile } from './files.js';
import { extractFileText } from './documents.js';
import { estimatePages, defenseStateView } from './defense.js';

/** Builds trusted context injected into the supervisor system prompt. */

/** Total attachment context budget. */
const MAX_ATTACHED_FILES = 3;
const MAX_FILE_CHARS = 12000;
const MAX_FILES_BLOCK_CHARS = 40000;

/** Defense uses a smaller file-text budget because its system prompt is larger. */
const MAX_FILE_CHARS_DEFENSE = 8000;

/** Estimates days since the latest guidance activity; defense sessions are excluded. */
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

/** Checks whether this is the user's first guidance message. */
async function isFirstMessageEver(userId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1 AND c.mode <> 'defense' AND m.role = 'user'`,
    [userId]
  );

  return Number(rows[0]?.total || 0) === 0;
}

/** Formats the user's step statuses for prompt context. */
function stepsStatusLine(journey) {
  if (!journey?.steps?.length) return 'لم يُسجَّل مسار بعد';

  return journey.steps.map((step) => `${step.title}: ${step.statusLabel}`).join(' · ');
}

/** Replaces empty profile values with an explicit unknown label. */
function orDash(value) {
  const text = String(value || '').trim();
  return text || 'غير محدد';
}

/** Parses the goal and progress summary stored in profiles.about. */
function extractAboutPart(about, key) {
  const text = String(about || '');
  const marker = `${key}:`;
  const index = text.indexOf(marker);
  if (index === -1) return '';
  return text.slice(index + marker.length).split('|')[0].trim();
}

/** Extracts attached file text and marks it as untrusted data. */
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

    // Report unreadable files instead of silently omitting them.
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

  // Keep file tags intact; omit excess files instead of truncating their markup.
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

/** Builds context for one supervisor conversation. */
export async function buildSupervisorContext({ userId, profile = {}, conversation = null, fileIds = [] } = {}) {
  // Defense uses the thesis stored in defense_state on every turn.
  const isDefenseConversation = conversation?.mode === 'defense';
  let defenseThesisId = null;
  if (isDefenseConversation) {
    const raw = conversation?.defense_state;
    const state = raw && typeof raw === 'object' ? raw : {};
    if (state.thesisFileId) defenseThesisId = String(state.thesisFileId);
  }
  const effectiveFileIds = defenseThesisId ? [defenseThesisId] : fileIds;

  // Keep defense context isolated from supervisor memory and workflow state.
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

  // Goal and progress details are parsed from profiles.about.
  const goalFromAbout = extractAboutPart(profile.about, 'الهدف الحالي');
  const progressFromAbout = extractAboutPart(profile.about, 'حالة المشروع');
  const goalMatched = GOAL_OPTIONS.find((item) => item.label === goalFromAbout);
  const goalFromColumn = GOAL_OPTIONS.find((item) => item.value === profile.research_stage);
  const researchGoal = orDash(goalFromAbout || goalFromColumn?.label || '');
  // Resolve the goal key from profile text, falling back to the legacy column.
  const researchGoalKey = goalMatched ? goalMatched.value : goalFromAbout ? '' : goalFromColumn?.value || '';
  const progressLevel = orDash(
    progressFromAbout ||
      PROGRESS_LEVELS.find((item) => item.value === profile.research_stage)?.label ||
      RESEARCH_STAGES.find((item) => item.value === profile.research_stage)?.label ||
      ''
  );

  // Inject defense progress and quotas into the isolated examiner prompt.
  const defenseState = isDefense
    ? defenseStateView(conversation?.defense_state || {})
    : null;

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
    // Current step key gates stage-specific tools; defense has no workflow step.
    currentStepKey: isDefenseConversation ? '' : journey?.current?.key || '',
    topicRecorded: isDefenseConversation
      ? ''
      : String(journey?.steps?.find((step) => step.key === 'topic')?.outputNote || '').trim(),
    stepsStatus: isDefenseConversation ? '' : stepsStatusLine(journey),
    journeyCompleted: isDefenseConversation ? false : Boolean(journey?.completed),
    // Supervisor memory and strike state never enter the defense prompt.
    memorySummary: isDefenseConversation ? '' : String(memoryRow.memory || ''),
    openTask: isDefenseConversation ? '' : String(memoryRow.open_task || ''),
    daysSinceLast: idleDays,
    isFirstMessageEver: firstEver,
    strikes: isDefenseConversation ? 0 : strikes,
    mode: isDefense ? 'defense' : 'normal',
    files: files.block,
    fileNames: files.names,
    filesUnreadable: files.unreadable || [],
    replyCap: isDefense ? CHAT_REPLY_CAPS.defense : CHAT_REPLY_CAPS.normal,
    defenseParts: defenseState?.parts ?? [],
    defenseTotal: defenseState?.total ?? 0,
    defenseAsked: defenseState?.asked ?? 0,
    defenseCovered: defenseState?.covered ?? [],
    defenseCurrentPart: defenseState?.current ?? null,
    defenseAskedQuestions: defenseState?.askedQuestions ?? [],
    defensePages: defenseState?.pages ?? 0
  };
}
