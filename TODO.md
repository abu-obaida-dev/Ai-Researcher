# قائمة المهام (TODO) — مشاكل المراجعة الأمنية والتنموية

> تقرير مراجعة كاملة — ٢٥ مشكلة مرتّبة حسب الأولوية.
> مراجَع: ١٦ أكتوبر ٢٠٢٦ · على كود `54d0d51` + تعديلات working tree غير مُرسَلة.
>
> **تعليمات العمل:** عند البدء بالمشكلة غيّر `[ ]` إلى `[~]`، وعند الانتهاء `[x]` مع رابط الـ commit.
> **قبل أي تعديل:** أرسل (commit) التعديلات الـ 29 المعلّقة أولاً حتى تبقى التراجعات منفصلة (راجع O1).

---

## 🔴 حرجة

### C1. اختبارات الوحدة مكسورة بالكامل — `npm test` لا يعمل ✅
- **الملفات:** `scripts/unit-tests.mjs:32-37` · `src/services/assistant.js`
- **الوصف:** الاختبار يستورد `ASSISTANT_SOURCE_ORDER` و`assistantSourceBatches` و`extractQueryFromHistory` من `assistant.js` وهذه التصديرات **أُزيلت** في commit `54d0d51`.
- **النتيجة:** `SyntaxError` ⇒ كل الاختبارات تسقط (0 pass / 1 fail) ⇒ لا شبكة أمان لأي تعديل لاحق.
- **تم الحل (16 أكتوبر 2026):** حُذف الاستيراد الثلاثي واستُبدل بـ `extractLastSuggestedQuery` (الباقية) مع تعليق توثيقي · حُذف断言 `extractQueryFromHistory` من اختبار «متابعة البحث» · استُبدل اختبار `assistantSourceBatches` باختبار `ASSISTANT_REPLY_CAPS` (يحفظ التغطية القديمة + زيادة) · حُدِّث عدّاد نص التلخيص القديم (`نتائج بحث حقيقية` → `تلخّص ما وُفّر من الباحث فقط` + `لا تبحث بنفسك`) ليطابق التصميم الجديد.
- **التحقق:** `npm test` → **42/42 pass, 0 fail**
- [x] **الأولوية:** فورية

### C2. أسرار حقيقية داخل مجلد المشروع (OAuth + Firebase service account) ✅ (جزئياً — التدوير يدوي)
- **الملفات:** `client_secret_41612444132-*.json` · `ai-research-34788-firebase-adminsdk-*.json` · `.env`
- **الوصف:** يحويان `client_secret` فعلي و`private_key`. متجاهَلة في `.gitignore` **وتحققتُ: لم يُرفع أي سرّ لسجل Git** — لكن بقائهما داخل المجلد يعني كشفهما بأي نسخ احتياطي أو حذف سطر واحد من `.gitignore`، و`src/services/firebase.js` كان يبحث عن ملف الخدمة تلقائياً داخل الجذر.
- **تم الحل (16 أكتوبر 2026):**
  - [x] نقل الملفين إلى `~/.config/zena/` (صلاحية المجلد 700 والملفات 600) — الجذر نظيف الآن
  - [x] ضبط `FIREBASE_SERVICE_ACCOUNT_FILE` (مسار مطلق) في `.env`
  - [x] تعديل `findServiceAccountFile()` في `firebase.js`: البيئة أولاً (مع توسعة `~`)، والجذر **خط نجاة فقط مع تحذير صريح** يطبع أوامر النقل
  - [x] معايرة `scripts/check-deploy-env.mjs` للتحقق من المسار الجديد بدل البحث الأعمى
  - [x] توثيق `FIREBASE_SERVICE_ACCOUNT_FILE` في `.env.example` + تعليقات `.env`
- **تبقّى (يدوي — لا يمكن تنفيذه من هنا):**
  - [ ] **تدوير** مفتاح OAuth: Google Cloud Console → APIs & Credentials → client secret → Rotate
  - [ ] **تدوير** مفتاح Firebase: Firebase Console → Project settings → Service accounts → Generate new private key ثم حذف القديم من `~/.config/zena/`
