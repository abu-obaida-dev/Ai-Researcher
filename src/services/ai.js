/**
 * طبقة مزوّدي الذكاء الاصطناعي (1F + 1H).
 *
 * كل مزوّد قد يحمل **عدّة مفاتيح** (مفصولة بفواصل في `NAME_API_KEYS`، أو مفتاح
 * واحد في `NAME_API_KEY` كسقوط متوافق). كل (مزوّد × مفتاح) «هدف» مستقل في
 * السباق، فإذا نفد رصيد مفتاح انتقل الطلب لغيره بلا انتظار.
 *
 * ثلاثة خطوط دفاع تتراكم: تبديل النماذج داخل المزوّد، ثم السباق المموَّه
 * (hedged requests) على مستوى الأهداف، ثم إخراج الفاشل من الدوران مؤقّتاً.
 *
 * أول من يردّ بنجاح هو المعتمد، وكل محاولة (ناجحة أو فاشلة) تُسجَّل في جدول
 * ai_requests. لا مفاتيح سرية في الواجهة إطلاقاً — الواجهة تعرض أسماء المزوّدين
 * المفعّلة وعدد مفاتيحها فقط.
 */

import { budgetForModel, trimPayloadToBudget } from './payload-budget.js';

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);
// حدّ طول الردّ المطلوب: يقلّل استهلاك رصيد المزوّد ويجنّب خطأ «requires more credits».
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 4000);
// محاولات إضافية عند ازدحام المزوّد (429/5xx). المحاولات الميتة (402/403) بلا إعادة.
const RETRIES = Number(process.env.AI_RETRIES || 1);
// الطلبات المموَّهة: بعد هذا الزمن من بدء النداء الأول نطلق المزوّد التالي بالتوازي
// بدل انتظاره. هكذا لو Gemini ازدحم، يردّ OpenRouter دون أن ينتظره الباحث.
const HEDGE_MS = Number(process.env.AI_HEDGE_MS || 3500);
// مدّة إخراج المزوّد من الدوران بعد خطأ مؤقّت (429/5xx/شبكة) بالدقائق.
const COOLDOWN_MIN = Number(process.env.AI_COOLDOWN_MIN || 10);
// خطأ دائم (رصيد/مفتاح/ترخيص) نُخرج المزوّد هذه المدة فقط — لا للأبد: فمن
// يشحن حسابه بعد قليل يجب أن يعمل الموقع وحده بلا إعادة تشغيل الخادم.
const HARD_COOLDOWN_MIN = Number(process.env.AI_HARD_COOLDOWN_MIN || 10);
const hardCooldownMs = HARD_COOLDOWN_MIN * 60000;

// أخطاء دائمة: المفتاح أو الرصيد أو النموذج نفسه خطأ — إعادة المحاولة لا تنفع.
// 413 (الحمولة أطول من حدّ النموذج) خطأ دائم *لهذه الحمولة*: لا فائدة من
// تكرارها كما هي — يجب تقصيرها. فنتركه يمرّ فوراً إلى منطق التقصير.
const HARD_STATUS = new Set([400, 401, 402, 403, 404, 413, 422]);

/** حالة المزوّدين في هذه العملية: من هو خارج الدوران الآن ولماذا. */
const HEALTH = new Map();

/** نماذج مزوّد: ما يستطيع تشغيله، بالترتيب (الأول هو الافتراضي). */
export function modelsFor(provider) {
  return Array.isArray(provider.models) ? [...provider.models] : [];
}

/** وصف عربي لخطأ المزوّد + هل هو دائم أم مؤقّت + مدة التهدئة. */
/**
 * يصنّف فشل المزوّد: دائم أم مؤقّت، ولماذا.
 * مُصدَّرة للاختبار — منطقها حسّاس ويقود قرارات التهدئة وإعادة المحاولة.
 *
 * `body` هو نصّ الرد الكامل (قد يكون أطول من الرسالة المختصرة) — نحتاجه لأن
 * كلمات مثل «ITPM» قد تقع بعد حدّ الاقتطاع فيظهر الخطأ خطأ طول.
 */
