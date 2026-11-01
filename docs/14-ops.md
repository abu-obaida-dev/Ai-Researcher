# 14 — Operations and Deployment: From Zero to Production

## 1. Requirements
Node.js 20+ + PostgreSQL 14+ (+ AI keys and Google keys for production).

## 2. Local startup (5 commands)

```bash
npm install
cp .env.example .env            # Then set DATABASE_URL, GOOGLE_*, and at least one AI key.
npm run db:up                   # Or start PostgreSQL with: sudo service postgresql start
npm run db:reset                # init + seed
npm run dev                     # node --watch server.js → http://localhost:3000
```

## 3. Scripts — `package.json`
| Command | What it does |
|---|---|
| `dev` / `start` | Development (watch) / production |
| `db:init/seed/reset/setup/up/down` | Initialize/seed/reset/setup/Docker |
| `doctor` | Full check (ENV + DB + AI + storage) — run first when troubleshooting |
| `test:unit` / `smoke:phase1` | Unit tests (pricing/fingerprint/Arabic) + route smoke tests |
| `set-admin` | Grant administrator role to an email (`ADMIN_EMAILS` is faster) |
| `verify:dashboard` / `check:deploy` | Verify analytics / deployment variables |
| `storage:clean` / `fonts:fetch` | Clean orphans / fetch fonts locally |

## 4. Environment variables (full list in `.env.example`)
- **Required in production**: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_TOKEN`, `APP_BASE_URL`, `SITE_URL`, `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID/SECRET`.
- **AI**: `OPENROUTER_API_KEYS` (comma-separated) / `GEMINI_API_KEY(+_FALLBACK)` / `GROQ_API_KEY` + `AI_HEDGE_MS/AI_*_COOLDOWN/AI_MAX_TOKENS/AI_TIMEOUT_MS/AI_PRICE_MULTIPLIER`.
- **References**: `UNPAYWALL_EMAIL` + `SEMANTIC_SCHOLAR_API_KEY` (optional).
- **Firebase web**: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, and `FIREBASE_MEASUREMENT_ID` configure browser notifications and Analytics on public pages. These web configuration values are public; restrict the API key by HTTP referrer in Firebase/Google Cloud settings. Push delivery additionally requires the Web Push `FIREBASE_VAPID_KEY` and a server-only service-account key. For local development, store the JSON in the Git-ignored `.secrets/` directory and set `FIREBASE_SERVICE_ACCOUNT_FILE=./.secrets/firebase-service-account.json`; never commit it.
- **Storage**: `MAX_UPLOAD_MB/MAX_STORAGE_MB` (fallback — actual values are managed in the dashboard).
- **Network**: `TRUST_PROXY` (number of proxies — never `true`) + `SUPPORT_WHATSAPP` + `SITE_URL`.

## 5. Deploying to Vercel
- `api/index.js` exports the same `app` (no port), and `vercel.json` configures memory/timeout.
- Add all ENV values in the Vercel dashboard (Production), then redeploy — post-deployment changes are not included in the running deployment (the diagnostic message reports their names).
- **Storage**: Vercel's filesystem is read-only — uploads fail with an Arabic message (`isEphemeralStorage`). For real production use: persistent disk (VPS) or S3.
- Use a hosted database with `?sslmode=require` + strong `SESSION_SECRET/ADMIN_TOKEN` + `TRUST_PROXY=1`.

## 6. Troubleshooting
| Symptom | Cause and fix |
|---|---|
| `ECONNREFUSED 5432` | PostgreSQL is not running — use `npm run db:up` or correct `DATABASE_URL` |
| `password authentication failed` | The password in `DATABASE_URL` does not match the user |
| `NO_PROVIDER` / chat does not respond | No AI key — add at least one |
| `كل المزوّدين متوقفون` | Cooldown after 401/402/429 — replenish the key and wait 10 minutes (it recovers automatically) |
| `EADDRINUSE` | Two instances are running — `lsof -ti tcp:3000 \| xargs kill` or `PORT=3001 npm run dev` |
| `nodemon not found` | nodemon was removed — `dev` uses built-in `node --watch` |
| 403 POST with a session | CSRF — send the request from the same origin |
| 429 upload | Concurrency/rate limit — wait 30 seconds |

## 7. Backups
`pg_dump $DATABASE_URL > backup.sql` for the database + copy the `storage/` directory for files — both are required (metadata without bytes means dead links).
