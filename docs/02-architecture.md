# 02 — Overall Architecture

## Layer Map

```
Browser (HTML + CSS + lightweight JS in public/js/)
   │  GET pages  /  POST forms — no JSON API for the interface
   │  (One exception: chat submission accepts Accept: application/json for partial updates without reloading)
   ▼
server.js — the single assembly point
   │  helmet + cors + trust-proxy + dotenv + ENV diagnostics
   │  attachAccount (every request knows its owner) + requireSameOrigin (CSRF)
   ▼
src/routes/*.js — 8 routes, each: validate → service → View
   │  auth · chat · journey · workspace · defense · payments · notifications · admin
   ▼
src/services/*.js — actual business logic (26 services)
   │  ai · tokens · chat · assistant · supervisor-* · literature · journey · workspace
   │  files · documents · library* · payments · plans · access · users
   │  settings · dashboard · notifications · firebase · spreadsheet
   ▼
src/db/client.js — one shared Pool (max 10)
   ▼
PostgreSQL — ~20 tables (see 03-database)
```

## Typical Request Flow (A Message to the Supervisor — Conversation as a Workspace Tool)

```
1. POST /chat → requireAccount (otherwise → /login?next=/chat)
2. chatRouter extracts { prompt, conversationId, fileIds }
3. chat.js:
   a. fetches profile + conversation + history(20)
   b. buildSupervisorContext() → facts from DB (steps/memory/files/absence/strikes + profile goal and progress status)
   c. literatureToolFor() → does the researcher want references? (blocked at the topic step until the problem is complete) Search Crossref/OpenAlex + platform library
   d. estimateReservation() → deductCredits() atomically (otherwise reject “رصيد غير كافٍ”)
   e. buildSystemPrompt(ctx) → runSupervisor() → the masked race
   f. stripStrikeTag() → addStrike() if the tag is present
   g. save two messages + settle chargeUsage() + refund the difference + logUsage()
   h. summarize the previous session if a new one has started (at the platform’s expense)
4. Response: updated HTML page (SSR) — no JSON
```

## “The Tutor” — Independent Learning Assistant (/assistant)

POST /assistant route (dedicated tables: `assistant_conversations` / `assistant_messages` — does not touch the supervisor or the journey):

1. assistant.js: sanitize the input + load the text of attached files (verify ownership).
2. `detectAssistantTask()` deterministically classifies the task as **teaching** (structures the researcher’s work) · **translation** (an uploaded file) · or **summarization**.
3. For summarization: the code-driven search layer searches the platform library first, then **all** sources in order (Crossref → OpenAlex → Semantic → arXiv → EuropePMC → DOAJ → OpenLibrary → IEEE → ACM) in two batches — the tutor answers only from injected results (no fabrication).
4. `buildAssistantPrompt(task)` → the same masked race (`runSupervisor`) + the same financial discipline (reserve → call → settle → refund the difference).


## Directory Map

| Path | Role | Key Contents |
|---|---|---|
| `server.js` | Assembly and startup | helmet/CSP, trust proxy, ENV check, router mounting, general error handler, clean shutdown |
| `api/index.js` | Vercel entry point | `export default app` — reuses the same application without a listening server |
| `src/constants.js` | Single source of constants | Plans/roles/services/permissions/pricing/currencies/payment methods/upload limits |
| `src/data/research-paths.js` | Degree paths | 5 paths (undergraduate/master’s/doctoral/diploma/independent) — seed + safe fallback |
| `src/db/` | Data | `client.js` connection, `init.js` schema, `seed.js` seed, `errors.js` Arabic messages |
| `src/auth/google.js` | OAuth + sessions | Build Google URL, exchange code, fetch profile, HMAC cookie |
| `src/middleware/` | Guards | `auth.js` (account/gates) + `security.js` (rate limit/CSRF/concurrency) |
| `src/routes/` | Routes | 8 files — lightweight: validate, then call service, then render View |
| `src/services/` | Logic | 25 services — 90% of the actual intelligence lives here (`step-review.js` deterministically reviews step completion) |
| `src/views/` | Rendering | 13 SSR files — `layout.js` (1,948 lines) is the framework; the rest are pages |
| `public/js/` | Browser behavior | `app-shell.js` + `file-picker.js` + `chat-auto-scroll.js` + `push-notifications.js` |
| `storage/` | Researcher files | `users/{id}/files/` + `library/` — not tracked in git |
| `scripts/` | Utilities | `doctor` + `smoke` + `unit-tests` + `set-admin` + `verify-dashboard` + `check-deploy-env` |

## Separation Principles

1. **Keep routes lightweight:** No SQL in routes — they call a service and select a View.
2. **Keep services substantial:** All SQL and business logic live here, and each service explains its philosophy in the file header.
3. **Keep views simple:** They receive prepared data and output HTML — no queries.
4. **Maintain one source of truth for constants:** Any text, price, or permission repeated in multiple places belongs in `constants.js`.
5. **Always fail safely:** Every external read (DB/AI/sources) has a `try/catch` and a default value — a single source error must not take down the page.
