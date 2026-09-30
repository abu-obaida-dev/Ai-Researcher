# Zena AI — خطة العمل والتودو ليست

> المرجع التقني: `src/` — Node.js + Express + PostgreSQL، صفحات HTML مولَّدة على الخادم (بدون React).
> كل بيانات المستخدم تُخزَّن في PostgreSQL ومربوطة بـ `user_id`.

## 0) التشغيل والتحقق السريع

```bash
npm run db:init        # تهيئة الجداول (idempotent — آمنة مع قاعدة قائمة)
npm run db:seed        # الباقات + مسارات البحث
npm run dev            # تشغيل الخادم مع --watch
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/        # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login   # 200
curl -s http://localhost:3000/api/health
```

ملاحظات بيئة العمل: مخرجات الترمنال غير موثوقة هنا — تُكتب في `/tmp/...txt` ثم تُقرأ. `node` = `/usr/bin/node` v22.23.3، PostgreSQL شغال على 5432.

## 1) البنية المعتمدة (Schema)

### المرحلة الأولى — لوحة المستخدم
- `roles(code, title, level, is_system)` + `role_permissions(role_code, permission)`
- `research_paths(id, degree_level, title, is_default)` — مسار لكل درجة (بكالوريوس/ماجستير/دكتوراه/دبلوم/باحث مستقل)
- `research_path_steps(id, path_id, step_no, title, description, cost_type, is_required, guidance)`
- `user_paths(user_id PK, path_id, current_step_no, started_at)`
- `user_step_progress(user_id, step_id, status, output_note, completed_at, UNIQUE(user_id, step_id))`
- `library_items(...)` — المكتبة العلمية المركزية (يرفعها المدير)
- `user_references(user_id, library_item_id NULL, custom_*, status, note, step_id)`
- `notes(user_id, title, body, tags, pinned, step_id, reference_id)`
- `files(user_id, title, file_name, stored_path, mime, size_bytes, source, step_id)`
- `conversations(id, user_id, title, step_id, provider)` + `messages(id, conversation_id, role, content, tokens_used, model)`
- `ai_requests(id, user_id, provider, model, latency_ms, status, error)` — مراقبة مزوّدي الـ AI

### المرحلة الثانية — الأدوار وربط المشرف
- تفعيل `roles` + `requireRole()` في middleware + مزامنة `users.role`
- `supervisors(id, kind('ai'|'human'), user_id NULL, name, specialty_field, degree_level, provider, model, system_prompt)`
- `supervisor_assignments(supervisor_id, user_id, role('primary'|'reviewer'))`

### المرحلة الثالثة — لوحة المديرين + المكتبة
- `/admin/library` لرفع المراجع (PDF/CSV/BibTeX) + بحث FTS + تعطيل
- `GET /api/library/suggest` يقترح من المكتبة فقط (بدون هلوسة) بصياغة APA من حقول الصف

### تخزين الملفات (حسب `storage/README.md`)
- `storage/library/references/{id}-{slug}.pdf` — الملف الأصلي مرة واحدة
- `storage/users/{userId}/files/{id}-{slug}.pdf` · `.../notes/` · `.../uploads/`
- التحميل عبر مسار محمي بجلسة (`GET /files/:id/raw`) لا عبر static مكشوف

## 2) التودو ليست التنفيذية

### 🔧 P0 — تحضير
- [x] تشغيل الخادم والتأكد من `/`, `/login`, `/api/health` (السيرفر شغال على 3000)
- [ ] حماية الأسرار: `.gitignore` يشمل `.env` و`client_secret_*.json` + `git init` + commit أولي
- [ ] `scripts/smoke.mjs`: فحص 200/302 لكل المسارات الأساسية (بدل صفر اختبارات)

### 🎨 P1 — المرحلة الأولى: لوحة المستخدم
- [x] **1A الهيكل:** `area:'app'` في `layout.js` — توب بار مضغوط (شعار + 🔔 Dropdown + أفاتار/خروج) + سايدبار يسار:
      الإحصائية · مسار البحث · المشرف الذكي · المراجع · المفكرة · ملفاتى (+ حسابى/خروج)
      + تحويل `renderAccountPage`/`renderOnboardingPage`/`renderNotificationsPage` إلى `area:'app'`،
      سكربت الجرس `/js/app-shell.js`، و`DELETE /api/notifications/:id` لحذف إشعار من الجرس
