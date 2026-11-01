# 03 — Database

## Philosophy
- **PostgreSQL only:** Real relationships, atomicity, and transactions. All user data lives here — no Firestore.
- **Idempotent:** Every statement uses `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — run `db:init` and `db:seed` safely any number of times.
- **Safe fallback:** The code works before seeding (paths from `research-paths.js`, plans from `DEFAULT_PLANS`, permissions from `DEFAULT_ROLES`).

## Tables (20 total)

### Identity and Profile
| Table | Key Columns | Role |
|---|---|---|
| `users` | `id uuid`, `email unique`, `google_sub unique`, `role`, `plan_code → plans.code`, `tokens_balance/used/granted`, `onboarding_complete`, `is_active/disabled/deleted` | Account + balance + plan |
| `profiles` | `user_id unique → users`, `full_name`, `research_field/title`, `degree_level`, `university/faculty`, `research_stage`, `methodology`, `citation_style` | Research profile (one-to-one) |

### Plans and Roles
| Table | Key | Notes |
|---|---|---|
| `plans` | `code unique` | `tokens` = plan credits, `storage_mb` = storage allowance, `role_code` = assigned role, `features` = newline-delimited text |
| `roles` | `code pk` | System roles (admin/supervisor/researcher/free…) |
| `role_permissions` | `(role_code, permission)` | One permission per row |
| `admins` | `email unique` | Admins from the panel (in addition to `ADMIN_EMAILS`) |
| `supervisors` | `email unique` | Human supervisors — their role is `supervisor` |

### Journey and Progress
| Table | Relationship |
|---|---|
| `research_paths` | `degree_level unique` — one path per degree |
| `research_path_steps` | `path_id → paths` + `(path_id, step_no)` unique + semantic `step_key` |
| `user_step_progress` | `(user_id, step_key)` unique + `status` + `output_note` + `completed_at` |

> **Why is `step_key` semantic?** Because step order can change — progress is tied to meaning (`topic`, `literature`…), not to a number. It is also used in `notes.step_key`, `user_references.step_key`, and `files.step_key` to link them to the journey.

### Conversations and Memory
| Table | Contents |
|---|---|
| `conversations` | `user_id`, `title`, `step_key`, `mode` (normal/defense), `defense_state jsonb {asked}`, `references_found jsonb`, `pending_review jsonb` (step-completion review card), `provider` |
| `messages` | `conversation_id → conversations`, `role` (user/assistant), `content`, `tokens_used`, `model` |
| `supervisor_memory` | `user_id unique`, `memory` (≤1500 characters), `open_task` (≤300), `strikes`, `strikes_updated_at` |
| `ai_requests` | Each provider attempt: `provider/model/latency/status/error` — for diagnostics |
| `usage_logs` | Each usage event: `type/tokens_used/input_tokens/output_tokens/provider/model/multiplier/summary` — for billing and disputes |

> **Terminology note:** The interface says “credits” while the database says `tokens_*` — both refer to the same thing (usage balance). Here, `tokens` are platform currency, not language-model tokens.

### Workspace
| Table | Contents |
|---|---|
| `library_items` | Central library: `title/authors/year/venue/doi/external_url/stored_path/search_text` |
| `user_references` | Researcher references: `library_item_id?` or manually entered `custom_*` fields + `status` (to_read/reading/read/cited — four states) + `step_key` |
| `notes` | `title/body/tags/pinned/step_key/reference_id?` |
| `files` | `title/file_name/stored_path/mime/size_bytes/source/step_key` — bytes stored on disk |

### Payments, Notifications, and Settings
| Table | Contents |
|---|---|
| `payment_methods` | `code/label/note/details/currency/is_active/display_order` — configured by the admin |
| `payment_requests` | `user_id/plan_code/amount/method_code/txn_ref/status(pending/confirmed/rejected)/admin_note/handled_by` |
| `notifications` | In-app notifications for each user |
| `device_tokens` | FCM tokens for mobile devices |
| `settings` | Text `key/value` pairs — site currency, storage limits, support WhatsApp, platform name |

## Scripts
- `npm run db:init` → `src/db/init.js`: creates the database if missing + all tables + migrations + indexes + currency and payment-method seeds.
- `npm run db:seed` → `src/db/seed.js`: plans + settings + roles and their permissions + paths and their steps. Does not touch `is_active` or `is_default` — it does not override the admin’s decisions.
- `npm run db:reset` → init + seed together.

## Important Indexes
- `usage_logs(user_id, created_at)` — for fast statistics.
- `messages(conversation_id, created_at)` — for conversation history.
- `library_items(search_text)` — for tolerant Arabic search (see 08).