export function classifyFailure(status, message, body = '') {
  const text = `${String(message || '')} ${String(body || '')}`;
  // رموز الحالة الصريحة تُقدَّم على التخمين النصّي: رسالة «mixed» (503) قد
  // تحتوي كلمات الطول داخل تفاصيل الفشل، وتُصنَّف خطأ طول ⇒ تهدئة صفرية
  // أي: لا تهدئة أصلاً. نبدأ من الرمز ثم نلجأ للنصّ عند الغموض.
  if (status === 401) return { kind: 'auth', hard: true, reason: 'مفتاح غير صالح', cooldownMs: hardCooldownMs };
  if (status === 402) return { kind: 'credits', hard: true, reason: 'لا يوجد رصيد عند المزوّد', cooldownMs: hardCooldownMs };
  if (status === 403) return { kind: 'license', hard: true, reason: 'لا صلاحية/ترخيص على الحساب', cooldownMs: hardCooldownMs };
  if (status === 404) return { kind: 'model', hard: true, reason: 'اسم النموذج غير متاح', cooldownMs: hardCooldownMs };
  if (status === 429) return { kind: 'quota', reason: 'تجاوز الحصة أو حدّ المعدّل', cooldownMs: COOLDOWN_MIN * 60000 };
  if (status === 503 || status === 502 || status === 500) {
    return { kind: 'busy', reason: 'المزوّد مزدحم حالياً', cooldownMs: Math.max(30000, (COOLDOWN_MIN * 60000) / 6) };
  }
  // 413 عند Groq قد يكون خطأ **معدّل** (ITPM/TPM) لا خطأ طول: النصّ كان ضمن
  // الحدّ لكن رصيد الدقيقة نفد. لا فائدة من تضييق الحمولة — يُصنَّف كـ quota.
  if (status === 413 && /rate_limit|tokens per minute|ITPM|TPM|too many requests/i.test(text)) {
    return { kind: 'quota', reason: 'تجاوز حدّ المعدّل عند المزوّد (413/ITPM)', cooldownMs: COOLDOWN_MIN * 60000 };
  }
  // خطأ طول المدخلات (برومبت المشرف أثقل من المعلم بكثير): خاص بالطلب نفسه
  // وليس بالمزوّد — لا يُخرج المزوّد من الدوران، فقط ننتقل للهدف التالي.
  if (
    status === 413 ||
    /reduce the length|too long|too_large|maximum context|context_length|max_tokens/i.test(text)
  ) {
    return { kind: 'length', hard: false, reason: 'الحمولة أطول من حدّ النموذج', cooldownMs: 0 };
  }
  return { kind: 'other', reason: String(message || '').slice(0, 120), cooldownMs: COOLDOWN_MIN * 60000 };
}

/** يوقف المزوّد مؤقّتاً/دائماً بعد فشله. */
function markUnhealthy(key, failure) {
  const cooldownMs = Number.isFinite(failure.cooldownMs) ? failure.cooldownMs : hardCooldownMs;
  if (cooldownMs <= 0) {
    console.warn(`تخطي «${key}» دون اخراج من الدوران: ${failure.reason}`);
    return;
  }
  HEALTH.set(key, {
    until: Date.now() + cooldownMs,
    reason: failure.reason,
    kind: failure.kind,
    hard: Boolean(failure.hard),
    since: new Date()
  });
  console.warn(`إخراج المزوّد «${key}» من الدوران ${Math.round(cooldownMs / 60000)} دقيقة: ${failure.reason}`);
}

/** هل هذا المزوّد خارج دورانه الآن؟ */
function isUnhealthy(key) {
  const entry = HEALTH.get(key);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    HEALTH.delete(key);
    return false;
  }
  return true;
}

/** أسماء عربية للمزوّدين تُعرض في الواجهة والتقارير. */
export const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
  gemini: 'Gemini',
  'gemini-fallback': 'Gemini احتياطي'
};

/**
 * مفاتيح مزوّد: `NAME_API_KEYS` (قائمة) أولاً ثم `NAME_API_KEY` (واحد).
 *   OPENROUTER_API_KEYS=sk-or-AAA,sk-or-BBB
 * عدد المفاتيح مقصود أن يكون أكثر من واحد: نفاد رصيد مفتاح يجب ألا يوقف الموقع.
 */
