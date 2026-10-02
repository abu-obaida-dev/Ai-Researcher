import { FREE_PLAN_CODE, TOKEN_COSTS } from '../constants.js';
import { escapeHtml, renderLayout, renderStat, renderTable } from './layout.js';
import { formatDate, formatDateTime, formatNumber, formatPrice } from './format.js';

/**
 * صفحات لوحة الإدارة مولَّدة على الخادم (Server-Side Rendering) — بدون React
 * وبدون أي خطوة بناء. تُقرأ البيانات مباشرة من PostgreSQL وتُطبع كـ HTML.
 */

/** أيام الأسبوع بالعربية — تُحلَّل من تاريخ YYYY-MM-DD لمخطط النشاط. */
const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** رسالة نجاح لكل عملية إجراء (تظهر كتنبيه أعلى الصفحة). */
const OK_TEXT = {
  activated: 'تم تفعيل الحساب — يستطيع الباحث الدخول فوراً.',
  suspended: 'تم إيقاف الحساب — يمنع الدخول من كل الأجهزة في طلبه القادم.',
  points_adjusted: 'تم تعديل رصيد النقاط وتسجيل العملية في سجل الاستهلاك.',
  plan_updated: 'تم تغيير الباقة — تسري الجديد فوراً.',
  notified: 'أُرسل الإشعار إلى الباحث (داخل الموقع + push لمن فعّل هاتفه).',
  user_deleted: 'تم حذف الحساب — أُلغي دخوله فوراً وبقيت سجلاته في القاعدة.',
  admin_added: 'أُضيف المدير — تُمنح الصلاحية في الطلب التالي لذلك الحساب.',
  admin_updated: 'حُدّث بريد المدير في الجدول.',
  admin_removed: 'أُزيل المدير من الجدول — لن يستطيع دخول لوحة الإدارة بعد طلبه القادم.',
  permission_added: 'أُضيفت الصلاحية — تسري على الحسابات في طلباتها القادمة.',
  permission_removed: 'حُذفت الصلاحية من الدور.',
  plan_saved: 'حُفظت الباقة — تسري على صفحة الهبوط وكل نصوص الموقع فوراً.',
  link_added: 'حُفظ الرابط — المفتاح والنموذج دخلا الدوران فوراً بلا إعادة تشغيل.',
  link_removed: 'حُذف الرابط — عاد المفتاح لوضعه الطبيعي (مفاتيح .env فقط إن لم يبقَ رابط).'
};

/** بطاقة مؤشر بقيمة نصية غير رقمية (اسم قاعدة البيانات، إصدار Node... إلخ). */
function statRaw(label, value) {
  return `<div class="stat"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(
    String(value)
  )}</p></div>`;
}

/** مخطط أعمدة للنقاط المستهلكة في آخر ٧ أيام — CSS خالص من الخادم (بلا مكتبات ولا سكربتات). */
function renderActivityBars(days = []) {
  if (!days.length) return '<div class="empty">لا تتوفّر بيانات نشاط بعد.</div>';

  const max = Math.max(...days.map((day) => Number(day.tokens) || 0), 1);
  const bars = days
    .map((day, index) => {
      const tokens = Number(day.tokens) || 0;
      const height = tokens > 0 ? Math.max(6, Math.round((tokens / max) * 100)) : 0;
      const isToday = index === days.length - 1;
      const [year, month, date] = String(day.day || '').split('-').map(Number);
      const weekday = year ? WEEKDAYS_AR[new Date(Date.UTC(year, month - 1, date)).getUTCDay()] : '';
      const title = `${day.day} — ${formatNumber(tokens)} نقطة في ${formatNumber(day.events)} عملية`;

      return `<div class="bar-col${isToday ? ' is-today' : ''}" title="${escapeHtml(title)}">
  <span class="bar-value${tokens ? '' : ' is-empty'}">${escapeHtml(formatNumber(tokens))}</span>
  <span class="bar-track"><i class="bar-fill" style="${height ? `height:${height}%` : ''}"></i></span>
  <span class="bar-label">${escapeHtml(isToday ? 'اليوم' : weekday)}</span>
</div>`;
    })
    .join('');

  return `<div class="bars" role="img" aria-label="النقاط المستهلكة يومياً">${bars}</div>`;
}

/** ألوان مخططات لوحة الإدارة — من هوية المنصة (نفس درجات صفحة الاستهلاك). */
const CHART_COLORS = ['#0d8e93', '#19b5a5', '#f4a261', '#7ecfc4', '#526777', '#0a6f73', '#c98b4b'];

/** تسمية عربية لنوع عملية الاستهلاك — الأنواع غير المعروفة تبقى بكودها المفهوم. */
function usageLabel(type) {
  const known = TOKEN_COSTS.find((item) => item.type === type);
  if (known) return known.label;
  return { chat_failed: 'رسالة فشلت (بلا خصم)', admin_adjust: 'تعديل إداري' }[type] || String(type);
}

/**
 * مخطط دائري (Donut) لتوزيع النقاط على الأنواع — conic-gradient مرسوم من
 * الخادم بلا سكربتات، مع وسيلة إيضاح بالنقاط والنسب.
 */
function renderDonut(rows, { total, unit = 'نقطة' }) {
  const clean = rows.filter((row) => Number(row.tokens) > 0);
  if (!clean.length || !total) return '<div class="empty">لا توجد نقاط مستهلكة بعد لتوزيعها على الأنواع.</div>';

  let accumulated = 0;
  const stops = [];
  const legend = clean.map((row, index) => {
    const color = CHART_COLORS[index % CHART_COLORS.length];
    const share = Number(row.tokens) / total;
    const start = accumulated * 100;
    accumulated += share;
    stops.push(`${color} ${start.toFixed(2)}% ${(accumulated * 100).toFixed(2)}%`);

    return `<li class="legend-item">
  <span class="legend-dot" style="background:${color}"></span>
  <span class="legend-label">${escapeHtml(row.label)}</span>
  <span class="legend-value">${escapeHtml(formatNumber(row.tokens))} ${escapeHtml(unit)} · ${Math.round(share * 100)}%</span>
</li>`;
  });

  return `<div class="donut-wrap">
  <div class="donut" style="background:conic-gradient(${stops.join(', ')})" role="img" aria-label="توزيع النقاط على أنواع العمليات">
    <span class="donut-hole"><b>${escapeHtml(formatNumber(total))}</b><em>${escapeHtml(unit)} موزّعة</em></span>
  </div>
  <ul class="legend">${legend.join('')}</ul>
</div>`;
}

/** خيارات عدد العمليات المعروضة في فلتر الجداول. */
const LIMIT_CHOICES = [8, 25, 50, 100, 250, 500];

