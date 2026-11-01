/** Provider orchestration with model fallback, hedged requests, and cooldowns. */

import { budgetForModel, trimPayloadToBudget } from './payload-budget.js';

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);
// Keep responses short to reduce provider cost and credit-limit failures.
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || 4000);
// Retry transient provider failures only.
const RETRIES = Number(process.env.AI_RETRIES || 1);
// Start the next target after this delay if the current one is still pending.
const HEDGE_MS = Number(process.env.AI_HEDGE_MS || 3500);
// Cooldown after transient provider errors.
const COOLDOWN_MIN = Number(process.env.AI_COOLDOWN_MIN || 10);
// Permanent configuration or billing errors use a bounded cooldown.
const HARD_COOLDOWN_MIN = Number(process.env.AI_HARD_COOLDOWN_MIN || 10);
const hardCooldownMs = HARD_COOLDOWN_MIN * 60000;

// Do not retry permanent errors; oversized payloads proceed to trimming.
const HARD_STATUS = new Set([400, 401, 402, 403, 404, 413, 422]);

/** Per-process provider and target cooldown state. */
const HEALTH = new Map();

/** Provider model fallback order. */
export function modelsFor(provider) {
  return Array.isArray(provider.models) ? [...provider.models] : [];
}

/** Classifies provider failures; full response text helps distinguish quota and payload errors. */
export function classifyFailure(status, message, body = '') {
  const text = `${String(message || '')} ${String(body || '')}`;
  // Prefer explicit status codes before inspecting error text.
  if (status === 401) return { kind: 'auth', hard: true, reason: 'مفتاح غير صالح', cooldownMs: hardCooldownMs };
  if (status === 402) return { kind: 'credits', hard: true, reason: 'لا يوجد رصيد عند المزوّد', cooldownMs: hardCooldownMs };
  if (status === 403) return { kind: 'license', hard: true, reason: 'لا صلاحية/ترخيص على الحساب', cooldownMs: hardCooldownMs };
  if (status === 404) return { kind: 'model', hard: true, reason: 'اسم النموذج غير متاح', cooldownMs: hardCooldownMs };
  if (status === 429) return { kind: 'quota', reason: 'تجاوز الحصة أو حدّ المعدّل', cooldownMs: COOLDOWN_MIN * 60000 };
  if (status === 503 || status === 502 || status === 500) {
    return { kind: 'busy', reason: 'المزوّد مزدحم حالياً', cooldownMs: Math.max(30000, (COOLDOWN_MIN * 60000) / 6) };
  }
  // Groq may use 413 for a rate quota rather than an oversized payload.
  if (status === 413 && /rate_limit|tokens per minute|ITPM|TPM|too many requests/i.test(text)) {
    return { kind: 'quota', reason: 'تجاوز حدّ المعدّل عند المزوّد (413/ITPM)', cooldownMs: COOLDOWN_MIN * 60000 };
  }
  // Input-length errors are request-specific and must not cool down the provider.
  if (
    status === 413 ||
    /reduce the length|too long|too_large|maximum context|context_length|max_tokens/i.test(text)
  ) {
    return { kind: 'length', hard: false, reason: 'الحمولة أطول من حدّ النموذج', cooldownMs: 0 };
  }
  return { kind: 'other', reason: String(message || '').slice(0, 120), cooldownMs: COOLDOWN_MIN * 60000 };
}

/** Applies a cooldown after provider failure. */
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

/** Checks whether a provider is currently cooling down. */
function isUnhealthy(key) {
  const entry = HEALTH.get(key);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    HEALTH.delete(key);
    return false;
  }
  return true;
}

/** Provider labels used by the UI and reports. */
export const PROVIDER_LABELS = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
  gemini: 'Gemini',
  'gemini-fallback': 'Gemini احتياطي'
};

/** Reads provider keys from the plural variable, with a singular fallback. */
function keysOf(provider) {
  const raw = process.env[`${provider.envKey}S`] ?? process.env[provider.envKey] ?? '';
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Creates independent race targets for every configured provider key. */
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

/** Reports provider and per-key health. */
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

/** Retries transient fetch failures only. */
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
      // Preserve the status for classification and payload-trimming retries.
      lastError.status = response.status;
    } catch (error) {
      lastError = error;
    }

    // Do not retry permanent authentication, billing, or model errors.
    if (HARD_STATUS.has(lastStatus)) break;
    if (attempt < RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  throw lastError;
}

