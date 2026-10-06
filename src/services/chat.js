import { pool } from '../db/client.js';
import { CHAT_REPLY_CAPS, TOKEN_COSTS, isUuid } from '../constants.js';
import { runSupervisor } from './ai.js';
import { extractStatedTopic, literatureToolFor, wantsLiterature } from './literature.js';
import { isValidStepKeyForUser, recordTopic, registeredTopic } from './journey.js';
import { buildSupervisorContext } from './supervisor-context.js';
import { buildSystemPrompt } from './supervisor-prompt.js';
import { addStrike, summarizeConversation } from './supervisor-memory.js';
import { balanceOf, chargeUsage, deductCredits, estimateReservation, logUsage, normalizeUsage, refundCredits } from './tokens.js';
import { detectStepCompletion } from './step-review.js';

/**
 * شات المشرف الذكي (1F): المحادثات ورسائلها في conversations/messages.
 *
 * التسعير صار متغيّراً بحسب الاستهلاك الفعلي (services/tokens.js):
 *   حجز قبل الإرسال ← نداء ← تسوية وردّ الفرق، وردّ كامل عند الفشل.
 *
 * ما يحسبه الكود لا البرومبت (services/supervisor-context.js):
 * أول رسالة في تاريخه، حالة خطواته، ملخّص ذاكرته، مهمته القادمة، عدد أيام
 * انقطاعه، عدّاد التنبيهات، وملفاته المرفقة.
 */

const CHAT_COST = TOKEN_COSTS.find((item) => item.type === 'chat')?.tokens || 30;
const HISTORY_LIMIT = 20;
const PROMPT_LIMIT = 8000;
const TITLE_LIMIT = 120;

/** وسم التنبيه الداخلي: المشرفة تكتبه، والكود يحذفه قبل العرض والعدّ. */
const STRIKE_TAG = /\[\[\s*strike\s*\]\]|\[\s*strike\s*\]/gi;

/**
 * ينظّف ردّ المشرفة: يحذف وسم التنبيه ويخبرك هل وُجد.
 * الوسم يوضع في آخر الرد فقط، ونتأكد أنه لم يُصِب ردودنا المخزّنة سابقاً.
 */
function stripStrikeTag(text) {
  const raw = String(text || '');
  const hadStrike = STRIKE_TAG.test(raw);
  STRIKE_TAG.lastIndex = 0;

  return { text: raw.replace(STRIKE_TAG, '').replace(/\s+$/, ''), hadStrike };
}

/** لا يُسمح للباحث بأن يحقن وسماً داخلياً فيردّ المشرفة تكرّره وتُحتسب له ضربة. */
function sanitizeUserText(text) {
  return String(text || '').replace(STRIKE_TAG, '').replace(/\s+$/, '');
}

/** تاريخ محادثات الباحث (الأحدث أولاً) مع عدد الرسائل. */
export async function listConversations(userId, { limit = 12 } = {}) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.step_key, c.mode, c.provider, c.created_at, c.updated_at,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS messages_count
       FROM conversations c
      WHERE c.user_id = $1
      ORDER BY c.updated_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 12, 1), 50)]
  );

  return rows;
}

/** محادثة واحدة بملكيتها + رسائلها بالترتيب الزمني + حالة المناقشة. */
export async function getConversation(userId, conversationId) {
  if (!isUuid(conversationId)) return null;
  const { rows } = await pool.query('SELECT * FROM conversations WHERE id = $2 AND user_id = $1', [
    userId,
    conversationId
  ]);
  if (!rows.length) return null;

  const { rows: messages } = await pool.query(
    'SELECT id, role, content, tokens_used, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId]
  );

  return { ...rows[0], messages, defense_state: rows[0].defense_state || {} };
}

