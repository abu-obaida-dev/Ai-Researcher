/** فحص جلسة مناقشة واحدة: سياقها الكامل + ذاكرة المستخدم (تشخيص تسرّب المراجع). */
import { pool } from '../src/db/client.js';

const conversationId = process.argv[2];
if (!conversationId) {
  console.error('الاستخدام: node scripts/inspect-defense-session.mjs <conversationId>');
  process.exit(1);
}

const conv = (
  await pool.query(
    'SELECT id, user_id, title, step_key, mode, defense_state, references_found, provider FROM conversations WHERE id = $1',
    [conversationId]
  )
).rows[0];
if (!conv) {
  console.error('الجلسة غير موجودة');
  process.exit(1);
}
console.log('CONV:', JSON.stringify(conv, null, 2));

const memory = (
  await pool.query('SELECT memory, open_task, strikes FROM supervisor_memory WHERE user_id = $1', [conv.user_id])
).rows[0];
console.log('MEMORY:', JSON.stringify(memory || {}, null, 2));

const profile = (
  await pool.query('SELECT full_name, research_field, research_title, research_stage, about FROM profiles WHERE id = $1', [
    conv.user_id
  ])
).rows[0];
console.log('PROFILE:', JSON.stringify(profile || {}, null, 2));

const msgs = await pool.query(
  'SELECT id, role, content, model, tokens_used, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at',
  [conversationId]
);
for (const r of msgs.rows) {
  console.log('\n=== [' + r.role + '] ' + r.created_at + ' model=' + r.model + ' tokens=' + r.tokens_used);
  console.log(r.content);
}

await pool.end();
