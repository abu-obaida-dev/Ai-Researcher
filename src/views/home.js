import { APP_NAME, APP_TAGLINE, escapeHtml, renderLayout } from './layout.js';

/** صفحة حالة الخدمة للمطوّرين: روابط الـ API ولوحة الإدارة ونصائح التشغيل. */
export function renderStatusPage({ account = null } = {}) {
  const body = `
  <div class="hero">
    <div class="hero-top">
      <h1>${escapeHtml(APP_NAME)} — حالة الخدمة</h1>
      <p class="tagline">
        الخدمة تعمل على Node.js + PostgreSQL بدون واجهة React. البيانات متاحة كـ JSON عبر
        <code>/api</code>، ولوحة الإدارة وصفحات الموقع مولَّدة على الخادم.
      </p>
    </div>
    <div class="links">
      <a class="btn btn-primary" href="/api/health">فحص الحالة /api/health</a>
      <a class="btn" href="/api/plans">/api/plans</a>
      <a class="btn" href="/admin/users">لوحة الإدارة — الباحثون</a>
      <a class="btn" href="/">الصفحة الرئيسية</a>
    </div>
  </div>

  <div class="card mt-16">
    <h2>ملاحظات التشغيل</h2>
    <ul>
      <li>الترتيب: <code>npm run db:init</code> ثم <code>npm run db:seed</code> ثم <code>npm run dev</code>.</li>
      <li>لوحة الإدارة تعمل من <code>localhost</code> افتراضياً، أو بحساب جوجل مُدرج في <code>ADMIN_EMAILS</code>.</li>
      <li>الدخول بحساب جوجل يحتاج <code>GOOGLE_CLIENT_ID</code> و<code>GOOGLE_CLIENT_SECRET</code> في <code>.env</code>.</li>
      <li>الهوية البصرية مطبّقة من <code>public/Zena AI — الهوية البصرية.md</code>، والخطوط مستضافة في <code>public/fonts</code>.</li>
    </ul>
  </div>`;

  return renderLayout({
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    area: 'public',
    pageHead: false,
    account,
    body
  });
}

/** صفحة 404 عربية مع روابط الصفحات المتاحة بدل رسالة JSON غامضة. */
export function renderNotFoundPage(pathname, account = null) {
  const body = `
  <div class="notice">
    <h2>الصفحة غير موجودة</h2>
    <p>
      المسار <code>${escapeHtml(pathname)}</code> غير معرّف في هذا الموقع — تحقّق من الرابط أو استخدم
      الروابط التالية.
    </p>
    <div class="links">
      <a class="btn btn-primary" href="/">الصفحة الرئيسية</a>
      <a class="btn" href="/#features">المميزات</a>
      <a class="btn" href="/#pricing">الباقات</a>
      <a class="btn" href="/login">تسجيل الدخول</a>
      <a class="btn" href="/status">حالة الخدمة</a>
    </div>
  </div>`;

  return renderLayout({
    title: 'صفحة غير موجودة (404)',
    subtitle: 'تحقق من الرابط أو استخدم الروابط التالية',
    area: 'public',
    account,
    body
  });
}