/**
 * شريط فلترة عمليات الاستهلاك: بحث (اختياري) + تاريخ + من/إلى ساعة + عدد
 * النتائج، كنموذج GET يرفع على الصفحة نفسها. الرمز الإداري يُرسل حقلًا
 * مخفياً لأن نموذج GET يستبدل سلسلة الاستعلام في الرابط.
 */
function operationsFilterBar({ action, adminToken = '', q = null, date = '', h1 = '', h2 = '', limit = 8 }) {
  const hourSelect = (id, name, current, blank) => `<select id="${id}" name="${name}">
    <option value=""${String(current) === '' ? ' selected' : ''}>${blank}</option>
    ${Array.from(
      { length: 24 },
      (_, hour) =>
        `<option value="${hour}"${String(current) === String(hour) ? ' selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`
    ).join('')}
  </select>`;

  return `
  <form class="filter-bar" method="get" action="${escapeHtml(action)}">
    ${
      q === null
        ? ''
        : `<div class="field">
      <label for="op-q">بحث</label>
      <input type="search" id="op-q" name="q" value="${escapeHtml(q)}" placeholder="إيميل أو نوع أو ملخص" />
    </div>`
    }
    <div class="field">
      <label for="op-date">التاريخ</label>
      <input type="date" id="op-date" name="date" value="${escapeHtml(date)}" />
    </div>
    <div class="field">
      <label for="op-h1">من الساعة</label>
      ${hourSelect('op-h1', 'h1', h1, 'بداية اليوم')}
    </div>
    <div class="field">
      <label for="op-h2">إلى الساعة</label>
      ${hourSelect('op-h2', 'h2', h2, 'نهاية اليوم')}
    </div>
    <div class="field">
      <label for="op-limit">عدد النتائج</label>
      <select id="op-limit" name="limit">
        ${LIMIT_CHOICES.map((value) => `<option value="${value}"${String(limit) === String(value) ? ' selected' : ''}>${value}</option>`).join('')}
      </select>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">تصفية</button>
      <a class="btn btn-quiet" href="${escapeHtml(action)}">عرض الكل</a>
    </div>
    ${adminToken ? `<input type="hidden" name="token" value="${escapeHtml(adminToken)}" />` : ''}
  </form>`;
}

/** تسميات عربية لصلاحيات الأدوار — يقرأها المدير بدل تخمين الكود. */
const PERMISSION_LABELS = {
  '*': 'كل الصلاحيات',
  'dashboard:view': 'لوحة الإحصائية',
  'chat:use': 'المشرف الذكي',
  'journey:edit': 'مسار البحث',
  'library:browse': 'مكتبة الملفات',
  'students:view': 'ملفات الطلاب'
};

/** الصلاحيات المتاحة للإضافة من القائمة (بلا «كل الصلاحيات» — حماية دور المدير). */
const PERMISSION_CHOICES = Object.keys(PERMISSION_LABELS).filter((code) => code !== '*');

/** تسمية الصلاحية مع بقاء الكود الأصلي في تلميح title للمراجعة. */
function permissionLabel(code) {
  return PERMISSION_LABELS[code] || String(code);
}

/**
 * نظرة عامة: مؤشرات المنصة كاملةً من PostgreSQL + نشاط آخر ٧ أيام +
 * أحدث الباحثين + آخر العمليات + إرسال إشعار للجميع.
 */
export function renderAdminHome({
  counts,
  days = [],
  typeShare = [],
  latestUsers,
  recent = [],
  sent = 0,
  filter = {},
  adminToken = '',
  account = null
}) {
  const stats = [
    ['الباحثون', counts.users],
    ['حسابات نشطة', counts.active_users],
    ['موقوفون', counts.disabled_users],
    ['مديرون', counts.admins],
    ['ملفات بحثية', counts.profiles],
    ['مشتركون بباقات', counts.subscribers],
    ['نقاط مستهلكة', counts.tokens_used],
    ['عمليات استهلاك', counts.usage_events],
    ['محادثات المشرف', counts.conversations],
    ['أسئلة الباحثين', counts.questions],
    ['طلبات ذكاء اصطناعي ناجحة', counts.ai_ok],
    ['ملفات مرفوعة', counts.files]
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

  const failedAlert =
    Number(counts.ai_failed) > 0
      ? `<div class="alert"><b>تنبيه:</b> ${escapeHtml(formatNumber(counts.ai_failed))} طلباً فشل عند المزوّدين — <a href="/admin/providers">راجع صفحة المزوّدين</a> لمعرفة السبب والمفتاح المتعطّل.</div>`
      : '';

  // ملخص الأسبوع للمخطط الدائري + هل الفلتر مفعّل الآن؟
  const weekTokens = days.reduce((total, day) => total + (Number(day.tokens) || 0), 0);
  const weekEvents = days.reduce((total, day) => total + (Number(day.events) || 0), 0);
  const shareTotal = typeShare.reduce((total, row) => total + (Number(row.tokens) || 0), 0);
  const isFiltered = Boolean(filter.date) || String(filter.h1 ?? '') !== '' || String(filter.h2 ?? '') !== '';

  const recentRows = recent.map(
    (item) => `
    <td>${escapeHtml(formatDateTime(item.created_at))}</td>
    <td>${escapeHtml(item.email)}</td>
    <td>${escapeHtml(item.type)}</td>
    <td>${escapeHtml(formatNumber(item.tokens_used))}</td>
    <td>${escapeHtml(item.summary || '—')}</td>`
  );

  const body = `
  <div class="grid">${stats}</div>
  ${failedAlert}
  ${
    sent
      ? `<div class="alert"><b>تم الإرسال:</b> أُرسل الإشعار إلى ${escapeHtml(String(sent))} حساباً — حُفظ داخل موقع كل باحث فوراً، ووصل push لمن فعّل هاتفه.</div>`
      : ''
  }
  <div class="duo mt-16">
    <div class="card">
      <h2>نشاط آخر ٧ أيام</h2>
      <p class="muted">
        النقاط المستهلكة يومياً — الأقدم يمين والأحدث يسار، والعمود المميّز هو اليوم.
        هذا الأسبوع: ${escapeHtml(formatNumber(weekTokens))} نقطة في ${escapeHtml(formatNumber(weekEvents))} عملية.
      </p>
      ${renderActivityBars(days)}
    </div>
    <div class="card">
      <h2>توزيع استهلاك الأسبوع</h2>
      <p class="muted">أي أنواع العمليات استهلكت نقاط الأسبوع — النسبة من إجمالي ${escapeHtml(formatNumber(weekTokens))} نقطة.</p>
      ${renderDonut(typeShare.map((row) => ({ label: usageLabel(row.type), tokens: row.tokens })), { total: shareTotal })}
    </div>
  </div>
  <div class="duo mt-16">
    <div class="card">
      <div class="card-head">
        <h2>أحدث الباحثين</h2>
        <a class="btn btn-sm" href="/admin/users">إدارة كل الباحثين</a>
      </div>
      ${renderTable({
        columns: ['الباحث', 'الجامعة', 'الباقة', 'الرصيد', 'التسجيل'],
        rows,
        emptyMessage: 'لا يوجد باحثون مسجّلون بعد.'
      })}
    </div>
    <div class="card">
      <div class="card-head">
        <h2>آخر العمليات${isFiltered ? ' (مُصفّاة)' : ''}</h2>
        <a class="btn btn-sm" href="/admin/usage">سجل الاستهلاك الكامل</a>
      </div>
      ${operationsFilterBar({ action: '/admin', adminToken, date: filter.date || '', h1: filter.h1 ?? '', h2: filter.h2 ?? '', limit: filter.limit || 8 })}
      <div class="table-scroll">${renderTable({
        columns: ['التاريخ', 'الباحث', 'النوع', 'النقاط', 'الملخص'],
        rows: recentRows,
        emptyMessage: isFiltered
          ? 'لا توجد عمليات مطابقة لهذه التصفية — جرّب تاريخاً أو ساعات أخرى.'
          : 'لا توجد عمليات مسجّلة بعد.'
      })}</div>
      <p class="muted mt-12">عرض ${escapeHtml(formatNumber(recent.length))} عملية — مرّر داخل الجدول للأسفل، أو افتح «سجل الاستهلاك الكامل» للبحث والتفاصيل.</p>
    </div>
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
  `;

  return renderLayout({
    title: 'نظرة عامة',
    subtitle: 'حالة المنصة كاملةً من قاعدة البيانات — باحثون ونقاط ومحادثات وطلبات ذكاء اصطناعي',
    activeKey: 'home',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/**
 * صفحة حالة المزوّدين: جدول يوضّح لكل مزوّد حالته وسبب تعطّله،
 * وزر «فحص الآن» يرسل نداءً صغيراً لكل مفتاح ليرى المدير الخطأ الحقيقي.
 */
export function renderAdminProviders({
  status = [],
  probed = false,
  links = [],
  catalog = { providers: [], models: [] },
  saved = '',
  error = '',
  adminToken = '',
  account = null
}) {
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

  const notice = saved && OK_TEXT[saved] ? `<div class="notice">${escapeHtml(OK_TEXT[saved])}</div>` : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر:</b> ${escapeHtml(error)}</div>` : '';

  const providerOptions = catalog.providers
    .map((provider) => `<option value="${escapeHtml(provider.key)}">${escapeHtml(provider.label)}</option>`)
    .join('');
  const modelOptions = catalog.models.map((model) => `<option value="${escapeHtml(model)}"></option>`).join('');

  const linkRows = links.map(
    (link) => `
    <td class="strong">${escapeHtml(
      catalog.providers.find((provider) => provider.key === link.provider)?.label || link.provider
    )}</td>
    <td><span class="mono">${escapeHtml(link.model)}</span></td>
    <td><span class="mono small">•••• ${escapeHtml(link.last4)}</span></td>
    <td class="row-actions">
      <form class="inline-form" method="post" action="/admin/providers/link/delete${query}"
        data-confirm="حذف رابط النموذج ${escapeHtml(link.model)}؟ سيعود المفتاح لوضعه بلا رابط مخصّص.">
        <input type="hidden" name="index" value="${escapeHtml(String(link.index))}" />
        <button class="btn btn-sm btn-danger" type="submit">حذف</button>
      </form>
    </td>`
  );

  const body = `
  ${notice}${errorNotice}
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
  <div class="card mt-16">
    <h2>ربط موديل بمفتاح خاص</h2>
    <p class="muted">
      تريد نموذجاً بعينه بمفتاحك؟ اختر المزوّد واكتب اسم النموذج والصق المفتاح — يُحفظ الرابط في قاعدة
      البيانات ويدخل الاستخدام فوراً: المفتاح ينضمّ لسباق هذا المزوّد والنموذج يظهر في قوائم النماذج،
      بلا تعديل .env وبلا إعادة تشغيل الخادم.
    </p>
    <form method="post" action="/admin/providers/link${query}">
      <div class="field-row">
        <div class="field">
          <label for="link-provider">المزوّد</label>
          <select id="link-provider" name="provider" required>${providerOptions}</select>
        </div>
        <div class="field">
          <label for="link-model">اسم النموذج</label>
          <input type="text" id="link-model" name="model" list="link-models" required maxlength="100"
            placeholder="gemini-3.6-flash" />
          <datalist id="link-models">${modelOptions}</datalist>
          <p class="form-hint">اختر من القائمة أو اكتب أي اسم تعرفه عند المزوّد.</p>
        </div>
        <div class="field">
          <label for="link-key">مفتاح API</label>
          <input type="password" id="link-key" name="api_key" required minlength="8" maxlength="400"
            autocomplete="off" placeholder="الصق المفتاح هنا" />
          <p class="form-hint">يُحفظ في قاعدة البيانات ولا يُطبع كاملاً في أي صفحة — تظهر آخر 4 أحرف فقط.</p>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">ربط النموذج</button>
        <span class="muted">يسري فوراً على أول طلب — هذا المفتاح يجرّب هذا النموذج وحده.</span>
      </div>
    </form>
  </div>
  <div class="card mt-16">
    <div class="card-head">
      <h2>الروابط المخصّصة (${escapeHtml(formatNumber(links.length))})</h2>
    </div>
    ${renderTable({
      columns: ['المزوّد', 'النموذج', 'المفتاح', 'إجراء'],
      rows: linkRows,
      emptyMessage: 'لا توجد روابط مخصّصة — المزوّدين يعملون الآن بمفاتيح .env ونماذجها فقط.'
    })}
    <p class="muted mt-12">حذف الرابط يُخرج المفتاح من السباق فوراً (يبقى المفتاح في .env لو كان منها).</p>
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
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/**
 * سجل الاستهلاك الكامل: بحث `?q=` + فلترة تاريخ/ساعات/عدد نتائج + أعمدة
 * ١٤ يوماً + مخطط دائري للأنواع + عمليات داخل صندوق تمرير.
 */
export function renderAdminUsage({
  summary = [],
  recent = [],
  totalTokens = 0,
  days14 = [],
  q = '',
  filter = {},
  adminToken = '',
  account = null
}) {
  const summaryRows = summary.map(
    (row) => `
    <td class="strong">${escapeHtml(usageLabel(row.type))}</td>
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

  const shareTotal = summary.reduce((total, row) => total + (Number(row.tokens) || 0), 0);
  const totalEvents = summary.reduce((total, row) => total + Number(row.events || 0), 0);
  const isFiltered =
    Boolean(filter.date) || Boolean(q) || String(filter.h1 ?? '') !== '' || String(filter.h2 ?? '') !== '';

  const body = `
  <div class="grid">${renderStat('إجمالي النقاط المستهلكة', totalTokens)}${renderStat(
    'عدد العمليات',
    totalEvents
  )}</div>
  <div class="duo mt-16">
    <div class="card">
      <h2>نشاط آخر ١٤ يوماً</h2>
      <p class="muted">النقاط المستهلكة يومياً — الأقدم يمين والأحدث يسار، والعمود المميّز هو اليوم.</p>
      ${renderActivityBars(days14)}
    </div>
    <div class="card">
      <h2>توزيع الاستهلاك حسب النوع</h2>
      <p class="muted">من أين جاءت النقاط المحسوبة كلها (${escapeHtml(formatNumber(shareTotal))} نقطة) — لكل نوع نسبته.</p>
      ${renderDonut(summary.map((row) => ({ label: usageLabel(row.type), tokens: row.tokens })), { total: shareTotal })}
      ${renderTable({
        columns: ['النوع', 'عدد العمليات', 'النقاط'],
        rows: summaryRows,
        emptyMessage: 'لا يوجد استهلاك مسجّل بعد.'
      })}
    </div>
  </div>
  <div class="card mt-16">
    <div class="card-head">
      <h2>العمليات${isFiltered ? ' (مُصفّاة)' : ''}</h2>
    </div>
    ${operationsFilterBar({
      action: '/admin/usage',
      adminToken,
      q,
      date: filter.date || '',
      h1: filter.h1 ?? '',
      h2: filter.h2 ?? '',
      limit: filter.limit || 100
    })}
    <div class="table-scroll">${renderTable({
      columns: ['التاريخ', 'الباحث', 'النوع', 'النقاط', 'الملخص'],
      rows: recentRows,
      emptyMessage: isFiltered
        ? 'لا توجد عمليات مطابقة لهذه التصفية — جرّب بحثاً أو تاريخاً آخر.'
        : 'لا توجد عمليات مسجّلة بعد.'
    })}</div>
    <p class="muted mt-12">
      عرض ${escapeHtml(formatNumber(recent.length))} عملية من الأحدث — مرّر داخل الجدول للمزيد.
      التصفية بالساعات تُحسم على وقت التسجيل في قاعدة البيانات (بتوقيت الخادم).
    </p>
  </div>`;

  return renderLayout({
    title: 'سجل الاستهلاك',
    subtitle: 'بحث وفلترة ومخططات استهلاك النقاط لكل عملية ولكل باحث',
    activeKey: 'usage',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** جدول الباحثين مع بحث وفلترة وترقيم صفحات (بديل لواجهة /admin/users السابقة). */
export function renderAdminUsers({
  users,
  total,
  page,
  pageSize,
  search,
  filter,
  adminToken = '',
  ok = '',
  error = '',
  account = null,
  isAdminDenied = false
}) {
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

  // جزء ?token= يُعاد في كل رابط/نموذج ليعمل الزائر من localhost وصاحب الرمز من أي جهاز
  const tokenQuery = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';

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
    <td>${escapeHtml(formatDate(user.created_at))}</td>
    <td class="row-actions">
      <a class="btn btn-sm" href="/admin/users/${user.id}${tokenQuery}">تفاصيل</a>
      <form class="inline-form" method="post" action="/admin/users/${user.id}/status${tokenQuery}">
        <input type="hidden" name="active" value="${user.is_active ? '0' : '1'}" />
        <input type="hidden" name="return" value="users" />
        <button class="btn btn-sm ${user.is_active ? 'btn-danger' : 'btn-quiet'}" type="submit">${user.is_active ? 'إيقاف' : 'تفعيل'}</button>
      </form>
      ${
        user.role === 'admin' || (account && account.id === user.id)
          ? ''
          : `<form class="inline-form" method="post" action="/admin/users/${user.id}/delete${tokenQuery}"
            data-confirm="حذف حساب ${escapeHtml(user.email || '')}؟ يُمنع دخوله فوراً من كل الأجهزة، ويبقى في السجلات. لا تراجع.">
        <button class="btn btn-sm btn-danger" type="submit">حذف</button>
      </form>`
      }
    </td>`
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

  const notice = ok && OK_TEXT[ok] ? `<div class="notice">${escapeHtml(OK_TEXT[ok])}</div>` : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر:</b> ${escapeHtml(error)}</div>` : '';

  const body = `
  ${notice}${errorNotice}
  <div class="card">
    <h2>الباحثون (${escapeHtml(formatNumber(total))})</h2>
    ${toolbar}
    ${renderTable({
      columns: ['الباحث', 'الجامعة / المجال', 'الباقة', 'النقاط', 'التسجيل', 'الإجراءات'],
      rows,
      emptyMessage: search
        ? 'لا يوجد باحثون مطابقون للبحث. جرّب مصطلحاً آخر أو ألغِ الفلتر.'
        : 'لا يوجد باحثون مسجّلون بعد.'
    })}
    ${pagination}
  </div>`;

  return renderLayout({
    title: 'إدارة الباحثين',
    subtitle: 'بحث وفلترة وإجراءات كاملة: تفاصيل وإيقاف وتفعيل ونقاط وباقة لكل باحث',
    activeKey: 'users',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** الباقات: جدول + تحرير فوري لكل باقة يسري على صفحة الهبوط ونصوص الموقع. */
export function renderAdminPlans({ plans, totalSubscribers, saved = '', error = '', adminToken = '', account = null }) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';

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
    }${plan.popular ? ' <span class="badge badge-admin">مميّزة</span>' : ''}</td>
    <td>${escapeHtml(formatNumber(plan.subscribers))}</td>
    <td><a class="btn btn-sm" href="#edit-${escapeHtml(plan.code)}">تعديل</a></td>`
  );

  const forms = plans
    .map((plan) => {
      const code = escapeHtml(plan.code);
      const isFree = plan.code === FREE_PLAN_CODE;
      return `
  <div class="modal" id="edit-${code}">
   <div class="card">
    <div class="card-head">
      <h2>تعديل: ${escapeHtml(plan.title)} <span class="muted mono">(${code})</span></h2>
      <div class="links">
        <span class="badge badge-plan">${escapeHtml(formatNumber(plan.subscribers))} مشترك</span>
        <a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a>
      </div>
    </div>
    <p class="muted">كل تعديل هنا يُحفظ في جدول plans ويسري فوراً على صفحة الهبوط ونصوص المنصة — بلا إعادة تشغيل.</p>
    <form method="post" action="/admin/plans/${encodeURIComponent(plan.code)}${token}">
      <div class="field-row">
        <div class="field">
          <label for="title-${code}">اسم الباقة</label>
          <input type="text" id="title-${code}" name="title" maxlength="100" required value="${escapeHtml(plan.title)}" />
        </div>
        <div class="field">
          <label for="period-${code}">الفترة</label>
          <input type="text" id="period-${code}" name="period" maxlength="40" value="${escapeHtml(plan.period || 'شهرياً')}" />
        </div>
        <div class="field">
          <label for="price-${code}">السعر</label>
          <input type="number" id="price-${code}" name="price" min="0" max="10000000" step="1" required
            value="${escapeHtml(String(plan.price))}" ${isFree ? 'readonly' : ''} />
          <p class="form-hint">${isFree ? 'الباقة المجانية سعرها صفر دائماً.' : 'صفر = باقة مجانية.'}</p>
        </div>
        <div class="field">
          <label for="tokens-${code}">النقاط</label>
          <input type="number" id="tokens-${code}" name="tokens" min="0" max="100000000" step="1" required
            value="${escapeHtml(String(plan.tokens))}" />
          <p class="form-hint">تظهر فوراً في كل النصوص (منها نقاط التجربة المجانية).</p>
        </div>
      </div>
      <div class="field">
        <label for="tagline-${code}">الوصف المختصر</label>
        <input type="text" id="tagline-${code}" name="tagline" maxlength="160" value="${escapeHtml(plan.tagline || '')}" />
      </div>
      <div class="field">
        <label for="features-${code}">المزايا (ميزة واحدة في كل سطر)</label>
        <textarea id="features-${code}" name="features" rows="6" maxlength="4000">${escapeHtml(String(plan.features ?? ''))}</textarea>
      </div>
      <label class="check"><input type="checkbox" name="popular" value="1" ${plan.popular ? 'checked' : ''} /> باقة مميّزة (شريط «الأكثر طلباً»)</label>
      <label class="check"><input type="checkbox" name="is_active" value="1" ${plan.is_active ? 'checked' : ''} /> مفعّلة (تظهر في صفحة الهبوط)</label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">حفظ ${escapeHtml(plan.title)}</button>
        <span class="muted">يُطبَّق فوراً — لا يحتاج إعادة تشغيل الخادم.</span>
      </div>
    </form>
   </div>
  </div>`;
    })
    .join('');

  const notice = saved ? `<div class="notice">${escapeHtml(OK_TEXT.plan_saved)} (${escapeHtml(saved)})</div>` : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر الحفظ:</b> ${escapeHtml(error)}</div>` : '';

  // مودال إضافة باقة جديدة — يفتح برابط #add-plan بلا سكربتات (نفس أسلوب التعديل).
  const addForm = `
  <div class="modal" id="add-plan">
    <div class="card">
      <div class="card-head">
        <h2>إضافة باقة جديدة</h2>
        <a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a>
      </div>
      <p class="muted">تظهر فوراً في صفحة الهبوط وكل نصوص الموقع بعد الحفظ — بلا إعادة تشغيل.</p>
      <form method="post" action="/admin/plans/add${token}">
        <div class="field-row">
          <div class="field">
            <label for="new-code">كود الباقة</label>
            <input type="text" id="new-code" name="code" required maxlength="50"
              pattern="[a-z0-9_-]{2,50}" title="حروف صغيرة وأرقام و _ و - فقط" placeholder="pro_annual" />
            <p class="form-hint">حروف صغيرة وأرقام و _ و - فقط (مثال: pro_annual).</p>
          </div>
          <div class="field">
            <label for="new-title">اسم الباقة</label>
            <input type="text" id="new-title" name="title" maxlength="100" required placeholder="باقة المحترفين" />
          </div>
          <div class="field">
            <label for="new-period">الفترة</label>
            <input type="text" id="new-period" name="period" maxlength="40" value="شهرياً" />
          </div>
          <div class="field">
            <label for="new-price">السعر</label>
            <input type="number" id="new-price" name="price" min="0" max="10000000" step="1" value="0" />
            <p class="form-hint">صفر = باقة مجانية (كود التجربة المجانية يبقى وحده السعر صفر).</p>
          </div>
          <div class="field">
            <label for="new-tokens">النقاط</label>
            <input type="number" id="new-tokens" name="tokens" min="0" max="100000000" step="1" required value="1000" />
          </div>
        </div>
        <div class="field">
          <label for="new-tagline">الوصف المختصر</label>
          <input type="text" id="new-tagline" name="tagline" maxlength="160" />
        </div>
        <div class="field">
          <label for="new-features">المزايا (ميزة واحدة في كل سطر)</label>
          <textarea id="new-features" name="features" rows="5" maxlength="4000"></textarea>
        </div>
        <label class="check"><input type="checkbox" name="popular" value="1" /> باقة مميّزة (شريط «الأكثر طلباً»)</label>
        <label class="check"><input type="checkbox" name="is_active" value="1" checked /> مفعّلة (تظهر في صفحة الهبوط)</label>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">إضافة الباقة</button>
          <a class="btn btn-quiet" href="#">إلغاء</a>
        </div>
      </form>
    </div>
  </div>`;

  const body = `
  ${notice}${errorNotice}
  <div class="grid">${renderStat('عدد الباقات', plans.length)}${renderStat('إجمالي المشتركين', totalSubscribers)}</div>
  <div class="card mt-16">
    <div class="card-head">
      <h2>الباقات</h2>
      <a class="btn btn-primary" href="#add-plan">إضافة باقة</a>
    </div>
    ${renderTable({
      columns: ['الكود', 'الاسم', 'السعر', 'النقاط', 'الحالة', 'المشتركون', 'تحرير'],
      rows,
      emptyMessage: 'لا توجد باقات بعد — شغّل npm run db:seed لإضافة الباقات الافتراضية.'
    })}
  </div>
  ${forms}
  ${addForm}`;

  return renderLayout({
    title: 'الباقات',
    subtitle: 'عرض وتحرير الباقات — أي تعديل يسري فوراً على صفحة الهبوط',
    activeKey: 'plans',
    account,
    scripts: ['/js/app-shell.js'],
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
export function renderAdminSettings({
  limits,
  usage = {},
  saved = false,
  error = '',
  adminToken = '',
  system = null,
  account = null
}) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const stats = [
    ['أقصى حجم للملف الواحد', `${limits.maxUploadMb} MB`],
    ['المساحة الكلية لكل باحث', `${limits.maxStorageMb} MB`],
    ['إجمالي ملفات المنصة', `${humanBytes(usage.bytes)} · ${usage.files || 0} ملف`],
    ['باحثون رفعوا ملفات', `${usage.users || 0} باحث`]
  ]
    .map(([label, value]) => renderStat(label, value))
    .join('');

  const notice = saved ? '<div class="notice">حُفظت حدود التخزين — تسري على كل الباحثين فوراً.</div>' : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر الحفظ:</b> ${escapeHtml(error)}</div>` : '';

  const body = `
  <div class="grid">${stats}</div>
  ${notice}${errorNotice}
  <div class="duo mt-16">
    <div class="card">
      <div class="card-head">
        <h2>حدود رفع الملفات</h2>
        <a class="btn btn-sm" href="#limits-help">ماذا تعني؟</a>
      </div>
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
      <div class="card-head">
        <h2>حالة النظام</h2>
        <a class="btn btn-sm" href="#system-help">ماذا تعني؟</a>
      </div>
      <p class="muted">كل ما يلي يُقرأ لحظياً من الخادم وقاعدة البيانات — يتحدث بعد كل تحديث للصفحة.</p>
      <div class="grid">
      ${statRaw('قاعدة البيانات', system?.database || '—')}
      ${statRaw('Node.js', system?.node || '—')}
      ${statRaw('مدة تشغيل الخادم', system?.uptime || '—')}
      ${statRaw('رمز ADMIN_TOKEN', system?.adminToken || '—')}
      ${statRaw('المزوّدون المعدّون', system?.providers || '—')}
      ${statRaw('باحثون', system?.users ?? '—')}
      ${statRaw('باقات', system?.plans ?? '—')}
      ${statRaw('عمليات استهلاك', system?.usage_events ?? '—')}
      ${statRaw('إشعارات', system?.notifications ?? '—')}
      ${statRaw('إعدادات محفوظة', system?.settings_rows ?? '—')}
      </div>
    </div>
  </div>
  <div class="modal" id="limits-help">
    <div class="card">
      <div class="card-head"><h2>حدود التخزين</h2><a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a></div>
      <ul class="muted">
        <li><b>حجم الملف الواحد</b> — أقصى حجم لملف يرفعه الباحث (بين 1 و2048 MB).</li>
        <li><b>المساحة الكلية</b> — مجموع ما يرفعه باحث واحد؛ لو ملأها لا يستطيع الرفع حتى يحذف ملفاً، ويجب ألا تقل عن حجم الملف الواحد.</li>
        <li>كل تعديل يُحفظ في جدول settings ويسري فوراً على كل الحسابات بلا إعادة تشغيل.</li>
      </ul>
    </div>
  </div>
  <div class="modal" id="system-help">
    <div class="card">
      <div class="card-head"><h2>حالة النظام</h2><a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a></div>
      <ul class="muted">
        <li><b>قاعدة البيانات و Node.js ومدة التشغيل</b> — قراءة لحظية من الخادم وقاعدة البيانات.</li>
        <li><b>رمز ADMIN_TOKEN</b> — هل اللوحة محمية برمز يصل من أي جهاز، أم متاحة محلياً فقط.</li>
        <li><b>المزوّدون المعدّون</b> — كم مزوّداً لديه مفتاح واحد على الأقل (من .env أو روابط اللوحة).</li>
        <li><b>باحثون وباقات وإشعارات وإعدادات محفوظة</b> — عدّادات أسطر في الجداول، تتحدث مع كل تحديث.</li>
      </ul>
    </div>
  </div>`;

  return renderLayout({
    title: 'الإعدادات',
    subtitle: 'حدود التخزين + حالة النظام لحظة بلحظة من قاعدة البيانات',
    activeKey: 'settings',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/**
 * صفحة تفصيل باحث: الحساب والملف والأرقام + إجراءات التحكم الكاملة
 * (منح/خصم نقاط · تغيير باقة · إيقاف · إشعار · حذف) — كلها POST محمية.
 */
export function renderAdminUserDetail({
  user,
  profile,
  plans = [],
  summary = {},
  recent = [],
  ok = '',
  error = '',
  adminToken = '',
  account = null
}) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const base = `/admin/users/${user.id}`;
  const isSelf = Boolean(account && account.id === user.id);
  const notice = ok && OK_TEXT[ok] ? `<div class="notice">${escapeHtml(OK_TEXT[ok])}</div>` : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر:</b> ${escapeHtml(error)}</div>` : '';

  const badges = [
    user.role === 'admin' ? '<span class="badge badge-admin">مدير</span>' : '',
    user.is_active ? '<span class="badge badge-active">نشط</span>' : '<span class="badge badge-off">موقوف</span>',
    user.deleted ? '<span class="badge badge-error">محذوف</span>' : '',
    `<span class="badge badge-plan">${escapeHtml(user.plan_code || 'بدون باقة')}</span>`
  ].join(' ');

  const accountCard = `
  <div class="card">
    <h2>الحساب</h2>
    <p class="strong">${escapeHtml(user.full_name || '—')}</p>
    <p class="muted">${escapeHtml(user.email)}</p>
    <p class="mt-16">${badges}</p>
    <ul class="mini-stats">
      <li><b>${escapeHtml(formatNumber(user.tokens_balance))}</b><span>رصيد النقاط الحالي</span></li>
      <li><b>${escapeHtml(formatNumber(summary.tokens_used || 0))}</b><span>نقاط مستهلكة</span></li>
      <li><b>${escapeHtml(formatNumber(user.tokens_granted || 0))}</b><span>نقاط الترحيب الممنوحة</span></li>
      <li><b>${escapeHtml(formatDate(user.created_at))}</b><span>تاريخ التسجيل</span></li>
    </ul>
  </div>`;

  const profileCard = `
  <div class="card">
    <h2>الملف البحثي</h2>
    ${
      profile
        ? `<ul class="mini-stats">
      <li><b>${escapeHtml(profile.university || '—')}</b><span>الجامعة</span></li>
      <li><b>${escapeHtml(profile.research_field || '—')}</b><span>مجال البحث</span></li>
      <li><b>${escapeHtml(profile.degree_level || '—')}</b><span>الدرجة العلمية</span></li>
      <li><b>${escapeHtml(profile.research_title || '—')}</b><span>عنوان البحث</span></li>
      <li><b>${escapeHtml(profile.supervisor_name || '—')}</b><span>اسم المشرف</span></li>
    </ul>`
        : '<p class="muted">لم يُكمل الباحث ملفه البحثي بعد.</p>'
    }
  </div>`;

  const activityCard = `
  <div class="card">
    <h2>النشاط</h2>
    <ul class="mini-stats">
      <li><b>${escapeHtml(formatNumber(summary.events || 0))}</b><span>عملية استهلاك</span></li>
      <li><b>${escapeHtml(formatNumber(summary.conversations || 0))}</b><span>محادثة مع المشرف</span></li>
      <li><b>${escapeHtml(formatNumber(summary.messages || 0))}</b><span>رسالة داخل المحادثات</span></li>
      <li><b>${escapeHtml(formatNumber(summary.files || 0))}</b><span>ملف مرفوع</span></li>
      <li><b>${escapeHtml(formatNumber(summary.notes || 0))}</b><span>ملاحظة في المفكرة</span></li>
      <li><b>${escapeHtml(formatNumber(summary.refs || 0))}</b><span>مرجع بحثي</span></li>
    </ul>
  </div>`;

  const controlsCard = `
  <div class="card mt-16">
    <h2>التحكم في الحساب</h2>
    ${isSelf ? '<p class="muted">هذا حسابك أنت — الإيقاف والحذف معطّلان لحمايتك من قفل اللوحة على نفسك.</p>' : ''}
    <div class="field-row">
      <form method="post" action="${base}/points${token}">
        <div class="field">
          <label for="adj-amount">تعديل الرصيد (نقاط)</label>
          <input type="number" id="adj-amount" name="amount" min="-1000000" max="1000000" step="1" required placeholder="100 أو -50" />
          <p class="form-hint">موجب = منح، سالب = خصم. تُسجَّل العملية في سجل الاستهلاك باسم «تعديل إداري».</p>
        </div>
        <div class="field">
          <label for="adj-note">سبب التعديل (اختياري)</label>
          <input type="text" id="adj-note" name="note" maxlength="120" placeholder="مثال: تعويض عن مشكلة تقنية" />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">تطبيق التعديل</button>
        </div>
      </form>
      <form method="post" action="${base}/plan${token}">
        <div class="field">
          <label for="plan-code">الباقة</label>
          <select id="plan-code" name="plan_code">
            ${plans
              .map(
                (plan) =>
                  `<option value="${escapeHtml(plan.code)}"${plan.code === user.plan_code ? ' selected' : ''}>${escapeHtml(
                    plan.title
                  )} — ${escapeHtml(formatNumber(plan.tokens))} نقطة</option>`
              )
              .join('')}
          </select>
          <p class="form-hint">الباقات المعروضة هي الباقات المفعّلة في جدول plans.</p>
        </div>
        <div class="form-actions">
          <button class="btn" type="submit">تغيير الباقة</button>
        </div>
      </form>
    </div>
    <div class="row-actions mt-16">
      ${
        isSelf
          ? ''
          : `<form class="inline-form" method="post" action="${base}/status${token}">
        <input type="hidden" name="active" value="${user.is_active ? '0' : '1'}" />
        <button class="btn ${user.is_active ? 'btn-danger' : 'btn-quiet'}" type="submit">${user.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'}</button>
      </form>`
      }
      <a class="btn btn-quiet" href="/admin/users${token}">عودة لقائمة الباحثين</a>
    </div>
  </div>`;

  const notifyCard = `
  <div class="card mt-16">
    <h2>إشعار مخصص لهذا الباحث</h2>
    <p class="muted">يُحفظ داخل موقعه فوراً، ويصل push لمن سجّل توكن جهازه.</p>
    <form method="post" action="${base}/notify${token}">
      <div class="field">
        <label for="notify-title">عنوان الإشعار</label>
        <input type="text" id="notify-title" name="title" maxlength="120" required placeholder="مثال: رصيدك الإضافي جاهز" />
      </div>
      <div class="field">
        <label for="notify-body">نص الإشعار (اختياري)</label>
        <textarea id="notify-body" name="body" maxlength="500" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">إرسال الإشعار</button>
      </div>
    </form>
  </div>`;

  const recentRows = recent.map(
    (item) => `
    <td>${escapeHtml(formatDateTime(item.created_at))}</td>
    <td>${escapeHtml(item.type)}</td>
    <td>${escapeHtml(formatNumber(item.tokens_used))}</td>
    <td>${escapeHtml(item.summary || '—')}</td>`
  );

  const recentCard = `
  <div class="card mt-16">
    <h2>آخر عمليات الاستهلاك</h2>
    ${renderTable({
      columns: ['التاريخ', 'النوع', 'النقاط', 'الملخص'],
      rows: recentRows,
      emptyMessage: 'لا توجد عمليات لهذا الباحث بعد.'
    })}
  </div>`;

  const dangerCard = isSelf
    ? ''
    : `
  <div class="card mt-16">
    <h2>منطقة الخطر</h2>
    <p class="muted">الحذف يُخفي الحساب فوراً ويمنع دخوله من كل الأجهزة، مع بقاء سجلاته في القاعدة. لا يمكن التراجع.</p>
    <form method="post" action="${base}/delete${token}">
      <button class="btn btn-danger" type="submit">حذف الحساب نهائياً</button>
    </form>
  </div>`;

  const body = `
  ${notice}${errorNotice}
  <div class="info-grid">
    ${accountCard}
    ${profileCard}
    ${activityCard}
  </div>
  ${controlsCard}
  ${notifyCard}
  ${recentCard}
  ${dangerCard}`;

  return renderLayout({
    title: user.full_name || user.email,
    subtitle: 'ملف باحث واحد: الحساب والرصيد والنشاط وجميع إجراءات التحكم',
    activeKey: 'users',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** إدارة قائمة المديرين: جدول admins في القاعدة + إيميلات .env الثابتة. */
export function renderAdminAdmins({
  dbAdmins = [],
  saved = '',
  error = '',
  adminToken = '',
  account = null
}) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const notice = saved && OK_TEXT[saved] ? `<div class="notice">${escapeHtml(OK_TEXT[saved])}</div>` : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر:</b> ${escapeHtml(error)}</div>` : '';

  const rows = dbAdmins.map((row, index) => {
    const email = String(row.email || '').toLowerCase();
    const isSelf = account && String(account.email || '').trim().toLowerCase() === email;
    return `
    <td class="strong">${escapeHtml(row.email)}</td>
    <td>${escapeHtml(row.added_by || '—')}</td>
    <td>${escapeHtml(formatDate(row.created_at))}</td>
    <td class="row-actions">
      <a class="btn btn-sm" href="#edit-admin-${index}">تعديل</a>
      ${
        isSelf
          ? '<span class="muted">حسابك الحالي</span>'
          : `<form class="inline-form" method="post" action="/admin/admins/delete${token}"
            data-confirm="إزالة ${escapeHtml(row.email)} من المديرين؟ سيفقد صلاحية اللوحة في طلبه القادم.">
            <input type="hidden" name="email" value="${escapeHtml(row.email)}" />
            <button class="btn btn-sm btn-danger" type="submit">إزالة</button>
          </form>`
      }
    </td>`;
  });

  // مودال تعديل بريد لكل مدير — يفتح برابط #edit-admin-N بلا سكربتات
  const editModals = dbAdmins
    .map(
      (row, index) => `
  <div class="modal" id="edit-admin-${index}">
    <div class="card">
      <div class="card-head">
        <h2>تعديل بريد مدير</h2>
        <a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a>
      </div>
      <form method="post" action="/admin/admins/edit${token}">
        <input type="hidden" name="email" value="${escapeHtml(row.email)}" />
        <div class="field">
          <label for="edit-admin-email-${index}">البريد الإلكتروني الجديد</label>
          <input type="email" id="edit-admin-email-${index}" name="new_email" maxlength="255" required
            value="${escapeHtml(row.email)}" />
          <p class="form-hint">يجب أن يكون نفس البريد المستخدم في تسجيل الدخول بجوجل.</p>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">حفظ البريد</button>
          <a class="btn btn-quiet" href="#">إلغاء</a>
        </div>
      </form>
    </div>
  </div>`
    )
    .join('');

  const body = `
  ${notice}${errorNotice}
  <div class="card">
    <h2>من يدخل اللوحة؟</h2>
    <p class="muted">
      مصدر واحد فقط: جدول <b>admins</b> في قاعدة البيانات. أي حساب جوجل يحمل أحد هذه
      البريدات يصبح «مدير المنصة» فوراً في طلبه القادم. الإضافة والتعديل والإزالة كلها
      من هذه الصفحة — يسري التغيير بعد الطلب التالي للمدير دون أي إعداد آخر.
    </p>
  </div>
  <div class="card mt-16">
    <div class="card-head">
      <h2>المديرون (${escapeHtml(formatNumber(dbAdmins.length))})</h2>
      <a class="btn btn-primary" href="#add-admin">إضافة مدير</a>
    </div>
    ${renderTable({
      columns: ['الإيميل', 'أُضيف بواسطة', 'التاريخ', 'إجراء'],
      rows,
      emptyMessage: 'لا يوجد مديرون في الجدول بعد — أضِف أول إيميل من النموذج أدناه.'
    })}
  </div>
  <div class="card mt-16" id="add-admin">
    <div class="card-head">
      <h2>إضافة مدير جديد</h2>
    </div>
    <form method="post" action="/admin/admins/add${token}">
      <div class="field">
        <label for="admin-email">بريد جوجل للمدير</label>
        <input type="email" id="admin-email" name="email" maxlength="255" required placeholder="someone@example.com" />
        <p class="form-hint">يجب أن يكون نفس البريد المستخدم في تسجيل الدخول بجوجل.</p>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">إضافة المدير</button>
      </div>
    </form>
  </div>
  ${editModals}`;

  return renderLayout({
    title: 'المديرون',
    subtitle: 'من يملك صلاحية لوحة الإدارة — من جدول admins في القاعدة مباشرة',
    activeKey: 'admins',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** الأدوار والصلاحيات: تُقرأ وتُعدَّل من جدولي roles وrole_permissions مباشرة. */
export function renderAdminRoles({ roles = [], saved = '', error = '', adminToken = '', account = null }) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const notice = saved ? `<div class="notice">${escapeHtml(saved)}</div>` : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر:</b> ${escapeHtml(error)}</div>` : '';

  const cards = roles
    // دور المدير غير معروض هنا: صلاحيته «*» محمية في المسارات وتُدار من صفحة المديرين
    .filter((role) => role.code !== 'admin')
    .map((role) => {
      const permissions = role.permissions || [];
      const chips = permissions.length
        ? permissions
            .map(
              (perm) => `<span class="chip" title="${escapeHtml(perm)}">${escapeHtml(permissionLabel(perm))}
        <form method="post" action="/admin/roles/${encodeURIComponent(role.code)}/permissions/delete${token}"
          data-confirm="حذف صلاحية «${escapeHtml(permissionLabel(perm))}» من دور «${escapeHtml(role.title)}»؟">
          <input type="hidden" name="permission" value="${escapeHtml(perm)}" />
          <button type="submit" title="حذف الصلاحية" aria-label="حذف الصلاحية ${escapeHtml(perm)}">×</button>
        </form>
      </span>`
            )
            .join('')
        : '<span class="muted">لا توجد صلاحيات لهذا الدور بعد.</span>';

      // الإضافة من قائمة مسدلة بالصلاحيات المعروفة بأسمائها العربية — بلا كتابة كود يدوياً
      const available = PERMISSION_CHOICES.filter((code) => !permissions.includes(code));
      const options = available.length
        ? available
            .map(
              (code) =>
                `<option value="${escapeHtml(code)}">${escapeHtml(permissionLabel(code))} — ${escapeHtml(code)}</option>`
            )
            .join('')
        : '<option value="">كل الصلاحيات المعروفة مضافة لهذا الدور</option>';

      return `
  <div class="card mt-16">
    <div class="card-head">
      <h2>${escapeHtml(role.title)} <span class="muted mono">(${escapeHtml(role.code)})</span></h2>
      <span class="badge badge-plan">مستوى ${escapeHtml(String(role.level))} · ${escapeHtml(
        formatNumber(role.members)
      )} حساب بهذا الدور</span>
    </div>
    <div class="chips">${chips}</div>
    <form class="toolbar mt-12" method="post" action="/admin/roles/${encodeURIComponent(role.code)}/permissions${token}">
      <select name="permission" required title="اختر صلاحية لإضافتها إلى الدور">
        <option value="" disabled selected>اختر صلاحية...</option>
        ${options}
      </select>
      <button class="btn btn-primary" type="submit">إضافة صلاحية</button>
    </form>
  </div>`;
    })
    .join('');

  const body = `
  ${notice}${errorNotice}
  <div class="card">
    <h2>كيف تعمل هذه الصفحة؟</h2>
    <p class="muted">
      كل ما تراه هنا يُقرأ ويُكتب مباشرةً في جدولي <b>roles</b> و<b>role_permissions</b> في قاعدة البيانات —
      لا شيء مكتوب في الكود. كل صلاحية معروضة باسمها العربي، وكودها الأصلي يظهر عند التمرير فوقها،
      ويمكن إضافتها من القائمة المنسدلة بأسمائها العربية. تُطبَّق الصلاحيات في طلبات الحسابات
      المعنية التالية فور حفظها.
    </p>
  </div>
  ${cards}`;

  return renderLayout({
    title: 'الأدوار والصلاحيات',
    subtitle: 'أدوار النظام وصلاحياتها من جدول roles — إضافة وحذف بلا لمس الكود',
    activeKey: 'roles',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

