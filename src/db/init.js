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

/**
 * مخطط قاعدة البيانات — Node.js + PostgreSQL فقط للدخول والبيانات.
 * Firebase يُستخدم حصرياً لقناة إشعارات الدفع (FCM) — لا مصادقة Firebase ولا Firestore.
 * مستمد من النسخة السابقة للمنصة (Firestore): مستند UserDoc في مجموعة users
 * + المجموعة الفرعية للاستهلاك + الباقات + إعدادات المنصة وقائمة المديرين
 * + المجموعة الفرعية للإشعارات ونقطةات أجهزة FCM.
 */

/** جدول المستخدمين: الهوية من جوجل + الدور + الحالة + الرصيد. */
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** الملف البحثي لكل مستخدم (علاقة واحد لواحد مع users) — يقابل حقل profile في UserDoc. */
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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** الباقات المتاحة — تُدار من جدول plans كما كانت تُدار من مجموعة plans في Firestore.
 *  storage_mb = حصة التخزين التي يمنحها المدير لهذه الباقة (تعديله من لوحة الباقات فقط). */
const PLANS_TABLE = `
  CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    tagline TEXT,
    price DECIMAL(10,2) DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    storage_mb INTEGER NOT NULL DEFAULT 500,
    period VARCHAR(100) DEFAULT 'شهرياً',
    features TEXT,
    cta VARCHAR(100) DEFAULT 'اشترك الآن',
    popular BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** أدوار النظام + صلاحياتها (P2 يفعّل requireRole — هنا البنية فقط). */
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

/** مسارات البحث: مسار واحد لكل درجة (بكالوريوس/ماجستير/دكتوراه/دبلوم/باحث مستقل). */
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

/** خطوات كل مسار — cost_type يطابق TOKEN_COSTS في constants.js (chat/translate/outline/sources/review). */
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

/** مسار الباحث الحالي (صف واحد لكل مستخدم). */
const USER_PATHS_TABLE = `
  CREATE TABLE IF NOT EXISTS user_paths (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    path_id UUID NOT NULL REFERENCES research_paths(id) ON DELETE RESTRICT,
    current_step_no INTEGER NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/**
 * تقدم الباحث في كل خطوة (لم يبدأ/جاري/تم + ملاحظة المخرجات).
 * step_key هو المعرّف الدلالي للخطوة ('topic'، 'proposal'، …) لأنه يبقى ثابتاٌ سواء
 * جاءت الخطوات من قاعدة البيانات (بعد db:seed) أو من التعريفات في src/data/research-paths.js،
 * فيبقى تقدّم الباحث صحيحاٌ في الحالتين. step_id يبقى اختيارياٌ للخطوات المخزّنة.
 */
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

/** المكتبة العلمية المركزية — يرفعها المدير مرة واحدة ويشير إليها كل باحث. */
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

/** ترقيات آمنة لجدول المكتبة (ملف الكتاب + مصدر الاستيراد) — idempotent. */
const LIBRARY_EXTRA_COLUMNS = `
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS file_name TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS mime VARCHAR(100);
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS external_url TEXT;
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS source_system VARCHAR(50) NOT NULL DEFAULT 'upload';
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS subjects TEXT;
  -- نصّ بحث مطبَّع (بلا همزات/تاء مربوطة) ليجد الباحث العنصر بأي إملاء:
  -- «اداره التغير» و«إدارة التغيير» و«ادارة التغيير» كلها تُطابق.
  ALTER TABLE library_items ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
`;

/** مراجع الباحث: رابط لعنصر المكتبة أو مرجع يدوي — مع حالة القراءة وربط اختياري بخطوة. */
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

/** مفكرة الباحث: ملاحظات شخصية مع تثبيت ووسوم وربط اختياري بخطوة أو مرجع. */
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

/** ملفات الباحث: الميتاداتا في PostgreSQL والبايتات في storage/users/. */
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

/** محادثات المشرف الذكي + رسائلها (تكلفة النقاط تُسجَّل في usage_logs). */
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

/** ترقية جدول المحادثات: نتائج أداة المراجع (JSONB) لعرضها تحت الرد. */
const CONVERSATIONS_REFERENCES_UPGRADE = `
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS references_found JSONB;
`;

/** ترقية بطاقة مراجعة اكتمال الخطوة (1F): تُملأ كشفياً بعد الرد ولا تُكتب في المسار إلا بحفظ الباحث. */
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

/** مراقبة مزودي الذكاء الاصطناعي (زمن الاستجابة والحالة والأخطاء). */
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

/** إعدادات المنصة القابلة للتحرير (اسم المنصة، الدعم، وضع الصيانة، الإعلان). */
const SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/**
 * Firebase للإشعارات فقط — الدخول يبقى Google OAuth والبيانات في PostgreSQL.
 *
 * توضيح مهم: Firebase هنا = Cloud Messaging (FCM) لإرسال إشعارات الدفع فقط.
 * لا نستخدم Firebase Authentication ولا Firestore إطلاقاً: الدخول يتم عبر
 * Google OAuth 2.0 من Google Cloud Console، وكل بيانات المستخدمين في PostgreSQL.
 *
 * إعدادات الواجهة (مكتبة Firebase JS للإشعارات فقط، لا Auth ولا Firestore):
 *   FIREBASE_API_KEY / FIREBASE_AUTH_DOMAIN / FIREBASE_PROJECT_ID
 *   FIREBASE_STORAGE_BUCKET / FIREBASE_MESSAGING_SENDER_ID / FIREBASE_APP_ID
 *   FIREBASE_VAPID_KEY (اختياري — مفتاح Web Push من Cloud Messaging)
 *
 * الإرسال من الخادم عبر Firebase Admin SDK (FCM):
 *   FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY (من Service Account)
 * الاعتماد firebase-admin اختياري: بدونه تُحفظ الإشعارات داخل الموقع فقط.
 *
 * إشعارات داخل التطبيق لكل مستخدم (بديل مجموعة users/{uid}/notifications في النسخة القديمة).
 */
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

/** نقطةات أجهزة الإشعارات (FCM) — بديل حقل fcmTokens الذي كان في مستند Firestore. */
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

/** ترقية تفضيل الإشعارات على جدول users (يقابل notificationsEnabled في النسخة القديمة). */
const USERS_NOTIFICATIONS_COLUMN = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT false;
`;

/** فهارس الإشعارات والنقطةات — تُنشأ مرة واحدة فقط (idempotent). */
const NOTIFICATION_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read = false;
  CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id) WHERE enabled = true;
`;

/**
 * إيميلات المديرين (يعدّلها المدير بنفسه من الإعدادات فقط).
 * تُقرأ مع ADMIN_EMAILS من .env (خطة نجاة ثابتة لا تُحذف).
 */
const ADMINS_TABLE = `
  CREATE TABLE IF NOT EXISTS admins (
    email VARCHAR(255) PRIMARY KEY,
    added_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/**
 * طرق الدفع اليدوية — يضيفها المدير ويعدّلها من صفحة الإعدادات.
 * كل طريقة تحمل عملتها (LYD/USD) وتفاصيل التحويل (رقم الحساب/الIBAN) التي
 * يراها الباحث عند تقديم طلب الدفع، والمدير عند التأكيد.
 */
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

/**
 * طلبات الدفع: الباحث يطلب باقة ويدفع خارج المنصة (يدوي)، والمدير يؤكد.
 * عند التأكيد: يُنقل الب researcher إلى باقته وتُضاف نقاطها (من services/plans).
 */
const PAYMENT_REQUESTS_TABLE = `
  CREATE TABLE IF NOT EXISTS payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_code VARCHAR(100),
    method_code VARCHAR(50),
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'LYD',
    reference_no VARCHAR(120),
    note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    handled_by VARCHAR(255),
    handled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** فهارس لطلبات الدفع (أحدث الطلبات + الطلبات المعلّقة للمراجعة). */
const PAYMENT_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON payment_requests (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests (status, created_at DESC);
`;

/**
 * حماية قاعدة بيانات لحساب المدير (طبقة أخيرة — لا تعتمد على الكود وحده):
 * يمنع إيقاف/تعطيل أي مستخدم دوره admin حتى لو مرّ استعلام مباشر على القاعدة.
 * مُطبَّق كـ trigger على users. آمن للتشغيل المتكرر (إذا كان غير موجود).
 */
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
 * يوحّد الهمزات والتاء المربوطة ويزيل التشكيل — نفس التطبيع الذي تستخدمه
 * خدمة المراجع، حتى يتطابق نصّ البحث المخزَّن مع ما يكتبه الباحث.
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

/** يبني نصّ البحث المطبَّع لعنصر مكتبة (يُخزَّن في library_items.search_text). */
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

/** مفتاح عملة الموقع في جدول settings (يضبطه المدير من الإعدادات). */
const SETTINGS_CURRENCY_SEED = `
  INSERT INTO settings (key, value, updated_at)
  VALUES ('site_currency', 'LYD', NOW())
  ON CONFLICT (key) DO NOTHING;
`;

/**
 * المشرفون الأكاديميون — بديل صفحة «المديرين».
 * يُضاف بريد المشرف من صفحة الإعدادات، ويأخذ دور supervisor وصلاحياته في
 * جدول role_permissions (يضبطها المدير مثل أي باحث). لا يوجد «مدير» إلا
 * إيميلات ADMIN_EMAILS في .env كخطة نجاة واحدة.
 */
const SUPERVISORS_TABLE = `
  CREATE TABLE IF NOT EXISTS supervisors (
    email VARCHAR(255) PRIMARY KEY,
    added_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** فهارس مساعدة لتسريع الاستعلامات الأكثر استخداماً. */
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

/**
 * ترقية آمنة لقواعد البيانات القائمة (أُنشئت قبل توسيع المخطط):
 * كل عبارة idempotent — تُنفَّذ فقط إن كان العمود/القيد ناقصاً.
 */
const USERS_EXTRA_COLUMNS = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_code VARCHAR(100);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_balance INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_granted INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false;
`;

const USERS_GOOGLE_SUB_UNIQUE = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_google_sub_unique') THEN
      ALTER TABLE users ADD CONSTRAINT users_google_sub_unique UNIQUE (google_sub);
    END IF;
  END $$;
`;

/** ترقية جدول الباقات: أعمدة العرض التي تُبنى منها بطاقات الأسعار في الموقع. */
const PLANS_EXTRA_COLUMNS = `
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS tagline TEXT;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS period VARCHAR(100) DEFAULT 'شهرياً';
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS features TEXT;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS cta VARCHAR(100) DEFAULT 'اشترك الآن';
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS popular BOOLEAN DEFAULT false;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS role_code VARCHAR(50);
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS storage_mb INTEGER NOT NULL DEFAULT 500;
`;

/** ترقية جدول الملف البحثي: بقية حقول نموذج التسجيل (onboarding). */
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
`;

/** ربط plan_code بجدول الباقات — يُضاف مرة واحدة فقط (idempotent). */
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

/**
 * ترقية المرحلة الأولى: ربط التقدم والملاحظات والمراجع والملفات بـ step_key
 * (المعرّف الدلالي للخطوة) بدل step_id وحده، حتى يعمل «مسار البحث» من
 * التعريفات البرمجية في src/data/research-paths.js بدون الحاجة إلى البذرة.
 * كل عبارة idempotent وتعمل على قاعدة قائمة أو جديدة.
 */
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

/**
 * ذاكرة المشرف الذكي لكل باحث (صف واحد لكل مستخدم).
 * ما تُخزَّن هنا لا يحسبه البرومبت بل الكود فقط:
 *   memory         → {{memory_summary}} ملخّص ما استقرّ في جلسات سابقة
 *   open_task      → {{open_task}} المهمة المتفق عليها للمرة القادمة
 *   strikes        → {{strikes}} عدّاد التنبيهات على الخروج عن النطاق/الاستهجار
 *   strikes_updated_at → لتصفير العدّاد بعد فترة هدوء
 */
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

/**
 * ترقية المشرف الذكي:
 * - usage_logs: تفصيل الاستهلاك الحقيقي (إدخال/إخراج/مزوّد/نموذج/معامل السعر)
 *   لأن السعر صار متغيّراً حسب الاستهلاك الفعلي لا سعراً ثابتاً لكل رسالة.
 * - conversations: وضع الجلسة (normal/defense) + حالة المناقشة (عدّاد الأسئلة).
 */
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

/** فهارس المشرف الذكي (استعلامات الذاكرة تكرّر مع كل رسالة). */
const SUPERVISOR_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON usage_logs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
`;

/** فهارس المرحلة الأولى على المفاتيح الجديدة. */
const STEP_KEY_INDEXES = `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_path_steps_key ON research_path_steps(path_id, step_key) WHERE step_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_user_refs_step_key ON user_references(user_id, step_key);
  CREATE INDEX IF NOT EXISTS idx_notes_step_key ON notes(user_id, step_key);
  CREATE INDEX IF NOT EXISTS idx_files_step_key ON files(user_id, step_key);
  CREATE INDEX IF NOT EXISTS idx_conversations_step_key ON conversations(user_id, step_key);
`;

/**
 * ينشئ قاعدة البيانات المستهدفة إن لم تكن موجودة.
 * يتصل بقاعدة الصيانة postgres، وإذا فشل الاتصال بها نُكمل ونترك الخطأ يظهر عند الاتصال بالقاعدة الهدف.
 */
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
    // ترقيات آمنة لقواعد البيانات القائمة (كل عبارة idempotent)
    await pool.query(USERS_EXTRA_COLUMNS);
    await pool.query(USERS_NOTIFICATIONS_COLUMN);
    await pool.query(PROFILES_EXTRA_COLUMNS);
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
    await pool.query(PAYMENT_INDEXES);

    // بذرة خفيفة: عملة الموقع + طرق الدفع الافتراضية (مرة واحدة، ولا نلمس تعديلات المدير)
    await pool.query(SETTINGS_CURRENCY_SEED);
    for (const [index, method] of DEFAULT_PAYMENT_METHODS.entries()) {
      await pool.query(
        `INSERT INTO payment_methods (code, label, note, details, currency, is_active, display_order)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT (code) DO NOTHING`,
        [method.code, method.label, method.note, method.details, method.currency, index]
      );
    }

    // تعبئة نصّ البحث المطبَّع للعناصر القديمة (مرة واحدة لكل عنصر):
    // «اداره التغير» يجب أن تجد «إدارة التغيير» — بحث ResearchGate/المنصة متسامح مع الإملاء.
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

