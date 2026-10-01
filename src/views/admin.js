import { escapeHtml, renderLayout, renderStat, renderTable } from './layout.js';
import { formatDate, formatDateTime, formatNumber, formatPrice } from './format.js';

/**
 * صفحات لوحة الإدارة مولَّدة على الخادم (Server-Side Rendering) — بدون React
 * وبدون أي خطوة بناء. تُقرأ البيانات مباشرة من PostgreSQL وتُطبع كـ HTML.
 */

/** نظرة عامة: أرقام سريعة + أحدث الباحثين + نموذج إرسال إشعار للجميع. */
export function renderAdminHome({ counts, latestUsers, sent = 0, adminToken = '' }) {
  const stats = [
    ['الباحثون', counts.users],
    ['حسابات نشطة', counts.active_users],
    ['مديرون', counts.admins],
    ['ملفات بحثية', counts.profiles],
    ['الباقات', counts.plans],
    ['عمليات استهلاك', counts.usage_events],
    ['نقاط مستهلكة', counts.tokens_used]
  ]
    .map(([label, value]) => renderStat(label, value))
    .join('');

  const rows = latestUsers.map(
    (user) => `
    <td>
      <p class="strong">${escapeHtml(user.full_name || '—')}</p>
      <p class="muted">${escapeHtml(user.email)}</p>
    </td>
    <td>${escapeHtml(user.university || '—')}</td>
    <td><span class="badge badge-plan">${escapeHtml(user.plan_code || 'بدون باقة')}</span></td>
    <td>${escapeHtml(formatNumber(user.tokens_balance))}</td>
    <td>${escapeHtml(formatDate(user.created_at))}</td>`
  );

  const body = `
  <div class="grid">${stats}</div>
  ${
    sent
      ? `<div class="alert"><b>تم الإرسال:</b> أُرسل الإشعار إلى ${escapeHtml(String(sent))} حساباً — حُفظ داخل موقع كل باحث فوراً، ووصل push لمن فعّل هاتفه.</div>`
      : ''
  }
  <div class="card mt-16">
    <h2>أحدث الباحثين</h2>
    ${renderTable({
      columns: ['الباحث', 'الجامعة', 'الباقة', 'الرصيد', 'التسجيل'],
      rows,
      emptyMessage: 'لا يوجد باحثون مسجّلون بعد.'
    })}
  </div>
  <div class="card">
    <h2>إرسال إشعار للباحثين</h2>
    <p class="muted">يُحفظ داخل موقع كل باحث فوراً، ويصل كإشعار هاتف (push) لمن سجّل توكن جهازه.</p>
    <form method="post" action="/admin/notifications${adminToken ? `?token=${encodeURIComponent(adminToken)}` : ''}">
      <div class="field">
        <label for="notif-title">عنوان الإشعار</label>
        <input type="text" id="notif-title" name="title" maxlength="120" required placeholder="مثال: بوابة الرسائل مفتوحة الآن" />
      </div>
      <div class="field">
        <label for="notif-body">نص الإشعار (اختياري)</label>
        <textarea id="notif-body" name="body" maxlength="500" rows="3" placeholder="تفاصيل تظهر تحت العنوان في هاتف الباحث"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">إرسال لكل الباحثين</button>
        <span class="muted">يُرسل أيضاً إشعار ترحيبي تلقائياً لكل حساب جديد.</span>
      </div>
    </form>
  </div>
  <div class="card">
    <h2>روابط سريعة</h2>
    <div class="links">
      <a class="btn btn-primary" href="/admin/users">إدارة الباحثين</a>
      <a class="btn" href="/admin/plans">الباقات</a>
      <a class="btn" href="/admin/usage">سجل الاستهلاك</a>
      <a class="btn" href="/admin/settings">إعدادات التخزين</a>
      <a class="btn" href="/api/health">/api/health</a>
      <a class="btn" href="/api/users">/api/users</a>
    </div>
  </div>`;

  return renderLayout({
    title: 'نظرة عامة',
    subtitle: 'ملخص سريع لحالة المنصة من قاعدة بيانات PostgreSQL',
    activeKey: 'home',
    body
  });
}

