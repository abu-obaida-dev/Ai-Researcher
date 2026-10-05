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
const HARD_STATUS = new Set([400, 401, 402, 403, 404, 422]);

/** حالة المزوّدين في هذه العملية: من هو خارج الدوران الآن ولماذا. */
const HEALTH = new Map();

/** نماذج مزوّد: ما يستطيع تشغيله، بالترتيب (الأول هو الافتراضي). */
export function modelsFor(provider) {
  return Array.isArray(provider.models) ? [...provider.models] : [];
}

/** وصف عربي لخطأ المزوّد + هل هو دائم أم مؤقّت + مدة التهدئة. */
function classifyFailure(status, message) {
  if (status === 401) return { kind: 'auth', hard: true, reason: 'مفتاح غير صالح', cooldownMs: hardCooldownMs };
  if (status === 402) return { kind: 'credits', hard: true, reason: 'لا يوجد رصيد عند المزوّد', cooldownMs: hardCooldownMs };
  if (status === 403) return { kind: 'license', hard: true, reason: 'لا صلاحية/ترخيص على الحساب', cooldownMs: hardCooldownMs };
  if (status === 404) return { kind: 'model', hard: true, reason: 'اسم النموذج غير متاح', cooldownMs: hardCooldownMs };
  if (status === 429) return { kind: 'quota', reason: 'تجاوز الحصة أو حدّ المعدّل', cooldownMs: COOLDOWN_MIN * 60000 };
  if (status === 503 || status === 502 || status === 500) {
    return { kind: 'busy', reason: 'المزوّد مزدحم حالياً', cooldownMs: Math.max(30000, (COOLDOWN_MIN * 60000) / 6) };
  }
  return { kind: 'other', reason: String(message || '').slice(0, 120), cooldownMs: COOLDOWN_MIN * 60000 };
}

/** يوقف المزوّد مؤقّتاً/دائماً بعد فشله. */
function markUnhealthy(key, failure) {
  HEALTH.set(key, {
    until: Date.now() + (Number.isFinite(failure.cooldownMs) ? failure.cooldownMs : hardCooldownMs),
    reason: failure.reason,
    kind: failure.kind,
    hard: Boolean(failure.hard),
    since: new Date()
  });
  console.warn(`إخراج المزوّد «${key}» من الدوران ${Math.round(failure.cooldownMs / 60000)} دقيقة: ${failure.reason}`);
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
  'gemini-fallback': 'Gemini احتياطي',
  grok: 'Grok (xAI)'
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
  const targets = [];
  for (const provider of PROVIDERS) {
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
  const error = new Error(`${label} ${status}: ${String(body || '').slice(0, 200)}`);
  error.status = status;
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
 * نداء Gemini (generateContent) مع تبديل بين نماذج المفتاح الواحد.
 *
 * gemini-3.8-flash نموذج «مفكّر»: يكتب تفكيره في parts منفصلة (thought: true)
 * ويحتسبها usageMetadata.thoughtsTokenCount **خارج** candidatesTokenCount. لذلك:
 *  - نستبعد أجزاء التفكير من النص الظاهر (لا نُفصح عن سلسلة استدلاله للباحث).
 *  - نضمن له هامشاً فوق سقف الرد، وإلا أكل التفكيرُ الحصة كلها فنال رداً فارغاً.
 */
async function geminiCall({ apiKey, models, system, messages, temperature, maxTokens = MAX_TOKENS, signal = null }) {
  const budget = Math.min(MAX_TOKENS, Math.max(Number(maxTokens) + 400, 1200));
  const contents = messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));

  const failures = [];
  for (const model of models) {
    try {
      const data = await callOnce({
        label: 'Gemini',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { 'content-type': 'application/json' },
        body: { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature, maxOutputTokens: budget } },
        model,
        signal
      });

      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts
        .filter((part) => part && part.thought !== true)
        .map((part) => part.text || '')
        .join('\n')
        .trim();

      if (!text) {
        const finish = data?.candidates?.[0]?.finishReason || 'غير معروف';
        const error = new Error(`النموذج ${model} أعاد رداً فارغاً (finishReason=${finish}).`);
        error.status = finish === 'MAX_TOKENS' ? 429 : 500;
        throw error;
      }
      // usageMetadata توحيده في services/tokens.js (promptTokenCount/candidatesTokenCount/thoughtsTokenCount)
      return { text, model, usage: data?.usageMetadata || null };
    } catch (error) {
      failures.push(`${model}: ${error.message.slice(0, 90)}`);
      // مفتاح/رصيد/نموذج غير موجود = لا فائدة من تبديل الباقي
      if ([401, 402, 403, 404].includes(error.status)) break;
      if (signal?.aborted) break;
    }
  }

  const last = failures.at(-1) || 'بلا تفاصيل';
  const error = new Error(`Gemini فشل على ${models.length} نموذج — ${last}`);
  error.status = /402|403|401/.test(last) ? 402 : 503;
  throw error;
}

