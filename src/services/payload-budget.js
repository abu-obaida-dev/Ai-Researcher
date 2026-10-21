/**
 * ميزانية الحمولة (payload budget) — حارس حجم الطلب قبل إرساله للنموذج.
 *
 * المشكلة التي حلّها: في وضع المناقشة كان نصّ ملف البحث كاملاً (12 ألف حرف)
 * يُحقن في موجّه النظام، ومعه موجّه المناقِش (15.4 ألف حرف) ⇒ نحو 8.1 ألف
 * token ⇒ Groq يرفض بـ 413 (TPM/ITPM) أو 400 "reduce the length". وضع المعلم
 * يمرّ لأن نصّه أصغر. فالإصلاح هنا: نحصر الإدخال ونقصّ **نصّ الملف** أولاً
 * (بيانات، لا تعليمات) مع بقاء السؤال وتعليمات المشرف سليمة.
 *
 * القاعدة: كل ما عدا نصّ الملف يُعدّ «إلزامياً» — لا يُقصّ إلا بعد استنزاف
 * نصّ الملفات، وعندئذ يُقصّ من الذيل (في وضع defense تكون الملفات في آخر
 * الموجّه، فالقصّ من الذيل = قصّ نصّ الملف).
 */

/** عدد الأحرف/token تقريباً: العربية ≈2.1 (مقيس من حمولة المناقشة الفعلية). */
export const CHARS_PER_TOKEN = 2.1;

/**
 * ميزانية الإدخال لكل مزوّد (token) — فوقها يرفض الطلب (413 / 400 length).
 *
 * أرقام Groq المجانية مقيسة فعلياً (2026-10): gpt-oss-20b حدّه 8000 TPM،
 * وqwen3.8-27b حدّه 7000 ITPM ⇒ أضيق الحدّين 7000.
 *
 * هامش الأمان: حدّ Groq **معدّل بالدقيقة** (ITPM) لا حدّ طول ثابت — أي
 * عدّة طلبات كبيرة متقاربة تفني الرصيد وتُرجع 413/429 حتى لو كان كل طلب
 * على حدة دون الحدّ. قياس حقيقي: طلبان ~3.5k رمز ⇒ الثالث يُرفض 429.
 * فنترك لـ Groq نصيباً من الرصيد ونعمل بحدّ 4000 رمز (≈57% من 7000).
 */
export const INPUT_BUDGETS = {
  groq: 4000,
  openrouter: 32000,
  gemini: 60000,
  'gemini-fallback': 60000
};

/**
 * ميزانية كل نموذج على حدة (token) — نأضيق من ميزانية المزوّد العام.
 *
 * مقيسة من Groq فعلياً (2026-10):
 *   - openai/gpt-oss-20b : حدّ TPM 8000  ⇒ نعمل بحدّ 4000
 *   - qwen/qwen3.8-27b   : حدّ ITPM 7000 ⇒ نعمل بحدّ 3600
 *   - allam-2-7b         : سياق 4096 فقط ⇒ نعمل بحدّ 2800
 * آخر نموذج في السلسلة هو الاحتياط: إن فشل لسبب حجم، نُشدّد الميزانية
 * ونُعيد المحاولة بدل الانتقال إلى نموذج آخر بنفس الحجم.
 */
export const MODEL_INPUT_BUDGETS = {
  'openai/gpt-oss-20b': 4000,
  'qwen/qwen3.8-27b': 3600,
  'allam-2-7b': 2800
};

/** الميزانية الافتراضية لنموذج غير معروف = أضيق ميزانية معروفة (أأمن). */
export function budgetForModel(model, providerKey = 'groq') {
  const exact = MODEL_INPUT_BUDGETS[String(model || '').trim()];
  if (exact) return exact;
  const provider = INPUT_BUDGETS[providerKey] ?? INPUT_BUDGETS.groq;
  // نموذج مجهول: نستعمل ٨٠٪ من ميزانية المزوّد كحدّ احتياطي.
  return Math.max(2000, Math.floor(provider * 0.8));
}


/** الحدّ الأدنى الذي نُبقيه من نصّ كل ملف — فلا نُفرغه تماماً. */
export const MIN_FILE_CHARS = 600;

/** علامة تدلّنا على أنّ ذيل الملف مقصوص (تُحتسب ضمن الحصة لا خارجها). */
const TRUNCATION_MARKER = '\n[… نُقص بقية الملف لضيق حدّ النموذج …]';

/** تقدير عدد الرموز (token) لنص. */
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

/** تقدير رموز مجموعة رسائل. */
export function estimateMessagesTokens(messages = []) {
  return messages.reduce((sum, message) => sum + estimateTokens(message?.content), 0);
}