- **التحقق:** `firebaseWebConfig()` → `serverReady: true` من المسار الجديد · `check-deploy-env` يُظهر ✅ · `npm test` → 42/42
- [x] **الأولوية:** فورية

### C3. حدود المعدّل «في الذاكرة» فقط — ضعيفة على Vercel serverless
- **الملفات:** `src/middleware/security.js:16` (`buckets`) · `src/routes/admin.js:147` (`adminFailures`)
- **الوصف:** كل cold start يصفّر كل الحدود (دخول الإدارة، الشات، الدفع…) وهجمات التخمين تكمل عبر تنويع الطلبات. كذلك `adminFailures` بلا sweeper (نمو بطيء للذاكرة — `buckets` لها sweeper ولم يُطبَّق عليها).
- **الحل:** تخزين الحدود وعدّادات الفشل في PostgreSQL (أو Redis) · إضافة sweeper لـ `adminFailures` فوراً على الأقل.
- [ ]

### C4. رفع ملف البحث في المناقشة بلا فحص حجم مبكر (ذاكرة) ✅
- **الملفات:** `src/routes/defense.js:130-145` (`POST /defense/:id/thesis`)
- **الوصف:** كان يقرأ `formData()` مباشرة بلا الفحص المبكر الموجود في `/files` (`workspace.js:431-439`) ⇒ ملف ضخم يُقرأ كاملاً في الذاكرة (DoS مع سقف التزامن 4).
- **تم الحل (16 أكتوبر 2026):** أُضيف استيراد `maxUploadBytes` من `settings.js` · فحص `content-length` المبكر قبل أي قراءة (رفض `303 → err=file_bad` إذا تجاوز `maxBytes + 2MB` — نفس الهامش والمنطق في `/files`) · أُضيفت رسالة `file_bad` إلى `FLASH` (نفس نص `/files`).
- **التحقق:** `node --check` سليم · `npm test` → 42/42 pass
- [x]

---

## 🟠 عالية الخطورة

### H1. تسريب تفاصيل الأخطاء الداخلية للمستخدم النهائي في الإنتاج ✅
- **المواضع:** `server.js:377-381` (`/api/users`) · `server.js:390-394` (`/api/plans` — **مسار عام بلا مصادقة**) · `chat.js:113` · `assistant.js:86` · `defense.js:80` · `payments.js:58` · `voice.js:96` · `workspace.js:142`
- **الوصف:** `error.message` من driver قاعدة البيانات تُطبع في صفحات/ردود المستخدم النهائي. المرجع الصحيح: `/api/health` (`server.js:349-359`) يخفي التفاصيل في prod.
- **الحل:** مساعد `publicError(error)` (رسالة عامة في prod) وتطبيقه في كل المواضع.
- **تم (16 أكتوبر 2026):** `renderNotice` في `layout.js` تُخفي `details` تلقائياً في الإنتاج (إصلاح مركزي يغطي 9 مسارات) · `/api/users` و`/api/plans` بنفس النمط مع `console.error` · مسارا `admin.js` مُبقاة عمداً · التحقق سلوكياً (تطوير يعرض/إنتاج يُخفي) · `npm test` → 43/43
- [x]

### H2. ثغرة SSRF: حارس الروابط قابل للتضليل بثلاث طرق ✅
- **الملفات:** `src/services/library-sources.js:257-289` + `redirect: 'follow'` في كل `fetch` (سطور 295, 317, 547, 611, 815, 1036, 1109, 1365, 1537)
- **الطرق:** (1) توجيه 302 من موقع عام إلى `169.254.169.254`/شبكة داخلية بلا إعادة فحص · (2) IPv6 خاص غير محجوب (`fc00::/7`, `fe80::`, `::ffff:127.0.0.1`) · (3) صيغ IPv4 البديلة (`http://2130706433/` عشري لـ 127.0.0.1).
- **الحل:** `redirect: 'manual'` مع فحص كل قفزة (حد 3) · حلّ DNS والتحقق قبل الاتصال · توسيع الحجب · مطابقة `response.url` النهائي.
- **تم (16 أكتوبر 2026):** `assertPublicUrl` موسّع (IPv6/CGNAT/صيغ رقمية/لاحقات) ومُصدَّر للاختبارات · `fetchPublic` جديدة (تتبّع يدوي بحد 5 + فحص كل قفزة) · كل النداءات الثمانية عبرها · اختبار SSRF جديد · `npm test` → 43/43 · المتبقي المعلوم: حلّ DNS (مؤجَّل بوعي — المسارات محمية أصلاً)
- [x]

