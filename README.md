# مشرفي AI — منصة الإشراف البحثي الذكي

خدمة **Node.js + PostgreSQL** خالصة. تمت إزالة Next.js و React و Firebase من الاعتماديات ومن شجرة الكود بالكامل.

## البنية والتقنيات

| الطبقة | التقنية |
| --- | --- |
| الخادم | Node.js 20+ مع Express |
| قاعدة البيانات | PostgreSQL 14+ |
| اتصال الـ DB | `pg` (Pool) |
| المتغيرات | `dotenv` |
| الأمان | `helmet` + `cors` |
| التشغيل في التطوير | `node --watch` — مدمج في Node، لا يحتاج أي حزمة إضافية |
| التشغيل في الإنتاج | `node server.js` |

## شجرة المشروع

```
server.js               نقطة تشغيل الـ API
src/db/client.js        اتصال PostgreSQL المشترك + فحص الصحة
src/db/init.js          إنشاء قاعدة البيانات والجداول
src/db/seed.js          إدخال الباقات الافتراضية
src/db/errors.js        تحويل أخطاء PostgreSQL إلى رسائل واضحة
src/routes/admin.js     مسارات لوحة الإدارة (/admin)
src/views/layout.js     قالب HTML المشترك + هوية الألوان
src/views/admin.js      صفحات الإدارة (نظرة عامة/باحثون/باقات/استهلاك)
src/views/landing.js    الصفحة الرئيسية (صفحة الهبوط): هيرو + مميزات + كيف تعمل + باقات + أسئلة + دعوة (محتوى مُراجع مقابل القدرات الفعلية)
src/views/home.js       صفحة حالة الخدمة (/status) وصفحة 404
src/views/format.js     تنسيق الأرقام والتواريخ
src/services/spreadsheet.js  قراءة جداول البيانات (xlsx/csv) لمعاينة Excel داخل الموقع
public/                 ملفات الهوية: الشعارات (zena-ai-icon.svg + logo1.webp + logo2.webp) ودليل الهوية وخطوط Manrope وIBM Plex Sans Arabic
public/fonts.css        تعريفات @font-face للخطوط المحلية (مولَّد آلياً)
scripts/doctor.mjs       تشخيص كامل: قاعدة البيانات + كل مزوّد بالاسم والسبب (npm run doctor)
scripts/set-admin.mjs    ترقية باحث إلى مدير (npm run set-admin -- someone@example.com)
scripts/fetch-fonts.mjs تنزيل خطوط الهوية من Google Fonts إلى public/fonts (npm run fonts:fetch)
scripts/setup-postgres.sh  تثبيت وتشغيل PostgreSQL بامر واحد (npm run db:setup)
docker-compose.yml      PostgreSQL جاهز عبر Docker
storage/                ملفات المشروع المرفوعة (الميتاداتا في PostgreSQL)
backup/                 نسخة مضغوطة من كود الواجهة القديمة (Next.js/React)
```

## المتطلبات

- **Node.js 20 أو أحدث** (المشروع مُختبر على Node 22).
- **PostgreSQL 14 أو أحدث** — إما مثبّت محلياً، أو عبر Docker، أو قاعدة مستضافة (Neon / Supabase / Railway).
- إذا كان Node في مسار مخصص على هذا الجهاز، فعّل المسار أولاً:
  ```bash
  export PATH=/home/obaida/.local/node-v22.23.2-linux-x64/bin:$PATH
  ```

## التشغيل السريع

```bash
# 1) تثبيت الحزم
npm install

# 2) إعداد متغيرات البيئة
cp .env.example .env     # ثم عدّل DATABASE_URL إذا لزم الأمر

# 3) تهيئة PostgreSQL (اختر طريقة واحدة من قسم «إعداد PostgreSQL» أدناه)
npm run db:setup         # Ubuntu/Zorin: تثبيت وتشغيل PostgreSQL + ضبط كلمة المرور
npm run db:init          # ينشئ قاعدة البيانات إن لم تكن موجودة + الجداول
npm run db:seed          # اختياري: الباقات الافتراضية

# 4) تشغيل الخادم مع إعادة التحميل التلقائي
npm run dev
```

الخادم سيعمل على:

- http://localhost:3000
- فحص الحالة: http://localhost:3000/api/health

## إعداد PostgreSQL — اختر طريقة واحدة

### 1) أمر واحد على Ubuntu / Zorin / Debian (موصى به)