function keysOf(provider) {
  const raw = process.env[`${provider.envKey}S`] ?? process.env[provider.envKey] ?? '';
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * الأهداف = (كل مزوّد × كل مفتاح فيه). هي وحدات السباق في runSupervisor،
 * والصحّة تُتابَع لكل هدف على حدة: مفتاح نُفد رصيده لا يُطعن في أخيه.
 */
function activeTargets() {
  const only = String(process.env.AI_ONLY_PROVIDER || '').trim().toLowerCase();
  const list = only ? PROVIDERS.filter((provider) => provider.key === only) : PROVIDERS;
  const targets = [];
  for (const provider of list) {
    keysOf(provider).forEach((apiKey, position) => {
      targets.push({ provider, apiKey, models: modelsFor(provider), id: `${provider.key}#${position + 1}`, position });
    });
  }
  return targets;
}

/** حالة المزوّدين: مستوى المزوّد (مع عدد المفاتيح) + مستوى كل مفتاح. */
export function providerStatus() {
  return PROVIDERS.map((provider) => {
    const keys = keysOf(provider);
    const keyStates = keys.map((apiKey, position) => {
      const id = `${provider.key}#${position + 1}`;
      const health = HEALTH.get(id);
      return {
        id,
        position: position + 1,
        down: isUnhealthy(id),
        reason: health?.reason || null,
        hard: Boolean(health?.hard),
        backInMs: health ? Math.max(0, health.until - Date.now()) : 0
      };
    });

    return {
      key: provider.key,
      label: PROVIDER_LABELS[provider.key] || provider.key,
      model: modelsFor(provider)[0],
      models: modelsFor(provider),
      configured: keys.length > 0,
      keyCount: keys.length,
      down: keys.length > 0 && keyStates.every((state) => state.down),
      keysDown: keyStates.filter((state) => state.down).length,
      reason: keyStates.find((state) => state.reason)?.reason || null,
      backInMs: Math.max(0, ...keyStates.map((state) => state.backInMs)),
      keyStates
    };
  });
}

/** ينفّذ fetch مع إعادة محاولة واحدة على الأخطاء المؤقتة فقط. */
async function fetchWithRetry(url, options, providerLabel = '', signal = null) {
  let lastError;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (signal?.aborted) throw new Error('أُلغي الطلب');
    try {
      const response = await fetch(url, { ...options, signal: signal || AbortSignal.timeout(TIMEOUT_MS) });
      lastStatus = response.status;
      if (response.ok || HARD_STATUS.has(response.status)) return response;

      lastError = new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      // نحفظ رمز الحالة على الخطأ: نحتاجه للتصنيف (413 = حمولة أطول من الحدّ)
      // ولإعادة المحاولة بحمولة مختصرة.
      lastError.status = response.status;
    } catch (error) {
      lastError = error;
    }

    // أخطاء دائمة (401/402/403/404) لا تُعاد — wasting الوقت لا ينفع.
    if (HARD_STATUS.has(lastStatus)) break;
    if (attempt < RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  throw lastError;
}

/** خطأ مزوّد يحمل رمز الحالة ليصنّفه runSupervisor (دائم/مؤقّت). */
function providerError(label, status, body) {
  const raw = String(body || '');
  const error = new Error(`${label} ${status}: ${raw.slice(0, 200)}`);
  error.status = status;
  // نصّ الرد الكامل (قبل الاقتطاع) — نحتاجه للتمييز بين 413-طول و413-معدّل.
  error.body = raw.slice(0, 4000);
  // 413 عند Groq قد يكون خطأ **معدّل** (ITPM/TPM) لا خطأ طول. نميّزه هنا
  // حيث النصّ كامل، لا في مواضع أخرى حيث يكون مبتوراً.
  if (
    status === 413 &&
    /rate_limit|tokens per minute|ITPM|TPM|too many requests/i.test(error.body)
  ) {
    error.rateLimited = true;
  }
  return error;
}

/**
 * قائمة النماذج لمزوّد: تُقرأ من البيئة بعدد مفصولة بفواصل.
 *
 * هذا هو خط الدفاع الثاني بعد المزوّد نفسه: مفتاح Gemini الواحد فيه عشرات
 * النماذج، وlzحام نموذج (503) لا يعني ازدحام المفتاح. جرّبنا 3.8 و3.7 و
 * flash-latest فكانوا 503 في نفس اللحظة التي ردّ فيها 3.6 فوراً.
 *   AI_MODEL_GEMINI=gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash
 */
function modelList(raw, fallback) {
  const list = String(raw || fallback || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : ['gpt-4o-mini'];
}

/** نداء واحد على نموذج واحد (بلا تبديل). يرمي خطأً يحمل status. */
async function callOnce({ label, url, headers, body, model, signal }) {
  const response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, label, signal);
  if (!response.ok) throw providerError(label, response.status, await response.text());
  return response.json();
}

/**
 * المزوّدون بالترتيب مع دالة نداء لكل واحد. كل مزوّد يحمل قائمة نماذج.
 * مُصدَّر للاختبار: نتحقّق من منطق التقصير وإعادة المحاولة على خطأ الطول
 * بلا أي طلبات شبكة (استبدال fetch عالمياً).
 */
export const PROVIDERS = [
  {
    key: 'groq',
    envKey: 'GROQ_API_KEY',
    // qwen3.8-27b سريع جداً (≈٦٦٠ms) وأفضله عربياً بين نماذج Groq؛ ثم بدائل.
    // نستبعد whisper (صوت) و llama-prompt-guard (تصنيف لا توليد).
    models: modelList(process.env.AI_MODEL_GROQ, 'openai/gpt-oss-20b,qwen/qwen3.8-27b,allam-2-7b'),
    async call({ apiKey, models, system, messages, temperature, maxTokens = MAX_TOKENS, signal = null }) {
      // ميزانية Groq المدخلة: نقصّ الحمولة قبل الإرسال حتى لا نُنفق محاولة
      // على خطأ 413/400-length. لكل نموذج حدّه الخاص (أضيق = أأمن)، وعند
      // فشل الطول نُشدّد الميزانية ونُعيد المحاولة بالنموذج نفسه.
      const failures = [];
      // نوع كل فشل: 'length' | 'rate_limit' | 'other' — لتصنيف الإجمالي بدقة.
      const failureKinds = [];
      for (const model of models) {
        const modelBudget = budgetForModel(model, 'groq');
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const currentBudget = Math.max(1800, Math.floor(modelBudget * Math.pow(0.6, attempt)));
          const payload = trimPayloadToBudget(system, messages, currentBudget);
          try {
            const data = await callOnce({
              label: 'Groq',
              url: 'https://api.groq.com/openai/v1/chat/completions',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
              body: { model, messages: [{ role: 'system', content: payload.system }, ...payload.messages], temperature, max_tokens: maxTokens },
              model,
              signal
            });

            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new Error('ردّ فارغ');
            return { text, model: data?.model || model, usage: data?.usage || null };
          } catch (error) {
            // خطأ الطول: نُعيد المحاولة بحمولة أقصر.
            const isLength =
              error?.status === 413 ||
              /reduce the length|too long|maximum context|context_length|\b413\b/i.test(String(error?.message || ''));
            // 413 عند Groq = خطأ **معدّل** (ITPM/TPM) لا خطأ طول: نصّ الطلب
            // كان ضمن الحدّ لكن رصيد الدقيقة نفد. تضييق الميزانية لا يُصلحه
            // (بل يستهلك رصيداً أكثر!) — فنتركه يُصنَّف كخطأ مزوّد مؤقّت.
            const isRateLimit = Boolean(error?.rateLimited);
            // نسجّل نوع كل فشل لنصنّف الإجمالي في النهاية بدقة.
            failures.push(`${model}: ${String(error?.message || error).slice(0, 90)}`);
            failureKinds.push(isRateLimit ? 'rate_limit' : isLength ? 'length' : 'other');
            if (isLength && !isRateLimit && attempt < 2) {
              // شدّد الميزانية للنموذج نفسه: نحتفظ بالسؤال وبتعليمات المشرف،
              // ونقصّ نصّ الملف — بدل الانتقال لنموذج آخر بنفس الحجم.
              console.warn(`Groq/${model}: الحمولة أطول من الحدّ — إعادة محاولة بميزانية ${currentBudget} token`);
              continue;
            }
            if ([401, 402, 403, 404, 422].includes(error.status) || signal?.aborted) break;
            break;
          }
        }
      }
      const last = failures.at(-1) || 'بلا تفاصيل';
      const error = new Error(`Groq فشل على ${models.length} نموذج — ${last}`);
      error.status = /402|403|401/.test(last) ? 402 : 503;
      // تصنيف دقيق حسب أنواع الفشل (لا بالاعتماد على مطابقة النصّ):
      //  - كلّها معدّل ⇒ 429 (مؤقّت يُعاد بعد قليل).
      //  - كلّها طول   ⇒ 413 (الحمولة تحتاج تقصيراً ⇒ دائمة لهذه الحمولة).
      //  - مزيج        ⇒ 503 مؤقّت + تفاصيل تشخيصية (لا دائمة، لا تضيع المعلومات).
      const kinds = new Set(failureKinds);
      if (kinds.size && !kinds.has('other')) {
        if (kinds.has('rate_limit') && kinds.has('length')) {
          error.status = 503;
          error.reason = 'mixed';
          error.message = `Groq فشل على ${models.length} نموذج (طول + حدّ معدّل) — ${last}`;
        } else if (kinds.has('rate_limit')) {
          error.status = 429;
          error.reason = 'rate_limit';
          error.message = `Groq تجاوز حدّ المعدّل (ITPM) على ${models.length} نموذج — ${last}`;
        } else {
          error.status = 413;
          error.reason = 'length';
          error.message = `Groq: الحمولة أطول من حدّ النموذج — ${last}`;
        }
      }
      throw error;
    }
  }
];


/**
 * فحص مباشر لمزوّد واحد بلا سلسلة التبديل: يناديه بأصغر نداء ممكن.
 * يُستخدم من scripts/doctor.mjs ومن صفحة /admin/providers ليعرف المدير
 * سبب تعطّل مزوّد بعينه (رصيد/حصة/ترخيص/اسم نموذج).
 * يرجع { key, ok, status, reason, ms, text }.
 */
export async function probeProvider(key, { timeoutMs = 30000, perKey = false } = {}) {
  const provider = PROVIDERS.find((item) => item.key === key);
  const keys = provider ? keysOf(provider) : [];

  if (!provider) return { key, ok: false, status: 0, reason: 'مزوّد غير معروف', ms: 0, keys: [] };
  if (!keys.length) return { key, ok: false, status: 0, reason: 'لا مفتاح في .env', ms: 0, keys: [] };

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const keyReports = [];
  let firstText = '';

  try {
    for (const [position, apiKey] of keys.entries()) {
      try {
        const result = await provider.call({
          apiKey,
          models: modelsFor(provider, apiKey),
          system: 'أجب بكلمة واحدة فقط.',
          messages: [{ role: 'user', content: 'قل: تم' }],
          temperature: 0.1,
          maxTokens: 400,
          signal: controller.signal
        });
        keyReports.push({ position: position + 1, ok: true, reason: 'يعمل' });
        if (!firstText) firstText = result.text?.slice(0, 60) || '';
        // أول مفتاح يعمل يكفي للمدير؛ وperKey يجعله يفحص كل المفاتيح.
        if (!perKey) {
          return { key, ok: true, status: 200, reason: 'يعمل', ms: Date.now() - startedAt, text: firstText, keys: keyReports };
        }
      } catch (error) {
        const failure = classifyFailure(error.status, error.message, error.body);
        const detail = String(error.message || '').replace(/\s+/g, ' ').slice(0, 150);
        keyReports.push({ position: position + 1, ok: false, status: error.status || 0, reason: `${failure.reason}${detail ? ` — ${detail}` : ''}` });
        if (perKey) continue;
        break;
      }
    }

    // بعد كل المفاتيح: يكفي أن يعمل واحد منها، والبقية مجرّد تفاصيل للمدير.
    const good = keyReports.filter((report) => report.ok).length;
    const firstBad = keyReports.find((report) => !report.ok);

    return {
      key,
      ok: good > 0,
      status: good > 0 ? 200 : firstBad?.status || 0,
      reason: good > 0
        ? `يعمل — ${good}/${keyReports.length} مفتاح`
        : keyReports.length > 1
          ? `كل المفاتيح (${keyReports.length}) فاشلة — ${firstBad?.reason || '؟'}`
          : firstBad?.reason || 'فشل',
      ms: Date.now() - startedAt,
      text: firstText,
      keys: keyReports
    };
  } finally {
    clearTimeout(timer);
  }
}

/** المزوّدون المفعّلون فعلياً (تظهر أسماؤهم وعدد مفاتيحهم في صفحة الشات). */
export function availableProviders() {
  const only = String(process.env.AI_ONLY_PROVIDER || '').trim().toLowerCase();
  const list = only ? PROVIDERS.filter((provider) => provider.key === only) : PROVIDERS;
  return list.filter((provider) => keysOf(provider).length).map((provider) => ({
    key: provider.key,
    models: modelsFor(provider),
    keyCount: keysOf(provider).length
  }));
}

/** هل يوجد مزوّد واحد على الأقل؟ (إلا فمعناها الشات يعرض رسالة إعداد) */
export function hasProvider() {
  return availableProviders().length > 0;
}

/** يسجّل محاولة مزوّد في ai_requests للمراقبة (يفشل بصمت حتى لا يعطّل الرد). */
async function logRequest({ userId, provider, model, latencyMs, status, error }) {
  try {
    const { pool } = await import('../db/client.js');
    await pool.query(
      `INSERT INTO ai_requests (user_id, provider, model, latency_ms, status, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId || null, provider, model || null, latencyMs || null, status, String(error || '').slice(0, 500) || null]
    );
  } catch (dbError) {
    console.warn(`تعذّر تسجيل طلب ${provider}: ${dbError.code || dbError.message}`);
  }
}

/**
 * تنفيذ طلب للمشرف الذكي عبر سباق **مموَّه** على الأهداف (مزوّد × مفتاح).
 *
 * المنطق: نطلق الهدف الأول، وبعد AI_HEDGE_MS نطلق التالي بالتوازي، وهكذا.
 * أول من يردّ بنجاح هو المعتمد، ويُلغى الباقون فوراً: لا-drop ولا انتظار.
 * ازدحام Gemini أو نفاد رصيد مفتاح OpenRouter لا يعني انقطاع الخدمة ما دام
 * هدفٌ واحد حيّ.
 * messages: [{ role: 'user' | 'assistant', content }] بترتيب زمني.
 * maxTokens: سقف طول الردّ (يقلّص الاستهلاك ويفرض قصر الرسالة).
 * يرجع { text, model, provider, target, usage } — و usage هو الاستهلاك الحقيقي.
 * يرمي خطأً يحمل code = NO_PROVIDER / PROVIDERS_FAILED.
 */
export async function runSupervisor({ userId = null, messages, system, temperature = 0.4, maxTokens = MAX_TOKENS } = {}) {
  const all = activeTargets();
  const targets = all.filter((target) => !isUnhealthy(target.id));

  if (!all.length) {
    const error = new Error(
      'لم يُضبط أي مزوّد ذكاء اصطناعي بعد (GROQ_API_KEY أو OPENROUTER_API_KEY أو GEMINI_API_KEY).'
    );
    error.code = 'NO_PROVIDER';
    throw error;
  }

  if (!targets.length) {
    // كل الأهداف في تهدئة: لا نستسلم فورا — نحاول مرة واحدة متجاهلين التهدئة
    // (قد تكون تهدئة قديمة من عملية سابقة أو عارض انتهى)، ثم نفشل بتفاصيل.
    const retryAll = all.filter((t) => (t.apiKey || '').trim());
    if (retryAll.length) {
      console.warn(`كل الأهداف في تهدئة — محاولة أخيرة متجاهلة التهدئة: ${retryAll.map((t) => t.id).join('، ')}`);
      for (const [key, entry] of [...HEALTH.entries()]) {
        if (Date.now() >= (entry?.until || 0)) HEALTH.delete(key);
      }
      const stillCool = retryAll.filter((t) => !isUnhealthy(t.id));
      if (stillCool.length) targets.push(...stillCool);
      else { HEALTH.clear(); targets.push(...retryAll); }
    }
  }
  if (!targets.length) {
    const error = new Error(
      `كل المزوّدين متوقّفون الآن: ${all.map((t) => `${t.id} (${HEALTH.get(t.id)?.reason || '؟'})`).join(' · ')}`
    );
    error.code = 'PROVIDERS_FAILED';
    throw error;
  }

  const failures = [];
  const controller = new AbortController();

  // وعد يفوز به أول هدف ينجح. (Promise.any لا يصلح: يلتقط القائمة لحظة بدئه فقط)
  let resolveWinner;
  let rejectWinner;
  const winner = new Promise((resolve, reject) => {
    resolveWinner = resolve;
    rejectWinner = reject;
  });
  winner.catch(() => {}); // نلتقط الرفض مسبقاً حتى لا يصير unhandledRejection

  let settled = false;
  let failed = 0;
  let index = 0;
  let hedgeTimer = null;

  const finish = (settle, value) => {
    if (settled) return;
    settled = true;
    clearInterval(hedgeTimer);
    controller.abort(); // نُلغي المتبقّي حتى لا نُنفق رصيداً على ردّ لا نستخدمه
    settle(value);
  };

  // إطلاق متدرّج: الأول فوراً، والتالي بعد HEDGE_MS إن لم يسبقه الأول،
  // أو فوراً إن فشل الأول قبل ذلك (لا ننتظر زمناً على مزوّد ميت).
  const launch = () => {
    const target = targets[index];
    index += 1;
    if (!target) return false;
    attempt(target);
    return true;
  };

  const attempt = async (target) => {
    const { provider } = target;
    const startedAt = Date.now();
    try {
      const result = await provider.call({
        apiKey: target.apiKey,
        models: target.models || provider.models,
        system,
        messages,
        temperature,
        maxTokens,
        signal: controller.signal
      });

      await logRequest({ userId, provider: provider.key, model: result.model, latencyMs: Date.now() - startedAt, status: 'ok' });
      finish(resolveWinner, { ...result, provider: provider.key, target: target.id });
    } catch (error) {
      if (settled) return; // أُلغي لأن هدفاً آخر سبقنا

      // الخروج من الدوران للمفتاح وحده: مفتاحٌ بلا رصيد لا يُطعن في أخيه.
      markUnhealthy(target.id, classifyFailure(error.status, error.message, error.body));
      failures.push(`${target.id}: ${String(error?.message || error).slice(0, 300)}`);
      await logRequest({ userId, provider: provider.key, model: (target.models || provider.models)[0], latencyMs: Date.now() - startedAt, status: 'error', error });
      console.warn(`فشل ${target.id}: ${String(error.message).slice(0, 120)}`);

      failed += 1;
      // نرفض فقط بعد أن جُرّب الجميع: فشل مبكّر لا يعني نهاية السباق.
      if (failed >= targets.length) {
        finish(rejectWinner, new Error('فشلت كل المزوّدين'));
        return;
      }
      if (index < targets.length) clearInterval(hedgeTimer);
      launch(); // التالي فوراً
    }
  };

  launch();
  hedgeTimer = setInterval(() => {
    if (settled || !launch()) clearInterval(hedgeTimer);
  }, HEDGE_MS);
  hedgeTimer.unref?.();

  try {
    return await winner;
  } catch {
    for (const target of targets.slice(index)) {
      failures.push(`${target.id}: لم يُطلق (انتهى الدوران)`);
    }
  }

  const error = new Error(`تعذّر الوصول لأي مزوّد ذكاء اصطناعي. آخر خطأ: ${failures.at(-1) || 'غير معروف'}`);
  error.code = 'PROVIDERS_FAILED';
  error.failures = failures;
  throw error;
}