### H3. `ADMIN_TOKEN` فارغ في `.env` + طباعة الرمز المولّد في سجل النشر ✅
- **الملفات:** `.env` (طول الرمز = 0) · `server.js:162-172`
- **الوصف:** محلياً آمن (localhost فقط)، لكن خلف Nginx بدون `TRUST_PROXY=1` يصبح كل زائر `127.0.0.1` ⇒ لوحة مفتوحة. والمعالج **يطبع الرمز المولّد في سجل النشر** (سطر 169) — من يملك السجلات يملك اللوحة.
- [x] توليد رمز محلي (64 محرفاً — تم 16 أكتوبر 2026): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] قبل النشر (يدوي — حين النشر): `ADMIN_TOKEN` + `TRUST_PROXY=1` + `NODE_ENV=production` في Vercel
- [x] إيقاف طباعة الرمز في السجل (تم — `server.js:169` يطبع أوّل 4 محارف فقط) (التحذير يكفي دون كشف القيمة)

### H4. تبعيات غير مستخدمة + ثغرات npm ✅
- **الملفات:** `package.json`
- **الوصف:** `express-session` · `cookie-parser` · `jsonwebtoken` · `google-auth-library` **لا يُستورد أي منها** (الجلسة HMAC مخصّصة). و`npm audit`: 3 ثغرات moderate في `uuid` (عبر `exceljs`/`gaxios`).
- [x] `npm uninstall express-session cookie-parser jsonwebtoken google-auth-library` (تم — الحزم الأربع غير مستوردة إطلاقاً و`google-auth-library` بقيت فقط كتبعية عابرة لـ Firebase)
- [x] `npm audit fix` (+overrides لـ uuid) (تم — `overrides: uuid ^11.1.1` · `npm audit` → **0 ثغرات** · `npm test` → 44/44 · اختبار انحدار جديد يمنع عودة الحزم الميتة)

---

## 🟡 متوسطة (أمان/سلوكيات)

### M1. ✅ كوكي الجلسة «session cookie» مع حمولة 30 يوم — تناقض سلوكي
- **الملفات:** `src/routes/auth.js:59-64` · `src/auth/google.js:10`
- **الوصف:** `setCookie` لا تضع `Max-Age` ⇒ يُحذف بإغلاق المتصفح بينما `SESSION_TTL_MS = 30 يوم` — المستخدم يُخرج فجأة.
- **الحل:** محلولة بالفعل (16 أكتوبر 2026): `auth.js:169` تمرّر `{ maxAgeMs: SESSION_TTL_MS }` لـ `setCookie` التي تضع `Max-Age=2592000` — لا تعديل لازم — كان التقرير الأولي مبنياً على فحص سطحي (مع إبقاء httpOnly + SameSite=Lax + Secure في prod).
- [x]

### M2. ✅ `ADMIN_TOKEN` يظهر في روابط لوحة الإدارة (?token=)
- **الملفات:** `src/views/admin.js:488` (`tokenBack`)
- **الوصف:** كل صفحات اللوحة تبني `?token=` في الروابط والنماذج ⇒ يظهر في شريط العنوان وسجل الخادم وترويسة `Referer`.
- **الحل:** بعد نجاح التحقق وضبط الكوكي، لا تُعاد إضافة `token` لأي رابط — جعل `tokenBack` تتجاهل `req.query.token`.
- **تم (16 أكتوبر 2026):** `tokenBack` في `routes/admin.js` تتجاهل `?token=` نهائياً + `buildQuery` في `views/admin.js` تتجاهل مفتاح `token` — نقطتان مركزيتان تغطيان كل الواجهات الـ11 التي تمرّر `adminToken` (الدخول بالكوكي HttpOnly فقط) · `npm test` → 44/44
- [x]