سكربت جاهز يثبّت PostgreSQL إن لم يكن مثبّتاً، يشغّل الخدمة ويفعّلها بعد إعادة تشغيل الجهاز،
ويضبط كلمة مرور المستخدم `postgres` لتطابق `.env`:

```bash
npm run db:setup     # يطلب كلمة مرور sudo مرة واحدة
npm run db:init      # ينشئ قاعدة ai_researcher + الجداول
npm run db:seed      # الباقات الافتراضية (اختياري)
```

وهذا هو المكافئ اليدوي إن أردت تنفيذ الخطوات بنفسك:

```bash
sudo apt install postgresql
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
npm run db:init
```

> لا حاجة لإنشاء قاعدة `ai_researcher` يدوياً — `db:init` ينشئها تلقائياً عبر الاتصال بقاعدة الصيانة `postgres` (يحتاج صلاحية `CREATEDB` وهي متوفرة للمستخدم `postgres`).

### 2) عبر Docker

يتطلب تثبيت Docker أولاً (`sudo apt install docker.io docker-compose-v2`)، ثم:

```bash
npm run db:up      # يشغّل خدمة db من docker-compose.yml
npm run db:down    # لإيقافها
```

الإعداد الافتراضي يطابق `.env.example`: المستخدم `postgres`، كلمة المرور `postgres`، القاعدة `ai_researcher`، المنفذ `5432`.

### 3) قاعدة بيانات مستضافة

أنشئ قاعدة على المزوّد ثم ضع رابط الاتصال في `.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

## أوامر npm

| الأمر | الوظيفة |
| --- | --- |
| `npm run dev` | تشغيل الخادم مع `node --watch` (إعادة تشغيل تلقائية عند تعديل الملفات) |
| `npm run dev:free` | تحرير المنفذ 3000 من أي عملية عالقة (ينفّذها تلقائياً عند EADDRINUSE) |
| `npm start` | تشغيل الإنتاج |
| `npm run db:setup` | تثبيت وتشغيل PostgreSQL وضبط كلمة المرور (يحتاج sudo مرة واحدة) |
| `npm run db:init` | إنشاء قاعدة البيانات (إن لزم) + `users` و`profiles` و`plans` و`usage_logs` |
| `npm run db:seed` | إدخال الباقات الافتراضية (آمن للتشغيل المتكرر) |
| `npm run db:reset` | `db:init` ثم `db:seed` |
| `npm run db:up` / `db:down` | تشغيل/إيقاف PostgreSQL عبر Docker |
| `npm run smoke:phase1` | اختبار دخان حيّ لمسارات الباحث (مسار البحث · المراجع · المفكرة · الملفات · الشات) — يحتاج الخادم شغّالاً |

> ملاحظة: `db:seed` اختياري تماماً. تعريفات مسارات البحث في `src/data/research-paths.js`
> تعمل مباشرة في صفحة «مسار البحث»، والبذرة فقط تنقلها إلى جداول `research_paths`.

## متغيرات البيئة

| المتغير | الوصف |
| --- | --- |
| `PORT` | منفذ الخادم (افتراضي 3000) |
| `NODE_ENV` | `development` أو `production` (يفعّل SSL في الإنتاج) |
| `JWT_SECRET` | مفتاح توقيع الجلسات (JWT) — غيّره في الإنتاج |
| `DATABASE_URL` | رابط اتصال PostgreSQL |
| `ADMIN_EMAILS` | إيميلات المديرين مفصولة بفواصل (تُقرأ على الخادم فقط) |
| `OPENROUTER_API_KEYS` | مفاتيح OpenRouter مفصولة بفواصل (ويقبل `OPENROUTER_API_KEY` لواحد) |
| `GROQ_API_KEY` | مفتاح Groq (`gsk_…`) من groq.com — وهو **ليس** Grok من xai.com (`xai-…`) |
| `ADMIN_TOKEN` | رمز دخول لوحة الإدارة؛ إن ترك فارغاً صارت `/admin` متاحة من localhost فقط |
| `AI_HEDGE_MS` | بعد كم مللي ثانية يُطلق المزوّد التالي بالتوازي (افتراضي ٣٥٠٠) |
| `AI_COOLDOWN_MIN` | خروج المزوّد عن الدوران بعد فشل مؤقّت بالدقائق (افتراضي ١٠) |
| `AI_HARD_COOLDOWN_MIN` | نفسه بعد فشل دائم 402/403/401 (افتراضي ١٠ — ليست للأبد) |
| `AI_MODEL_*` | قائمة النماذج لكل مزوّد مفصولة بفواصل تُجرَّب بالترتيب |
| `AI_PRICE_MULTIPLIER` | معامل تسعير الاستهلاك (١ = بدون تعديل) |
| `ADMIN_TOKEN` | رمز حماية صفحات `/admin`. فارغ = السماح من الجهاز المحلي فقط |
| `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `GEMINI_API_KEY_FALLBACK` / `GROK_API_KEY` | مفاتيح وكلاء الذكاء الاصطناعي (على الخادم فقط) |

