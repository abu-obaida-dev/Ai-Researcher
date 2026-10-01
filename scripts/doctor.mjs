/**
 * تشخيص سريع: قاعدة البيانات + مزوّدو الذكاء الاصطناعي + دخول لوحة الإدارة.
 *   node --env-file=.env scripts/doctor.mjs        (أو: npm run doctor)
 * يطبع لكل مزوّد: يعمل الآن / خطأ.HTTP + ما قاله المزوّد بالعربية.
 */
import { pool } from '../src/db/client.js';
import { PROVIDER_LABELS, probeProvider, providerStatus, runSupervisor } from '../src/services/ai.js';

const ok = (text) => `\x1b[32m${text}\x1b[0m`;
const bad = (text) => `\x1b[31m${text}\x1b[0m`;
const warn = (text) => `\x1b[33m${text}\x1b[0m`;

console.log('\n━━ فحص قاعدة البيانات ━━');
let dbReady = false;
try {
  const { rows } = await pool.query('SELECT count(*)::int AS users FROM users');
  dbReady = true;
  console.log(ok(`✔ متصلة — ${rows[0].users} باحثاً مسجّلاً`));
} catch (error) {
  console.log(bad(`✘ ${error.message}`));
  console.log(warn('  شغّل: npm run db:up  ثم  npm run db:init'));
}

console.log('\n━━ فحص مباشر لكل مزوّد (أصغر نداء ممكن) ━━');
const status = providerStatus();
let working = 0;

for (const provider of status) {
  const label = (PROVIDER_LABELS[provider.key] || provider.key).padEnd(16);
  if (!provider.configured) {
    console.log(`${label} ${warn('غير مُعدّ — لا مفتاح في .env')}`);
    continue;
  }
  const probe = await probeProvider(provider.key);
  if (probe.ok) {
    working += 1;
    console.log(ok(`✔ ${label} يعمل خلال ${probe.ms}ms — «${probe.text}»`));
  } else {
    const code = probe.status ? `HTTP ${probe.status}` : 'بلا استجابة';
    console.log(bad(`✘ ${label} ${code} — ${probe.reason}`));
  }
}

console.log('\n━━ نداء كامل عبر سلسلة المزوّدين ━━');
if (working) {
  const startedAt = Date.now();
  try {
    const result = await runSupervisor({
      messages: [{ role: 'user', content: 'اذكر مشكلة بحثية واحدة في منهجية، في جملتين.' }],
      system: 'أنت مشرف بحثي. أجب بإيجاز شديد.',
      temperature: 0.3,
      maxTokens: 600
    });
    console.log(ok(`✔ ردّ «${(result.text || '').slice(0, 60)}…» عبر ${result.provider} خلال ${Date.now() - startedAt}ms`));
  } catch (error) {
    console.log(bad(`✘ فشل: ${error.message.slice(0, 300)}`));
  }
} else {
  console.log(bad('لا مزوّد يردّ — لن يفيد النداء الكامل.'));
}

console.log('\n━━ لوحة تحكم المدير ━━');
if (dbReady) {
  const { rows } = await pool.query("SELECT count(*)::int AS admins FROM users WHERE role = 'admin'");
  console.log(rows[0].admins ? ok(`✔ ${rows[0].admins} حساب مدير`) : warn('لا يوجد حساب بدور admin'));
  if (!rows[0].admins) {
    const { rows: last } = await pool.query('SELECT email FROM users ORDER BY created_at DESC LIMIT 1');
    if (last[0]) console.log(warn(`  لترقية آخر باحث:  npm run set-admin -- ${last[0].email}`));
  }
}
console.log(process.env.ADMIN_TOKEN
  ? ok('✔ ADMIN_TOKEN معرّف — افتح /admin?token=… من أي جهاز')
  : warn('⚠ ADMIN_TOKEN فارغ — /admin متاحة من localhost فقط (أو عرّف ADMIN_TOKEN في .env)'));

await pool.end();
console.log('');