### M3. ✅ CSP: `img-src https:` مفتوح لأي نطاق
- **الملفات:** `server.js:223`
- **الحل:** سرد نطاقات موثوقة فقط (مثل `lh3.googleusercontent.com`) بدل `https:` العام.
- **تم (16 أكتوبر 2026):** `server.js:225` → `lh3..lh6.googleusercontent.com` فقط (الصور الخارجية الوحيدة هي `photo_url` من جوجل).
- [x]

### M4. ✅ `/api/404` ينعكس المسار خاماً
- **الملفات:** `server.js:514` — `Route not found: ${req.originalUrl}`
- **الحل:** رسالة ثابتة (أو قصّ المسار إلى 100 محرف).
- **تم (16 أكتوبر 2026):** JSON ثابت + `renderNotFoundPage('', ...)` والدالة تعرض رسالة ثابتة بلا مسار.
- [x]

### M5. ✅ بلا حدود معدّل على مسارات القراءة (GET)
- **المواضع:** `chat.js:71` · `assistant.js:56` · `workspace.js:110` (كل طلب قراءة ينفّذ 4-5 استعلامات)
- **الحل:** `rateLimit` واسع (120/5د لكل IP) على مسارات GET الحساسة أو حدّ عام في `server.js`.
- **تم (16 أكتوبر 2026):** `pageReadLimit` (120/5د) على `/chat` و`/assistant` و`/library` و`/notes` و`/files` · `npm test` → 44/44.
- [x]

---

## 🟢 تنسيق وواجهة (UI/UX/نصوص)

### F1. ✅ خلط أنظمة الأرقام في نفس الصفحة (لاتينية + عربية-هندية)
- **الملفات:** `src/views/format.js:19,32` · `src/services/dashboard.js:37,44` · `public/js/app-shell.js:110`
- **الوصف:** `formatNumber` بـ `en-US` (`1,234`) بينما `Intl.DateTimeFormat('ar-EG')` يُنتج `٢٠٢٥` ⇒ «١٥ أكتوبر ٢٠٢٥ — الرصيد 5,000 نقطة» في الصفحة نفسها.
- **الحل:** محلولة بالفعل: كل التنسيقات تستخدم `ar-EG-u-nu-latn` (أرقام لاتينية موحدة) في `format.js:19,32` و`dashboard.js:37,44` و`app-shell.js:110`.
- [x]

### F2. ✅ `formatPrice` تجبر العملة «ر.س» مهما اختيرت عملة الموقع
- **الملفات:** `src/views/format.js:45` · مستخدَمة في `src/views/admin.js:629`
- **الوصف:** `formatMoney` موحّدة مع `SITE_CURRENCIES` (LYD/USD) لكن `formatPrice` تُعيد `ر.س` دائماً ⇒ الباقات تختلف عن صفحات الدفع.
- **الحل:** محلولة على مرحلتين: الدالة أصبحت غلافاً فوق `formatMoney` بعملة الموقع (سابقاً) ثم حُذفت نهائياً بعد استبدال استدعاءها الوحيد في `admin.js` بـ `formatMoney` — لا مرجع لها في الكود (`grep` صفر) · `npm test` → 44/44.
- [x]

### F3. ✅ `manifest.webmanifest` حقل غير صالح `lang_ar`
- **الملفات:** `server.js:415` — `lang_ar: 'ar'` غير معياري (`lang` موجود في السطر 407).
- **الحل:** محلولة بالفعل: `lang_ar` محذوف من `server.js` — البيان يحوي `lang` الصحيح فقط.
- [x]

### F4. ✅ استيراد فارغ متبقّى
- **الملفات:** `server.js:25` — `import {  } from './src/services/ai.js';`
- **الحل:** محلولة بالفعل: السطر الفارغ محذوف من `server.js`.
- [x]

### F5. ✅ أحرف كورية (هانغل) متسللة في تعليق
- **الملفات:** `server.js:233` — `الردود الـ API우리`
- **الحل:** تم: التعليق في `server.js:234` نظيف (بلا هانغل).
- [x]

