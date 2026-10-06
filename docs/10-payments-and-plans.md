# 10 — الباقات والدفع اليدوي

## 1. الباقات — `services/plans.js`
- المصدر `plans`: `code/title/price/tokens/storage_mb/period/cta/popular/role_code/features`.
- **المزايا تُولَّد من الصلاحيات الحقيقية** `decoratePlans()`: كل خدمة مفتوحة لدور الباقة سطر + سطر الحصة + إضافات المدير — فلا تعد الواجهة بما لا يفتحه الدور فعلاً.
- `freeTrialTokens()`: الرقم المعلن في كل الموقع يُقرأ من باقة `free_trial` — يغيّره المدير فيسري فوراً.
- السقوط: `fallbackPlans()` من `DEFAULT_PLANS` — صفحة الهبوط تعمل بلا DB.

## 2. الحصص
- التخزين: `plans.storage_mb` لكل باقة (من `/admin/plans`) → `planStorageBytes()` → يُطبَّق عند الرفع. `MAX_STORAGE_MB` fallback فقط.
- النقاط: `tokens` لكل باقة + `FREE_TRIAL_TOKENS` للجدد. (المصطلح: الواجهة تقول «نقاط» والقاعدة `tokens_*` — نفس الشيء؛ انظر `03`.)

## 3. الدفع اليدوي — `services/payments.js`
- يناسب الواقع: تحويل بنكي / محفظة / مكتب نقدي — الطرق من `payment_methods` يضبطها المدير (كود/اسم/ملاحظة/تفاصيل/عملة/نشطة).
- الباحث: يختار باقة وطريقة → يكتب المبلغ ورقم العملية → طلب `pending` (≤5 معلقة لكل باحث).
- **السعر من `plans` وقت الطلب** — لا يُرسل من المتصفح.
- المدير: `confirmPaymentRequest` **بمعاملة ذرّية واحدة** (طلب مؤكد + باقة + نقاط + سجل `payment_confirmed`) — إما الكل أو لا شيء. `rejectPaymentRequest` بملاحظة بلا تغيير.
- العملة: `LYD` افتراضياً (`USD` بديلة) من `settings.site_currency`.