/**
 * صفحة حالة المزوّدين: جدول يوضّح لكل مزوّد حالته وسبب تعطّله،
 * وزر «فحص الآن» يرسل نداءً صغيراً لكل مفتاح ليرى المدير الخطأ الحقيقي.
 */
export function renderAdminProviders({ status = [], probed = false, adminToken = '' }) {
  const query = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const live = probed ? `${query ? '&' : '?'}probe=1` : `${query}${query ? '&' : '?'}probe=1`;

  const rows = status.map((item) => {
    const probe = item.probe;
    let badge = '<span class="badge badge-active">جاهز</span>';
    if (!item.configured) badge = '<span class="badge">غير مُعدّ</span>';
    else if (probe && !probe.ok) badge = `<span class="badge badge-error">متوقّف${probe.status ? ` · ${probe.status}` : ''}</span>`;
    else if (item.down) badge = '<span class="badge badge-error">خارج الدوران</span>';
    else if (probe && probe.ok) badge = '<span class="badge badge-active">يعمل الآن</span>';

    const backIn = item.down && item.backInMs ? ` · يعود بعد ${Math.ceil(item.backInMs / 60000)} دقيقة` : '';
    const models = (item.models || []).map((model) => escapeHtml(model)).join(' ← ');
    const detail = probe && !probe.ok ? probe.reason : item.reason || '';
    const keyCount = item.keyCount > 1 ? ` · ${item.keyCount} مفاتيح` : '';

    // سطر لكل مفتاح: المفتاح الثاني قد ينفد رصيده بينما الأول سليم.
    const keyLines = (item.keyStates || []).map((state) => {
      const probed = (probe?.keys || []).find((entry) => entry.position === state.position);
      const mark = probed ? (probed.ok ? '✔' : '✘') : state.down ? '⏸' : '·';
      const note = probed ? probed.reason : state.reason || '';
      const tail = state.down && state.backInMs ? ` (يعود بعد ${Math.ceil(state.backInMs / 60000)} د)` : '';
      return `<li><b>${mark} مفتاح ${state.position}</b> — ${escapeHtml(note || 'لم يُفحص')}${escapeHtml(tail)}</li>`;
    });

    return `
    <td class="strong">${escapeHtml(item.label || item.key)}</td>
    <td>${badge}</td>
    <td><span class="mono small">${models || '—'}</span></td>
    <td>${escapeHtml(detail || '—')}${escapeHtml(backIn)}${escapeHtml(keyCount)}
      ${keyLines.length ? `<ul class="small muted" style="margin:6px 0 0;padding-inline-start:18px">${keyLines.join('')}</ul>` : ''}
    </td>
    <td>${probe ? `${probe.ms}ms` : '—'}</td>`;
  });

  const body = `
  <div class="card">
    <h2>حالة مزوّدي الذكاء الاصطناعي</h2>
    <p class="muted">
      يردّ الموقع من أول مزوّد ينجح. عند تعطّل مزوّد يخرج من الدوران مؤقّتاً حتى لا يضيّع وقت الباحث،
      والطلب يذهب للمزوّد التالي بالتوازي بعد ٣٫٥ ثانية، ومعه قائمة نماذج تُجرَّب بالترتيب.
    </p>
    <div class="links">
      <a class="btn btn-primary" href="/admin/providers${live}">فحص الآن (نداء صغير لكل مفتاح)</a>
      <a class="btn" href="/admin/providers${query}">تحديث الحالة فقط</a>
    </div>
  </div>
  <div class="card mt-16">
    ${renderTable({
      columns: ['المزوّد', 'الحالة', 'النماذج (بترتيب التبديل)', 'السبب + كل مفتاح', 'زمن الرد'],
      rows,
      emptyMessage: 'لا يوجد مزوّدات.'
    })}
  </div>
  <div class="card">
    <h2>معاني الأخطاء</h2>
    <ul class="muted">
      <li><b>402</b> لا يوجد رصيد عند المزوّد — اشحن حساب OpenRouter من settings/credits.</li>
      <li><b>403</b> لا ترخيص على فريق xAI — اشحنه من console.x.ai/team.</li>
      <li><b>429</b> تجاوزت حصة المفتاح أو حدّ معدّله.</li>
      <li><b>503</b> النموذج مزدحم — يتغيّر بين النماذج تلقائياً بقائمة النماذج.</li>
      </ul>
      <p class="muted">كل مزوّد يقرأ مفتاحه من <code>NAME_API_KEYS</code> (مفاتيح مفصولة بفواصل) أو
        <code>NAME_API_KEY</code> (مفتاح واحد). نفاد رصيد مفتاح لا يوقف الموقع: يخرج ذلك المفتاح وحده
        من الدوران ١٠ دقائق ويعمل الباقي، ثم يعود وحده بعد شحنه بلا إعادة تشغيل.</p>
      <ul class="muted">
    </ul>
  </div>`;

  return renderLayout({
    title: 'المزوّدون',
    subtitle: 'من يردّ الآن على المشرف الذكي، ولماذا يتعطّل',
    activeKey: 'providers',
    body
  });
}

