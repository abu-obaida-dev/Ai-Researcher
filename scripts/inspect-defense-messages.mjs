/**
 * فحص تسلسل رسائل جلسات المناقشة + تاريخ رفع ملفات المستخدم:
 * هل وصلت رسالة «ارفع ملفك» بعد رفع الملف فعلاً؟
 * التشغيل: node --env-file=.env scripts/inspect-defense-messages.mjs
 */
import { pool } from '../src/db/client.js';

// الجلسة التي تحتوي رسالة «6178438.pdf» — نبحث عنها إن لم تُحدَّد.
const hit = await pool.query(
  `SELECT m.conversation_id FROM messages m
     WHERE m.content LIKE '%6178438.pdf%' ORDER BY m.created_at LIMIT 1`
);
const TARGET_CONV = process.argv[2] || hit.rows[0]?.conversation_id;

if (!TARGET_CONV) {
  console.log('لم تُعثر على جلسة تحتوي 6178438.pdf');
  process.exit(0);
}

const conv = await pool.query(
  'SELECT id, user_id, created_at, defense_state FROM conversations WHERE id = $1',
  [TARGET_CONV]
);
const c = conv.rows[0];
console.log(`CONV ${c.id} — بدأت ${c.created_at.toISOString()} — user ${c.user_id}`);
console.log('  state:', JSON.stringify(c.defense_state));

const files = await pool.query(
  'SELECT id, file_name, created_at FROM files WHERE user_id = $1 ORDER BY created_at',
  [c.user_id]
);
console.log('\nملفات المستخدم:');
for (const f of files.rows) {
  console.log(`   ${f.created_at.toISOString()} ${f.id} ${f.file_name}`);
}

const msgs = await pool.query(
  'SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at',
  [c.id]
);
console.log('\nالرسائل:');
for (const m of msgs.rows) {
  console.log(
    `   ${m.created_at.toISOString()} [${m.role}] ${String(m.content).replace(/\s+/g, ' ').slice(0, 110)}`
  );
}

await pool.end();

