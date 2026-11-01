import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/** Shared PostgreSQL connection pool. */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Keep idle-client errors from terminating the process.
pool.on('error', (error) => {
  console.error('خطأ غير متوقع في اتصال PostgreSQL:', error.message);
});

/** Checks database connectivity and returns the server time. */
export async function testDatabaseConnection() {
  const result = await pool.query('SELECT NOW() AS current_time');
  return result.rows[0]?.current_time;
}

export { pool };
