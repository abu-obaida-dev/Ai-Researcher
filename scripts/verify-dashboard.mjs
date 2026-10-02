import assert from 'node:assert/strict';
import { pool } from '../src/db/client.js';
import { getDashboardStats } from '../src/services/dashboard.js';
import { getJourneySummary } from '../src/services/journey.js';
import { renderAccountPage, renderDashboardPage } from '../src/views/auth.js';

const stamp = Date.now();

const { rows } = await pool.query(
  `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, tokens_used, tokens_granted, onboarding_complete, is_active, plan_code)
   VALUES ($1, 'باحث إحصائية', $2, 'researcher', 900, 100, 1000, true, true, 'free_trial')
   RETURNING *`,
  [`stats.${stamp}@example.com`, `stats-${stamp}`]
);
const user = rows[0];

try {
  // بيانات اختبار: عمليات استهلاك (اليوم وأمس) + مرجع/ملاحظة/ملف/محادثة/سؤال
  await pool.query(
    `INSERT INTO usage_logs (user_id, type, tokens_used, summary, created_at) VALUES
       ($1, 'chat', 30, 'سؤالي · model=x', NOW()),
       ($1, 'chat', 45, 'سؤال آخر', NOW() - interval '1 day'),
       ($1, 'review', 150, 'مراجعة فصل', NOW() - interval '1 day'),
       ($1, 'chat_failed', 0, 'فشل المزود', NOW())`,
    [user.id]
  );
  await pool.query(
    `INSERT INTO user_references (user_id, custom_title, custom_authors, custom_year, status) VALUES ($1, 'مرجع', 'مؤلف', 2024, 'to_read')`,
    [user.id]
  );
  await pool.query(`INSERT INTO notes (user_id, title, body) VALUES ($1, 'ملاحظة', 'نص')`, [user.id]);
  await pool.query(
    `INSERT INTO files (user_id, title, file_name, stored_path, mime, size_bytes) VALUES ($1, 'ملف', 'a.pdf', 'x/a.pdf', 'application/pdf', 100)`,
    [user.id]
  );
  const conv = await pool.query(
    `INSERT INTO conversations (user_id, title) VALUES ($1, 'محادثة') RETURNING id`,
    [user.id]
  );
  await pool.query(
    `INSERT INTO messages (conversation_id, role, content, tokens_used) VALUES
       ($1, 'user', 'س00', 30), ($1, 'assistant', 'رد', 0), ($1, 'user', 'س2', 45)`,
    [conv.rows[0].id]
  );

  // 1) الإحصاءات
  const stats = await getDashboardStats(user.id);
  assert.equal(stats.days.length, 7, 'يجب أن يكون مخطط النشاط ٧ أيام');
  assert.equal(stats.days.at(-1).tokens, 30, 'آخر يوم يجب أن يحمل 30 نقطة');
  assert.equal(stats.days.at(-2).tokens, 195, 'أمس يجب أن يحمل 195 نقطة');
  assert.equal(stats.maxTokens, 195, 'أعلى يوم = 195');
  assert.equal(stats.weekTokens, 225, 'إجمالي الأسبوع = 225');
  assert.ok(stats.byType.every((row) => row.type !== 'chat_failed'), 'الأنواع الفاشلة مستثناة من التوزيع');
  assert.equal(stats.byType.find((r) => r.type === 'review').tokens, 150, 'توزيع review = 150');
  assert.equal(stats.totalByType, 225, 'إجمالي التوزيع = 225');
  assert.deepEqual(
    [stats.counts.references, stats.counts.notes, stats.counts.files, stats.counts.conversations, stats.counts.questions, stats.counts.failed],
    [1, 1, 1, 1, 2, 1],
    'أعداد المكتبة والمحادثات والمحاولات الفاشلة'
  );
  assert.ok(stats.lastActivity, 'آخر نشاط غير فارغ');

  // 2) ملخص المسار يحمل الخطوات الإلزامية
  const journey = await getJourneySummary(user.id, 'bachelor');
  assert.ok(journey && Number.isInteger(journey.requiredTotal) && journey.requiredTotal > 0, 'الخطوات الإلزامية تظهر');
  assert.equal(typeof journey.completed, 'boolean', 'حالة الاكتمال boolean');

  // 3) عرض الصفحة: مخططات ومؤشرات موجودة، وأزرار السايدبار المكرّرة مُزالة
  const plan = { title: 'الباقة المجانية' };
  const usage = { events: 4, tokens: 225, recent: [{ type: 'chat', tokens_used: 30, summary: 'سؤالي', created_at: new Date() }] };
  const html = renderDashboardPage({
    account: user,
    profile: { degree_level: 'bachelor', research_field: 'إدارة الأعمال', university: 'جامعة', research_stage: 'proposal' },
    plan,
    usage,
    journey,
    unread: 2,
    stats
  });

  assert.ok(html.includes('class="stat-grid"'), 'شريط المؤشرات موجود');
  assert.ok(html.includes('class="bars"') && html.includes('bar-fill'), 'مخطط الأعمدة مرسوم');
  assert.ok(html.includes('conic-gradient'), 'المخطط الدائري مرسوم');
  assert.ok(html.includes('class="legend"') && html.includes('mini-stats'), 'وسيلة الإيضاح وإحصاءات المكتبة');
  assert.ok(html.includes('الخطوات الإلزامية'), 'بطاقة المسار تعرض الإلزامية');

  // الأزرار المكرّرة مع السايدبار يجب أن تكون مُزالة من جسم الصفحة
  // (نستثني السايدبار: روابطه موجودة بحق لأنه مصدر التنقّل الأساسي)
  const mainStart = html.indexOf('<div class="app-main">');
  const sideStart = html.indexOf('<aside class="app-side">');
  assert.ok(mainStart > -1 && sideStart > mainStart, 'جسم الصفحة والسايدبار موجودان');
  const main = html.slice(mainStart, sideStart);

  for (const href of ['href="/chat"', 'href="/journey"', 'href="/account"']) {
    assert.ok(!main.includes(href), `يجب إزالة الرابط المكرّر ${href} من جسم الإحصائية`);
  }
  assert.ok(!main.includes('افتح مسار البحث'), 'زر «افتح مسار البحث» أُزيل');
  assert.ok(!main.includes('ابدأ مع المشرف الذكي'), 'زر «ابدأ مع المشرف الذكي» أُزيل');
  assert.ok(main.includes('href="/#pricing"'), 'زر إضافة النقاط باقٍ (غير مكرّر)');

  // 4) صفحة الحساب: قائمة صورة الحساب في الشريط، وجسم بلا روابط مكرّرة
  const accountHtml = renderAccountPage({
    account: user,
    profile: { research_field: 'إدارة الأعمال', university: 'جامعة', research_stage: 'proposal', degree_level: 'bachelor' },
    plan,
    usage: { events: 4, tokens: 225, recent: [] },
    unread: 0
  });
  assert.ok(accountHtml.includes('id="user-toggle"') && accountHtml.includes('id="user-menu"'), 'قائمة صورة الحساب في الشريط');
  assert.ok(accountHtml.includes('تسجيل الخروج'), 'تسجيل الخروج داخل القائمة المنسدلة');
  assert.ok(accountHtml.includes('role-chip'), 'شارة الدور بجانب الاسم');
  const accMainStart = accountHtml.indexOf('<div class="app-main">');
  const accSideStart = accountHtml.indexOf('<aside class="app-side">');
  assert.ok(accMainStart > -1 && accSideStart > accMainStart, 'جسم صفحة الحساب والسايدبار موجودان');
  const accMain = accountHtml.slice(accMainStart, accSideStart);
  for (const href of ['href="/chat"', 'href="/journey"', 'href="/dashboard"', 'href="/logout"', 'href="/account"']) {
    assert.ok(!accMain.includes(href), `لا رابط مكرّر في جسم الحساب: ${href}`);
  }
  assert.ok(!accMain.includes('>الباقات</a>'), 'زر الباقات المكرّر مُزال من جسم الحساب');

  // 5) حساب بلا نشاط: لا تعطّل، وصفحة تُرسم برسائل فارغة
  const emptyUser = await pool.query(
    `INSERT INTO users (email, full_name, google_sub, role, tokens_balance, tokens_granted, onboarding_complete, is_active)
     VALUES ($1, 'باحث جديد', $2, 'researcher', 500, 500, false, true) RETURNING *`,
    [`stats.empty.${stamp}@example.com`, `stats-empty-${stamp}`]
  );
  const emptyStats = await getDashboardStats(emptyUser.rows[0].id);
  assert.equal(emptyStats.weekTokens, 0, 'بلا نشاط = صفر');
  assert.equal(emptyStats.days.length, 7, 'الأيام السبعة تبقى موجودة');
  const emptyHtml = renderDashboardPage({
    account: emptyUser.rows[0],
    profile: null,
    plan,
    usage: { events: 0, tokens: 0, recent: [] },
    journey: null,
    unread: 0,
    stats: emptyStats
  });
  assert.ok(emptyHtml.includes('href="/onboarding"'), 'دعوة إكمال الملف تظهر لمن بلا ملف');
  assert.ok(emptyHtml.includes('لا يوجد استهلاك مسجّل بعد'), 'رسالة فارغة للمخطط الدائري');
  await pool.query('DELETE FROM users WHERE id = $1', [emptyUser.rows[0].id]);

  console.log('✔ الإحصاءات والمخططات تعمل، والأزرار المكرّرة مُزالة من الصفحة.');
} finally {
  await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  await pool.end();
}