/** سجل الاستهلاك: ملخص حسب النوع + آخر العمليات. */
export function renderAdminUsage({ summary, recent, totalTokens }) {
  const summaryRows = summary.map(
    (row) => `
    <td class="strong">${escapeHtml(row.type)}</td>
    <td>${escapeHtml(formatNumber(row.events))}</td>
    <td>${escapeHtml(formatNumber(row.tokens))}</td>`
  );

  const recentRows = recent.map(
    (row) => `
    <td>${escapeHtml(formatDateTime(row.created_at))}</td>
    <td>${escapeHtml(row.email)}</td>
    <td>${escapeHtml(row.type)}</td>
    <td>${escapeHtml(formatNumber(row.tokens_used))}</td>
    <td class="muted">${escapeHtml(row.summary || '—')}</td>`
  );

  const body = `
  <div class="grid">${renderStat('إجمالي النقاط المستهلكة', totalTokens)}${renderStat(
    'عدد العمليات',
    summary.reduce((total, row) => total + Number(row.events), 0)
  )}</div>
  <div class="card mt-16">
    <h2>الاستهلاك حسب النوع</h2>
    ${renderTable({
      columns: ['النوع', 'عدد العمليات', 'النقاط'],
      rows: summaryRows,
      emptyMessage: 'لا يوجد استهلاك مسجّل بعد.'
    })}
  </div>
  <div class="card">
    <h2>آخر 100 عملية</h2>
    ${renderTable({
      columns: ['التاريخ', 'الباحث', 'النوع', 'النقاط', 'الملخص'],
      rows: recentRows,
      emptyMessage: 'لا توجد عمليات مسجّلة بعد.'
    })}
  </div>`;

  return renderLayout({
    title: 'سجل الاستهلاك',
    subtitle: 'متابعة استهلاك النقاط لكل عملية ولكل باحث',
    activeKey: 'usage',
    body
  });
}

