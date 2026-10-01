import { pool } from '../db/client.js';
import { TOKEN_RATES, priceMultiplier } from '../constants.js';

/**
 * تسعير واستهلاك رصيد الباحث (السعر صار متغيّراً بحسب الاستهلاك الفعلي).
 *
 * المسار في كل رسالة:
 *   1) حجز:  estimateReservation() → deductTokens()  (يتركّب مع شرط الرصيد)
 *   2) نداء:  runSupervisor() يرجع usage الحقيقي من المزوّد
 *   3) تسوية: chargeUsage() يحسب الفعلي، والفرق يُردّ بـ refundTokens()
 *   4) فشل:  refundTokens() تردّ الحجز كاملة ولا يُكتب anything للباحث.
 *
 * كل خطوة ذرّية في جملة SQL واحدة (UPDATE … WHERE balance >= x) فلا يمكن
 * أن يخصم رصيداً سالباً مع رسالتين متزامنتين.
 */

/** تقدير النقاط من النص: العربية/الإنجليزية ≈ ٢.٦ حرفاً للنقطة. */
export function estimateTokens(text) {
  const length = String(text || '').length;
  return Math.ceil(length / 2.6);
}

/**
 * الحجز المسبق: أقصى ما قد تكلّفه الرسالة = نقاط الإدخال التقديرية بسعر
 * الإدخال + سقف الرد بسعر الإخراج، مع هامش أمان صغير. كل ما يُحجز يُردّ
 * بعد الرد، فالفارق بين الحجز والفعلي لا يكلّف الباحث شيئاً.
 */
export function estimateReservation({ system = '', messages = [], replyCap = 900 } = {}) {
  const inputTokens = estimateTokens(system) + messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const inCredits = (inputTokens / 1000) * TOKEN_RATES.inputPer1k;
  const outCredits = (Number(replyCap) / 1000) * TOKEN_RATES.outputPer1k;

  return {
    credits: Math.max(1, Math.ceil((inCredits + outCredits) * TOKEN_RATES.reserveBuffer)),
    inputTokens
  };
}

/**
 * التسعير الفعلي من usage الذي يرجعه المزوّد. السعران منفصلان لأن سعر
 * الإدخال يختلف عن الإخراج؛ والمعامل يغطي التكلفة + الهامش.
 */
export function chargeUsage({ inputTokens = 0, outputTokens = 0, multiplier = priceMultiplier() } = {}) {
  const inCredits = (Number(inputTokens) / 1000) * TOKEN_RATES.inputPer1k;
  const outCredits = (Number(outputTokens) / 1000) * TOKEN_RATES.outputPer1k;

  return {
    credits: Math.max(1, Math.ceil((inCredits + outCredits) * multiplier)),
    inputTokens: Number(inputTokens) || 0,
    outputTokens: Number(outputTokens) || 0,
    multiplier
  };
}

/**
 * يوحّد أسماء حقول الاستهلاك بين المزوّدين (OpenAI/Grok مقابل Gemini).
 *
 * ملاحظة مهمة: نماذج Gemini المفكّرة (مثل 3.8-flash) تُرجع نقاط التفكير في
 * thoughtsTokenCount **خارج** candidatesTokenCount، وتحتسب على الباحث كإخراج.
 * نضمّها هنا حتى لا نحتسب 10% فقط من الاستهلاك الفعلي.
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return { inputTokens: 0, outputTokens: 0 };

  // OpenAI/Grok: { prompt_tokens, completion_tokens }
  // Gemini:     { promptTokenCount, candidatesTokenCount, thoughtsTokenCount }
  const inputTokens = Number(usage.prompt_tokens ?? usage.promptTokenCount ?? usage.input_tokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.output_tokens ?? 0);
  const thoughts = Number(usage.thoughtsTokenCount ?? usage.thoughts_token_count ?? 0);

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: (Number.isFinite(outputTokens) ? outputTokens : 0) + (Number.isFinite(thoughts) ? thoughts : 0)
  };
}

/** يخصم رصيداً بحدّ أدنى من الرصيد: ذرّي تماماً. false = رصيد غير كافٍ. */
export async function deductCredits(userId, credits) {
  const amount = Math.max(0, Math.ceil(Number(credits) || 0));
  if (!amount) return true;

  const { rows } = await pool.query(
    `UPDATE users SET tokens_balance = tokens_balance - $2, tokens_used = tokens_used + $2
      WHERE id = $1 AND tokens_balance >= $2
      RETURNING tokens_balance`,
    [userId, amount]
  );

  return rows.length > 0;
}

/** يردّ رصيداً (فرق الحجز، أو كامل الحجز عند فشل المزوّدين). */
export async function refundCredits(userId, credits) {
  const amount = Math.max(0, Math.ceil(Number(credits) || 0));
  if (!amount) return;

  await pool.query(
    'UPDATE users SET tokens_balance = tokens_balance + $2, tokens_used = GREATEST(tokens_used - $2, 0) WHERE id = $1',
    [userId, amount]
  );
}

/**
 * تسجيل الاستهلاك بتفصيله: نقاط الإدخال/الإخراج + المزوّد + النموذج + معامل
 * السعر. هذا هو السجل الذي نحتاجه لأي اعتراض من العميل عن الفاتورة.
 * يفشل بصمت حتى لا يعطّل الرد.
 */
export async function logUsage(userId, {
  type,
  tokens = 0,
  inputTokens = null,
  outputTokens = null,
  provider = null,
  model = null,
  multiplier = null,
  summary = ''
}) {
  try {
    await pool.query(
      `INSERT INTO usage_logs
         (user_id, type, tokens_used, summary, input_tokens, output_tokens, provider, model, price_multiplier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        type,
        Number(tokens) || 0,
        String(summary || '').slice(0, 500) || null,
        inputTokens,
        outputTokens,
        provider,
        model,
        multiplier
      ]
    );
  } catch (error) {
    console.warn(`تعذّر تسجيل الاستهلاك: ${error.code || error.message}`);
  }
}

/** رصيد الباحث الحالي (لرسالة الرفض قبل الإرسال). */
export async function balanceOf(userId) {
  const { rows } = await pool.query('SELECT tokens_balance FROM users WHERE id = $1', [userId]);
  return Number(rows[0]?.tokens_balance || 0);
}
