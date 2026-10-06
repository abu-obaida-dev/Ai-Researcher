/**
 * فحص حيّ لبوابة الملف الجزئية (P0-2) — بلا مزوّد ذكاء (كل المسارات المختبرة لا تصله).
 * التشغيل: شغّل الخادم ثم: node scripts/gate-check.mjs
 * يتحقق: التحويل مع ?next= · الرسائل الذكية · دورة الحفظ والعودة · الزائر.
 */
import { pool } from '../src/db/client.js';
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/google.js';

const BASE = 'http://localhost:3000';
const stamp = Date.now();
let pass = 0;
let fail = 0;

const check = (name, ok, extra = '') => {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}`);
  } else {
    fail += 1;
    console.log(`❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const cookieFor = (user) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionCookie(user))}`;
const loc = (res) => res.headers.get('location') || '';

async function get(path, cookie) {
  const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const body = res.status === 200 ? await res.text() : '';
  return { res, body };
}

async function post(path, cookie, form) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
      origin: BASE
    },
    body: form,
    redirect: 'manual'
  });
  return { res };
}

const newU = await pool.query(
  `INSERT INTO users (email, full_name, role, tokens_balance, tokens_granted, onboarding_complete, is_active)
   VALUES ($1, 'باحث بوابة', 'researcher', 500, 500, false, true) RETURNING *`,
  [`gate.check.${stamp}@example.com`]
);
const user = newU.rows[0];
const cookie = cookieFor(user);

// منح الدور defense:train مؤقتاً (الدور الافتراضي مقفلها بقفل الباقة) + انتظار
// كاش الصلاحيات في عملية الخادم (30 ثانية) حتى يقرأ المنح.
await pool.query("INSERT INTO role_permissions (role_code, permission) VALUES ('researcher','defense:train') ON CONFLICT DO NOTHING");
await new Promise((resolve) => setTimeout(resolve, 31_000));

try {
  // 1) الزائر: /journey → الدخول مع وجهة العودة
  const anon = await get('/journey', '');
  check('زائر /journey → /login مع ?next=', anon.res.status === 302 && loc(anon.res).startsWith('/login?next='), `${anon.res.status} ${loc(anon.res)}`);

  // 2) باحث غير مكمل: /journey محوّل إلى الملف مع وجهة العودة
  const journey = await get('/journey', cookie);
  check('غير المكمل /journey → /onboarding مع ?next=', journey.res.status === 302 && loc(journey.res).startsWith('/onboarding?next='), `${journey.res.status} ${loc(journey.res)}`);

  // 3) قراءة الشات مفتوحة مع رسالة ذكية
  const chat = await get('/chat', cookie);
  check('غير المكمل /chat مفتوح + رسالة ذكية', chat.res.status === 200 && chat.body.includes('ملفك البحثي غير مكتمل'), `status=${chat.res.status}`);

  // 4) المراجع مفتوح مع رسالة ذكية
  const refs = await get('/references', cookie);
  check('غير المكمل /references مفتوح + رسالة ذكية', refs.res.status === 200 && refs.body.includes('ترشيح المراجع يحتاج تخصصك'), `status=${refs.res.status}`);

  // 5) إرسال الشات يحوّل
  const send = await post('/chat', cookie, 'message=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7');
  check('غير المكمل POST /chat → /onboarding?next=/chat', send.res.status === 302 && loc(send.res).startsWith('/onboarding?next='), `${send.res.status} ${loc(send.res)}`);

  // 6) بدء المناقشة يحوّل (الصلاحية ممنوحة مؤقتاً في بداية السكربت)
  const defense = await post('/defense/start', cookie, '');
  check('غير المكمل POST /defense/start → /onboarding', defense.res.status === 302 && loc(defense.res).startsWith('/onboarding?next='), `${defense.res.status} ${loc(defense.res)}`);

  // 7) صفحة الملف تحفظ وجهة العودة في زر الإرسال
  const form = await get('/onboarding?next=%2Fjourney', cookie);
  check('صفحة الملف تحفظ ?next=/journey في فُرمتها', form.res.status === 200 && form.body.includes('action="/onboarding?next=%2Fjourney"'), `status=${form.res.status}`);

  // 7b) قبل الإكمال: الصفحة مستقلة — لا سايدبار ولا شريط علوي (قرار الواجهة)
  check(
    'غير المكمل /onboarding صفحة مستقلة بلا سايدبار',
    form.res.status === 200 &&
      !form.body.includes('<aside class="app-side">') &&
      !form.body.includes('<header class="app-top">') &&
      form.body.includes('class="onboarding-standalone"'),
    form.body.includes('<aside class="app-side">') ? 'السايدبار ظاهر!' : 'مستقلة'
  );

  // 8) حفظ الأساسيات الثلاث يعيد للوجهة المحفوظة
  const save = await post('/onboarding?next=%2Fjourney', cookie, 'degree_level=bachelor&research_field=%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86&research_stage=proposal&progress_stage=proposal&citation_style=mla9');
  check('POST /onboarding يعود إلى /journey', save.res.status === 302 && loc(save.res) === '/journey', `${save.res.status} ${loc(save.res)}`);

  // 9) بعد الإكمال: المسار مفتوح
  const after = await get('/journey', cookie);
  check('بعد الإكمال /journey مفتوح', after.res.status === 200, `status=${after.res.status}`);

  // 9b) بعد الإكمال: تعديل الملف يُفتح داخل اللوحة (السايدبار مسموح)
  const edit = await get('/onboarding', cookie);
  check(
    'بعد الإكمال /onboarding داخل اللوحة بالسايدبار',
    edit.res.status === 200 && edit.body.includes('<aside class=\"app-side\">') && !edit.body.includes('class=\"onboarding-standalone\"'),
    `status=${edit.res.status}`
  );

  // 10) بعد الإكمال: الشات بلا رسالة نقص (الإرسال يُمرَّر)
  const chatAfter = await get('/chat', cookie);
  check('بعد الإكمال /chat بلا رسالة النقص', chatAfter.res.status === 200 && !chatAfter.body.includes('ملفك البحثي غير مكتمل'), `status=${chatAfter.res.status}`);

  console.log(`\nالنتيجة: ${pass}/${pass + fail}`);
} finally {
  await pool.query("DELETE FROM role_permissions WHERE role_code = 'researcher' AND permission = 'defense:train'");
  await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  await pool.end();
}

process.exit(fail ? 1 : 0);