## مخطط قاعدة البيانات

```sql
users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  is_active BOOLEAN DEFAULT true,
  plan_code VARCHAR(100) REFERENCES plans(code) ON DELETE SET NULL,  -- الباقة الحالية
  tokens_balance INTEGER NOT NULL DEFAULT 0,                        -- رصيد النقاط
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  research_field VARCHAR(255),
  university VARCHAR(255),
  degree_level VARCHAR(100),
  research_title TEXT,
  preferred_language VARCHAR(50),
  about TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

## نقاط الـ API المتاحة الآن

| المسار | الوصف |
| --- | --- |
| `GET /` | معلومات المشروع (JSON، وصفحة HTML عند فتحه من المتصفح) |
| `GET /api/health` | فحص الخادم وقاعدة البيانات (يعيد 503 عند تعذّر الاتصال) |
| `GET /api/users` | أحدث 50 مستخدماً |
| `GET /api/plans` | قائمة الباقات |

## لوحة الباحث (HTML بدون React)

كل الصفحات تحتاج جلسة فعّالة (`requireAccount`) — والزائر يُحوَّل إلى `/login?next=…`.
كل النماذج `POST` عادية تنتهي بـ `303 redirect`، فلا تعتمد على JavaScript إطلاقاً.

| المسار | الوصف |
| --- | --- |
| `GET /dashboard` | الإحصائية: **شريط مؤشرات (KPIs)** + **مخطط أعمدة لنشاط آخر ٧ أيام** + **مخطط دائري (Donut) لتوزيع الاستهلاك حسب النوع** + «مكتبتك البحثية» (مراجع/ملاحظات/ملفات/أسئلة) + الرصيد والباقة + شريط تقدّم مسار البحث + آخر العمليات (كل المخططات CSS/SVG من الخادم بلا مكتبات) |
| `GET /journey` | خطوات مسار درجة الباحث مع حالته في كل خطوة وملاحظة مخرجاتها |
| `POST /journey/steps/:key` | تغيير حالة الخطوة (`not_started` / `in_progress` / `done`) |
| `GET /references` | بحث في مكتبة المنصة + «مراجعي» (إضافة يدوية أو من المكتبة + حالة القراءة) |
| `POST /references` · `/:id/status` · `/:id/delete` | إدارة المراجع |
| `GET /notes` | المفكرة: إنشاء/تعديل/تثبيت/بحث/ربط بخطوة |
| `POST /notes` · `/:id` · `/:id/pin` · `/:id/delete` | إدارة الملاحظات |
| `GET /files` | ملفات الباحث: رفع (multipart) + تحميل + حذف + معاينة |
| `GET /files/:id/view` | صفحة معاينة: صورة · PDF · نص · **جدول بيانات (xlsx/xls/csv)** داخل الموقع (doc·pptx·zip ⇒ تحميل فقط) |
| `GET /files/:id/raw` | البايتات: تحميل (`attachment`) أو عرض (`?inline=1`) مع `nosniff` + CSP معزولة |
| `POST /files` · `POST /files/:id/delete` | إدارة الملفات (بملكية الجلسة فقط) |
| `GET /chat` | المشرف الذكي: كارت دردشة بملء الشاشة + قائمة المحادثات في السايدبار (`?c=` لمحادثة، `?step=` للسياق) |
| `POST /chat` | إرسال رسالة + ملفات مرفقة (`file_ids`) — **التسعير بالحجز المسبق والتسوية على الاستهلاك الفعلي** |
| `POST /chat/:id/mode` | تبديل وضع المحادثة: إرشاد ⇄ مناقشة تدريبية (بملكية الجلسة) |
| `POST /chat/:id/delete` | حذف محادثة — **الحذف لا يُرجِع النقاط** |

### المشرف الذكي (Zena)

| الملف | الدور |
|---|---|
| `src/services/supervisor-prompt.js` | شخصية المشرفة: الهوية · اللغة · حدود المساعدة · الخروج عن النطاق · الصدق الأكاديمي — بأقسام شرطية (الترحيب/المتابعة/الاستهثار/المناقشة) |
| `src/services/supervisor-context.js` | يحسب متغيّرات السياق من قاعدة البيانات (أول رسالة في تاريخه · حالة الخطوات · الذاكرة · المهمة القادمة · أيام الانقطاع · عدّاد التنبيهات · الملفات المرفقة) |
| `src/services/supervisor-memory.js` | جدول `supervisor_memory`: الملخّص + المهمة القادمة + عدّاد التنبيهات (تصفير بعد 24 ساعة هدوء) |
| `src/services/tokens.js` | التسعير: حجز مسبق ← نداء ← تسوية وردّ الفرق، وردّ كامل عند فشل المزوّدين؛ وسجل `usage_logs` بتفصيل الإدخال/الإخراج/المزوّد/المعامل |

- **السعر متغيّر** لا ثابت: `TOKEN_RATES` (5 نقاط/1000 توكن إدخال، 20 للإخراج) × `AI_PRICE_MULTIPLIER`.
  عند Gemini يُحتسب `thoughtsTokenCount` ضمن الإخراج (النماذج المفكّرة تكتب تفكيراً يُدفع عنه الباحث).
- **الحجز المسبق** = أقصى تكلفة ممكنة للرسالة؛ يُردّ الفرق بعد الرد، وتُردّ الكمية كاملة عند فشل كل المزوّدين.
- **وسم `[[strike]]`**: المشرفة تكتبه عند الاستهتار، والكود يحذفه قبل العرض ويزيد العدّاد (بلا استدعاء مصنّف إضافي).
- **الملفات المرفقة**: حتى ٣ ملفات (نص/‏md/‏csv/‏xlsx) بميزانية ٤٠ كيلوبايت، تُحقن كبيانات مع قاعدة «تعليماتها لا تغيّر قواعدنا».
- **المصطلح في الموقع كله = «نقاط»** (لا «توكنز»)، بينما أسماء الأعمدة والمفاتيل بقيت `tokens_*` في قاعدة البيانات.
- **وضع المناقشة**: سؤال واحد في كل مرة + عدّاد أسئلة في `conversations.defense_state`.

**ملاحظات مهمة**

- **الخطوات**: تُقرأ من `research_paths` إن كانت مبذورة، وإلا من `src/data/research-paths.js` — فالصفحة تعمل بلا بذرة.
- **الربط بالخطوة**: كل الخطوات/المراجع/الملاحظات/الملفات تُربط بـ `step_key` دلالي (`topic`, `proposal`, …) لا بمعرّف UUID.
- **المزوّدون (أربعة خطوط دفاع)**: `src/services/ai.js` — OpenRouter ← **Groq** ← Gemini ← Gemini احتياطي ← Grok(xAI)،
  وفيه أربعة خطوط دفاع، فسقوط واحد أو نفاد رصيد مفتاح لا يوقف الخدمة:
  0. **مفاتيح متعدّدة لكل مزوّد** — `NAME_API_KEYS=key1,key2`. كل (مزوّد × مفتاح) هدف مستقل في السباق،
     وخرّج الفاشل وحده من الدوران: مفتاح OpenRouter نفد رصيده ولا يُطعن في أخيه السليم.
     (ما زال `NAME_API_KEY` مقبولاً كسقوط متوافق.)
  1.
  1. **تبديل النماذج داخل المزوّد** — `AI_MODEL_GEMINI` قائمة مفصولة بفواصل تُجرَّب بالترتيب.
     ازدحام نموذج (503) لا يعني ازدحام المفتاح: قِسنا 3.8 و3.7 وflash-latest فكانوا 503 في نفس
     اللحظة التي ردّ فيها `gemini-3.6-flash` فوراً.
  2. **طلب مموَّه (hedge)** — بعد `AI_HEDGE_MS` (٣٫٥ ث) يُطلق المزوّد التالي **بالتوازي**، وأول من يردّ
     يفوز، والباقي يُلغى. فإزحام Gemini لا يعني انتظاره: OpenRouter يردّ في نفس اللحظة.
  3. **قائمة خروج (circuit breaker)** — المزوّد الفاشل يخرج ١٠ دقائق فلا يضيّع وقت الباحث
     ولا رصيده في كل رسالة. ليست للأبد: من شحن حسابه يعود الموقع للعمل وحده بلا إعادة تشغيل.
  - لا إعادة محاولة للأخطاء الدائمة (402 لا رصيد · 403 لا ترخيص · 401 مفتاح · 404 نموذج) — تُستهلك
    الثواني بلا فائدة. إعادة واحدة فقط لـ 429/5xx.
  - إذا فشلوا كلهم **تُعاد نقاط الباحث** ويُسجَّل `chat_failed` في `usage_logs`.
  - **Groq**: نقطة نهاية متوافقة مع OpenAPI وسرعة الأعلى — `qwen/qwen3.8-27b` يردّ عربياً في ≈٣٠٠–٦٠٠ مللي.
  - **التشخيص**: `npm run doctor` يطبع لكل مفتاح على حدة `✔#1` / `✘#2 402`،
    والصفحة `/admin/providers` تعرض نفس الشيء بزر «فحص الآن».
