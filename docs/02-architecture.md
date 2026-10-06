# 02 — المعمارية العامة

## خريطة الطبقات

```
المتصفح (HTML + CSS + JS خفيف في public/js/)
   │  GET صفحات  /  POST نماذج (Forms) — بلا JSON API للواجهة
   ▼
server.js — نقطة التجميع الوحيدة
   │  helmet + cors + trust-proxy + dotenv + تشخيص ENV
   │  attachAccount (كل طلب يعرف صاحبه) + requireSameOrigin (CSRF)
   ▼
src/routes/*.js — 8 مسارات، كل مسار: تحقق → خدمة → View
   │  auth · chat · journey · workspace · defense · payments · notifications · admin
   ▼
src/services/*.js — منطق العمل الحقيقي (25 خدمة)
   │  ai · tokens · chat · supervisor-* · literature · journey · workspace
   │  files · documents · library* · payments · plans · access · users
   │  settings · dashboard · notifications · firebase · spreadsheet
   ▼
src/db/client.js — Pool واحد مشترك (max 10)
   ▼
PostgreSQL — ~20 جدولاً (انظر 03-database)
```

## دورة طلب نموذجية (رسالة للمشرفة — المحادثة كأداة في مساحة العمل)

```
1. POST /chat → requireAccount (وإلا → /login?next=/chat)
2. chatRouter يستخرج { prompt, conversationId, fileIds }
3. chat.js:
   a. يجلب profile + conversation + history(20)
   b. buildSupervisorContext() → حقائق من DB (خطوات/ذاكرة/ملفات/انقطاع/strikes + هدف الملف وحالة تقدّمه)
   c. literatureToolFor() → هل يريد مراجع؟ (ممنوع في خطوة topic حتى اكتمال المشكلة) ابحث في Crossref/OpenAlex + مكتبة المنصة
   d. estimateReservation() → deductCredits() ذرّياً (وإلا رفض «رصيد غير كافٍ»)
   e. buildSystemPrompt(ctx) → runSupervisor() → السباق المموّه
   f. stripStrikeTag() → addStrike() إن وُجد الوسم
   g. حفظ رسالتين + تسوية chargeUsage() + refund الفرق + logUsage()
   h. تلخيص الجلسة السابقة إن بدأت جديدة (على حساب المنصة)
4. الرد: صفحة HTML محدثة (SSR) — لا JSON
```

## خريطة المجلدات

| المسار | الدور | أهم ما فيه |
|---|---|---|
| `server.js` | التجميع والإقلاع | helmet/CSP، trust proxy، ENV check، تركيب الـ routers، معالج أخطاء عام، إغلاق نظيف |
| `api/index.js` | مدخل Vercel | `export default app` — يعيد استخدام نفس التطبيق بلا خادم منفذ |
| `src/constants.js` | الثوابت الوحيدة | الباقات/الأدوار/الخدمات/الصلاحيات/التسعير/العملات/طرق الدفع/حدود الرفع |
| `src/data/research-paths.js` | مسارات الدرجات | 5 مسارات (بكالوريوس/ماجستير/دكتوراه/دبلوم/مستقل) — بذرة + سقوط آمن |
| `src/db/` | البيانات | `client.js` اتصال، `init.js` مخطط، `seed.js` بذرة، `errors.js` رسائل عربية |
| `src/auth/google.js` | OAuth + جلسات | بناء رابط جوجل، تبديل code، جلب profile، كوكي HMAC |
| `src/middleware/` | الحراسة | `auth.js` (الحساب/البوابات) + `security.js` (المعدل/CSRF/التزامن) |
| `src/routes/` | المسارات | 8 ملفات — نحيفة: تحقق ثم خدمة ثم View |
| `src/services/` | المنطق | 25 خدمة — هنا 90% من الذكاء الحقيقي (`step-review.js` مراجعة اكتمال الخطوة حتمياً) |
| `src/views/` | العرض | 13 ملف SSR — `layout.js` (1948 سطراً) هو الهيكل، والبقية صفحات |
| `public/js/` | سلوك المتصفح | `app-shell.js` + `file-picker.js` + `chat-auto-scroll.js` + `push-notifications.js` |
| `storage/` | ملفات الباحثين | `users/{id}/files/` + `library/` — غير متتبع في git |
| `scripts/` | الأدوات | `doctor` + `smoke` + `unit-tests` + `set-admin` + `verify-dashboard` + `check-deploy-env` |

## مبادئ التقسيم

1. **Routes نحيفة**: لا SQL في المسارات أبداً — تستدعي خدمة وتختار View.
2. **Services سمينة**: كل SQL والمنطق هنا، وكل واحدة تشرح فلسفتها في ترويسة الملف.
3. **Views غبية**: تستقبل بيانات جاهزة وتُخرج HTML — لا استعلامات.
4. **Constants مرجع واحد**: أي نص/سعر/صلاحية يتكرر في مكانين يُنقل إلى `constants.js`.
5. **سقوط آمن إجباري**: كل قراءة خارجية (DB/AI/مصادر) لها `try/catch` وقيمة افتراضية — الصفحة لا تموت بخطأ مصدر واحد.
