/**
 * ترقية باحث إلى مدير:  npm run set-admin -- someone@example.com
 * بلا مفتاح arg يعرض آخر 10 حسابات مسجّلة مع أدوارها.
 */
import { pool } from '../src/db/client.js';

const email = String(process.argv[2] || '').trim().toLowerCase();

if (!email) {
  const { rows } = await pool.query('SELECT email, role, tokens_balance FROM users ORDER BY created_at DESC LIMIT 10');
  console.log('الاستعمال: npm run set-admin -- <البريد الإلكتروني>');
  console.log('\nآخر الحسابات:');
  for (const row of rows) console.log(`  ${row.email}  [${row.role}]  ${row.tokens_balance} نقطة`);
  await pool.end();
  process.exit(0);
}

const { rows } = await pool.query("UPDATE users SET role = 'admin' WHERE lower(email) = $1 RETURNING id, email, role", [email]);
if (!rows[0]) {
  console.log(`لا يوجد حساب بهذا البريد: ${email}`);
  await pool.end();
  process.exit(1);
}
console.log(`✔ ${rows[0].email} أصبح مديراً. ادخل بحسابه ثم افتح /admin.`);
await pool.end();
