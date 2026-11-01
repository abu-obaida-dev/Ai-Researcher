import pg from 'pg';
import dotenv from 'dotenv';
import {
  resolveDatabaseTarget,
  adminConnectionString,
  describeDatabaseError
} from './errors.js';
import { DEFAULT_PAYMENT_METHODS } from '../constants.js';

dotenv.config();

const { Pool } = pg;

/** PostgreSQL schema for application data and authentication. Firebase is used only for push delivery. */

/** User identity, role, account state, and balance. */
const USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    photo_url TEXT,
    google_sub VARCHAR(255) UNIQUE,
    role VARCHAR(50) DEFAULT 'user',
    plan_code VARCHAR(100),
    tokens_balance INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    tokens_granted INTEGER NOT NULL DEFAULT 0,
    onboarding_complete BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    disabled BOOLEAN DEFAULT false,
    deleted BOOLEAN DEFAULT false,
    last_login_at TIMESTAMPTZ,
    plan_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** One-to-one research profile for each user. */
const PROFILES_TABLE = `
  CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    age INTEGER,
    research_field VARCHAR(255),
    research_title TEXT,
    degree_level VARCHAR(100),
    academic_year VARCHAR(100),
    university VARCHAR(255),
    faculty VARCHAR(255),
    research_interests TEXT,
    preferred_language VARCHAR(50) DEFAULT 'ar',
    about TEXT,
    research_stage VARCHAR(100) DEFAULT 'topic',
    methodology TEXT,
    citation_style VARCHAR(50) DEFAULT 'apa7',
    supervisor_name VARCHAR(255),
    supervisor_notes TEXT,
    whatsapp_number VARCHAR(20),
    wa_country VARCHAR(2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Plans and administrator-managed storage limits. */
const PLANS_TABLE = `
  CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    tagline TEXT,
    price DECIMAL(10,2) DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    storage_mb INTEGER NOT NULL DEFAULT 500,
    max_file_mb INTEGER NOT NULL DEFAULT 100,
    period VARCHAR(100) DEFAULT 'شهرياً',
    period_days INTEGER,
    features TEXT,
    cta VARCHAR(100) DEFAULT 'اشترك الآن',
    popular BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** System roles and their permissions. */
const ROLES_TABLE = `
  CREATE TABLE IF NOT EXISTS roles (
    code VARCHAR(50) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    level INTEGER NOT NULL DEFAULT 0,
    is_system BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

const ROLE_PERMISSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_code VARCHAR(50) NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
    permission VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (role_code, permission)
  );
`;

/** One research path per degree level. */
const RESEARCH_PATHS_TABLE = `
  CREATE TABLE IF NOT EXISTS research_paths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    degree_level VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Research-path steps; cost_type must match TOKEN_COSTS. */
const RESEARCH_PATH_STEPS_TABLE = `
  CREATE TABLE IF NOT EXISTS research_path_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path_id UUID NOT NULL REFERENCES research_paths(id) ON DELETE CASCADE,
    step_no INTEGER NOT NULL,
    step_key VARCHAR(100),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    cost_type VARCHAR(100) NOT NULL DEFAULT 'chat',
    is_required BOOLEAN DEFAULT true,
    guidance TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (path_id, step_no)
  );
