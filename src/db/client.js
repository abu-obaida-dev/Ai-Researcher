import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * الاتصال المشترك لقاعدة البيانات — يُستخدم في كل مسارات الـ API.
 * الإعدادات مقروءة من DATABASE_URL في ملف .env.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// منع انهيار العملية عند خطأ في اتصال خامل، مع طباعة تنبيه واضح
pool.on('error', (error) => {
  console.error('خطأ غير متوقع في اتصال PostgreSQL:', error.message);
});

/** يتحقق من الاتصال بقاعدة البيانات ويعيد وقت الخادم الحالي. */
export async function testDatabaseConnection() {
  const result = await pool.query('SELECT NOW() AS current_time');
  return result.rows[0]?.current_time;
}

export { pool };