/** المزوّدون بالترتيب مع دالة نداء لكل واحد. كل مزوّد يحمل قائمة نماذج. */
const PROVIDERS = [
  {
    key: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    models: modelList(process.env.AI_MODEL_OPENROUTER, 'openai/gpt-4o-mini'),
    async call({ apiKey, models, system, messages, temperature, maxTokens = MAX_TOKENS, signal = null }) {
      const failures = [];
      for (const model of models) {
        try {
          const data = await callOnce({
            label: 'OpenRouter',
            url: 'https://openrouter.ai/api/v1/chat/completions',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`,
              'x-title': 'Zena AI',
              'HTTP-Referer': 'https://zena.ai'
            },
            body: { model, messages: [{ role: 'system', content: system }, ...messages], temperature, max_tokens: maxTokens },
            model,
            signal
          });

          const text = data?.choices?.[0]?.message?.content;
          if (!text) throw new Error('ردّ فارغ');
          return { text, model: data?.model || model, usage: data?.usage || null };
        } catch (error) {
          failures.push(`${model}: ${error.message.slice(0, 90)}`);
          if ([401, 402, 403, 404].includes(error.status) || signal?.aborted) break;
        }
      }
      const last = failures.at(-1) || 'بلا تفاصيل';
      const error = new Error(`OpenRouter فشل على ${models.length} نموذج — ${last}`);
      error.status = /402|403|401/.test(last) ? 402 : 503;
      throw error;
    }
  },
  {
    key: 'groq',
    envKey: 'GROQ_API_KEY',
    // qwen3.8-27b سريع جداً (≈٦٦٠ms) وأفضله عربياً بين نماذج Groq؛ ثم بدائل.
    // نستبعد whisper (صوت) و llama-prompt-guard (تصنيف لا توليد).
    models: modelList(process.env.AI_MODEL_GROQ, 'qwen/qwen3.8-27b,openai/gpt-oss-20b,allam-2-7b'),
    async call({ apiKey, models, system, messages, temperature, maxTokens = MAX_TOKENS, signal = null }) {
      const failures = [];
      for (const model of models) {
        try {
          const data = await callOnce({
            label: 'Groq',
            url: 'https://api.groq.com/openai/v1/chat/completions',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: { model, messages: [{ role: 'system', content: system }, ...messages], temperature, max_tokens: maxTokens },
            model,
            signal
          });

          const text = data?.choices?.[0]?.message?.content;
          if (!text) throw new Error('ردّ فارغ');
          return { text, model: data?.model || model, usage: data?.usage || null };
        } catch (error) {
          failures.push(`${model}: ${error.message.slice(0, 90)}`);
          if ([401, 402, 403, 404, 422].includes(error.status) || signal?.aborted) break;
        }
      }
      const last = failures.at(-1) || 'بلا تفاصيل';
      const error = new Error(`Groq فشل على ${models.length} نموذج — ${last}`);
      error.status = /402|403|401/.test(last) ? 402 : 503;
      throw error;
    }
  },
  {
    key: 'gemini',
    envKey: 'GEMINI_API_KEY',
    models: modelList(process.env.AI_MODEL_GEMINI, 'gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest'),
    call: geminiCall
  },
  {
    key: 'gemini-fallback',
    envKey: 'GEMINI_API_KEY_FALLBACK',
    models: modelList(process.env.AI_MODEL_GEMINI_FALLBACK, 'gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite'),
    call: geminiCall
  },
  {
    key: 'grok',
    envKey: 'GROK_API_KEY',
    models: modelList(process.env.AI_MODEL_GROK, 'grok-3-mini'),
    async call({ apiKey, models, system, messages, temperature, maxTokens = MAX_TOKENS, signal = null }) {
      const data = await callOnce({
        label: 'Grok',
        url: 'https://api.x.ai/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: { model: models[0], messages: [{ role: 'system', content: system }, ...messages], temperature, max_tokens: maxTokens },
        model: models[0],
        signal
      });

      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Grok أعاد رداً فارغاً.');
      return { text, model: data?.model || models[0], usage: data?.usage || null };
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
        const failure = classifyFailure(error.status, error.message);
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
  return PROVIDERS.filter((provider) => keysOf(provider).length).map((provider) => ({
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
      'لم يُضبط أي مزوّد ذكاء اصطناعي بعد (OPENROUTER_API_KEY أو GROQ_API_KEY أو GEMINI_API_KEY أو GROK_API_KEY).'
    );
    error.code = 'NO_PROVIDER';
    throw error;
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
      markUnhealthy(target.id, classifyFailure(error.status, error.message));
      failures.push(`${target.id}: ${error.message}`);
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
