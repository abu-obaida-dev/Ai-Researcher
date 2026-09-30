/**
 * طبقة مزوّدي الذكاء الاصطناعي (1F).
 *
 * سلسلة المزوّدين بالترتيب: OpenRouter ثم Gemini ثم مفتاح Gemini الاحتياطي ثم Grok.
 * أول مزوّد يستجيب بنجاح هو الذي يُستخدم، وكل محاولة (ناجحة أو فاشلة) تُسجَّل في
 * جدول ai_requests للمراقبة. لا مفاتيح سرية في الواجهة إطلاقاً — الواجهة تعرض
 * أسماء المزوّدين المفعّلة فقط عبر availableProviders().
 */

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);
// حدّ طول الردّ المطلوب: يقلّل استهلاك رصيد المزوّد ويجنّب خطأ «requires more credits».
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 4000);
// محاولات إضافية عند ازدحام المزوّد (429/5xx) قبل الانتقال للمزوّد التالي.
const RETRIES = Number(process.env.AI_RETRIES || 2);

/** ينفّذ fetch مع إعادة المحاولة عند الأخطاء المؤقتة (ازدحام/حدّ معدّل). */
async function fetchWithRetry(url, options, providerLabel = '') {
  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status)) return response;

      lastError = new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < RETRIES) {
      // انتظار متزايد (2ث، 5ث، 9ث): ازدحام النماذج المجانية متقطّع ولا ينجح التحويل الفوري
      const waitMs = [2000, 5000, 9000][attempt] || 9000;
      console.warn(`إعادة محاولة بعد ${waitMs / 1000} ثانية (${providerLabel || 'المزوّد'}): ${lastError.message}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}

/** نداء Gemini (generateContent) — يُستخدم للمفتاح الأساسي والاحتياطي معاً. */
async function geminiCall({ apiKey, model, system, messages, temperature }) {
  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        })),
        generationConfig: { temperature, maxOutputTokens: MAX_TOKENS }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    },
    'gemini'
  );

  if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`);

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n');
  if (!text) throw new Error('Gemini أعاد رداً فارغاً.');
  return { text, model };
}

/** المزوّدون بالترتيب مع دالة نداء لكل واحد. */
const PROVIDERS = [
  {
    key: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    model: process.env.AI_MODEL_OPENROUTER || 'openai/gpt-4o-mini',
    async call({ apiKey, model, system, messages, temperature }) {
      const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'x-title': 'Zena AI',
          'HTTP-Referer': 'https://zena.ai'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, ...messages],
          temperature,
          max_tokens: MAX_TOKENS
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      },
      'openrouter'
    );

      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenRouter أعاد رداً فارغاً.');
      return { text, model: data?.model || model };
    }
  },
  {
    key: 'gemini',
    envKey: 'GEMINI_API_KEY',
    model: process.env.AI_MODEL_GEMINI || 'gemini-3.8-flash',
    call: geminiCall
  },
  {
    key: 'gemini-fallback',
    envKey: 'GEMINI_API_KEY_FALLBACK',
    model: process.env.AI_MODEL_GEMINI_FALLBACK || 'gemini-3.8-flash',
    call: geminiCall
  },
  {
    key: 'grok',
    envKey: 'GROK_API_KEY',
    model: process.env.AI_MODEL_GROK || 'grok-3-mini',
    async call({ apiKey, model, system, messages, temperature }) {
      const response = await fetchWithRetry('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], temperature, max_tokens: MAX_TOKENS }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      },
      'grok'
    );

      if (!response.ok) throw new Error(`Grok ${response.status}: ${(await response.text()).slice(0, 200)}`);

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('Grok أعاد رداً فارغاً.');
      return { text, model: data?.model || model };
    }
  }
];

/** المزوّدون المفعّلون فعلياً (تظهر أسماؤهم في صفحة الشات). */
export function availableProviders() {
  return PROVIDERS.filter((provider) => Boolean(process.env[provider.envKey])).map((provider) => ({
    key: provider.key,
    model: provider.model
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
 * تنفيذ طلب للمشرف الذكي مع تبديل تلقائي بين المزوّدين.
 * messages: [{ role: 'user' | 'assistant', content }] بترتيب زمني.
 * يرمي خطأً يحمل code = NO_PROVIDER إذا لم يعمل أي مزوّد.
 */
export async function runSupervisor({ userId = null, messages, system, temperature = 0.4 } = {}) {
  const configured = PROVIDERS.filter((provider) => Boolean(process.env[provider.envKey]));

  if (!configured.length) {
    const error = new Error(
      'لم يُضبط أي مزوّد ذكاء اصطناعي بعد (OPENROUTER_API_KEY أو GEMINI_API_KEY أو GROK_API_KEY).'
    );
    error.code = 'NO_PROVIDER';
    throw error;
  }

  const failures = [];

  for (const provider of configured) {
    const startedAt = Date.now();

    try {
      const result = await provider.call({
        apiKey: process.env[provider.envKey],
        model: provider.model,
        system,
        messages,
        temperature
      });

      await logRequest({
        userId,
        provider: provider.key,
        model: result.model,
        latencyMs: Date.now() - startedAt,
        status: 'ok'
      });

      return { ...result, provider: provider.key };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      failures.push(`${provider.key}: ${error.message}`);
      await logRequest({ userId, provider: provider.key, model: provider.model, latencyMs, status: 'error', error });
      console.warn(`فشل المزوّد ${provider.key}: ${error.message}`);
    }
  }

  const error = new Error(`تعذّر الوصول لأي مزوّد ذكاء اصطناعي. آخر خطأ: ${failures.at(-1) || 'غير معروف'}`);
  error.code = 'PROVIDERS_FAILED';
  error.failures = failures;
  throw error;
}