/** حجم الحمولة الكلي (system + الرسائل) بالرموز. */
export function measurePayloadTokens(system, messages = []) {
  return estimateTokens(system) + estimateMessagesTokens(messages);
}

/** رموز ⇐ حروف (للتحويل من ميزانية token إلى سقف أحرف). */
export function tokensToChars(tokens) {
  return Math.floor(Number(tokens || 0) * CHARS_PER_TOKEN);
}

/**
 * يوزّع نصّ ملف واحد على ميزانية أحرف، مع قصّ ذيله (الفصل الأخير عادةً
 * أضعف صلةً بالسؤال) وإبقاء حدّ أدنى من حجمه.
 */
function capFileText(text, maxChars) {
  const body = String(text || '');
  if (body.length <= maxChars) return body;
  const keep = Math.max(MIN_FILE_CHARS, maxChars);
  // علامة القصّ تُقتطع من نصّ الملف نفسه (لا تُضاف فوقه) وإلا تجاوزنا الحصة
  // وبالتصعيد التالي حُذفت كتلة الملف كاملةً فتضاعف الخسارة.
  const room = Math.max(0, keep - TRUNCATION_MARKER.length);
  return `${body.slice(0, room)}${TRUNCATION_MARKER}`;
}

/**
 * يقصّ كتلة `<files>…</files>` داخل موجّه النظام لتلائم ميزانية معيّنة.
 * يعيد الـ system معدّلاً وعدد الرموز بعد القصّ.
 *
 * @param {string} system موجّه النظام (قد يحتوي كتلة ملفات)
 * @param {number} maxFileChars سقف أحرف نصّ الملفات المسموح
 * @returns {{system: string, filesChars: number}} الموجّه بعد القصّ
 */
export function trimFilesInSystem(system, maxFileChars) {
  const text = String(system || '');
  const open = text.indexOf('<files>');
  const close = text.indexOf('</files>');
  if (open === -1 || close === -1 || close < open) {
    return { system: text, filesChars: 0 };
  }

  const before = text.slice(0, open);
  const block = text.slice(open, close + '</files>'.length);
  const after = text.slice(close + '</files>'.length);

  // نمرّ على كل وسم <file name="…">…</file> ونقصّ نصّه بالحصّة.
  const filePattern = /<file name="[^"]*">[\s\S]*?<\/file>/g;
  const parts = block.match(filePattern) || [];
  if (!parts.length) return { system: text, filesChars: 0 };

  const perFile = Math.max(MIN_FILE_CHARS, Math.floor(maxFileChars / parts.length));
  let filesChars = 0;
  const trimmed = parts.map((part) => {
    const head = part.slice(0, part.indexOf('>') + 1);
    const inner = part.slice(head.length, part.lastIndexOf('</file>'));
    const capped = capFileText(inner, perFile);
    filesChars += capped.length;
    return `${head}${capped}</file>`;
  });

  const newBlock = block.replace(filePattern, () => trimmed.shift());
  return { system: `${before}${newBlock}${after}`, filesChars };
}

/**
 * يقصّ الحمولة (system + messages) لتلائم ميزانية token معيّنة.
 *
 * ترتيب القصّ (الأقل ضرراً أولاً):
 *   ١) نصّ الملفات (بيانات) — نُقصّ ذيله حتى تتّسع الميزانية.
 *   ٢) الرسائل الأقدم في التاريخ (لا آخر رسالة: سؤال الباحث).
 *   ٣) حذف كتل الملفات الزائدة كلياً (وسوم سليمة) ثم — كحلّ أخير — بتر
 *      موجّه النظام من المنتصف (لا من الذيل!) حتى لا تُحذف تعليمات
 *      المناقِش الموجودة في آخر الموجّه.
 *
 * @param {string} system موجّه النظام
 * @param {Array<{role: string, content: string}>} messages الرسائل
 * @param {number} budget سقف الإدخال بالـ token
 * @returns {{system: string, messages: Array, tokens: number, trimmed: boolean, fileChars: number}}
 */
