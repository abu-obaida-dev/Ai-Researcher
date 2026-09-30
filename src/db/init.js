import pg from 'pg';
import dotenv from 'dotenv';
import {
  resolveDatabaseTarget,
  adminConnectionString,
  describeDatabaseError
} from './errors.js';

dotenv.config();

const { Pool } = pg;

/**
 * مخطط قاعدة البيانات — Node.js + PostgreSQL فقط للدخول والبيانات.
 * Firebase يُستخدم حصرياً لقناة إشعارات الدفع (FCM) — لا مصادقة Firebase ولا Firestore.
 * مستمد من النسخة السابقة للمنصة (Firestore): مستند UserDoc في مجموعة users
 * + المجموعة الفرعية للاستهلاك + الباقات + إعدادات المنصة وقائمة المديرين
 * + المجموعة الفرعية للإشعارات وتوكنات أجهزة FCM.
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

/** الباقات المتاحة — تُدار من جدول plans كما كانت تُدار من مجموعة plans في Firestore. */
const PLANS_TABLE = `
  CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    tagline TEXT,
    price DECIMAL(10,2) DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    period VARCHAR(100) DEFAULT 'شهرياً',
    features TEXT,
    cta VARCHAR(100) DEFAULT 'اشترك الآن',
    popular BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

/** سجل استهلاك التوكنز لكل مستخدم. */
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

/** توكنات أجهزة الإشعارات (FCM) — بديل حقل fcmTokens الذي كان في مستند Firestore. */
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

/** فهارس الإشعارات والتوكنات — تُنشأ مرة واحدة فقط (idempotent). */
const NOTIFICATION_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read = false;
  CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id) WHERE enabled = true;
`;

/** قائمة إيميلات المديرين القابلة للإدارة من لوحة الإدارة (بديل admins/config). */
const ADMINS_TABLE = `
  CREATE TABLE IF NOT EXISTS admins (
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
    await pool.query(USAGE_LOGS_TABLE);
    await pool.query(SETTINGS_TABLE);
    await pool.query(NOTIFICATIONS_TABLE);
    await pool.query(DEVICE_TOKENS_TABLE);
    await pool.query(ADMINS_TABLE);
    // ترقيات آمنة لقواعد البيانات القائمة (كل عبارة idempotent)
    await pool.query(USERS_EXTRA_COLUMNS);
    await pool.query(USERS_NOTIFICATIONS_COLUMN);
    await pool.query(PROFILES_EXTRA_COLUMNS);
    await pool.query(PLANS_EXTRA_COLUMNS);
    await pool.query(USERS_GOOGLE_SUB_UNIQUE);
    await pool.query(USERS_PLAN_FOREIGN_KEY);
    await pool.query(INDEXES);
    await pool.query(NOTIFICATION_INDEXES);

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