/** Provider error carrying its HTTP status for classification. */
function providerError(label, status, body) {
  const raw = String(body || '');
  const error = new Error(`${label} ${status}: ${raw.slice(0, 200)}`);
  error.status = status;
  // Keep the full body to distinguish quota errors from oversized payloads.
  error.body = raw.slice(0, 4000);
  // Groq may use 413 for a rate quota rather than an oversized payload.
  if (
    status === 413 &&
    /rate_limit|tokens per minute|ITPM|TPM|too many requests/i.test(error.body)
  ) {
    error.rateLimited = true;
  }
  return error;
}

/** Parses the configured model fallback list. */
function modelList(raw, fallback) {
  const list = String(raw || fallback || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : ['gpt-4o-mini'];
}

/** Sends one request to a specific provider model. */
async function callOnce({ label, url, headers, body, model, signal }) {
  const response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, label, signal);
  if (!response.ok) throw providerError(label, response.status, await response.text());
  return response.json();
}

/** Provider definitions and ordered model fallbacks. */
export const PROVIDERS = [
  {
    key: 'groq',
    envKey: 'GROQ_API_KEY',
    // Exclude audio and classifier models from text generation.
    models: modelList(process.env.AI_MODEL_GROQ, 'openai/gpt-oss-20b,qwen/qwen3.8-27b,allam-2-7b'),
    async call({ apiKey, models, system, messages, temperature, maxTokens = MAX_TOKENS, signal = null }) {
      // Trim requests to each model's input budget and retry length failures with smaller payloads.
      const failures = [];
      // Track failure categories for aggregate classification.
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
            // Retry payload-length failures with a smaller request.
            const isLength =
              error?.status === 413 ||
              /reduce the length|too long|maximum context|context_length|\b413\b/i.test(String(error?.message || ''));
            // Rate-quota 413 errors are transient and should not trigger further trimming.
            const isRateLimit = Boolean(error?.rateLimited);
            // Preserve each failure category for aggregate classification.
            failures.push(`${model}: ${String(error?.message || error).slice(0, 90)}`);
            failureKinds.push(isRateLimit ? 'rate_limit' : isLength ? 'length' : 'other');
            if (isLength && !isRateLimit && attempt < 2) {
              // Preserve the prompt and question while trimming attached file text.
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
      // Classify all-model failures from recorded categories, not message text.
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


/** Probes a provider directly for diagnostics. */
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
        // Stop after the first working key unless per-key diagnostics are requested.
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

    // One healthy key is sufficient for the provider to be available.
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

/** Returns configured providers and their key counts. */
export function availableProviders() {
  const only = String(process.env.AI_ONLY_PROVIDER || '').trim().toLowerCase();
  const list = only ? PROVIDERS.filter((provider) => provider.key === only) : PROVIDERS;
  return list.filter((provider) => keysOf(provider).length).map((provider) => ({
    key: provider.key,
    models: modelsFor(provider),
    keyCount: keysOf(provider).length
  }));
}

/** Checks whether at least one provider is configured. */
export function hasProvider() {
  return availableProviders().length > 0;
}

/** Records a provider attempt without affecting the response. */
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

/** Races provider-key targets and returns the first successful response. */
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
    // Retry once without cooldown filtering in case a prior failure has recovered.
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

  // Resolve when the first target succeeds while later targets can still launch.
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

  // Launch targets progressively, immediately advancing when one fails.
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

      // Cool down only the failing key, not its provider's other keys.
      markUnhealthy(target.id, classifyFailure(error.status, error.message, error.body));
      failures.push(`${target.id}: ${String(error?.message || error).slice(0, 300)}`);
      await logRequest({ userId, provider: provider.key, model: (target.models || provider.models)[0], latencyMs: Date.now() - startedAt, status: 'error', error });
      console.warn(`فشل ${target.id}: ${String(error.message).slice(0, 120)}`);

      failed += 1;
      // Fail only after every target has been attempted.
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