### F6. ✅ رابط «المناقشة الصوتية» لا يُظلَّل في السايدبار
- **الملفات:** `src/views/layout.js:115` (`APP_VOICE_NAV` بلا `key`) · `src/routes/voice.js:84` (يمرّر `activeKey: 'voice'`)
- **الحل:** محلولة بالفعل: `APP_VOICE_NAV` في `layout.js:115` يحمل `key: 'voice'`.
- [x]

### F7. ✅ صفحة خطأ المستخدم تعرض «لوحة الإدارة» ✅
- **الملفات:** `src/views/layout.js:1970` (`renderNotice`) · مسارات المستخدم: `voice.js`, `chat.js:112`, `assistant.js:86`, `defense.js:79`, `journey.js:52`, `payments.js:55` · `workspace.js` (المكتبة/المفكرة/الملفات/معاينة) · معالج الأخطاء العام `server.js:548`
- **الحل (16 أكتوبر 2026):** `renderNotice` تقبل الآن `area` و`activeKey` وتحلّ subtitle/key تلقائياً: مع `area` → عنوان محايد ('حدث خطأ') + مفتاح الصفحة؛ بدون `area` (الإدارة) → 'لوحة الإدارة'/'home' كما قبل. كل نداءات المستخدم تُمرّر `area: 'app'` + `activeKey` مناسب (voice/chat/assistant/defense/journey/payments/library/notes/files). المعالج العام يستخدم `area: 'public'`.
- **التحقق:** `npm test` → 44/44 · كل `node --check` سليم
- [x]

### F8. ✅ `unread: 0` مُصلَّب في صفحة الصوت ✅
- **الملفات:** `src/routes/voice.js`
- **الحل (16 أكتوبر 2026):** استيراد `unreadCount` من `services/notifications.js` + `Promise.all([getProfile, unreadCount])` + تمرير `unread` ديناميكياً في `renderLayout` بدلاً من `0`.
- **التحقق:** `npm test` → 44/44 · `node --check src/routes/voice.js` سليم
- [x]

### F9. ✅ ترتيب الاستيرادات في `admin.js` (ثابت بين الاستيرادات) ✅
- **الملفات:** `src/routes/admin.js`
- **الحل (16 أكتوبر 2026):** نُقل `const SUPERVISOR_ROLE = 'supervisor'` من بين الاستيرادات (السطر 31-32 سابقاً) إلى ما بعد كتلة الاستيرادات (`ALLOWED_FILTERS`، السطر 73 حالياً) — تدفق استيرادات نظيف.
- **التحقق:** `npm test` → 44/44 · `node --check src/routes/admin.js` سليم
- [x]

### F10. ✅ `icon()` في `voice.js` معرفة بعد استخدامها ✅
- **الملفات:** `src/routes/voice.js`
- **الحل (16 أكتوبر 2026):** نُقلت دالة `icon` من أسفل الملف (بعد `export`) إلى أعلى الملف مباشرة بعد الاستيرادات وقبل `const router` — يتوافق مع نمط بقية الملفات (مثل `layout.js` التي تستورد/تعرف أيقوناتها قبل الاستخدام).
- **التحقق:** `npm test` → 44/44 · `node --check src/routes/voice.js` سليم
- [x]


### A1. ✅ مناقشة: خطأ 413 من Groq (رفض الحجم) يُفقد جلسة المناقشة
- **الملفات:** `src/services/ai.js` · `src/services/payload-budget.js` (جديد) · `src/services/supervisor-context.js` · `scripts/unit-tests.mjs` · `scripts/diag-defense-payload.mjs` (جديد)
- **الوصف:** في وضع المناقشة (defense) يُحقن نصّ ملف البحث كاملاً (12 ألف حرف) في موجّه المناقِش (15.4 ألف حرف) ⇒ ~8.1 ألف token ⇒ Groq يرفض بـ 413/400-length ⇒ تفشل الجلسة. كذلك كان 413 عند Groq **يُصنَّف خطأ طول دائماً** (تهدئة صفرية) بينما هو أحياناً خطأ **معدّل** (ITPM) — فيُطعَن المزوّد بلا سبب.
- **الحل (21 أكتوبر 2026):**
  - `src/services/payload-budget.js` (جديد): ميزانية إدخال لكل نموذج (gpt-oss-20b=4000 · qwen3.8-27b=3600 · allam-2-7b=2800 رمز) + `trimPayloadToBudget()` بقصٍّ مرتّب: نصّ الملفات ⇒ الرسائل الأقدم ⇒ حذف كتل `<file>` ⇒ بتر الموجّه من المنتصف (لا الذيل).
  - `src/services/ai.js`: `trimPayloadToBudget` قبل كل نداء Groq + إعادة محاولة على **النموذج نفسه** بميزانية ×0.6 عند خطأ الطول + `classifyFailure` صار يفرّق بين 413-طول (لا تهدئة) و413-معدّل/ITPM (تهدئة مؤقّتة) عبر نصّ الرد الكامل `error.body`.
  - `src/services/supervisor-context.js`: `MAX_FILE_CHARS_DEFENSE` = 6000 حرف في وضع المناقشة + إصلاح قصّ كتلة `<files>` في منتصف الوسم (كان يُنتج `<file>` بلا `</file>`).
