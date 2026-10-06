# 12 — الأمان: طبقات لا شعار

| الطبقة | الآلية | أين؟ |
|---|---|---|
| الجلسات | HMAC-SHA256 + `timingSafeEqual` + HttpOnly/Secure/Lax + TTL | `auth/google.js` |
| كلمات المرور | لا وجود لها — OAuth فقط | — |
| CSRF | `requireSameOrigin`: كل POST بجلسة بلا Origin/Referer مطابق يُرفض | `middleware/security.js` |
| المعدل | `rateLimit(name)` لكل مسار حساس (دخول/دفع/رفع) بمفتاح مسار+IP + تنظيف دوري | `middleware/security.js` |
| التزامن | سقف 4 رفعات / 2 كتب — `429` فور الامتلاء، وتحرير على `finish/close` | `concurrencyLimit` |
| الرفع | امتداد مغلق + MIME + **بصمة ثنائية** قبل أي كتابة + `nosniff` وإجبار النوع عند العرض | `upload-guard.js` + `files.js` |
| الحقن | `escapeHtml` في كل View + ملفات البرومبت «بيانات فقط» + `step_key` يُتحقق من مسار الباحث | `views/*` + `supervisor-prompt.js` |
| الانهيار | حارس `isUuid` قبل أي استعلام + معالج أخطاء عام (HTML/JSON) + التقاط `unhandledRejection` | `constants.js` + `server.js` |
| الوكيل العكسي | `TRUST_PROXY` بعدد الوكلاء — بدونه يصير الكل `127.0.0.1` (تُفتح الإدارة وتتعطل الحدود) | `server.js` + `.env.example` |
| الإنتاج | رفض إقلاع بلا `SESSION_SECRET/ADMIN_TOKEN` حقيقيين + تشخيص ENV **بالأسماء فقط** | `server.js` |
| الأسرار | مفاتيح AI وFCM على الخادم فقط — المتصفح يرى الأسماء والأعداد | `services/ai.js` |

## القاعدة الذهبية
> **الفشل يُغلق الباب (fail-closed)**: أي خطأ في التحقق من صلاحية = رفض — إلا المدير فدوره فوق البوابات.
