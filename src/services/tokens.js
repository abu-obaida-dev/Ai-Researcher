import { pool } from '../db/client.js';
import { TOKEN_RATES, priceMultiplier } from '../constants.js';

/** Reserves credits before provider calls and settles against actual usage atomically. */

/** Estimates tokens from text length. */
export function estimateTokens(text) {
  const length = String(text || '').length;
  return Math.ceil(length / 2.6);
}

/** Reserves the maximum estimated cost; unused credits are refunded after the response. */
export function estimateReservation({ system = '', messages = [], replyCap = 900 } = {}) {
  const inputTokens = estimateTokens(system) + messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const inCredits = (inputTokens / 1000) * TOKEN_RATES.inputPer1k;
  const outCredits = (Number(replyCap) / 1000) * TOKEN_RATES.outputPer1k;

  return {
    credits: Math.max(1, Math.ceil((inCredits + outCredits) * TOKEN_RATES.reserveBuffer)),
    inputTokens
  };
}

/** Calculates the charge from provider-reported input and output usage. */
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

/** Normalizes provider usage fields, including Gemini thought tokens. */
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

/** Atomically deducts credits only when the balance is sufficient. */
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

/** Refunds unused or failed-request reservations. */
export async function refundCredits(userId, credits) {
  const amount = Math.max(0, Math.ceil(Number(credits) || 0));
  if (!amount) return;

  await pool.query(
    'UPDATE users SET tokens_balance = tokens_balance + $2, tokens_used = GREATEST(tokens_used - $2, 0) WHERE id = $1',
    [userId, amount]
  );
}

/** Records detailed usage for billing review; logging failures do not block responses. */
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

/** Returns the current account balance. */
export async function balanceOf(userId) {
  const { rows } = await pool.query('SELECT tokens_balance FROM users WHERE id = $1', [userId]);
  return Number(rows[0]?.tokens_balance || 0);
}
