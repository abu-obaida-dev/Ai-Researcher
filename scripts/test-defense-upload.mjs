/**
 * اختبار حي لمسار تثبيت ملف البحث في المناقشة: يحاكي المتصفح تماماً
 * (كوكي جلسة + Origin للـ CSRF + multipart/form-data) ويطبع وجهة كل خطوة.
 * التشغيل: node --env-file=.env scripts/test-defense-upload.mjs  (والخادم شغّال)
 */
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/google.js';
import { pool } from '../src/db/client.js';
import { setStepStatus } from '../src/services/journey.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (!headers.has('origin')) headers.set('origin', new URL(String(url), BASE).origin);
  return nativeFetch(url, { ...options, headers });
};

async function createDefender() {
  const stamp = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, tokens_used, tokens_granted, onboarding_complete, is_active, plan_code)
     VALUES ($1, 'باحث اختبار', $2, 'researcher', 80000, 0, 80000, true, true, 'thesis') RETURNING *`,
    [`t.${stamp}@example.com`, `t-${stamp}`]
  );
  const id = rows[0].id;
  rows[0].role = rows[0].role || 'researcher';
  await pool.query(
    `INSERT INTO profiles (user_id, full_name, degree_level, research_field, research_title, research_stage, preferred_language, citation_style, university, faculty, about)
     VALUES ($1,'باحث اختبار','master','إدارة الأعمال','أثر التسويق الرقمي','defense','ar','apa7','جامعة الاختبار','كلية الإدارة','الهدف الحالي: الاستعداد للمناقشة') ON CONFLICT (user_id) DO NOTHING`,
    [id]
  );
  for (const k of ['topic', 'proposal', 'literature', 'methodology', 'writing']) {
    await setStepStatus(id, k, { status: 'done', outputNote: 'مكتمل' }).catch(() => {});
  }
  return { userId: id, cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionCookie(rows[0]))}` };
}

async function main() {
  const { userId, cookieHeader } = await createDefender();

  // 1) بدء جلسة مناقشة
  const start = await fetch(`${BASE}/defense/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader },
    body: '',
    redirect: 'manual'
  });
  console.log('1) start →', start.status, start.headers.get('location'));
  const conv = await pool.query(`SELECT id FROM conversations WHERE user_id = $1 AND mode = 'defense' ORDER BY created_at DESC LIMIT 1`, [userId]);
  const cid = conv.rows[0]?.id;
  console.log('   conversation:', cid);
  if (!cid) throw new Error('لم تُنشأ جلسة');

  // 2) رفع ملف بحث multipart
  const form = new FormData();
  form.set('file', new File([Buffer.from('عنوان البحث: اختبار. المشكلة: ضعف المبيعات. المنهج: وصفي تحليلي.', 'utf8')], 'بحثي.txt', { type: 'text/plain' }));
  const up = await fetch(`${BASE}/defense/${cid}/thesis`, {
    method: 'POST',
    headers: { cookie: cookieHeader },
    body: form,
    redirect: 'manual'
  });
  console.log('2) thesis upload →', up.status, up.headers.get('location'));

  // 3) حالة defense_state بعد الرفع
  const state = await pool.query(`SELECT defense_state FROM conversations WHERE id = $1`, [cid]);
  console.log('3) defense_state →', JSON.stringify(state.rows[0]?.defense_state));

  // 4) قراءة الصفحة: هل اختفت بطاقة الرفع؟
  const page = await fetch(`${BASE}/defense?d=${cid}`, { headers: { cookie: cookieHeader } });
  const html = await page.text();
  console.log('4) GET /defense →', page.status);
  console.log('   بطاقة الرفع ظاهرة؟', html.includes('ارفع ملف البحث اولا') ? 'نعم ❌' : 'لا ✅');
  console.log('   مربع الإجابة ظاهر؟', html.includes('name="answer"') ? 'نعم ✅' : 'لا ❌');
  console.log('   شريط التثبيت؟', html.includes('ملف البحث مثبّت') || html.includes('مثبت') ? 'نعم ✅' : 'لا ❌');
  console.log('   فقاعة رسالة النظام مرئية؟', html.includes('bubble-system') && html.includes('ثُبِّت ملف البحث') ? 'نعم ✅' : 'لا ❌');
  const flash = html.match(/class="(?:alert|notice) chat-flash">([^<]*)</);
  console.log('   flash:', flash ? flash[1] : '(لا)');

  // 5) برومبتات النظام لا تظهر كرسائل مستخدم + رسالة تثبيت النظام تظهر بين الرسالتين
  const msgs = await pool.query(`SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at`, [cid]);
  const leaked = msgs.rows.filter((m) => m.role === 'user');
  console.log('5) رسائل المستخدم المحفوظة:', leaked.length, leaked.length === 0 ? '✅' : '❌');
  leaked.forEach((m) => console.log('   ', m.content.slice(0, 80)));
  const assistants = msgs.rows.filter((m) => m.role === 'assistant');
  const systems = msgs.rows.filter((m) => m.role === 'system');
  console.log('   ردود المناقِش:', assistants.length);
  console.log('   رسالة نظام التثبيت:', systems.length, systems.length >= 1 ? '✅' : '❌');
  if (systems[0]) console.log('     ', String(systems[0].content).slice(0, 80));
  // التسلسل المتوقع: ترحيب (مساعد) ← تثبيت (نظام) ← قراءة وسؤال (مساعد)
  const roles = msgs.rows.map((m) => m.role).join(',');
  console.log('   التسلسل:', roles, roles === 'assistant,system,assistant' ? '✅' : '❌');
  // الترحيب لا يحمل وسوم البرومبت الداخلي ولا أقواس تعليمات
  const welcome = String(assistants[0]?.content || '');
  const hasBrackets = /\[(?:بدء|ملف البحث)/.test(welcome);
  console.log('   الترحيب بلا وسوم داخلية:', hasBrackets ? '❌ ' + welcome.slice(0, 60) : '✅');
  // الترحيب يخاطب الباحث باسمه (اسم ملف الاختبار: باحث اختبار)
  const greetsByName = welcome.includes('باحث اختبار');
  console.log('   الترحيب باسم الباحث:', greetsByName ? '✅' : '❌ ' + welcome.slice(0, 100));

  // تنظيف
  await pool.query(`DELETE FROM messages WHERE conversation_id = $1`, [cid]).catch(() => {});
  await pool.query(`DELETE FROM conversations WHERE id = $1`, [cid]).catch(() => {});
  await pool.query(`DELETE FROM files WHERE user_id = $1`, [userId]).catch(() => {});
  await pool.query(`DELETE FROM user_step_progress WHERE user_id = $1`, [userId]).catch(() => {});
  await pool.query(`DELETE FROM profiles WHERE user_id = $1`, [userId]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
  console.log('✓ تم التنظيف');
}

main().then(() => process.exit(0)).catch((e) => { console.error('خطأ:', e); process.exit(1); });