- **الرفع**: حدّان يضبطهما المدير من `/admin/settings` ويُحفظان في جدول `settings` (يسريان فوراً بلا إعادة تشغيل):
  - `max_upload_mb` — حجم الملف الواحد (افتراضي **100** ميجابايت).
  - `max_storage_mb` — المساحة الإجمالية لكل باحث (افتراضي **500** ميجابايت؛ 1024 = 1 جيجابايت)، ولا تقبل أقل من حجم الملف.
  - القيم في `.env` (`MAX_UPLOAD_MB` / `MAX_STORAGE_MB`) سقوط احتياطي فقط، والأنواع المسموحة في `constants.js`.

## لوحة الإدارة (HTML بدون React)

صفحات مولَّدة على الخادم (Server-Side Rendering) بنفس هوية المنصة البصرية، بدون أي حزمة واجهة وبدون خطوة بناء — بديل مسارات `/admin` القديمة:

| الصفحة | الوصف |
| --- | --- |
| `GET /admin` | نظرة عامة حية: 12 بطاقة إحصائية (باحثون/نشطون/مشتركون/باقات/مزوّدون/رسائل/طلبات ناجحة...) + مخطط نشاط 7 أيام + **مخطط دائري لتوزيع استهلاك الأسبوع** + أحدث الباحثين + آخر العمليات **مع فلترة (تاريخ + من/إلى ساعة + عدد نتائج) وصندوق تمرير داخلي** + نموذج إرسال إشعار فوري للجميع |
| `GET /admin/users` | جدول الباحثين مع بحث (`?q=`)، فلترة (`?filter=all\|active\|disabled`) وترقيم (`?page=`) — وإجراء **حذف مع تأكيد** لكل صف |
| `GET /admin/users/:id` | تفصيل باحث: الحساب والملف والأرقام + إجراءات التحكم الكاملة |
| `POST /admin/users/:id/status` `/points` `/plan` `/notify` `/delete` | إيقاف/تفعيل · منح أو خصم نقاط · تغيير باقة · إشعار داخلي · حذف (بتأكيد قبل الإرسال) |
| `GET /admin/admins` + `POST /admin/admins/add` `/edit` `/delete` | المديرون من **جدول admins وحده** (بلا أي ذكر لـ .env) — إضافة وتعديل بريد عبر مودال وإزالة |
| `GET /admin/roles` + `POST /admin/roles/:code/permissions` `/permissions/delete` | الأدوار وصلاحياتها — تسميات **عربية** لكل صلاحية + إضافة من **قائمة مسدلة** بدل كتابة الكود (ودور المدير غير معروض هنا) |
| `GET /admin/plans` + `POST /admin/plans/add` + `POST /admin/plans/:code` | الباقات وعدد المشتركين + **مودال** تعديل لكل باقة (يفتح بلا سكربتات) + **مودال إضافة باقة جديدة** |
| `GET /admin/providers` | حالة مزوّدي الذكاء الاصطناعي (يعمل/متوقّف + السبب + قائمة النماذج) — `?probe=1` يرسل نداءً صغيراً لكل مفتاح + **ربط موديل بمفتاح خاص** (يُحفظ في `settings` مفتاح `ai_custom_links` ويدخل الكاش فوراً بلا إعادة تشغيل) مع جدول الروابط المضافة وحذفها |
| `GET /admin/usage` | سجل الاستهلاك: **بحث `?q=`** (إيميل/نوع/ملخص) + **فلترة تاريخ/ساعات/عدد نتائج** + **أعمدة 14 يوماً** + **مخطط دائري للأنواع** + عمليات داخل صندوق تمرير (حتى 500) |
| `GET /admin/settings` | حدود التخزين + إحصاءات الملفات + حالة النظام — كل بطاقة بشروحات في **مودال «ماذا تعني؟»** |
| `POST /admin/settings/storage` | حفظ حدّي الرفع (يُحفظان في `settings` ويسريان فوراً) |
| `POST /admin/notifications` | إرسال إشعار فوري لكل الباحثين (من نموذج النظرة العامة) |

