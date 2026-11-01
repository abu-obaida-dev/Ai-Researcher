# 10 — Plans and Manual Payments

## 1. Plans — `services/plans.js`
- Source: `plans`: `code/title/price/tokens/storage_mb/period/cta/popular/role_code/features`.
- **Features are generated from actual permissions** by `decoratePlans()`: each service available to the plan's role is listed, along with the quota and administrator-added features. The interface therefore never promises access the role does not actually grant.
- `freeTrialTokens()`: the amount advertised across the site is read from the `free_trial` plan. An administrator can change it, and the change takes effect immediately.
- Fallback: `fallbackPlans()` from `DEFAULT_PLANS` — the landing page works without a DB.

## 2. Quotas
- Storage: `plans.storage_mb` per plan (from `/admin/plans`) → `planStorageBytes()` → enforced during uploads. `MAX_STORAGE_MB` is fallback only.
- Points: `tokens` per plan + `FREE_TRIAL_TOKENS` for new users. (Terminology: the interface says “points,” while the database uses `tokens_*` — they mean the same thing; see `03`.)

## 3. Manual payments — `services/payments.js`
- Designed for practical payment methods: bank transfer, wallet, or cash office. Administrators configure the methods in `payment_methods` (code/name/note/details/currency/active).
- Researcher: selects a plan and method → enters the amount and transaction number → request is `pending` (up to 5 pending requests per researcher).
- **The price is taken from `plans` at the time of the request** — it is not sent by the browser.
- Administrator: `confirmPaymentRequest` runs in **one atomic transaction** (request confirmed + plan + points + `payment_confirmed` log) — all or nothing. `rejectPaymentRequest` adds a note without making any other changes.
- Currency: `LYD` by default (`USD` as an alternative), from `settings.site_currency`.
