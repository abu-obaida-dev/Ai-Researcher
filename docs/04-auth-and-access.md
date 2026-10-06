# 04 — الدخول والوصول: Google OAuth + الجلسات + الأدوار

## 1. الدخول بجوجل (OAuth 2.0) — `src/auth/google.js`

```
الباحث → GET /auth/login → رابط جوجل (+ state عشوائي في كوكي httpOnly)
  → يوافق في جوجل → GET /auth/google/callback?code=…&state=…
  → نتحقق من state (ضد CSRF) → نبدّل code بـ access_token (نداء خلفي)
  → نجلب profile (email/name/picture/sub)
  → ensureUserFromGoogle() → كوكي جلسة → redirect للوجهة (homePathFor)
```

- **بلا كلمات مرور**: لا نخزن أي سرّ للمستخدم.
- **الـ `sub`**: معرّف جوجل الثابت — يربط الحساب حتى لو غيّر بريده الاسم.
- **غير مُفعّل؟** إن غابت `GOOGLE_CLIENT_ID/SECRET` صفحة الدخول تشرح ذلك بدل الانهيار.

## 2. الجلسات: كوكي موقّع HMAC — بلا جدول جلسات

- الحمولة: `{ uid, email, role, iat, exp }` — مشفرة `base64url` + توقيع `HMAC-SHA256` بالسرّ.
- التحقق `timingSafeEqual` — يمنع التزوير وقياس الزمن.
- `Secure + HttpOnly + SameSite=Lax` في الإنتاج، وTTL ثلاثون يوماً.
- **لماذا بلا Redis/جدول؟** البساطة: التحقق حسابي خالص، والإبطال يتم عبر `is_active/deleted` في `users`.

## 3. `attachAccount` — كل طلب يعرف صاحبه (`src/middleware/auth.js`)

- يُثبَّت قبل كل المسارات: يقرأ الكوكي → `getUserById` → `syncUserRole` → يحمّل `services` + `adminPermissions` مرة واحدة.
- الحساب الموقوف/المحذوف → لا جلسة. فشل DB → الصفحات العامة تظل تعمل (تحذير في السجل فقط).

## 4. مزامنة الدور `syncUserRole` — الترتيب الهرمي

```
admin (ADMIN_EMAILS أو جدول admins)  ← أعلى، لا يُنزَع إلا بتغيير المصدر
  ← supervisor (جدول supervisors)
  ← دور الباقة (plans.role_code)
  ← بلا باقة: 'researcher' (حتى لا تُقفل الخدمات فجأة على البيانات القديمة)
```

## 5. الصلاحيات والخدمات — `src/services/access.js`

- كل خدمة في `PLATFORM_SERVICES` لها **صلاحية واحدة** (مثل `chat:use`، `library:use`، `defense:use`).
- الدور يملك صلاحياته في `role_permissions` — والمدير يعدّلها من «الأدوار والصلاحيات» فيسري التغيير في الطلب التالي (كاش 30 ثانية فقط).
- **الشات مفتوح لكل الباقات** بمجرد التسجيل — القفل على المزايا المتقدمة لا على المشرف نفسه.
- `requireService(key)` في المسارات: الممنوع يرى صفحة عربية تشرح الخدمة والباقة المطلوبة (403) بدل خطأ جاف — تغطي `/references` و`/notes` و`/files` و`/defense` و`/journey` (و`/chat` خارجها قصداً).
- `requireCoreOnboarding` (البوابة الجزئية للملف): وظائف تحتاج سياقاً بحثياً — إرسال الشات، مسار البحث، بدء المناقشة — تحوّل غير المكمل إلى `/onboarding?next=…` ليعود لوجهته بعد الحفظ. القراءة العامة والمساعدة لا تُمنع (ولوحة الباحث تحوّلك للملف أول مرة فقط).
- `needsOnboarding`: المدير/المشرف لا يُطالبان بملف بحثي.

## 6. صلاحيات الإدارة `ADMIN_PERMISSIONS`

`admin:panel/users/library/plans/roles/usage/payments/notify` — المدير يملك `*`، والمشرف ما يُمنح له فقط، والسايدبار يُصفَّى بها.

## 7. حماية `/admin` طبقتان

1. **رمز `ADMIN_TOKEN`** (مقارنة ثابتة الزمن) — أو localhost فقط إن غاب في التطوير، ورفض إقلاع في الإنتاج بلا رمز.
2. **دور admin/supervisor+panel** من الجلسة — الرمز وحده لا يكفي.