الصفحات تُقرأ من PostgreSQL مباشرة، وكل تعديل عبر **POST محمي** ثم إعادة توجيه برسالة نجاح أو خطأ عربية.
وكل نموذج حذف أو إجراء خطير يحمل `data-confirm` فيسأل المتصفح تأكيداً قبل الإرسال (بلا سكربتات مخصصة)،
والمودالات كلها تعتمد على `:target` من CSS — بلا JavaScript على الإطلاق.

### حماية الصفحات

- إذا كان `ADMIN_TOKEN` **فارغاً**: الصفحات متاحة من الجهاز المحلي فقط (localhost)، وأي طلب خارجي يحصل على 403.
- إذا عرّفت `ADMIN_TOKEN` في `.env`: يجب إرساله بأحد الأشكال:
  - الترويسة: `x-admin-token: <الرمز>`
  - الرابط: `/admin/users?token=<الرمز>`
  - Basic Auth: اسم المستخدم أي شيء وكلمة المرور هي الرمز.

> عند فشل قاعدة البيانات تعرض الصفحات رسالة عربية واضحة بخطوات الحل (بدل صفحة بيضاء أو خطأ خام).

## حل المشاكل الشائعة

### `Error: listen EADDRINUSE: address already in use :::3000`

المنفذ 3000 محجوز من عملية أخرى (غالباً نسخة سابقة من الخادم ما زالت تعمل). الحل:

```bash
npm run dev:free     # يوقف العملية التي تحتجز المنفذ
npm run dev
```

أو يدوياً: `lsof -ti tcp:3000 | xargs -r kill` — أو شغّل على منفذ آخر: `PORT=3001 npm run dev`.

### `{"message":"Route not found: /admin/users"}`

هذا المسار كان في واجهة Next.js/React القديمة التي أُزيلت. صار له بديل الآن بصفحة HTML على الخادم:

- `/admin/users` — جدول الباحثين
- `/admin` و`/admin/plans` و`/admin/usage`

أما مسارات الواجهة القديمة الأخرى (`/api/users` و`/api/send-message` ...) فلم تعد موجودة، وفتحها يعطيك صفحة 404 عربية فيها روابط الصفحات المتاحة. أما صفحات الباحث (`/dashboard` و`/journey` و`/chat` و`/references` و`/notes` و`/files`) فموجودة الآن كصفحات HTML على الخادم — راجع قسم «لوحة الباحث» أعلاه.

### `GET /api/users` يعيد `{"hint":"الجداول غير موجودة بعد..."}`

لم تُشغَّل تهيئة قاعدة البيانات بعد: `npm run db:init` ثم اختيارياً `npm run db:seed`.

### `npm error code ETARGET No matching version found for nodemon@^3.1.16`

السبب: لا يوجد إصدار منشور بهذا الرقم — أحدث إصدار من `nodemon` هو **3.1.14**.
لأن `npm install` يفشل بالكامل عندها، لم تُثبَّت أي حزمة، فظهر بعدها خطآن تابعان:

- `Cannot find package 'pg'` عند `npm run db:init`.
- `nodemon: not found` عند `npm run dev`.

الحل المطبَّق: إزالة `nodemon` من المشروع واستخدام **`node --watch`** المدمج في Node لسكربت التطوير، فأصبح التثبيت لا يعتمد على أي حزمة اختيارية. إن أردت nodemon لاحقاً:

```bash
npm install -D nodemon@^3.1.14
# ثم اجعل dev: "nodemon server.js"
```

### `ECONNREFUSED 127.0.0.1:5432`