/** إنشاء محادثة جديدة باسم مختصر من أول سؤال — والوضع إرشادي افتراضياً. */
export async function createConversation(userId, { title = '', stepKey = null, mode = 'normal' } = {}) {
  const nextMode = mode === 'defense' ? 'defense' : 'normal';
  const { rows } = await pool.query(
    'INSERT INTO conversations (user_id, title, step_key, mode) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, String(title || 'محادثة جديدة').trim().slice(0, TITLE_LIMIT), stepKey || null, nextMode]
  );

  return rows[0];
}

/** إضافة رسالة إلى محادثة (تحدّث updated_at لظهورها في الأعلى). */
export async function appendMessage(conversationId, { role, content, tokensUsed = 0, model = null }) {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, role, content, tokens_used, model)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [conversationId, role, String(content || ''), Number(tokensUsed) || 0, model]
  );

  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

  return rows[0];
}

/** حذف محادثة كاملة برسائلها. */
export async function deleteConversation(userId, conversationId) {
  if (!isUuid(conversationId)) return false;
  const { rowCount } = await pool.query('DELETE FROM conversations WHERE id = $2 AND user_id = $1', [
    userId,
    conversationId
  ]);

  return rowCount > 0;
}

/** عنوان مختصر للمحادثة من أول سؤال (أول ٦٠ حرفاً). */
function titleFromPrompt(prompt) {
  const line = String(prompt).split('\n').find((item) => item.trim()) || 'محادثة جديدة';
  return line.trim().slice(0, 60);
}

/** آخر محادثة سابقة لها رسائل، لاستخدامها في تلخيص الذاكرة عند بدء جلسة جديدة. */
async function lastRichConversation(userId, excludeId = null) {
  const { rows } = await pool.query(
    `SELECT c.id FROM conversations c
      WHERE c.user_id = $1 AND c.id IS DISTINCT FROM $2
        AND (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) >= 4
      ORDER BY c.updated_at DESC LIMIT 1`,
    [userId, excludeId || null]
  );

  return rows[0]?.id || null;
}

/** حالة المناقشة: عدّاد الأسئلة والمحاور (تُحفظ في conversations.defense_state). */
function readDefenseState(conversation) {
  const state = conversation?.defense_state;
  if (!state || typeof state !== 'object') return { asked: 0, startedAt: null };

  return {
    asked: Number(state.asked) || 0,
    startedAt: state.startedAt || null
  };
}

async function writeDefenseState(conversationId, state) {
  await pool.query('UPDATE conversations SET defense_state = $2 WHERE id = $1', [
    conversationId,
    JSON.stringify(state)
  ]);
}

/**
 * إرسال سؤال للمشرف الذكي.
 *
 * الترتيب مقصود وكل خطوة المالية ذرّية:
 *   1) تحقق من المدخلات والمحفظة (لا خصم بعد).
 *   2) بناء السياق من قاعدة البيانات ثم موجّه النظام.
 *   3) حجز الرصيد بسقف تقديري — إن لم يكن كافياً نرفض قبل الإرسال.
 *   4) النداء؛ عند الفشل: ردّ الحجز كاملاً بلا تسجيل استهلاك.
 *   5) التسوية: الفارق بين الحجز والاستهلاك الفعلي يُردّ فوراً.
 *   6) حذف وسم التنبيه قبل الحفظ، وزيادة العدّاد إن وُجد.
 *   7) عند بدء جلسة جديدة: تلخيص الجلسة السابقة لتحديث الذاكرة.
 *
 * الأكواد: NO_TOKENS / NO_PROVIDER / PROVIDERS_FAILED / EMPTY_PROMPT / NOT_FOUND / BAD_STEP.
 */