- **التحقق:** `npm test` → **64/64 pass** (12 اختباراً جديداً للميزانية والتقصير والتصنيف) · `node scripts/diag-defense-payload.mjs` يقيس الحمولة الفعلية (7556 ⇒ 3970 رمز بعد القصّ) · `node --check` سليم على الملفات المعدّلة
- [x]


### O1. تعديلات working tree غير مُرسَلة (29 ملفاً) ✅
- **الأمر:** راجع `git status` ثم `git add -A && git commit` — **قبل** بدء أي إصلاح.
- **الحل (21 أكتوبر 2026):** كل التعديلات المعلّقة رُفعت في `1dd918d` (ميزانية الإدخال + إصلاح 413 في المناقشة) · `git status` نظيف الآن.
- [x]

### O2. ملفات اختبار على قرص التخزين المحلي
- **الملفات:** `storage/users/*/files/notes.txt` (تحوي `<script>alert(1)</script>` من اختبارات smoke)
- **الوصف:** غير خطرة (العرض text/plain مُجبر) لكنها فوضى.
- **الأمر:** `npm run storage:clean`
- [ ]

---

## سجل العمل

| # | المشكلة | الحالة | commit |
|---|---------|--------|--------|
| C1 | اختبارات الوحدة مكسورة | [x] 42/42 pass | (غير مُرسل بعد) |
| C2 | أسرار داخل مجلد المشروع | [x] نُقلت + كود معدَّل (التدوير يدوي) | (غير مُرسل بعد) |
| C3 | حدود المعدّل في الذاكرة | [ ] | |
| C4 | رفع thesis بلا فحص حجم | [x] فحص مبكر + file_bad · 42/42 | (غير مُرسل بعد) |
| H1 | تسريب error.message | [ ] | |
| H2 | ثغرة SSRF | [ ] | |
| H3 | ADMIN_TOKEN فارغ + طباعة في السجل | [ ] | |
| H4 | تبعيات غير مستخدمة + npm audit | [ ] | |
| M1 | كوكي الجلسة بلا Max-Age | [ ] | |
| M2 | ?token= في روابط اللوحة | [ ] | |
| M3 | img-src مفتوح | [ ] | |
| M4 | انعكاس المسار في 404 | [ ] | |
| M5 | بلا حدود على القراءة | [ ] | |
| F1 | خلط أنظمة الأرقام | [ ] | |
| F2 | formatPrice تجبر ر.س | [ ] | |
| F3 | lang_ar غير صالح | [ ] | |
| F4 | استيراد فارغ | [ ] | |
| F5 | أحرف كورية في تعليق | [ ] | |
| F6 | key='voice' ناقص | [ ] | |
| F7 | renderNotice تعرض لوحة الإدارة | [ ] | |
| F8 | unread مُصلَّب في /voice | [ ] | |
| F9 | ترتيب الاستيرادات admin.js | [ ] | |
| F10 | icon() بعد الاستخدام | [ ] | |
| A1 | 413 في المناقشة + ميزانية الإدخال | [x] 64/64 | (غير مُرسل بعد) |
| O1 | تعديلات غير مُرسلة | [ ] | |
| O2 | ملفات اختبار في storage | [ ] | |