/** جدول الباحثين مع بحث وفلترة وترقيم صفحات (بديل لواجهة /admin/users السابقة). */
export function renderAdminUsers({ users, total, page, pageSize, search, filter, isAdminDenied = false }) {
  if (isAdminDenied) {
    return renderLayout({
      title: 'غير مصرّح',
      subtitle: 'لوحة الإدارة متاحة من الجهاز المحلي فقط',
      activeKey: 'users',
      body: `<div class="notice"><h2>الوصول مرفوض</h2><p>يمكن الوصول للوحة الإدارة من localhost فقط، أو بإرسال رمز الإدارة في الترويسة x-admin-token.</p></div>`
    });
  }

  const filters = [
    ['all', 'الكل'],
    ['active', 'النشطة'],
    ['disabled', 'الموقوفة']
  ];

  const link = (nextFilter, nextPage = 1) => {
    const params = new URLSearchParams({ filter: nextFilter, page: String(nextPage) });
    if (search) params.set('q', search);
    return `/admin/users?${params.toString()}`;
  };

  const toolbar = `
  <form class="toolbar" method="get" action="/admin/users">
    <input type="search" name="q" value="${escapeHtml(search)}" placeholder="ابحث بالإيميل أو الاسم أو الجامعة..." />
    <input type="hidden" name="filter" value="${escapeHtml(filter)}" />
    <button class="btn btn-primary" type="submit">بحث</button>
    ${filters
      .map(
        ([value, label]) =>
          `<a class="btn${filter === value ? ' btn-primary' : ''}" href="${link(value)}">${escapeHtml(label)}</a>`
      )
      .join('')}
  </form>`;

  const rows = users.map(
    (user) => `
    <td>
      <p class="strong">${escapeHtml(user.full_name || '—')}${
        user.role === 'admin' ? ' <span class="badge badge-admin">مدير</span>' : ''
      }</p>
      <p class="muted">${escapeHtml(user.email)}</p>
      ${user.is_active ? '' : '<span class="badge badge-off">موقوف</span>'}
    </td>
    <td>
      <p>${escapeHtml(user.university || '—')}</p>
      <p class="muted">${escapeHtml(user.research_field || '—')}</p>
      ${user.degree_level ? `<p class="muted">${escapeHtml(user.degree_level)}</p>` : ''}
    </td>
    <td><span class="badge badge-plan">${escapeHtml(user.plan_code || 'بدون باقة')}</span></td>
    <td>
      <p class="strong">${escapeHtml(formatNumber(user.tokens_balance))}</p>
      <p class="muted">استُهلك: ${escapeHtml(formatNumber(user.tokens_used))}</p>
    </td>
    <td>${escapeHtml(formatDate(user.created_at))}</td>`
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pagination = `
  <div class="toolbar mt-12">
    <span class="muted">عرض ${escapeHtml(formatNumber(users.length))} من ${escapeHtml(
      formatNumber(total)
    )} باحث — صفحة ${escapeHtml(formatNumber(page))} من ${escapeHtml(formatNumber(totalPages))}</span>
    ${page > 1 ? `<a class="btn" href="${link(filter, page - 1)}">السابق</a>` : ''}
    ${page < totalPages ? `<a class="btn" href="${link(filter, page + 1)}">التالي</a>` : ''}
  </div>`;

  const body = `
  <div class="card">
    <h2>الباحثون (${escapeHtml(formatNumber(total))})</h2>
    ${toolbar}
    ${renderTable({
      columns: ['الباحث', 'الجامعة / المجال', 'الباقة', 'النقاط', 'التسجيل'],
      rows,
      emptyMessage: search
        ? 'لا يوجد باحثون مطابقون للبحث. جرّب مصطلحاً آخر أو ألغِ الفلتر.'
        : 'لا يوجد باحثون مسجّلون بعد.'
    })}
    ${pagination}
  </div>`;

  return renderLayout({
    title: 'إدارة الباحثين',
    subtitle: 'بحث وفلترة ومتابعة الباقة ورصيد النقاط لكل باحث',
    activeKey: 'users',
    body
  });
}

/** جدول الباقات مع عدد المشتركين في كل باقة. */
export function renderAdminPlans({ plans, totalSubscribers }) {
  const rows = plans.map(
    (plan) => `
    <td class="strong">${escapeHtml(plan.code)}</td>
    <td>${escapeHtml(plan.title)}</td>
    <td>${escapeHtml(formatPrice(plan.price))}</td>
    <td>${escapeHtml(formatNumber(plan.tokens))}</td>
    <td>${
      plan.is_active
        ? '<span class="badge badge-active">مفعّلة</span>'
        : '<span class="badge badge-off">معطّلة</span>'
    }</td>
    <td>${escapeHtml(formatNumber(plan.subscribers))}</td>
    <td>${escapeHtml(formatDate(plan.created_at))}</td>`
  );

  const body = `
  <div class="grid">${renderStat('عدد الباقات', plans.length)}${renderStat('إجمالي المشتركين', totalSubscribers)}</div>
  <div class="card mt-16">
    <h2>الباقات</h2>
    ${renderTable({
      columns: ['الكود', 'الاسم', 'السعر', 'النقاط', 'الحالة', 'المشتركون', 'تاريخ الإنشاء'],
      rows,
      emptyMessage: 'لا توجد باقات بعد — شغّل npm run db:seed لإضافة الباقات الافتراضية.'
    })}
  </div>`;

  return renderLayout({
    title: 'الباقات',
    subtitle: 'الباقات المتاحة وعدد المشتركين في كل باقة',
    activeKey: 'plans',
    body
  });
}

/** يحول البايتات إلى نص مقروء (KB/MB/GB). */
function humanBytes(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1073741824) return `${(size / 1073741824).toFixed(2)} GB`;
  if (size >= 1048576) return `${(size / 1048576).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} بايت`;
}

