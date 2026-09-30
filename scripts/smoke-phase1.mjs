/**
 * اختبار دخان للمرحلة الأولى (1D + 1E + 1F): مسار البحث، المراجع، المفكرة، الملفات، الشات.
 * ينشئ حساب اختبار في قاعدة البيانات، يوقّع جلسة، ثم يضرب المسارات ويتحقق من الردود.
 * التشغيل: شغّل الخادم ثم node scripts/smoke-phase1.mjs
 */
import { createSessionCookie, SESSION_COOKIE_NAME } from '../src/auth/google.js';
import { pool } from '../src/db/client.js';
import { deleteFile, filesSummary, saveUpload } from '../src/services/files.js';
import { saveStorageLimits, storageLimits } from '../src/services/settings.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const results = [];

/** يسجّل نتيجة اختبار واحدة ويطبعها. */
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
}

/** طلب HTTP مع كوكي الجلسة، ويعيد الحالة والنص ورابط التحويل. */
async function call(path, { method = 'GET', form, cookie, expect = [200] } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }

  const response = await fetch(`${BASE}${path}`, { method, headers, body, redirect: 'manual' });
  const text = await response.text();
  return { ok: expect.includes(response.status), status: response.status, text, location: response.headers.get('location') || '' };
}

/** ينشئ حساب اختبار بدرجة ماجستير وكوكي جلسة موقع. */
async function createTestUser() {
  const stamp = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, tokens_used, tokens_granted, onboarding_complete, is_active)
     VALUES ($1, 'باحث اختبار', $2, 'researcher', 5000, 0, 5000, true, true)
     RETURNING id, email`,
    [`smoke.phase1.${stamp}@example.com`, `smoke-${stamp}`]
  );
  const user = rows[0];

  await pool.query(
    `INSERT INTO profiles (user_id, full_name, degree_level, research_field, research_title, research_stage, preferred_language, citation_style)
     VALUES ($1, 'باحث اختبار', 'master', 'إدارة الأعمال', 'أثر التسويق الرقمي على ولاء العملاء', 'proposal', 'ar', 'apa7')
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  );

  return { user, cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionCookie(user))}` };
}

/** اختبارات 1D: صفحة المسار + حفظ الحالة + رفض خطوة غير موجودة. */
async function testJourney(cookie) {
  const journey = await call('/journey', { cookie });
  check('1D /journey يفتح ويعرض مسار الماجستير', journey.ok && journey.text.includes('مسار الماجستير'), `status=${journey.status}`);
  check('1D يعرض خطوة «تحديد المشكلة والفرضيات»', journey.text.includes('تحديد المشكلة والفرضيات'));
  check('1D يعرض شريط التقدّم', journey.text.includes('class="meter"'));

  const start = await call('/journey/steps/topic', {
    method: 'POST',
    form: { status: 'in_progress', output_note: 'خطة أولية لاختيار الموضوع' },
    cookie,
    expect: [303]
  });
  check('1D حفظ حالة «جاري» (303)', start.ok && start.location.includes('ok=status_saved'), start.location);

  const done = await call('/journey/steps/proposal', {
    method: 'POST',
    form: { status: 'done', output_note: 'المقترح جاهز' },
    cookie,
    expect: [303]
  });
  check('1D حفظ حالة «تم» (303)', done.ok, done.location);

  const after = await call('/journey', { cookie });
  check('1D شريط التقدّم تحدّث (1 من 9)', after.text.includes('1 من 9'));
  check('1D الخطوة المنجزة مميّزة بصرياً', after.text.includes('journey-step is-done'));

  const bad = await call('/journey/steps/not_a_step', { method: 'POST', form: { status: 'done' }, cookie, expect: [303] });
  check('1D يرفض خطوة غير موجودة في المسار', bad.ok && bad.location.includes('err=bad_step'), bad.location);

  const guest = await call('/journey', { expect: [302] });
  check('الحماية: زائر بلا جلسة يُحوَّل إلى /login', guest.ok && guest.location.includes('/login'), guest.location);
}

/** اختبارات 1E: المراجع (مكتبة + يدوي + الحالة + الحذف). */
async function testReferences(userId, cookie) {
  const page = await call('/references', { cookie });
  check('1E /references يفتح', page.ok && page.text.includes('مراجعي'));

  const add = await call('/references', {
    method: 'POST',
    form: {
      title: 'Kotler, P. & Keller, K. (2016) Marketing Management',
      authors: 'Kotler & Keller',
      year: '2016',
      source: 'Pearson',
      step: 'literature'
    },
    cookie,
    expect: [303]
  });
  check('1E إضافة مرجع يدوي (303)', add.ok && add.location.includes('ok=ref_added'), add.location);

  const rows = await pool.query('SELECT id, step_key, status FROM user_references WHERE user_id = $1', [userId]);
  check('1E المرجع محفوظ ومربوط بالخطوة', rows.rows.length === 1 && rows.rows[0].step_key === 'literature');
  const refId = rows.rows[0]?.id;

  const status = await call(`/references/${refId}/status`, { method: 'POST', form: { status: 'read' }, cookie, expect: [303] });
  check('1E تغيير حالة القراءة (303)', status.ok, status.location);
  const afterStatus = await pool.query('SELECT status FROM user_references WHERE id = $1', [refId]);
  check('1E الحالة الجديدة محفوظة (read)', afterStatus.rows[0]?.status === 'read');

  const shown = await call('/references', { cookie });
  check('1E المرجع يظهر في الصفحة مع توثيقه', shown.text.includes('Kotler') && shown.text.includes('Kotler &amp; Keller'));

  const badStep = await call('/references', { method: 'POST', form: { title: 'خطأ', step: 'nope' }, cookie, expect: [303] });
  check('1E يرفض ربط مرجع بخطوة غير موجودة', badStep.ok && badStep.location.includes('err='), badStep.location);

  // ملاحظة مرتبطة بالمرجع ثم عدّادها في «مراجعي»
  const noteForRef = await call('/notes', {
    method: 'POST',
    form: { title: 'اقتباس من المرجع', body: 'نص الاقتباس', reference_id: refId },
    cookie,
    expect: [303]
  });
  check('1E إنشاء ملاحظة مرتبطة بمرجع', noteForRef.ok, noteForRef.location);

  const withCount = await call('/references', { cookie });
  check('1E عدّاد ملاحظات المرجع تحدّث', withCount.text.includes('ملاحظات (1)'));
  const linkedNotes = await call(`/notes?ref=${refId}`, { cookie });
  check('1E فلترة الملاحظات بالمرجع تعمل', linkedNotes.text.includes('اقتباس من المرجع'));

  const del = await call(`/references/${refId}/delete`, { method: 'POST', cookie, expect: [303] });
  check('1E حذف المرجع (303)', del.ok && del.location.includes('ok=ref_deleted'), del.location);
  const gone = await pool.query('SELECT count(*)::int AS total FROM user_references WHERE id = $1', [refId]);
  check('1E المرجع اختفى من قاعدة البيانات', gone.rows[0].total === 0);
}

/** اختبارات 1E: المفكرة (إنشاء + تثبيت + تعديل + بحث + حذف). */
async function testNotes(userId, cookie) {
  const page = await call('/notes', { cookie });
  check('1E /notes يفتح', page.ok && page.text.includes('مفكرتي'));

  const add = await call('/notes', {
    method: 'POST',
    form: { title: 'ملاحظة اختبار', body: 'نص الملاحظة', tags: 'منهجية, مراجع', pinned: '1', step: 'methodology' },
    cookie,
    expect: [303]
  });
  check('1E إنشاء ملاحظة (303)', add.ok && add.location.includes('ok=note_added'), add.location);

  // نحدد الملاحظة بالعنوان: الاختبار أنشأ ملاحظة أخرى مرتبطة بالمرجع في testReferences
  const rows = await pool.query(
    "SELECT id, pinned, tags, step_key FROM notes WHERE user_id = $1 AND title = 'ملاحظة اختبار'",
    [userId]
  );
  const note = rows.rows[0];
  check('1E الملاحظة محفوظة (مثبّتة + وسوم + خطوة)', Boolean(note) && note.pinned === true && note.step_key === 'methodology', JSON.stringify(note || {}));

  const pin = await call(`/notes/${note.id}/pin`, { method: 'POST', cookie, expect: [303] });
  check('1E تبديل التثبيت (303)', pin.ok);
  const afterPin = await pool.query('SELECT pinned FROM notes WHERE id = $1', [note.id]);
  check('1E التثبيت انقلب إلى false', afterPin.rows[0]?.pinned === false);

  const edit = await call(`/notes/${note.id}`, {
    method: 'POST',
    form: { title: 'ملاحظة معدّلة', body: 'نص محدّث', tags: 'منهجية', step: 'writing' },
    cookie,
    expect: [303]
  });
  check('1E تعديل الملاحظة (303)', edit.ok);
  const afterEdit = await pool.query('SELECT title, step_key FROM notes WHERE id = $1', [note.id]);
  check('1E التعديلات محفوظة', afterEdit.rows[0]?.title === 'ملاحظة معدّلة' && afterEdit.rows[0]?.step_key === 'writing');

  const search = await call('/notes?q=' + encodeURIComponent('معدّلة'), { cookie });
  check('1E البحث النصي في المفكرة', search.text.includes('ملاحظة معدّلة'));

  const del = await call(`/notes/${note.id}/delete`, { method: 'POST', cookie, expect: [303] });
  check('1E حذف الملاحظة (303)', del.ok && del.location.includes('ok=note_deleted'), del.location);
  const gone = await pool.query('SELECT count(*)::int AS total FROM notes WHERE id = $1', [note.id]);
  check('1E الملاحظة اختفت من قاعدة البيانات', gone.rows[0].total === 0);
}

/** اختبارات 1E: الملفات (رفع multipart + تحميل + رفض نوع + حماية). */
async function testFiles(userId, cookie) {
  const page = await call('/files', { cookie });
  check('1E /files يفتح', page.ok && page.text.includes('ملفاتي'));

  const form = new FormData();
  form.append('title', 'مقترح البحث');
  form.append('step', 'proposal');
  form.append('file', new Blob(['%PDF-1.4 test bytes'], { type: 'application/pdf' }), 'proposal draft.pdf');

  const upload = await fetch(`${BASE}/files`, { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
  const location = upload.headers.get('location') || '';
  check('1E رفع ملف PDF (303)', upload.status === 303 && location.includes('ok=file_uploaded'), location);

  const rows = await pool.query('SELECT id, file_name, size_bytes, step_key FROM files WHERE user_id = $1', [userId]);
  const file = rows.rows[0];
  check('1E صف الملف محفوظ بالميتاداتا', Boolean(file) && file.step_key === 'proposal', JSON.stringify(file || {}));
  check('1E اسم الملف مُنظَّف على القرص', file?.file_name === 'proposal-draft.pdf', file?.file_name);

  const download = await fetch(`${BASE}/files/${file.id}/raw`, { headers: { cookie } });
  const bytes = Buffer.from(await download.arrayBuffer());
  check('1E تحميل الملف بنفس البايتات', download.status === 200 && bytes.toString().includes('%PDF-1.4'), `status=${download.status}`);

  // المعاينة: PDF داخل iframe عبر ?inline=1
  const viewPage = await call(`/files/${file.id}/view`, { cookie });
  check('1E صفحة معاينة PDF تفتح', viewPage.ok && viewPage.text.includes('file-preview--pdf'), `status=${viewPage.status}`);
  const inline = await fetch(`${BASE}/files/${file.id}/raw?inline=1`, { headers: { cookie } });
  check(
    '1E العرض داخل المتصفح: نوع صحيح + nosniff + CSP معزولة',
    inline.headers.get('content-type') === 'application/pdf' &&
      inline.headers.get('x-content-type-options') === 'nosniff' &&
      (inline.headers.get('content-security-policy') || '').includes('sandbox')
  );
  check('1E زر التحميل ينزّل (attachment) لا يعرض', (await fetch(`${BASE}/files/${file.id}/raw`, { headers: { cookie } })).headers.get('content-disposition')?.startsWith('attachment'));

  const shown = await call('/files', { cookie });
  check('1E الملف يظهر في الصفحة', shown.text.includes('مقترح البحث'));

  // منتقي الملف منسّق: input حقيقي مغطّى + بطاقة قابلة للسحب + سكربت عرض الاسم
  const filesBody = shown.text.split('</style>')[1] || '';
  check(
    '1E منتقي الملف منسّق (سحب وإفلات + اسم الملف)',
    filesBody.includes('file-picker-label') && filesBody.includes('file-picked-name') && filesBody.includes('/js/file-picker.js')
  );

  const badForm = new FormData();
  badForm.append('file', new Blob(['#!/bin/sh\necho hi'], { type: 'application/x-sh' }), 'evil.sh');
  const badUpload = await fetch(`${BASE}/files`, { method: 'POST', headers: { cookie }, body: badForm, redirect: 'manual' });
  check('1E يرفض رفع ملف من نوع ممنوع', badUpload.status === 303 && (badUpload.headers.get('location') || '').includes('err=file_bad'));

  // مستخدم آخر لا يستطيع تحميل الملف
  const stamp = Date.now();
  const other = await pool.query(
    `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, onboarding_complete)
     VALUES ($1, 'آخر', $2, 'researcher', 100, true) RETURNING id, email`,
    [`other.${stamp}@example.com`, `other-${stamp}`]
  );
  const otherCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionCookie(other.rows[0]))}`;
  const steal = await fetch(`${BASE}/files/${file.id}/raw`, { headers: { cookie: otherCookie } });
  check('الحماية: مستخدم آخر لا يحمّل الملف (404)', steal.status === 404, `status=${steal.status}`);
  const stealView = await fetch(`${BASE}/files/${file.id}/view`, { headers: { cookie: otherCookie } });
  check('الحماية: مستخدم آخر لا يعرض الملف (404)', stealView.status === 404, `status=${stealView.status}`);
  await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);

  // معاينة النص: يُعرض داخل <pre> مُهرَّب، ويُقدَّم text/plain (لا HTML)
  const textUpload = new FormData();
  textUpload.append('title', 'ملف نصي');
  textUpload.append('file', new Blob(['<script>alert(1)</script>\nنص البحث'], { type: 'text/plain' }), 'notes.txt');
  const textRes = await fetch(`${BASE}/files`, { method: 'POST', headers: { cookie }, body: textUpload, redirect: 'manual' });
  const textRow = await pool.query(
    "SELECT id FROM files WHERE user_id = $1 AND title = 'ملف نصي' ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  const textId = textRow.rows[0]?.id;
  check('1E رفع ملف نصي', textRes.status === 303 && Boolean(textId));

  const textView = await call(`/files/${textId}/view`, { cookie });
  check('1E معاينة النص داخل <pre> مع تهريب HTML', textView.ok && textView.text.includes('file-preview--text') && textView.text.includes('&lt;script&gt;'));
  const textRaw = await fetch(`${BASE}/files/${textId}/raw?inline=1`, { headers: { cookie } });
  check('1E النص يُقدَّم text/plain لا text/html', (textRaw.headers.get('content-type') || '').startsWith('text/plain'));

  // ملف غير معروض (xlsx) ⇒ لا زر «عرض» بل تحميل فقط
  const xlsxUpload = new FormData();
  xlsxUpload.append('title', 'جدول بيانات');
  xlsxUpload.append(
    'file',
    new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'sheet.xlsx'
  );
  await fetch(`${BASE}/files`, { method: 'POST', headers: { cookie }, body: xlsxUpload, redirect: 'manual' });
  const listNow = await call('/files', { cookie });
  const xlsxView = await call(`/files/${(await pool.query("SELECT id FROM files WHERE user_id = $1 AND title = 'جدول بيانات' ORDER BY created_at DESC LIMIT 1", [userId])).rows[0].id}/view`, { cookie });
  check('1E ملف Excel: صفحة بلا معاينة + إرشاد للتحميل', xlsxView.ok && xlsxView.text.includes('لا يعرض المتصفح هذا النوع'));
  check('1E زر «عرض» لا يظهر لغير المعروض', !listNow.text.includes('لا يعرض المتصفح'));

  const del = await call(`/files/${file.id}/delete`, { method: 'POST', cookie, expect: [303] });
  check('1E حذف الملف (303)', del.ok && del.location.includes('ok=file_deleted'), del.location);
  const gone = await pool.query('SELECT count(*)::int AS total FROM files WHERE id = $1', [file.id]);
  check('1E صف الملف حُذف', gone.rows[0].total === 0);
}