- [ ] **1B قاعدة البيانات + البذرة:** جداول المرحلة الأولى في `db/init.js` + `db/seed.js`:
      5 مسارات (بكالوريوس/ماجستير/دكتوراه/دبلوم/باحث مستقل) وخطواتها مع `cost_type` من `TOKEN_COSTS`
- [x] **1C `/dashboard` (الإحصائية — الرئيسية):** رصيد/مستهلك/إجمالي + نسبة، الباقة، آخر العمليات،
      الملف البحثي + زر «تعديل ملفي البحثي» → `/onboarding` — الدخول يحوّل إليها (`homePathFor`) وهي أول السايدبار.
      المتبقي منها لاحقاً (بعد 1B): شريط تقدم مسار البحث (X/Y)
- [ ] **1D `/journey` (مسار البحث):** خطوات درجة المستخدم وتخصصه، تغيير الحالة (لم يبدأ/جاري/تم)،
      ربط مرجع أو ملاحظة بالخطوة، وزر «ابدأ مع المشرف» يفتح الشات بسياق الخطوة
- [ ] **1E المراجع + المفكرة + ملفاتى:** بحث في المكتبة + «أضف إلى مراجعى» + إضافة يدوية + حالة القراءة؛
      ملاحظات CRUD بتثبيت ووسوم؛ ملفات برفع وتحميل محمي وحذف (حد حجم وأنواع مسموحة)
- [ ] **1F `/chat` (المشرف الذكي):** `services/ai.js` بسلسلة fallback (OpenRouter → Gemini → Gemini-fallback → Grok)
      + خصم توكنز ذرّي + تسجيل `usage_logs` + رفض عند رصيد صفر + حفظ المحادثة

### 🧑‍🏫 P2 — الأدوار + ربط المشرف
- [ ] جدول `roles`/`role_permissions` + بذرة (user / researcher / supervisor / admin) + ترقية `syncUserRole`
- [ ] `requireRole()` + إخفاء روابط لوحة المدير عن غير المصرّح
- [ ] `supervisors` + `supervisor_assignments` + ربط تلقائي بحسب `degree_level + research_field`
- [ ] شاشة «مشرفي» تعتمد على `supervisor_name`/`supervisor_notes` الموجودين في `profiles`

### 🏛️ P3 — لوحة المديرين + المكتبة العلمية
- [ ] `/admin/library`: رفع مرجع + بيانات APA + تخصصات + بحث/فلترة + تعطيل (soft delete) + `audit_log`
- [ ] رفع جماعي CSV/BibTeX + فهرس حسابي في `storage/library/references/`
- [ ] `GET /api/library/suggest` ودمجه في المشرف (اقتراح من المكتبة فقط + صياغة APA من الحقول)
- [ ] بحث FTS داخل المكتبة (`tsvector` + فهرس GIN) بدل `ILIKE`

### 🚀 P4 — مقترحات إضافية (بانتظار الموافقة)
- [ ] تصدير Word/PDF + قائمة مراجع APA + تصدير المفكرة Markdown
- [ ] الباقات والدفع (إنستاباي/فودافون كاش) + حدود استخدام وتجديد رصيد
- [ ] Push حقيقي: إضافة 7 مفاتيح `FIREBASE_*` + 3 `FCM_*` (المكان جاهز في `.env.example`)
- [ ] الأمان: rate-limit + تحقق ملكية موحّد + نسخ احتياطي (`pg_dump` + `storage`)
- [ ] النشر: systemd/Docker + Nginx + HTTPS + `NODE_ENV=production`

## 3) قرارات معلّقة (تحتاج تأكيد صاحب المشروع)
1. «ربط المشرف»: مشرف ذكي مخصّص لكل باحث، أم مشرف بشري (الأستاذ)، أم الاثنان؟ (الخطة تفترض الاثنان)
2. «الرولز»: أدوار أكاديمية (بكالوريوس/ماجستير/دكتوراه) أم أدوار نظام (user/supervisor/admin) أم الاثنان؟
3. المراجع: هل كل مرجع في المكتبة لازم يكون معه PDF، أم تُقبل بيانات ببليوغرافية بدون ملف؟
4. مسار البحث: خطوات مشتركة لكل درجة، أم نسخ خاصة لكل تخصص؟
