# 14 — التشغيل والنشر: من الصفر للإنتاج

## 1. المتطلبات
Node.js 20+ + PostgreSQL 14+ (+ مفاتيح AI ومفاتيح جوجل للإنتاج).

## 2. الإقلاع المحلي (5 أوامر)

```bash
npm install
cp .env.example .env            # ثم عدّل DATABASE_URL و GOOGLE_* ومفتاح AI واحداً على الأقل
npm run db:up                   # أو: sudo service postgresql start
npm run db:reset                # init + seed
npm run dev                     # node --watch server.js → http://localhost:3000
```

## 3. السكربتات — `package.json`
| الأمر | ماذا يفعل؟ |
|---|---|
| `dev` / `start` | تطوير (watch) / إنتاج |
| `db:init/seed/reset/setup/up/down` | تهيئة/بذرة/إعداد النظام/دوكر |
| `doctor` | فحص شامل (ENV + DB + AI + تخزين) — أول ما يُشغَّل عند عطل |
| `test:unit` / `smoke:phase1` | اختبارات الوحدة (تسعير/بصمة/عربي) + دخان المسارات |
| `set-admin` | منح دور مدير لبريد (`ADMIN_EMAILS` أسرع منه) |
| `verify:dashboard` / `check:deploy` | التحقق من الإحصاءات / من متغيرات النشر |
| `storage:clean` / `fonts:fetch` | تنظيف اليتامى / جلب الخطوط محلياً |

## 4. متغيرات البيئة (الكاملة في `.env.example`)
- **إلزامية إنتاجاً**: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_TOKEN`, `APP_BASE_URL`, `SITE_URL`, `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID/SECRET`.
- **الذكاء**: `OPENROUTER_API_KEYS` (فواصل) / `GEMINI_API_KEY(+_FALLBACK)` / `GROQ_API_KEY` / `GROK_API_KEY` + `AI_HEDGE_MS/AI_*_COOLDOWN/AI_MAX_TOKENS/AI_TIMEOUT_MS/AI_PRICE_MULTIPLIER`.
- **المراجع**: `UNPAYWALL_EMAIL` + `SEMANTIC_SCHOLAR_API_KEY` (اختياري).
- **التخزين**: `MAX_UPLOAD_MB/MAX_STORAGE_MB` (fallback — الحقيقي في اللوحة).
- **الشبكة**: `TRUST_PROXY` (عدد الوكلاء — لا `true` أبداً) + `SUPPORT_WHATSAPP` + `SITE_URL`.

## 5. النشر على Vercel
- `api/index.js` يُصدّر نفس `app` (لا منفذ)، و`vercel.json` يضبط الذاكرة/المهلة.
- أضف كل ENV في لوحة Vercel (Production) ثم أعد النشر — القيم بعد النشر لا تدخل فيه (رسالة التشخيص تكشف ذلك بالأسماء).
- **التخزين**: نظام ملفات Vercel للقراءة فقط — الرفع يتعطل برسالة عربية (`isEphemeralStorage`). للإنتاج الحقيقي: قرص دائم (VPS) أو S3.
- قاعدة مستضافة `?sslmode=require` + `SESSION_SECRET/ADMIN_TOKEN` قويان + `TRUST_PROXY=1`.

## 6. استكشاف الأخطاء
| العرض | السبب والحل |
|---|---|
| `ECONNREFUSED 5432` | لا PostgreSQL — `npm run db:up` أو صحح `DATABASE_URL` |
| `password authentication failed` | كلمة `DATABASE_URL` لا تطابق المستخدم |
| `NO_PROVIDER` / شات لا يرد | لا مفتاح AI — أضف واحداً على الأقل |
| `كل المزوّدين متوقفون` | تهدئة بعد 401/402/429 — اشحن المفتاح وانتظر 10 دقائق (يعود وحده) |
| `EADDRINUSE` | نسختان تعملان — `lsof -ti tcp:3000 \| xargs kill` أو `PORT=3001 npm run dev` |
| `nodemon not found` | أُزيل nodemon — `dev` يعمل بـ `node --watch` المدمج |
| 403 POST بجلسة | CSRF — أرسل من نفس الأصل (Origin) |
| 429 رفع | سقف التزامن/المعدل — انتظر 30 ثانية |

## 7. النسخ الاحتياطي
`pg_dump $DATABASE_URL > backup.sql` للقاعدة + نسخ مجلد `storage/` للملفات — الاثنان معاً (الميتاداتا بلا بايتات = روابط ميتة).