/** اختبارات 1F: الشات (الصفحة + الإرسال + الخصم + الحذف). */
async function testChat(userId, cookie) {
  const page = await call('/chat', { cookie });
  check('1F /chat يفتح', page.ok && page.text.includes('المشرف الذكي'));
  check('1F بلا سطر الرصيد/التكلفة داخل الكارت', !page.text.includes('تكلفة الرسالة'));
  console.log(`ℹ️  مزوّدو الذكاء الاصطناعي مفعّلون: ${page.text.includes('لا يوجد مزوّد ذكاء اصطناعي مفعّل') ? 'لا' : 'نعم'}`);

  const withStep = await call('/chat?step=methodology', { cookie });
  check('1F يقبل سياق الخطوة', withStep.ok && withStep.text.includes('السياق'));

  const before = await pool.query('SELECT tokens_balance FROM users WHERE id = $1', [userId]);
  let ask = null;
  let messages = { rows: [] };
  let after = before;

  // مزوّدو الذكاء الاصطناعي المجانيون قد يردّون 503 مؤقتاً، فنُعيد المحاولة ٣ مرات
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    ask = await call('/chat', {
      method: 'POST',
      form: { message: 'أراجع منهجي الوصفي في دراستي، هل يناسب سؤال البحث؟', step: 'methodology' },
      cookie,
      expect: [303]
    });
    messages = await pool.query(
      `SELECT m.role, m.content, m.tokens_used FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = $1 ORDER BY m.created_at ASC`,
      [userId]
    );
    after = await pool.query('SELECT tokens_balance FROM users WHERE id = $1', [userId]);
    if (messages.rows.some((row) => row.role === 'assistant')) break;
    console.log(`⚠️  المحاولة ${attempt} بلا رد — إعادة المحاولة…`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  check('1F إرسال رسالة (303)', Boolean(ask?.ok), ask?.location || '');
  console.log(`ℹ️  الرسائل: ${messages.rows.length} · الرصيد: ${before.rows[0].tokens_balance} → ${after.rows[0].tokens_balance}`);

  if (messages.rows.some((row) => row.role === 'assistant')) {
    check('1F حُفظ رد المشرف الذكي', true, messages.rows.at(-1).content.slice(0, 70).replace(/\s+/g, ' '));
    check('1F خُصمت تكلفة الرسالة (30 توكن)', after.rows[0].tokens_balance === before.rows[0].tokens_balance - 30);
  } else {
    // مزوّدو الذكاء الاصطناعي خدمة خارجية: نُبقيها تحذيراً لا فشلاً، وال deduct أُعيد فعلاً
    console.log('⚠️  1F لم يصل رد من أي مزوّد (خدمة خارجية: رصيد OpenRouter/Grok أو ازدحام Gemini)');
    const usage = await pool.query('SELECT type FROM usage_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
    check('1F سُجّل الفشل وأُعيدت التوكنز للباحث', usage.rows[0]?.type === 'chat_failed' && after.rows[0].tokens_balance === before.rows[0].tokens_balance);
  }

  const usage = await pool.query('SELECT type, tokens_used FROM usage_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
  console.log(`ℹ️  آخر سجل استهلاك: ${JSON.stringify(usage.rows[0] || {})}`);

  const listed = await call('/chat', { cookie });
  check('1F المحادثة تظهر في السجل', listed.text.includes('أراجع منهجي'));

  const chatBody = listed.text.split('</style>')[1] || '';
  check('1F بلا ترويسة صفحة (أقصى مساحة للدردشة)', !chatBody.includes('page-head'));
  check('1F بلا هيدر لكارت الدردشة', !chatBody.includes('chat-head'));
  check('1F بلا اقتراحات داخل الكارت', !chatBody.includes('اقترح لي ٥ عناوين'));
  // المحادثات يجب أن تكون داخل <nav> نفسه لا بطاقة منفصلة (ChatGPT/Claude style)
  const navHtml = chatBody.slice(chatBody.indexOf('<nav class="app-nav"'), chatBody.indexOf('</nav>'));
  check('1F المحادثات داخل قائمة السايدبار نفسها', navHtml.includes('class="chat-nav"') && !chatBody.includes('chat-side-card'));
  check('1F زر «محادثة جديدة» أسفل رابط المشرف الذكي', navHtml.includes('btn-block') && navHtml.indexOf('محادثة جديدة') > navHtml.indexOf('href="/chat"'));
  check('1F لا يوجد نص «أدوات البحث»', !chatBody.includes('أدوات البحث'));
  // لا تكرار: الحساب/الملف/الخروج في الشريط العلوي لا في السايدبار
  check(
    '1F السايدبار بلا قسم «حسابى» ولا خروج',
    !navHtml.includes('حسابى') && !navHtml.includes('ملفي البحثى') && !navHtml.includes('تسجيل الخروج')
  );
  const topbar = chatBody.slice(chatBody.indexOf('<header class="app-top">'), chatBody.indexOf('</header>'));
  check('1F الشريط العلوي فيه الحساب والخروج', topbar.includes('href="/account"') && topbar.includes('href="/logout"'));

  // رابط «المشرف الذكي» هو آخر رابط تنقّل (قبله روابط الجلسات /chat?c=)
  const tools = [...navHtml.matchAll(/<a href="(\/(?:dashboard|journey|references|notes|files|chat|account|admin|onboarding))"/g)].map((m) => m[1]);
  check('1F المشرف الذكي آخر رابط أدوات في القائمة', tools[tools.length - 1] === '/chat', tools.join(' '));
  check('1F الجلسات أسفل رابط المشرف الذكي', navHtml.indexOf('class="chat-nav"') > navHtml.indexOf('href="/chat"'));
  check('1F فاصل أعلى الأدوات وآخر قبل المشرف', navHtml.indexOf('app-nav-sep first') < navHtml.indexOf('href="/dashboard"') && navHtml.indexOf('app-nav-foot') < navHtml.indexOf('href="/chat"'));

  // لا سكرول في الصفحة: الشل يملأ ما تحت التوب بار، والتمرير داخل الصناديق
  check('1F وضع ملء الارتفاع مفعّل (لا سكرول في الصفحة)', chatBody.includes('app-shell app-shell--fit'));
  const css = (await call('/chat', { cookie })).text.split('</style>')[0];
  check('1F التمرير داخل صندوق الشات وسجل الجلسات', /\.chat-body \{[^}]*overflow-y: auto/.test(css) && /\.chat-list \{[^}]*overflow-y: auto/.test(css));
  check('1F شريط التمرير بلون الهوية', /scrollbar-color: var\(--sea\)/.test(css) && /::-webkit-scrollbar-thumb/.test(css));

  // الحذف لا يجب أن يُرجِع التوكنز: نسجّل الرصيد قبل حذف كل المحادثات
  const beforeDelete = await pool.query('SELECT tokens_balance, tokens_used FROM users WHERE id = $1', [userId]);
  const conversation = await pool.query('SELECT id FROM conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
  const del = await call(`/chat/${conversation.rows[0].id}/delete`, { method: 'POST', cookie, expect: [303] });
  check('1F حذف المحادثة (303)', del.ok);
  const gone = await pool.query('SELECT count(*)::int AS total FROM conversations WHERE id = $1', [conversation.rows[0].id]);
  check('1F حُذفت المحادثة برسائلها', gone.rows[0].total === 0);

  const afterDelete = await pool.query('SELECT tokens_balance, tokens_used FROM users WHERE id = $1', [userId]);
  check(
    '1F الحذف لا يُرجِع التوكنز المستهلكة',
    afterDelete.rows[0].tokens_balance === beforeDelete.rows[0].tokens_balance &&
      afterDelete.rows[0].tokens_used === beforeDelete.rows[0].tokens_used,
    `الرصيد ${beforeDelete.rows[0].tokens_balance} → ${afterDelete.rows[0].tokens_balance}`
  );
  const usageKept = await pool.query('SELECT count(*)::int AS n FROM usage_logs WHERE user_id = $1', [userId]);
  check('1F سجل الاستهلاك يبقى بعد حذف المحادثات', usageKept.rows[0].n > 0, `${usageKept.rows[0].n} سطر`);
}

/**
 * اختبارات حدود التخزين: الافتراضي 100/500، ضبط المدير، رفض القيم غير المنطقية،
 * ورفض الرفع عند تجاوز حصة المستخدم. تُعيد القيم الافتراضية في النهاية.
 */
async function testStorageLimits() {
  const defaults = await storageLimits();
  check('1E الحد الافتراضي: ملف 100 MB / حصة 500 MB', defaults.maxUploadMb === 100 && defaults.maxStorageMb === 500, JSON.stringify(defaults));

  const adminPage = await call('/admin/settings', { expect: [200] });
  check('1E صفحة إعدادات التخزين تفتح للمدير', adminPage.ok && adminPage.text.includes('name="max_upload_mb"') && adminPage.text.includes('name="max_storage_mb"'));

  await saveStorageLimits({ maxUploadMb: 30, maxStorageMb: 50 });
  const changed = await storageLimits();
  check('1E المدير يغيّر الحدود (30/50)', changed.maxUploadMb === 30 && changed.maxStorageMb === 50, JSON.stringify(changed));

  let rejected = false;
  try {
    await saveStorageLimits({ maxUploadMb: 100, maxStorageMb: 10 });
  } catch (error) {
    rejected = error.code === 'INVALID_LIMITS';
  }
  check('1E ترفض حصة أقل من حجم الملف الواحد', rejected);

  // باحث يرفع 30MB ثم يحاول تجاوز الحصة الباقية (20MB)
  const { user, cookie } = await createTestUser();
  const megabytes = (n) => Buffer.alloc(n * 1024 * 1024, 0x41);
  const fakeFile = (name, sizeMb) => ({
    name,
    size: sizeMb * 1024 * 1024,
    type: 'application/pdf',
    arrayBuffer: async () => megabytes(sizeMb).buffer
  });

  await saveUpload(user.id, { file: fakeFile('a.pdf', 30) });
  const summary = await filesSummary(user.id);
  check('1E الملخّص يحسب المستخدم والمتبقي', summary.usedMb === 30 && summary.quotaMb === 50 && summary.remainingMb === 20, JSON.stringify(summary));

  let quotaBlocked = false;
  try {
    await saveUpload(user.id, { file: fakeFile('b.pdf', 30) });
  } catch (error) {
    quotaBlocked = error.code === 'QUOTA_EXCEEDED';
  }
  check('1E يرفض رفع يتجاوز الحصة الكلية', quotaBlocked);

  let sizeBlocked = false;
  try {
    await saveUpload(user.id, { file: fakeFile('c.pdf', 31) });
  } catch (error) {
    sizeBlocked = error.code === 'TOO_LARGE';
  }
  check('1E يرفض ملف أكبر من حد الملف الواحد', sizeBlocked);

  // دقة العرض: ملف صغير يجب ألا يظهر «0 MB» أو شريطاً غير مرئي
  const small = await filesSummary(user.id);
  check(
    '1E الحصة تظهر بالبايت الدقيق (لا 0 MB لملف صغير)',
    typeof small.usedLabel === 'string' && /KB|MB/.test(small.usedLabel),
    small.usedLabel
  );
  check('1E شريط المساحة مرئي مع أي استخدام', small.barWidth >= 1.2, `${small.barWidth}%`);
  const smallPage = (await call('/files', { cookie })).text.split('</style>')[1] || '';
  const flatPage = smallPage.replace(/\s+/g, ' ');
  check(
    '1E الكارت يعرض «X من Y» + المتاح',
    flatPage.includes('مساحة ملفاتك') && flatPage.includes('المتاح:') && /من [\d.]+ (MB|GB|KB)/.test(flatPage)
  );

  // الترقية عبر الواجهة: ننزّل الحد إلى 5MB والرفع بالحقل يجب أن يُرفض
  await saveStorageLimits({ maxUploadMb: 5, maxStorageMb: 50 });
  const form = new FormData();
  form.append('file', new Blob([megabytes(10)], { type: 'application/pdf' }), 'ten.pdf');
  const viaForm = await fetch(`${BASE}/files`, { method: 'POST', headers: { cookie }, body: form, redirect: 'manual' });
  check('1E الحد الجديد يطبَّق فوراً على الرفع', viaForm.status === 303 && (viaForm.headers.get('location') || '').includes('err=file_bad'));

  // تنظيف + إعادة الافتراضي
  const files = await pool.query('SELECT id FROM files WHERE user_id = $1', [user.id]);
  for (const file of files.rows) await deleteFile(user.id, file.id);
  await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  await saveStorageLimits({ maxUploadMb: defaults.maxUploadMb, maxStorageMb: defaults.maxStorageMb });
  const restored = await storageLimits();
  check('1E العودة للافتراضي بعد الاختبار', restored.maxUploadMb === 100 && restored.maxStorageMb === 500, JSON.stringify(restored));
}

async function main() {
  const { user, cookie } = await createTestUser();

  try {
    await testJourney(cookie);
    await testReferences(user.id, cookie);
    await testNotes(user.id, cookie);
    await testFiles(user.id, cookie);
    await testChat(user.id, cookie);
    await testStorageLimits();
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    await pool.end();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${failed.length ? '❌' : '✅'} النتيجة النهائية: ${results.length - failed.length}/${results.length} اختبار ناجح`);
  failed.forEach((item) => console.log(`   - ${item.name} ${item.extra}`));
  if (failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('تعذّر تشغيل الاختبار:', error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});