`;

/** Current research path for each user. */
const USER_PATHS_TABLE = `
  CREATE TABLE IF NOT EXISTS user_paths (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    path_id UUID NOT NULL REFERENCES research_paths(id) ON DELETE RESTRICT,
    current_step_no INTEGER NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Per-user progress keyed by stable step_key, with optional database step_id. */
const USER_STEP_PROGRESS_TABLE = `
  CREATE TABLE IF NOT EXISTS user_step_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    step_key VARCHAR(100) NOT NULL,
    step_id UUID REFERENCES research_path_steps(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'not_started',
    output_note TEXT,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, step_key)
  );
`;

/** Shared scientific library. */
const LIBRARY_ITEMS_TABLE = `
  CREATE TABLE IF NOT EXISTS library_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    authors TEXT,
    year INTEGER,
    source VARCHAR(255),
    abstract TEXT,
    stored_path TEXT,
    degree_level VARCHAR(100),
    field VARCHAR(255),
    citation_style VARCHAR(50) DEFAULT 'apa7',
    citation_text TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Idempotent library schema upgrades. */
const LIBRARY_EXTRA_COLUMNS = `
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS file_name TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS mime VARCHAR(100);
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS external_url TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS source_system VARCHAR(50) NOT NULL DEFAULT 'upload';
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS subjects TEXT;
  -- Normalized search text supports common Arabic spelling variants.
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
`;

/** User references linked to library items or entered manually. */
const USER_REFERENCES_TABLE = `
  CREATE TABLE IF NOT EXISTS user_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    library_item_id UUID REFERENCES library_items(id) ON DELETE SET NULL,
    custom_title VARCHAR(500),
    custom_authors TEXT,
    custom_year INTEGER,
    custom_source VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'to_read',
    note TEXT,
    step_id UUID REFERENCES research_path_steps(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** User notes with optional step and reference links. */
const NOTES_TABLE = `
  CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    tags TEXT,
    pinned BOOLEAN DEFAULT false,
    step_id UUID REFERENCES research_path_steps(id) ON DELETE SET NULL,
    reference_id UUID REFERENCES user_references(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** User file metadata; file bytes are stored under storage/users/. */
const FILES_TABLE = `
  CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    stored_path TEXT NOT NULL,
    mime VARCHAR(100),
    size_bytes INTEGER NOT NULL DEFAULT 0,
    source VARCHAR(50) NOT NULL DEFAULT 'upload',
    step_id UUID REFERENCES research_path_steps(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Supervisor conversations; usage is recorded in usage_logs. */
const CONVERSATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    step_id UUID REFERENCES research_path_steps(id) ON DELETE SET NULL,
    provider VARCHAR(100),
    references_found JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Adds stored reference results to existing conversations. */
const CONVERSATIONS_REFERENCES_UPGRADE = `
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS references_found JSONB;
`;

/** Stores pending step reviews until the user accepts them. */
const CONVERSATIONS_PENDING_REVIEW_UPGRADE = `
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_review JSONB;
`;

const MESSAGES_TABLE = `
  CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    model VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Separate conversation and message tables for the teaching assistant. */
const ASSISTANT_CONVERSATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS assistant_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    provider VARCHAR(100),
    sources_found JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

const ASSISTANT_MESSAGES_TABLE = `
  CREATE TABLE IF NOT EXISTS assistant_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    model VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

const ASSISTANT_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user ON assistant_conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation ON assistant_messages(conversation_id);
  -- سياق آخر بحث للمتابعة: «نعم أعد البحث بالأولى» ⇒ نفس الموضوع وآخر عبارة مقترحة.
  ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS last_query VARCHAR(255);
  ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS last_task VARCHAR(50);
`;

/** Separate teaching-assistant memory; supervisor and defense sessions are never stored here. */
const ASSISTANT_MEMORY_TABLE = `
  CREATE TABLE IF NOT EXISTS assistant_memory (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    memory TEXT NOT NULL DEFAULT '',
    open_task VARCHAR(300) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** AI-provider latency and error monitoring. */
const AI_REQUESTS_TABLE = `
  CREATE TABLE IF NOT EXISTS ai_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    provider VARCHAR(100) NOT NULL,
    model VARCHAR(255),
    latency_ms INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'ok',
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;
const USAGE_LOGS_TABLE = `
  CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Administrator-managed platform settings. */
const SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** In-app notifications; Firebase Cloud Messaging is optional and used only for push delivery. */
const NOTIFICATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    kind VARCHAR(50) NOT NULL DEFAULT 'system',
    url TEXT NOT NULL DEFAULT '/account',
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Registered push-notification device tokens. */
const DEVICE_TOKENS_TABLE = `
  CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'web',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, token)
  );
`;

/** Adds notification preferences to existing users. */
const USERS_NOTIFICATIONS_COLUMN = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT false;
`;

/** Idempotent notification indexes. */
const NOTIFICATION_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read = false;
  CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id) WHERE enabled = true;
`;

/** Database-managed administrators; ADMIN_EMAILS remains the recovery path. */
const ADMINS_TABLE = `
  CREATE TABLE IF NOT EXISTS admins (
    email VARCHAR(255) PRIMARY KEY,
    added_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Administrator-managed manual payment methods. */
const PAYMENT_METHODS_TABLE = `
  CREATE TABLE IF NOT EXISTS payment_methods (
    code VARCHAR(50) PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    note VARCHAR(255),
    details TEXT,
    currency VARCHAR(10) NOT NULL DEFAULT 'LYD',
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Manual payment requests awaiting administrator review. */
const PAYMENT_REQUESTS_TABLE = `
  CREATE TABLE IF NOT EXISTS payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_code VARCHAR(100),
    method_code VARCHAR(50),
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'LYD',
    reference_no VARCHAR(120),
    reference_code VARCHAR(6),
    whatsapp_number VARCHAR(20),
    note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    handled_by VARCHAR(255),
    handled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Indexes for recent and pending payment requests. */
const PAYMENT_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON payment_requests (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payment_requests_reference_code ON payment_requests (reference_code);
`;

/** Database triggers prevent administrator accounts from being disabled or deleted. */
const ADMIN_ACCOUNT_GUARD = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_admin_account') THEN
    CREATE OR REPLACE FUNCTION guard_admin_account() RETURNS trigger AS $fn$
    BEGIN
      IF OLD.role = 'admin' AND (NEW.is_active IS DISTINCT FROM TRUE OR NEW.deleted IS DISTINCT FROM false) THEN
        RAISE EXCEPTION 'حساب المدير محمي: لا يمكن إيقافه أو تعطيله.';
      END IF;
      IF OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'حساب المدير محمي: لا يمكن تغيير دوره إلا بتغيير ADMIN_EMAILS في .env.';
      END IF;
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE TRIGGER guard_admin_account
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION guard_admin_account();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_admin_delete') THEN
    CREATE OR REPLACE FUNCTION guard_admin_delete() RETURNS trigger AS $fn$
    BEGIN
      IF OLD.role = 'admin' THEN
        RAISE EXCEPTION 'حساب المدير محمي: لا يمكن حذفه من قاعدة البيانات.';
      END IF;
      RETURN OLD;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE TRIGGER guard_admin_delete
      BEFORE DELETE ON users
      FOR EACH ROW EXECUTE FUNCTION guard_admin_delete();
  END IF;
END $$;
`;
/**
 * Uses the same Arabic normalization as the literature service so stored and queried text match.
 */
function normalizeArabic(text) {
  return String(text || '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

/** Backfills normalized search text for older library items. */
async function backfillLibrarySearchText(pool) {
  const { rows } = await pool.query(
    `SELECT id, title, authors, source, subjects, field, external_url
       FROM library_items
      WHERE search_text = ''`
  );
  if (!rows.length) return;

  for (const row of rows) {
    const searchText = normalizeArabic(
      [row.title, row.authors, row.source, row.subjects, row.field, row.external_url].filter(Boolean).join(' ')
    );
    await pool.query('UPDATE library_items SET search_text = $2 WHERE id = $1', [row.id, searchText]);
  }
  console.log(`   · تم تحديث نصّ البحث لـ ${rows.length} عنصر مكتبة.`);
}

/** Default site-currency seed. */
const SETTINGS_CURRENCY_SEED = `
  INSERT INTO settings (key, value, updated_at)
  VALUES ('site_currency', 'LYD', NOW())
  ON CONFLICT (key) DO NOTHING;
`;

/** Academic supervisors and their separately managed permissions. */
const SUPERVISORS_TABLE = `
  CREATE TABLE IF NOT EXISTS supervisors (
    email VARCHAR(255) PRIMARY KEY,
    added_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Indexes for frequently queried tables. */
const INDEXES = `
  CREATE INDEX IF NOT EXISTS usage_logs_user_id_created_at_idx
    ON usage_logs (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS users_plan_code_idx
    ON users (plan_code);
  CREATE INDEX IF NOT EXISTS idx_path_steps_path ON research_path_steps(path_id, step_no);
  CREATE INDEX IF NOT EXISTS idx_progress_user ON user_step_progress(user_id);
  CREATE INDEX IF NOT EXISTS idx_library_active ON library_items(is_active) WHERE is_active = true;
  CREATE INDEX IF NOT EXISTS idx_library_field ON library_items(field);
  CREATE INDEX IF NOT EXISTS idx_library_search ON library_items(search_text);
  CREATE INDEX IF NOT EXISTS idx_user_refs_user ON user_references(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_refs_library ON user_references(library_item_id);
  CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(user_id, pinned) WHERE pinned = true;
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_ai_requests_user ON ai_requests(user_id);
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id);
`;

/** Idempotent upgrades for existing databases. */
const USERS_EXTRA_COLUMNS = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_code VARCHAR(100);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_balance INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_granted INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
  -- تصنيف النشاط: آخر دخول + انتهاء الباقة (يُضبطان تلقائياً مع الدخول وتأكيد الدفع)
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
`;

const USERS_GOOGLE_SUB_UNIQUE = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_google_sub_unique') THEN
      ALTER TABLE users ADD CONSTRAINT users_google_sub_unique UNIQUE (google_sub);
    END IF;
  END $$;
`;

/** Adds plan-display fields to existing schemas. */
const PLANS_EXTRA_COLUMNS = `
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS tagline TEXT;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS period VARCHAR(100) DEFAULT 'شهرياً';
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS features TEXT;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS cta VARCHAR(100) DEFAULT 'اشترك الآن';
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS popular BOOLEAN DEFAULT false;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS role_code VARCHAR(50);
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS storage_mb INTEGER NOT NULL DEFAULT 500;
  -- أقصى حجم للملف الواحد (MB) لكل باقة — حدّ المنصة العام (settings) أُلغي بقرار المنصة
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_file_mb INTEGER NOT NULL DEFAULT 100;
  -- مدة الباقة بالأيام (يُحسب منها plan_expires_at عند تأكيد الدفع) — NULL = لا تنتهي (مجانية)
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS period_days INTEGER;
`;

/** Adds activation-code and WhatsApp fields to existing payment requests. */
const PAYMENT_REQUESTS_EXTRA_COLUMNS = `
  ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS reference_code VARCHAR(6);
  ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20);
  -- الطريقتان ثابّتتان فقط (تحويل بنكي / كاش) — لا يدير المدير طرق الدفع بعد الآن
  UPDATE payment_methods SET is_active = false WHERE code NOT IN ('bank_transfer', 'cash_office');
`;

/** Adds remaining onboarding profile fields. */
const PROFILES_EXTRA_COLUMNS = `
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS age INTEGER;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS academic_year VARCHAR(100);
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faculty VARCHAR(255);
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS research_interests TEXT;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS research_stage VARCHAR(100) DEFAULT 'topic';
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS methodology TEXT;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS citation_style VARCHAR(50) DEFAULT 'apa7';
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS supervisor_name VARCHAR(255);
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS supervisor_notes TEXT;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20);
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wa_country VARCHAR(2);
`;

/** Backfills country codes for legacy WhatsApp numbers. */
const WA_COUNTRY_BACKFILL = `
  UPDATE profiles SET wa_country = CASE
    WHEN whatsapp_number LIKE '+218%' THEN 'LY'
    WHEN whatsapp_number LIKE '+20%' THEN 'EG'
    WHEN whatsapp_number LIKE '+966%' THEN 'SA'
    WHEN whatsapp_number LIKE '+971%' THEN 'AE'
    WHEN whatsapp_number LIKE '+965%' THEN 'KW'
    WHEN whatsapp_number LIKE '+974%' THEN 'QA'
    WHEN whatsapp_number LIKE '+973%' THEN 'BH'
    WHEN whatsapp_number LIKE '+968%' THEN 'OM'
    WHEN whatsapp_number LIKE '+964%' THEN 'IQ'
    WHEN whatsapp_number LIKE '+962%' THEN 'JO'
    WHEN whatsapp_number LIKE '+961%' THEN 'LB'
    WHEN whatsapp_number LIKE '+963%' THEN 'SY'
    WHEN whatsapp_number LIKE '+970%' THEN 'PS'
    WHEN whatsapp_number LIKE '+967%' THEN 'YE'
    WHEN whatsapp_number LIKE '+249%' THEN 'SD'
    WHEN whatsapp_number LIKE '+212%' THEN 'MA'
    WHEN whatsapp_number LIKE '+213%' THEN 'DZ'
    WHEN whatsapp_number LIKE '+216%' THEN 'TN'
    WHEN whatsapp_number LIKE '+222%' THEN 'MR'
    WHEN whatsapp_number LIKE '+252%' THEN 'SO'
    WHEN whatsapp_number LIKE '+253%' THEN 'DJ'
    WHEN whatsapp_number LIKE '+269%' THEN 'KM'
    ELSE 'LY'
  END
  WHERE (wa_country IS NULL OR wa_country = '') AND whatsapp_number IS NOT NULL AND whatsapp_number <> '';
`;

/** Adds the plan foreign key when missing. */
const USERS_PLAN_FOREIGN_KEY = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_code_fkey') THEN
      ALTER TABLE users
        ADD CONSTRAINT users_plan_code_fkey FOREIGN KEY (plan_code)
        REFERENCES plans(code) ON DELETE SET NULL;
    END IF;
  END $$;
`;

/** Adds stable step_key links for seeded and runtime-defined research paths. */
const STEP_KEY_UPGRADE = `
  ALTER TABLE research_path_steps ADD COLUMN IF NOT EXISTS step_key VARCHAR(100);
  ALTER TABLE user_references ADD COLUMN IF NOT EXISTS step_key VARCHAR(100);
  ALTER TABLE notes ADD COLUMN IF NOT EXISTS step_key VARCHAR(100);
  ALTER TABLE files ADD COLUMN IF NOT EXISTS step_key VARCHAR(100);
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS step_key VARCHAR(100);
  ALTER TABLE user_step_progress ADD COLUMN IF NOT EXISTS step_key VARCHAR(100);
  UPDATE user_step_progress SET step_key = 'legacy-' || step_id::text WHERE step_key IS NULL;
  UPDATE user_step_progress p SET step_key = s.step_key
    FROM research_path_steps s WHERE p.step_id = s.id AND s.step_key IS NOT NULL;
  -- مفتاح جدول التقدم كان (user_id, step_id) — يُسقط أولاّ ثم يصبح (user_id, step_key)
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_step_progress_pkey') THEN
      ALTER TABLE user_step_progress DROP CONSTRAINT user_step_progress_pkey;
    END IF;
  END $$;
  ALTER TABLE user_step_progress ALTER COLUMN step_id DROP NOT NULL;
  ALTER TABLE user_step_progress ALTER COLUMN step_key SET NOT NULL;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_step_progress_pkey') THEN
      ALTER TABLE user_step_progress ADD CONSTRAINT user_step_progress_pkey PRIMARY KEY (user_id, step_key);
    END IF;
  END $$;
`;

/** One supervisor-memory row per user. */
const SUPERVISOR_MEMORY_TABLE = `
  CREATE TABLE IF NOT EXISTS supervisor_memory (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    memory TEXT NOT NULL DEFAULT '',
    open_task TEXT NOT NULL DEFAULT '',
    strikes INTEGER NOT NULL DEFAULT 0,
    strikes_updated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** Adds usage details and independent defense-session state. */
const SUPERVISOR_UPGRADE = `
  ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
  ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
  ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS provider VARCHAR(100);
  ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS model VARCHAR(255);
  ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS price_multiplier NUMERIC(6,2);
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'normal';
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS defense_state JSONB NOT NULL DEFAULT '{}'::jsonb;
  -- المشرف صار إدارياً: صلاحياته كلها في اللوحة، فيُسقَط ما تبقّى من صلاحيات الباحث القديمة.
  DELETE FROM role_permissions WHERE role_code = 'supervisor' AND permission NOT IN ('dashboard:view', 'admin:panel', 'admin:users', 'admin:library', 'admin:usage', 'admin:payments');
  -- صفحة المزوّدين حُذفت بقرار المنصة ⇒ صلاحيتها وإعدادات روابطها المخصّصة تُنظَّف من القاعدة.
  DELETE FROM role_permissions WHERE permission = 'admin:providers';
  DELETE FROM settings WHERE key = 'ai_custom_links';
`;

/** Indexes for supervisor memory queries. */
const SUPERVISOR_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON usage_logs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
`;

/** Indexes for stable step keys. */
const STEP_KEY_INDEXES = `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_path_steps_key ON research_path_steps(path_id, step_key) WHERE step_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_user_refs_step_key ON user_references(user_id, step_key);
  CREATE INDEX IF NOT EXISTS idx_notes_step_key ON notes(user_id, step_key);
  CREATE INDEX IF NOT EXISTS idx_files_step_key ON files(user_id, step_key);
  CREATE INDEX IF NOT EXISTS idx_conversations_step_key ON conversations(user_id, step_key);
`;

/** Creates the target database when missing, then initializes its schema. */
async function ensureDatabaseExists(target) {
  const adminPool = new Pool({
    connectionString: adminConnectionString(target.connectionString),
    connectionTimeoutMillis: 5000
  });

  try {
    const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      target.database
    ]);

    if (result.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE "${target.database}"`);
      console.log(`تم إنشاء قاعدة البيانات "${target.database}".`);
    }
  } catch (error) {
    console.warn(
      `تنبيه: تعذّر التحقق من وجود قاعدة البيانات "${target.database}" (${error.code || error.message}).`
    );
  } finally {
    await adminPool.end();
  }
}

async function initializeDatabase() {
  let target;
  let pool;

  try {
    target = resolveDatabaseTarget();
    await ensureDatabaseExists(target);

    pool = new Pool({
      connectionString: target.connectionString,
      connectionTimeoutMillis: 5000
    });

    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await pool.query(USERS_TABLE);
    await pool.query(PROFILES_TABLE);
    await pool.query(PLANS_TABLE);
    await pool.query(ROLES_TABLE);
    await pool.query(ROLE_PERMISSIONS_TABLE);
    await pool.query(RESEARCH_PATHS_TABLE);
    await pool.query(RESEARCH_PATH_STEPS_TABLE);
    await pool.query(USER_PATHS_TABLE);
    await pool.query(USER_STEP_PROGRESS_TABLE);
    await pool.query(LIBRARY_ITEMS_TABLE);
    await pool.query(USER_REFERENCES_TABLE);
    await pool.query(NOTES_TABLE);
    await pool.query(FILES_TABLE);
    await pool.query(CONVERSATIONS_TABLE);
    await pool.query(MESSAGES_TABLE);
    await pool.query(ASSISTANT_CONVERSATIONS_TABLE);
    await pool.query(ASSISTANT_MESSAGES_TABLE);
    await pool.query(ASSISTANT_MEMORY_TABLE);
    await pool.query(AI_REQUESTS_TABLE);
    await pool.query(USAGE_LOGS_TABLE);
    await pool.query(SETTINGS_TABLE);
    await pool.query(NOTIFICATIONS_TABLE);
    await pool.query(DEVICE_TOKENS_TABLE);
    await pool.query(ADMINS_TABLE);
    await pool.query(SUPERVISORS_TABLE);
    await pool.query(PAYMENT_METHODS_TABLE);
    await pool.query(PAYMENT_REQUESTS_TABLE);
    await pool.query(SUPERVISOR_MEMORY_TABLE);
    // Apply idempotent upgrades to existing databases.
    await pool.query(USERS_EXTRA_COLUMNS);
    await pool.query(USERS_NOTIFICATIONS_COLUMN);
    await pool.query(PROFILES_EXTRA_COLUMNS);
    await pool.query(WA_COUNTRY_BACKFILL);
    await pool.query(PAYMENT_REQUESTS_EXTRA_COLUMNS);
    await pool.query(PLANS_EXTRA_COLUMNS);
    await pool.query(LIBRARY_EXTRA_COLUMNS);
    await pool.query(USERS_GOOGLE_SUB_UNIQUE);
    await pool.query(USERS_PLAN_FOREIGN_KEY);
    await pool.query(STEP_KEY_UPGRADE);
    await pool.query(CONVERSATIONS_REFERENCES_UPGRADE);
    await pool.query(CONVERSATIONS_PENDING_REVIEW_UPGRADE);
    await pool.query(SUPERVISOR_UPGRADE);
    await pool.query(ADMIN_ACCOUNT_GUARD);
    await pool.query(INDEXES);
    await pool.query(STEP_KEY_INDEXES);
    await pool.query(NOTIFICATION_INDEXES);
    await pool.query(SUPERVISOR_INDEXES);
    await pool.query(ASSISTANT_INDEXES);
    await pool.query(PAYMENT_INDEXES);

    // Seed defaults without overwriting administrator-managed settings.
    await pool.query(SETTINGS_CURRENCY_SEED);
    for (const [index, method] of DEFAULT_PAYMENT_METHODS.entries()) {
      await pool.query(
        `INSERT INTO payment_methods (code, label, note, details, currency, is_active, display_order)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT (code) DO NOTHING`,
        [method.code, method.label, method.note, method.details, method.currency, index]
      );
    }

    // Backfill normalized search text for older library items.
    await backfillLibrarySearchText(pool);

    console.log(`Database initialized successfully on ${target.host}:${target.port}/${target.database}.`);
    console.log('الخطوة التالية (اختيارية): npm run db:seed لإضافة الباقات الافتراضية.');
  } catch (error) {
    console.error(describeDatabaseError(error, target, 'تهيئة قاعدة البيانات'));
    process.exitCode = 1;
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

initializeDatabase();