export function trimPayloadToBudget(system, messages = [], budget = INPUT_BUDGETS.groq) {
  // ملاحظة: `Number(budget) || default` يبتلع الصفر (falsy) فيعود للافتراضي.
  // هنا نريد الصفر = أضيق ميزانية ممكنة، فنفصله.
  const requested = Number(budget);
  const limit = Math.max(500, Number.isFinite(requested) ? requested : INPUT_BUDGETS.groq);
  const original = measurePayloadTokens(system, messages);
  if (original <= limit) {
    return { system, messages, tokens: original, trimmed: false, fileChars: 0 };
  }

  let nextSystem = String(system || '');
  let nextMessages = messages.map((message) => ({ ...message }));

  /*
   * ١) قصّ نصّ الملفات: نمنحها ما بقي من الميزانية بعد طرح كل ما ليس ملفات
   *    (التعليمات + الرسائل). فالمساواة هي: غير-الملفات + الملفات ≤ الميزانية.
   */
  const messagesTokens = estimateMessagesTokens(nextMessages);
  const nonFileSystemChars = nextSystem
    .replace(/<file name="[^"]*">[\s\S]*?<\/file>/g, '')
    .length;
  const nonFileTokens = estimateTokens('ا'.repeat(nonFileSystemChars)) + messagesTokens;
  const fileBudgetChars = tokensToChars(Math.max(0, limit - nonFileTokens));
  if (fileBudgetChars > 0) {
    nextSystem = trimFilesInSystem(nextSystem, fileBudgetChars).system;
  }

  // ٢) قصّ الرسائل الأقدم (التاريخ) — نحافظ على آخر رسالة (سؤال الباحث).
  let guard = 0;
  while (measurePayloadTokens(nextSystem, nextMessages) > limit && guard < 100) {
    guard += 1;
    const index = nextMessages.findIndex(
      (message, position) => position < nextMessages.length - 1 && String(message?.content || '').length > 0
    );
    if (index === -1) break;
    const target = nextMessages[index];
    const content = String(target.content || '');
    target.content = content.slice(0, Math.floor(content.length / 2));
    if (!target.content.trim()) nextMessages.splice(index, 1);
  }

  /*
   * ٣) حلّ أخير: نحذف كتل <file> كاملةً (من آخر ملف) مع بقاء الوسوم سليمة،
   *    ثم — إن بقيت الزيادة — نبرّ الموجّه من المنتصف لا من الذيل، لأن
   *    الذيل في defense يحوي تعليمات المناقِش وسطر «لا تقولي للباحث…».
   */
  if (measurePayloadTokens(nextSystem, nextMessages) > limit) {
    // ٣أ) إعادة قصّ نصّ الملفات بحصّة أدقّ (تصاعدي): نُبقي الملفات بأكبر
    //     حجم ممكن ضمن الميزانية بدل حذفها كاملةً.
    let guardFiles = 0;
    while (measurePayloadTokens(nextSystem, nextMessages) > limit && guardFiles < 12) {
      guardFiles += 1;
      const blocks = nextSystem.match(/<file name="[^"]*">[\s\S]*?<\/file>/g) || [];
      if (!blocks.length) break;
      const overflow = measurePayloadTokens(nextSystem, nextMessages) - limit;
      const currentFilesChars = blocks.join('').length;
      // نقصّ نصّ الملفات بنسبة الزيادة/الحجم الحالي (مع هامش صغير).
      const cutChars = Math.max(200, Math.ceil((overflow * 2.1) + 100));
      const newPerFile = Math.max(0, Math.floor((currentFilesChars - cutChars) / blocks.length));
      if (newPerFile < MIN_FILE_CHARS) break; // لا نستطيع القصّ أكثر دون إفراغ
      nextSystem = trimFilesInSystem(nextSystem, newPerFile * blocks.length).system;
    }

    // ٣ب) ما زال أضيق من أن نُبقي أيّ نصّ ملف: نحذف كتل الملفات كاملةً
    //     (من آخر ملف) مع بقاء الوسوم سليمة.
    while (measurePayloadTokens(nextSystem, nextMessages) > limit) {
      const blocks = nextSystem.match(/<file name="[^"]*">[\s\S]*?<\/file>/g) || [];
      if (!blocks.length) break;
      const last = blocks[blocks.length - 1];
      nextSystem = nextSystem.replace(last, '');
    }

    if (measurePayloadTokens(nextSystem, nextMessages) > limit) {
      const overflow = measurePayloadTokens(nextSystem, nextMessages) - limit;
      const cutChars = tokensToChars(overflow) + 200;
      // بتر من المنتصف: نحتفظ ببداية الموجّه (الطبقة الأولى) ونهايته
      // (تعليمات المناقِش) ولا نُبقي إلا وسطَه.
      const head = nextSystem.slice(0, Math.floor(nextSystem.length * 0.35));
      const tail = nextSystem.slice(Math.max(0, nextSystem.length - Math.floor(nextSystem.length * 0.35)));
      const middle = nextSystem.slice(Math.floor(nextSystem.length * 0.35), Math.max(0, nextSystem.length - Math.floor(nextSystem.length * 0.35)));
      nextSystem = `${head}${middle.slice(0, Math.max(0, middle.length - cutChars))}${tail}`;
    }
  }

  const fileChars = (nextSystem.match(/<file name="[^"]*">[\s\S]*?<\/file>/g) || []).join('').length;
  return {
    system: nextSystem,
    messages: nextMessages,
    tokens: measurePayloadTokens(nextSystem, nextMessages),
    trimmed: true,
    fileChars
  };
}
