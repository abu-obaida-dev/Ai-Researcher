# 03 — قاعدة البيانات

## الفلسفة
- **PostgreSQL فقط**: علاقات حقيقية + ذرّية + معاملات. كل بيانات المستخدمين هنا — لا Firestore.
- **Idempotent**: كل عبارة `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — شغّل `db:init` و`db:seed` بأمان أي عدد من المرات.
- **سقوط آمن**: الكود يعمل قبل البذرة (مسارات من `research-paths.js`، باقات من `DEFAULT_PLANS`، صلاحيات من `DEFAULT_ROLES`).

## الجداول (20 جدولاً)

### الهوية والملف
| الجدول | الأعمدة المفتاحية | الدور |
|---|---|---|
| `users` | `id uuid`, `email unique`, `google_sub unique`, `role`, `plan_code → plans.code`, `tokens_balance/used/granted`, `onboarding_complete`, `is_active/disabled/deleted` | الحساب + الرصيد + الباقة |
| `profiles` | `user_id unique → users`, `full_name`, `research_field/title`, `degree_level`, `university/faculty`, `research_stage`, `methodology`, `citation_style` | الملف البحثي (واحد لواحد) |

### الباقات والأدوار
| الجدول | المفتاح | ملاحظة |
|---|---|---|
| `plans` | `code unique` | `tokens` = نقاط الباقة، `storage_mb` = حصتها، `role_code` = دورها، `features` نص بأسطر |
| `roles` | `code pk` | أدوار النظام (admin/supervisor/researcher/free…) |
| `role_permissions` | `(role_code, permission)` | صلاحية واحدة لكل صف |
| `admins` | `email unique` | مديرون من اللوحة (إضافة لـ `ADMIN_EMAILS`) |
| `supervisors` | `email unique` | مشرفون بشريون — دورهم `supervisor` |

### المسار والتقدم
| الجدول | العلاقة |
|---|---|
| `research_paths` | `degree_level unique` — مسار لكل درجة |
| `research_path_steps` | `path_id → paths` + `(path_id, step_no)` unique + `step_key` الدلالي |
| `user_step_progress` | `(user_id, step_key)` unique + `status` + `output_note` + `completed_at` |

> **لماذا `step_key` دلالي؟** لأن ترتيب الخطوات قد يتغير — التقدم مربوط بالمعنى (`topic`, `literature`…) لا بالرقم. يُستخدم أيضاً في `notes.step_key` و`user_references.step_key` و`files.step_key` للربط بالمسار.

### المحادثات والذاكرة
| الجدول | المحتوى |
|---|---|
| `conversations` | `user_id`, `title`, `step_key`, `mode` (normal/defense), `defense_state jsonb {asked}`, `references_found jsonb`, `pending_review jsonb` (بطاقة مراجعة اكتمال الخطوة)، `provider` |
| `messages` | `conversation_id → conversations`, `role` (user/assistant), `content`, `tokens_used`, `model` |
| `supervisor_memory` | `user_id unique`, `memory` (≤1500 حرف), `open_task` (≤300), `strikes`, `strikes_updated_at` |
| `ai_requests` | كل محاولة مزوّد: `provider/model/latency/status/error` — للتشخيص |
| `usage_logs` | كل استهلاك: `type/tokens_used/input_tokens/output_tokens/provider/model/multiplier/summary` — للفوترة والاعتراضات |

> **ازدواج مصطلح:** الواجهة تقول «نقاط» والقاعدة تقول `tokens_*` — المقصود شيء واحد (رصيد الاستهلاك)، و`tokens` هنا ليس توكنات نموذج لغوي بل عملة المنصة.

### مساحة العمل
| الجدول | المحتوى |
|---|---|
| `library_items` | المكتبة المركزية: `title/authors/year/venue/doi/external_url/stored_path/search_text` |
| `user_references` | مراجع الباحث: `library_item_id?` أو حقول يدوية `custom_*` + `status` (to_read/reading/read/cited — أربع حالات) + `step_key` |
| `notes` | `title/body/tags/pinned/step_key/reference_id?` |
| `files` | `title/file_name/stored_path/mime/size_bytes/source/step_key` — البايتات على القرص |

### المدفوعات والإشعارات والإعدادات
| الجدول | المحتوى |
|---|---|
| `payment_methods` | `code/label/note/details/currency/is_active/display_order` — يضبطها المدير |
| `payment_requests` | `user_id/plan_code/amount/method_code/txn_ref/status(pending/confirmed/rejected)/admin_note/handled_by` |
| `notifications` | إشعارات داخلية لكل مستخدم |
| `device_tokens` | توكنات FCM للهاتف |
| `settings` | `key/value` نصية — عملة الموقع، حدود التخزين، واتساب الدعم، اسم المنصة |

## السكربتات
- `npm run db:init` → `src/db/init.js`: ينشئ القاعدة إن غابت + كل الجداول + الترقيات + الفهارس + بذرة العملة وطرق الدفع.
- `npm run db:seed` → `src/db/seed.js`: الباقات + الإعدادات + الأدوار وصلاحياتها + المسارات وخطواتها. لا يمس `is_active` ولا `is_default` — لا يلغي قرار المدير.
- `npm run db:reset` → init + seed معاً.

## الفهارس المهمة
- `usage_logs(user_id, created_at)` — للإحصاءات السريعة.
- `messages(conversation_id, created_at)` — لتاريخ المحادثة.
- `library_items(search_text)` — للبحث العربي المتسامح (انظر 08).