لا يوجد خادم PostgreSQL يعمل: شغّل `npm run db:up` أو `sudo service postgresql start`، أو حدّث `DATABASE_URL` لقاعدة مستضافة. سكربتات `db:init` و`db:seed` تطبع الآن خطوات الحل مباشرة.

### `password authentication failed for user`

كلمة المرور في `DATABASE_URL` لا تطابق كلمة مرور المستخدم في PostgreSQL.

### تغييرات بيئة الطرفية

بعد أي تعديل على `.env` أعد تشغيل الخادم (`node --watch` لا يعيد قراءة `.env` تلقائياً عند تغييره).

## ما تم في هذا الإصلاح

1. **إصلاح `npm install`**: حذف الاعتماد على `nodemon@^3.1.16` غير الموجود، وإزالة `devDependencies` غير اللازمة، و`dev` يعمل الآن بـ `node --watch`.
2. **حذف `package-lock.json` القديم** الذي كان يخص واجهة Next.js/React/Firebase وجرّ `node_modules` قديمة — وسيُنشئ `npm install` ملف قفل نظيفاً.
3. **إزالة React/Next/Firebase بالكامل** من الكود: `src/app` و`src/components` و`src/context` و`src/lib` و`src/types` و`next.config.ts` و`tsconfig.json` و`postcss.config.mjs` و`firestore.rules` و`public/firebase-messaging-sw.js` ومجلد `.next` ومجلد `scripts`.
4. **نسخة احتياطية كاملة** من الملفات المحذوفة في `backup/legacy-nextjs-react-20260923.tar.gz` (126 ملفاً) — استخرجها في أي وقت بـ `tar -xzf` لعرض الكود القديم، ولمنع فقدان أي منطق عمل (مزوّدو الذكاء الاصطناعي، الثوابت، الخدمات) عند إعادة بناء الواجهة لاحقاً بدون React.
5. **نقل مفاتيح الذكاء الاصطناعي** من `.env.local` (Firebase) إلى `.env` كمتغيرات خادم، وحذف `.env.local`.
6. **تحسين سكربتات قاعدة البيانات**: إنشاء قاعدة البيانات تلقائياً إن لم تكن موجودة، فهرس على `usage_logs(user_id, created_at)`، ورسائل أخطاء عربية واضحة.
7. **إضافة `docker-compose.yml`** لتشغيل PostgreSQL بأمر واحد.
8. **إضافة إغلاق نظيف للخادم** (`SIGINT`/`SIGTERM`) يغلق اتصالات قاعدة البيانات.
9. **تحديث `.gitignore`** وحذف إعدادات Next.js/TypeScript القديمة، مع تجاهل `backup/` و`storage/` والملفات المرفوعة.

## الإضافات الأخيرة: لوحة إدارة HTML بدون React

10. **بديل مسار `/admin/users`** الذي كان يعيد `Route not found`: صفحات HTML مولَّدة على الخادم (`src/routes/admin.js` + `src/views/*`) بنفس هوية المنصة (زمردي/نحاسي/ورق الرقّ + حبر البرقوق للإدارة) — بدون React وبدون أي حزمة جديدة وبدون خطوة بناء.
11. **صفحات جديدة**: `/admin` (نظرة عامة)، `/admin/users` (بحث + فلترة + ترقيم)، `/admin/plans`، `/admin/usage`.
12. **حماية `ADMIN_TOKEN`** مع افتراض آمن: بدون الرمز تعمل الصفحات من localhost فقط.
13. **أعمدة جديدة في `users`**: `plan_code` (مرتبط بـ `plans.code`) و`tokens_balance` ليظهر الباقة والرصيد في لوحة الإدارة — تُضاف تلقائياً عند `npm run db:init`.
14. **صفحة جذر ذكية**: `GET /` يعيد HTML للمتصفح وJSON لعملاء الـ API، وصفحة 404 عربية لكل مسار غير معروف بدل رسالة JSON.
15. **إصلاح خطأ 500 في مسارات الـ API**: صار الرد يحتوي الحقل `hint` بخطوات الحل (تشغيل PostgreSQL، `db:init`، تصحيح كلمة المرور).

## هوية Zena AI البصرية في الواجهة

كل تنسيقات الصفحات مأخوذة من `public/Zena AI — الهوية البصرية.md` (ونسختها PDF) بدون أي حزمة جديدة وبدون خطوة بناء:

| العنصر | التطبيق في الكود |
| --- | --- |
| الألوان | Ink Navy `#102A43` للترويسة والعناوين، Sea Teal `#0D8E93` للأزرار والروابط والحالة النشطة، Fresh Teal `#19B5A5` للإبرازات وشريط البطاقات الإحصائية، Mist `#D8F3EF` للحدود والبطاقات الخفيفة والاقتباسات، Paper `#F7FBFC` للخلفية والعناصر على الكحلي، Apricot Spark `#F4A261` كإشارة صغيرة فقط (خط الترويسة وحدود التنبيهات)، Slate `#526777` للنصوص الثانوية — معرَّفة كمتغيرات CSS في `src/views/layout.js` |
| الخطوط | Manrope (400..800) للحروف اللاتينية والواجهة وIBM Plex Sans Arabic (400..700) للنص العربي، مستضافان محلياً في `public/fonts` مع تعريفات `public/fonts.css` — بلا أي طلب لـ CDN خارجي (`npm run fonts:fetch` يعيد تنزيلهما) |
| الشعار | `zena-ai-icon.svg` في الترويسة (داخل وسادة بلون Paper للحفاظ على مساحة الأمان) وفي التذييل وكأيقونة الموقع، `logo2.webp` شعاراً كبيراً في الصفحة الرئيسية، و`logo1.webp` كأيقونة لمس/مشاركة |
| الجمل التعريفية | «ابحث بعمق. اكتب بوضوح.» كعنوان للصفحة الرئيسية، مع «من الفكرة الأولى إلى فصل متماسك» و«ناقش فكرتك مع Zena» |
| التوزيع | الشريط العلوي كحلي الحبر (25%)، الخلفية Paper (55%)، الحدود والبطاقات الخفيفة Mist (12%)، الأزرار والحالات النشطة Teal (6%)، والمشمشي (2%) كإشارة صغيرة فقط — كما تقترح نسب الاستخدام في الدليل |

نقاط مهمة:

- مجلد `public` يُقدَّم الآن كملفات ثابتة من `server.js` عبر `express.static`، لذلك يعمل `/zena-ai-icon.svg` و`/logo1.webp` و`/logo2.webp` و`/fonts.css` و`/fonts/*` مباشرة، و`/favicon.ico` و`/favicon.svg` يعيدان أيقونة الهوية.
- لا حاجة لتعديل إعدادات `helmet`: سياسة CSP الافتراضية تسمح بالخطوط والصور المحلية وبالأنماط المضمّنة، ولا يوجد أي طلب خارجي أصلاً.
- لتغيير الشعار لاحقاً: استبدل `public/zena-ai-icon.svg` أو `public/logo2.webp`، أو عدّل كائن `BRAND` في `src/views/layout.js`. ولو أُضيف الملف الأفقي `zena-ai-logo.svg` المذكور في دليل الهوية فيكفي إضافته لكائن `BRAND` واستخدامه مكان الأيقونة+النص في `renderBrand`.

## ملاحظات أمنية مهمة

- كان الملفان `ai-api.md` و`.env.local` يحتويان مفاتيح OpenRouter وGemini وGrok مكتوبة صراحةً. أُزيل الاثنان من جذر المشروع (موجودان فقط داخل `backup/legacy-nextjs-react-20260923.tar.gz`) ونُقلت المفاتيح إلى `.env`. **يُنصح بإعادة توليد هذه المفاتيح** من لوحات المزوّدين، فهي تُعدّ مكشوفة.
- لا تُرسل أي مفتاح من هذه المفاتيح إلى الواجهة؛ كلها تُستخدم على الخادم فقط (لا وجود لبادئة `NEXT_PUBLIC_` الآن).
- ملف `.env` مستثنى من Git — تأكد من عدم رفعه.

## الخطوة التالية المقترحة

- **تشغيل PostgreSQL** (`npm run db:up` أو تثبيت محلي) ثم `npm run db:init` و`npm run db:seed` لعرض بيانات حقيقية في اللوحة.
- **إضافة إجراءات إدارية** للوحة (شحن نقاط، تغيير الباقة، إيقاف/تفعيل حساب) عبر نماذج HTML ترسل POST إلى مسارات في `src/routes/admin.js`.
- **نظام تسجيل دخول** (JWT أو جلسات) وربط `ADMIN_EMAILS` بالأدوار، ثم إضافة بقية الصفحات (`/admin/requests` و`/admin/settings` و`/admin/stats`).