export async function askSupervisor({
  userId,
  prompt,
  conversationId = null,
  stepKey = null,
  profile = {},
  fileIds = [],
  mode = null
}) {
  const question = sanitizeUserText(String(prompt || '').trim().slice(0, PROMPT_LIMIT));
  if (!question) {
    const error = new Error('اكتب سؤالك أولاً.');
    error.code = 'EMPTY_PROMPT';
    throw error;
  }

  if (stepKey && !(await isValidStepKeyForUser(userId, stepKey))) {
    const error = new Error('هذه الخطوة غير موجودة في مسار بحثك.');
    error.code = 'BAD_STEP';
    throw error;
  }

  let conversation = conversationId ? await getConversation(userId, conversationId) : null;
  if (conversationId && !conversation) {
    const error = new Error('المحادثة غير موجودة.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  // محادثة جديدة: ننشئها أولاً لنعرف وضعها، ونتذكّر السابقة لتلخيص ذاكرتها
  const previousId = conversation ? null : await lastRichConversation(userId);
  if (!conversation) {
    const created = await createConversation(userId, { title: titleFromPrompt(question), stepKey, mode });
    conversation = { ...created, messages: [], mode: created.mode || mode || 'normal', defense_state: {} };
  }

  const context = await buildSupervisorContext({ userId, profile, conversation, fileIds });

  const history = conversation.messages
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content
    }));

  const messages = [...history, { role: 'user', content: question }];

  // الملفات المرفقة: نذكرها في الرسالة نفسها (لا في الموجّه فقط) حتى لا يفترض
  // النموذج أن السؤال بلا سياق ويصنّفه خارج النطاق.
  const attachedNames = Array.isArray(context.fileNames) ? context.fileNames : [];
  if (attachedNames.length && context.files) {
    messages[messages.length - 1] = {
      role: 'user',
      content: `${question}\n\n[مرفق مع هذه الرسالة: ${attachedNames.join('، ')} — مقتطفاتها كاملة في قسم «الملفات المرفقة»]`
    };
  }

  const baseCap = context.replyCap || CHAT_REPLY_CAPS.normal;

  /*
   * أداة المراجع: إن طلب الباحث مصادر/مراجع، نبحث له في قواعد البيانات
   * العلمية الحقيقية (Crossref · OpenAlex · IEEE · ACM · arXiv …) ونحقن
   * النتائج في رسالة المشرف، فلا يختلق مرجعاً ولا رابطاً من ذاكرته.
   * الروابط كلها حقيقية (DOI/الناشر/نسخة مفتوحة) وما دون ذلك يقول «ابحثت ولم أجد».
   * التكلفة: بلا خصم نقاط (نداء خارجي رخيص) مع تسجيله في سجل الاستهلاك.
   */
  let references = null;
  // هل ما زال في خطوة تحديد المشكلة؟ (topic أولى خطوات كل مسارات الرحلة).
  const inTopicStep = String(context.currentStepKey || stepKey || '') === 'topic';
  // الموضوع المُسجَّل (خطوة اختيار الموضوع أو عنوان الملف) — مصدر واحد معتمد.
  let registered = { topic: '', origin: 'none' };
  try {
    registered = await registeredTopic(userId, profile);
  } catch (error) {
    console.warn(`تعذّرت قراءة موضوع البحث المسجّل: ${error?.code || error?.message}`);
  }

  try {
    // سياق المحادثات: المهمة المتفق عليها + ملخّص الذاكرة + آخر كلام للباحث،
    // حتى لو كان ملفه ناقصاً نعرف من أي تخصّص يبحث.
    const conversationTopic = [
      context.openTask,
      context.memorySummary,
      ...history
        .filter((message) => message.role === 'user')
        .slice(-2)
        .map((message) => String(message.content || '').slice(0, 160))
    ]
      .filter(Boolean)
      .join(' · ');

    // هل سبق أن سألناه عن العنوان في هذه المحادثة؟ (لنفادي سؤال مكرّر)
    // نتحقّق أننا سبق عن العنوان (المحرّك قد يصوغ السؤال بصيغ مختلفة)
    const askedBefore = conversation.messages.slice(-3).some((message) => {
      if (message.role !== 'assistant') return false;
      const text = String(message.content || '');
      if (/في أي عنوان|أي عنوان بالتحديد/.test(text)) return true;
      return /(عنوان|موضوع)/.test(text) && /(مراجع|مصادر)/.test(text) && /[؟?]/.test(text);
    });

    // بوابة مرحلة topic: لا أداة مراجع قبل اكتمال تعريف المشكلة وحدودها —
    // تسجيل موضوع عام وحده لا يكفي (المراجع تعود بعد اكتمال الخطوة).
    references = inTopicStep
      ? null
      : await literatureToolFor(question, {
          limit: 6,
          userId,
          field: String(profile?.research_field || context.field || '').slice(0, 80),
          title: String(profile?.research_title || context.title || '').slice(0, 160),
          context: conversationTopic,
          askedBefore
        });
  } catch (error) {
    console.warn(`فشل بحث المراجع التلقائي: ${error?.code || error?.message}`);
  }

  // لا نقبل طلباً بلا عنوان محدّد ⇒ نطلب من الباحث عنوان بحثه (سؤال واحد).
  if (references?.needsTopic) {
    const hint =
      references.reason === 'need_title'
        ? 'طلب الباحث مراجع دون أن يذكر عنواناً محدّداً.'
        : references.reason === 'no_match'
          ? `بحثنا عن «${references.topic || ''}» ولم نجد له مراجع مطابقة في قواعد البيانات.`
          : references.reason === 'broad'
            ? `عبارة «${references.topic || ''}» عامة أكثر من اللازم ولا تحدّد بحثاً بعينه.`
            : 'لم نتبيّن عنوان بحثه بعد.';

    messages[messages.length - 1] = {
      role: 'user',
      content:
        '== لا ترسل مراجع في هذه الرسالة ==\n' +
        `${hint}\n` +
        'المطلوب ممنك: اسأله **سؤالاً واحداً فقط** عن العنوان الذي يريد مراجع عنه، مثل: «في أي عنوان بالتحديد تريد المراجع؟».\n' +
        (context.field && context.field !== 'غير محدد'
          ? `اذكري أن تخصصه في ملفه «${context.field}» وتسأليه إن كان العنوان داخل هذا التخصص أو خارجه.\n`
          : '') +
        'لا تعرضي أي مرجع من معرفتكِ الآن، ولا تَعِدْه به. انتظري جوابه ثم ابحثي له في رسالته التالية.\n' +
        'قاعدة عامة: لا تفترض شيئاً من عندك ولا تخمّن ما يريده.'
    };
  } else if (references?.block) {
    messages[messages.length - 1] = {
      role: 'user',
      content: `${references.block}\n\n---\nسؤال الباحث: ${question}`
    };
  }

  /*
   * طلب مراجع أثناء خطوة topic: البوابة أعلاه منعت الأداة، ونوجّه المشرفة
   * لرفض لطيف ثم سؤال إرشادي واحد يستكمل به تحديد المشكلة وحدودها —
   * لا مراجع ولا روابط ولا وعود بها في هذه المرحلة.
   */
  if (inTopicStep && references === null && wantsLiterature(question)) {
    messages[messages.length - 1] = {
      role: 'user',
      content:
        '== لا ترسل مراجع أو روابط في هذه الرسالة ==\n' +
        'الباحث ما زال في خطوة تحديد المشكلة والفرضيات: تعريف مشكلته وحدودها غير مكتمل، وتسجيل موضوع عام وحده لا يكفي لجلب مراجع مرتبطة ببحثه.\n' +
        'المطلوب ممنك: جملة رفض واحدة بلطف، ثم سؤال إرشادي واحد فقط يستكمل به تحديد المشكلة أو نطاق الدراسة، مثل: «قبل البحث عن المراجع نحتاج أولاً إلى تحديد المشكلة ونطاق الدراسة حتى تكون المراجع مرتبطة ببحثك، ما الجانب المحدد الذي تريد دراسته؟».\n' +
        'لا تذكري أي مرجع أو رابط أو كتاب من معرفتكِ، ولا تَعِدْه بمراجع في رسالة لاحقة.\n' +
        'سؤال واحد فقط في الرد كله.'
    };
  }

  /*
   * إكمال خطوة «اختيار الموضوع»: إن كتب الباحث موضوعه صراحةً في رسالة
   * (أو أجاب على سؤال المشرفة عنه) نُسجّله في خطته — بعبارته هو، بلا تأليف.
   * وتبقى الخطوة «جاري» حتى هو يقرّر أنها تمّت.
   */
  let topicRecordedBySystem = '';
  if (inTopicStep) {
    const stated = extractStatedTopic(question);
    if (stated) {
      try {
        topicRecordedBySystem = await recordTopic(userId, stated, {
          degreeLevel: profile?.degree_level || '',
          stepKey: 'topic'
        });
      } catch (error) {
        console.warn(`تعذّر تسجيل موضوع البحث: ${error?.code || error?.message}`);
      }
    }
  }

  // نخبر المشرف بما سجّلناه نيابةً عن الباحث، فتكتب أمامه لا من تلقاء نفسها.
  const system = buildSystemPrompt(
    { ...context, topicRecordedBySystem },
    { references: references?.items?.length || 0, recordedTopic: topicRecordedBySystem }
  );
  const replyCap = references?.block || attachedNames.length ? Math.max(baseCap, 1400) : baseCap;

  // ٣) الحجز المسبق — أعلى تكلفة ممكنة لهذه الرسالة، يُردّ الفرق بعد الرد
  const reservation = estimateReservation({ system, messages, replyCap });
  if (!(await deductCredits(userId, reservation.credits))) {
    const balance = await balanceOf(userId);
    const error = new Error(
      `رصيدك (${balance}) لا يكفي لهذه الرسالة: نحتاج ${reservation.credits} نقطة كحدٍّ أقصى قبل الإرسال. اشترِ باقة أو ابدأ محادثة جديدة أقصر.`
    );
    error.code = 'NO_TOKENS';
    throw error;
  }

  let reply;
  try {
    reply = await runSupervisor({ userId, system, messages, maxTokens: replyCap });
  } catch (error) {
    await refundCredits(userId, reservation.credits);
    await logUsage(userId, { type: 'chat_failed', tokens: 0, summary: error.message });
    throw error;
  }

  // ٥) التسوية على الاستهلاك الحقيقي الذي أرجعه المزوّد
  const usage = normalizeUsage(reply.usage);
  const charge = usage.inputTokens || usage.outputTokens
    ? chargeUsage(usage)
    : { credits: reservation.credits, inputTokens: 0, outputTokens: 0, multiplier: chargeUsage(usage).multiplier };

  const charged = Math.min(charge.credits, reservation.credits);
  if (reservation.credits > charged) await refundCredits(userId, reservation.credits - charged);

  // ٦) وسم التنبيه: يُحذف قبل الحفظ والعرض، ويُحتسب في العدّاد
  const cleaned = stripStrikeTag(reply.text);
  let strikes = context.strikes;
  if (cleaned.hadStrike) strikes = await addStrike(userId);

  await appendMessage(conversation.id, { role: 'user', content: question, tokensUsed: charged });
  await appendMessage(conversation.id, { role: 'assistant', content: cleaned.text, model: reply.model });
  await pool.query('UPDATE conversations SET provider = $2 WHERE id = $1', [conversation.id, reply.provider]);

  // نتائج أداة المراجع: قواعد البيانات الخارجية + ما وجدناه في مكتبة المنصة (وروابطه).
  const foundReferences = [
    ...(references?.items || []).map((item) => ({ kind: 'web', ...item })),
    ...(references?.libraryItems || []).map((item) => ({
      kind: 'library',
      id: item.id,
      title: item.title,
      authorText: item.authorsText || item.authors || '',
      authors: item.authors || [],
      year: item.year,
      venue: item.venue || item.source,
      source: item.source,
      doi: item.doi || '',
      pdfUrl: item.pdfUrl || '',
      hasFile: Boolean(item.hasFile),
      externalUrl: item.externalUrl || '',
      // بيانات مقروءة من رابط المصدر نفسه (وسوم citation_*)
      fromLink: Boolean(item.enriched),
      linkTitle: item.linkTitle || ''
    }))
  ].slice(0, 12);

  // نحفظها لتظهر للباحث كقائمة بيانات وروابط قابلة للفتح
  if (foundReferences.length) {
    const payload = foundReferences;

    await pool.query('UPDATE conversations SET references_found = $2 WHERE id = $1', [
      conversation.id,
      JSON.stringify(payload)
    ]);
  }

  await logUsage(userId, {
    type: 'chat',
    tokens: charged,
    inputTokens: charge.inputTokens,
    outputTokens: charge.outputTokens,
    provider: reply.provider,
    model: reply.model,
    multiplier: charge.multiplier,
    summary: titleFromPrompt(question)
  });

  // سجل أدوات المراجع: يوثّق ما بحثناه فعلاً بلا خصم (شفافية للباحث ولوحة الإدارة).
  if (references?.items?.length || references?.libraryItems?.length) {
    const webSources = [...new Set((references.items || []).flatMap((item) => item.sources || []))];
    await logUsage(userId, {
      type: 'sources',
      tokens: 0,
      summary: `بحث مراجع: ${(references.items || []).length} نتيجة خارجية${webSources.length ? ` (${webSources.join('، ')})` : ''}${
        references.libraryItems?.length ? ` + ${references.libraryItems.length} من مكتبة المنصة` : ''
      }`
    });
  }

  // ٧) بدء جلسة جديدة ⇒ تلخيص الجلسة السابقة (على حساب المنصة، لا الباحث)
  if (previousId) {
    const previous = await getConversation(userId, previousId);
    if (previous) {
      const memory = await summarizeConversation(userId, { messages: previous.messages, profile });
      if (memory) {
        await logUsage(userId, { type: 'chat_summary', tokens: 0, summary: 'تلخيص جلسة سابقة لتحديث ذاكرة المشرف' });
      }
    }
  }

  // عدّاد أسئلة المناقشة (الإجمالي 11 سؤالاً حتى التقييم النهائي)
  if (conversation.mode === 'defense') {
    const state = readDefenseState(conversation);
    await writeDefenseState(conversation.id, { ...state, asked: state.asked + 1, startedAt: state.startedAt || new Date().toISOString() });
  }

  // مراجعة اكتمال الخطوة: كشف حتمي يضع بطاقة معلّقة فقط — لا يمسّ المسار
  // ولا يمسّ هذا الرد؛ الإتمام قرار الباحث بزر «حفظ» (routes/chat.js).
  try {
    await detectStepCompletion({
      userId,
      conversation: { ...conversation, step_key: conversation.step_key || stepKey || '' }
    });
  } catch (error) {
    console.warn(`تعذّر كشف اكتمال الخطوة: ${error?.code || error?.message}`);
  }

  return {
    conversationId: conversation.id,
    title: conversation.title,
    answer: cleaned.text,
    provider: reply.provider,
    model: reply.model,
    tokensCharged: charged,
    reserved: reservation.credits,
    strikes,
    // المراجع التي عثرت عليها الأداة (خارجية + مكتبة المنصة): تُعرض تحت الرد برابط كل مرجع
    references: foundReferences,
    mode: conversation.mode
  };
}

/** تبديل وضع المحادثة بين الإرشاد العادي ووضع المناقشة. */
export async function setConversationMode(userId, conversationId, mode) {
  if (!isUuid(conversationId)) return false;
  const next = mode === 'defense' ? 'defense' : 'normal';
  const { rowCount } = await pool.query(
    "UPDATE conversations SET mode = $3, defense_state = '{}'::jsonb WHERE id = $2 AND user_id = $1",
    [userId, conversationId, next]
  );

  return rowCount > 0;
}

/** تكلفة رسالة الشات التقديرية المعروضة في الواجهة قبل الإرسال. */
export function chatCost() {
  return CHAT_COST;
}