/**
 * إعدادات التخزين: يضبط المدير حجم الملف الواحد والمساحة الكلية لكل باحث.
 * التغيير يُحفظ في جدول settings ويسري فوراً على كل الحسابات بلا إعادة تشغيل.
 */
export function renderAdminSettings({ limits, usage = {}, saved = false, error = '', adminToken = '' }) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const stats = [
    ['أقصى حجم للملف الواحد', `${limits.maxUploadMb} MB`],
    ['المساحة الكلية لكل باحث', `${limits.maxStorageMb} MB`],
    ['إجمالي ملفات المنصة', `${humanBytes(usage.bytes)} · ${usage.files || 0} ملف`],
    ['باحثون رفعوا ملفات', `${usage.users || 0} باحث`]
  ]
    .map(([label, value]) => renderStat(label, value))
    .join('');

  const body = `
  <div class="grid">${stats}</div>
  ${
    saved
      ? '<div class="notice">حُفظت حدود التخزين — تسري على كل الباحثين فوراً.</div>'
      : ''
  }
  ${error ? `<div class="alert"><b>تعذّر الحفظ:</b> ${escapeHtml(error)}</div>` : ''}
  <div class="card mt-16">
    <h2>حدود رفع الملفات</h2>
    <p class="muted">
      حجم الملف الواحد: أقصى حجم لملف يرفعه الباحث. المساحة الكلية: مجموع ما يمكن أن يرفعه
      باحث واحد (لو ملأها لن يستطيع الرفع حتى يحذف ملفاً). يجب أن تكون المساحة الكلية
      أكبر من أو تساوي حجم الملف الواحد.
    </p>
    <form method="post" action="/admin/settings/storage${token}" class="form-card">
      <div class="field-row">
        <div class="field">
          <label for="max_upload_mb">أقصى حجم للملف الواحد (MB)</label>
          <input type="number" id="max_upload_mb" name="max_upload_mb" min="1" max="2048" step="1" required
            value="${escapeHtml(String(limits.maxUploadMb))}" />
          <p class="form-hint">مثال: 100 يعني 100 ميجابايت كحد أقصى للملف.</p>
        </div>
        <div class="field">
          <label for="max_storage_mb">المساحة الكلية لكل باحث (MB)</label>
          <input type="number" id="max_storage_mb" name="max_storage_mb" min="10" max="102400" step="10" required
            value="${escapeHtml(String(limits.maxStorageMb))}" />
          <p class="form-hint">مثال: 500 يعني 500 ميجابايت إجمالاً. (1024 = 1 جيجابايت)</p>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">حفظ الحدود</button>
        <span class="muted">يُطبَّق فوراً — لا يحتاج إعادة تشغيل الخادم.</span>
      </div>
    </form>
  </div>
  <div class="card">
    <h2>روابط سريعة</h2>
    <div class="links">
      <a class="btn" href="/admin">نظرة عامة</a>
      <a class="btn" href="/admin/users">إدارة الباحثين</a>
      <a class="btn" href="/admin/plans">الباقات</a>
    </div>
  </div>`;

  return renderLayout({
    title: 'إعدادات التخزين',
    subtitle: 'حدود رفع الملفات والمساحة المخصصة لكل باحث',
    activeKey: 'settings',
    body
  });
}

