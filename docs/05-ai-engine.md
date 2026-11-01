# 05 — AI Engine: Hedged Race and Real Pricing

## The idea
The site must respond even when a particular provider is busy or a particular key has run out of credit—without a restart and without making the researcher pay for a failure.

## 1. Providers and order — `src/services/ai.js`
`Groq → OpenRouter → Gemini → Gemini fallback` — each provider reads its keys from `NAME_API_KEYS` (comma-separated) or `NAME_API_KEY`, and each (provider × key) is an **independent target** in the race.

## 2. Three lines of defense
1. **Switching models within a provider**: `AI_MODEL_*` lists are tried in order—congestion on a model (503) does not mean the provider is down (real example: 3.8 and 3.7 were congested while 3.6 responded immediately).
2. **Hedged race (Hedged)**: the first request starts immediately, and the next starts after `AI_HEDGE_MS` (3500ms) if the first has not responded—or immediately if it fails. The first successful response wins, and the others are cancelled (`AbortController`) to avoid spending credit on a discarded response.
3. **Temporary removal from rotation**: temporary failure (429/5xx) → cooldown for `AI_COOLDOWN_MIN`; permanent failure (401/402/403) → `AI_HARD_COOLDOWN_MIN`, not forever—the provider returns automatically after its account is funded.

## 3. Logging and transparency
Every attempt (successful/failed) is recorded in `ai_requests`, and the interface displays only the names of enabled providers and their key counts—**keys are never exposed in the browser**.

## 4. Pricing: reserve → call → settle — `src/services/tokens.js`
- `TOKEN_RATES`: input 5 / thousand, output 20 / thousand, reservation margin 1.08, and `AI_PRICE_MULTIPLIER` for cost + margin.
- `estimateReservation()`: (estimated input × input rate + response limit × output rate)—the estimate is 2.6 Arabic characters per token.
- `deductCredits()`: atomic `UPDATE … WHERE balance >= x`—two concurrent messages cannot create a negative balance.
- `chargeUsage(normalizeUsage(usage))`: actual usage from the provider—with `thoughtsTokenCount` included for Gemini's thinking tokens (otherwise we would count only 10%!).
- `refundCredits()`: the difference after the response, or the full amount if all providers fail.
- `logUsage()`: full details in `usage_logs`—fails silently so it does not interrupt the response.
- **The response limit varies by message:** 900 tokens normally, rising to 1400 (the defense-session limit) if the response contains reference results or attachments. The maximum reservation rises accordingly, and this appears on the invoice even when the message is “normal.”
- **No direct charge for references:** reference-tool searches are logged under `sources` at zero tokens, but their results injected into the supervisor's message increase input usage and are implicitly priced as part of that message.

## 5. Input budget — `src/services/payload-budget.js`
A hedged race without a budget means throwing credit at requests the provider rejects for being too large. A size guard runs before sending:

- **Per-model budget** (`MODEL_INPUT_BUDGETS`): `openai/gpt-oss-20b` = 4000 tokens · `qwen/qwen3.8-27b` = 3600 · `allam-2-7b` = 2800—and all are safely below Groq's actual limits (TPM 8000 / ITPM 7000 / context 4096). An unknown model gets the narrowest known budget.
- **Truncation order** (least harmful first): ① **file** text (data) ② older messages in the history (the last message—the researcher's question—is untouched) ③ remove complete `<file>` blocks (well-formed tags) ④ truncate the system prompt from the middle—not from the end, because the end of the examiner's prompt contains its instructions.
- **Retry within the provider:** a length error (413/400-length) retries the **same model** with a stricter budget (×0.6) instead of switching to another model with the same size.
- **Distinguishing 413-length from 413-rate-limit:** a 413 from Groq may be ITPM (per-minute quota)—it is **not** a length error, and tightening the budget will not fix it. It is classified as `quota` there → temporary cooldown, while 413-length → no cooldown (permanent for this payload).
- **Text limit in defense mode:** `MAX_FILE_CHARS_DEFENSE` = 6000 characters (instead of 12000 in guidance mode)—because the examiner's prompt is heavier than the tutor's prompt.
