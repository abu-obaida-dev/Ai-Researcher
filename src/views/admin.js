import {
  ADMIN_PERMISSIONS,
  DEFAULT_ROLES,
  FREE_PLAN_CODE,
  PLAN_STORAGE_DEFAULT_MB,
  SITE_CURRENCIES,
  TOKEN_COSTS
} from '../constants.js';
import { escapeHtml, renderLayout, renderStat, renderTable, whatsappLink } from './layout.js';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPrice } from './format.js';
import { icon } from './icons.js';
import { LIBRARY_EXTENSIONS } from '../services/library.js';
import { formatStorageMb, planFeaturesFromPermissions, storageLabel } from '../services/plans.js';

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
  user_deleted: 'حُذف الحساب نهائياً — زالت بياناته وملفاته ومحادثاته كلها.',
  admin_added: 'أُضيف المدير — تُمنح الصلاحية في الطلب التالي لذلك الحساب.',
  admin_updated: 'حُدّث بريد المدير.',
  admin_removed: 'أُزيل المدير — لن يستطيع دخول لوحة الإدارة بعد طلبه القادم.',
  permission_added: 'أُضيفت الصلاحية — تسري على الحسابات في طلباتها القادمة.',
  permission_removed: 'حُذفت الصلاحية من الدور.',
  plan_saved: 'حُفظت الباقة — تسري على صفحة الهبوط وكل نصوص الموقع فوراً.',
  plan_deleted: 'حُذفت الباقة — كل مشتركيها انتقلوا إلى الباقة المجانية.',
  link_added: 'حُفظ الرابط — المفتاح والنموذج دخلا الدوران فوراً بلا إعادة تشغيل.',
  link_removed: 'حُذف الرابط — عاد المفتاح لوضعه الطبيعي (مفاتيح .env فقط إن لم يبقَ رابط).',
  library_added: 'أُضيف الكتاب إلى مكتبة المنصة — يظهر للباحثين في صفحة المراجع فوراً.',
  library_imported: 'استُورد العنصر إلى المكتبة.',
  library_updated: 'حُدّثت بيانات العنصر في المكتبة.',
  library_toggled: 'تغيّرت حالة العنصر (مفعّل/معطّل) في المكتبة.',
  library_deleted: 'حُذف العنصر وملفّه من المكتبة نهائياً.',
  supervisor_added: 'أُضيف المشرف — دوره الآن supervisor في طلبه القادم.',
  supervisor_removed: 'أُزيل المشرف — عاد دوره إلى دور باقته.',
  supervisor_missing: 'هذا البريد ليس في قائمة المشرفين.'
};

/** بطاقة مؤشر بقيمة نصية (تُستعمل في إحصاءات المكتبة: إجمالي · بملف · بيانات فقط). */
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
  'chat:use': 'المشرف الذكي (الدردشة)',
  'journey:edit': 'مسار البحث',
  'library:browse': 'المكتبة العلمية',
  'notes:use': 'المفكرة',
  'files:upload': 'رفع الملفات',
  'defense:train': 'المناقشة والتدريب عليها',
  'students:view': 'ملفات الطلاب',
  ...Object.fromEntries(ADMIN_PERMISSIONS.map((item) => [item.key, item.label]))
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
  push = null,
  pushFailed = 0,
  pushNone = 0,
  pushError = '',
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
      ? `<div class="alert"><b>تنبيه:</b> ${escapeHtml(formatNumber(counts.ai_failed))} طلباً فشل عند مزوّدي الذكاء الاصطناعي. راجع <code>سجل الاستهلاك</code> عمود «الحالة»، أو شغّل <code>npm run doctor</code> لفحص المفاتيح من الخادم.</div>`
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
      ? (() => {
          // نقول للمدير ما الذي وصل فعلاً: داخل الموقع دائماً، وعلى الهاتف لمن فعّل،
          // ومن لم يصله (بلا جهاز · فشل عند المزوّد) حتى لا نظن أن الكل وصل.
          const reached = Number(push || 0);
          const parts = [
            `حُفظ الإشعار داخل موقع <b>${escapeHtml(formatNumber(sent))}</b> باحث.`,
            `وصل إلى الهاتف: <b>${escapeHtml(formatNumber(reached))}</b>`
          ];
          if (Number(pushNone) > 0) parts.push(`${escapeHtml(formatNumber(pushNone))} لم يفعّلوا إشعارات هاتفهم`);
          if (Number(pushFailed) > 0) {
            parts.push(`فشل عند <b>${escapeHtml(formatNumber(pushFailed))}</b> عند مزوّد الإشعارات`);
          }
          if (pushError) parts.push(`السبب: ${escapeHtml(pushError)}`);
          return `<div class="alert"><b>تم الإرسال:</b> ${parts.join(' · ')}</div>`;
        })()
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
      <p class="muted mt-12">عرض ${escapeHtml(formatNumber(recent.length))} عملية — مرّر داخل القائمة للأسفل، أو افتح «سجل الاستهلاك الكامل» للبحث والتفاصيل.</p>
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
    subtitle: 'حالة المنصة كاملةً — باحثون ونقاط ومحادثات وطلبات ذكاء اصطناعي',
    activeKey: 'home',
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
      عرض ${escapeHtml(formatNumber(recent.length))} عملية من الأحدث — مرّر داخل القائمة للمزيد.
      التصفية بالساعات تعتمد وقت التسجيل (بتوقيت الخادم).
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
      ${
        user.role === 'admin'
          ? '<span class="badge badge-admin">محمي</span>'
          : `<form class="inline-form" method="post" action="/admin/users/${user.id}/status${tokenQuery}">
        <input type="hidden" name="active" value="${user.is_active ? '0' : '1'}" />
        <input type="hidden" name="return" value="users" />
        <button class="btn btn-sm ${user.is_active ? 'btn-danger' : 'btn-quiet'}" type="submit">${user.is_active ? 'إيقاف' : 'تفعيل'}</button>
      </form>`
      }
      ${
        user.role === 'admin' || (account && account.id === user.id)
          ? ''
          : `<form class="inline-form" method="post" action="/admin/users/${user.id}/delete${tokenQuery}"
            data-confirm="حذف حساب ${escapeHtml(user.email || '')}؟ يُحذف نهائياً مع كل بياناته وملفاته ومحادثاته. لا تراجع.">
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
/** خيارات دور الباقة (بدون دور المدير — حماية). */
function roleOptions(current) {
  const options = DEFAULT_ROLES.filter((role) => role.code !== 'admin')
    .map(
      (role) =>
        `<option value="${escapeHtml(role.code)}"${role.code === current ? ' selected' : ''}>${escapeHtml(role.title)}</option>`
    )
    .join('');
  return `<option value=""${!current ? ' selected' : ''}>— بدون تحديد (افتراضي: مجاني) —</option>${options}`;
}

/**
 * معاينة ما سيظهر للباحث في بطاقة الباقة على صفحة الهبوط: يُبنى بنفس
 * دالة المزايا العامة (planFeaturesFromPermissions) من صلاحيات دور الباقة،
 * مضافاً إليها سطر حصة التخزين القادمة من قاعدة البيانات.
 */
function rolePermissionsPreview(roleCode, storageMb) {
  const role = DEFAULT_ROLES.find((item) => item.code === String(roleCode || ''));
  const permissions = new Set(role?.permissions || []);

  return [...planFeaturesFromPermissions(permissions), storageLabel(storageMb)];
}

export function renderAdminPlans({
  plans,
  totalSubscribers,
  permissionsByRole = {},
  saved = '',
  note = '',
  error = '',
  adminToken = '',
  account = null
}) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';

  const rows = plans.map(
    (plan) => `
    <td class="strong">${escapeHtml(plan.code)}</td>
    <td>${escapeHtml(plan.title)}</td>
    <td>${escapeHtml(formatPrice(plan.price))}</td>
    <td>${escapeHtml(formatNumber(plan.tokens))}</td>
    <td>${escapeHtml(formatStorageMb(plan.storage_mb))}</td>
    <td>${escapeHtml(plan.role_code || '—')}</td>
    <td>${
      plan.is_active
        ? '<span class="badge badge-active">مفعّلة</span>'
        : '<span class="badge badge-off">معطّلة</span>'
    }${plan.popular ? ' <span class="badge badge-admin">مميّزة</span>' : ''}</td>
    <td>${escapeHtml(formatNumber(plan.subscribers))}</td>
    <td class="row-actions">
      <a class="btn btn-sm" href="#edit-${escapeHtml(plan.code)}">تعديل</a>
      ${
        plan.code === FREE_PLAN_CODE
          ? '<span class="badge">لا تُحذف</span>'
          : `<form class="inline-form" method="post" action="/admin/plans/${encodeURIComponent(plan.code)}/delete${token}"
            data-confirm="حذف باقة «${escapeHtml(plan.title)}» نهائياً؟${
              Number(plan.subscribers) > 0
                ? ` سينتقل ${Number(plan.subscribers)} مشترك إلى الباقة المجانية.`
                : ''
            } لا يمكن التراجع.">
            <input type="hidden" name="confirm" value="1" />
            <button class="btn btn-sm btn-danger" type="submit">حذف</button>
          </form>`
      }
    </td>`
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
    <p class="muted">كل تعديل هنا يُحفظ فوراً ويسري على صفحة الهبوط ونصوص المنصة — بلا إعادة تشغيل.</p>
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
        <div class="field">
          <label for="storage-${code}">مساحة التخزين (MB)</label>
          <input type="number" id="storage-${code}" name="storage_mb" min="10" max="102400" step="10" required
            value="${escapeHtml(String(Number(plan.storage_mb) || PLAN_STORAGE_DEFAULT_MB))}" />
          <p class="form-hint">تُحفظ لهذه الباقة وتُطبَّق على كل باحثيها عند رفع الملفات.</p>
        </div>
      </div>
      <div class="field">
        <label for="role-${code}">دور الباقة (يحدد الخدمات المفتوحة)</label>
        <select id="role-${code}" name="role_code">
          ${roleOptions(plan.role_code)}
        </select>
        <p class="form-hint">الدور يربط الباقة بالصلاحيات — مثلاً «رسائل علمية» يفتح المناقشة والتدريب عليها.</p>
      </div>
      <div class="field">
        <label for="tagline-${code}">الوصف المختصر</label>
        <input type="text" id="tagline-${code}" name="tagline" maxlength="160" value="${escapeHtml(plan.tagline || '')}" />
      </div>
      ${plan.role_code
        ? permissionsEditor({
            permissions: permissionsByRole[plan.role_code] || [],
            addAction: `/admin/plans/${encodeURIComponent(plan.code)}/permissions${token}`,
            deleteAction: `/admin/plans/${encodeURIComponent(plan.code)}/permissions/delete${token}`,
            ownerLabel: plan.title
          })
        : '<p class="muted">اختر دور الباقة أولاً لتظهر صلاحياتها هنا.</p>'}
      <div class="field">
        <label for="features-${code}">أسطر إضافية تُعرض مع المزايا (سطر لكل ميزة — اختياري)</label>
        <textarea id="features-${code}" name="features" rows="5" maxlength="4000">${escapeHtml(String(plan.features ?? ''))}</textarea>
        <p class="form-hint">مزايا الباقة تُولَّد تلقائياً من صلاحيات دور الباقة (كل خدمة مفتوحة سطر). ما تكتبه هنا يظهر بعدها.</p>
        <ul class="info-list mt-8">
          ${rolePermissionsPreview(plan.role_code, plan.storage_mb).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ul>
      </div>
      <label class="check"><input type="checkbox" name="popular" value="1" ${plan.popular ? 'checked' : ''} /> باقة مميّزة (شريط «الأكثر طلباً»)</label>
      <label class="check"><input type="checkbox" name="is_active" value="1" ${plan.is_active ? 'checked' : ''} /> مفعّلة (تظهر في صفحة الهبوط)</label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">حفظ ${escapeHtml(plan.title)}</button>
        <span class="muted">يُطبَّق فوراً — لا يحتاج إعادة تشغيل الخادم.</span>
      </div>
    </form>
    ${
      isFree
        ? '<p class="muted mt-12">الباقة المجانية لا تُحذف — كل الحسابات تعود إليها تلقائياً.</p>'
        : `<form class="mt-12" method="post" action="/admin/plans/${encodeURIComponent(code)}/delete${token}"
          data-confirm="حذف باقة «${escapeHtml(plan.title)}» نهائياً؟${
            Number(plan.subscribers) > 0
              ? ` she'll ${Number(plan.subscribers)} مشترك سينتقلون إلى الباقة المجانية.`
              : ''
          } لا يمكن التراجع.">
          <input type="hidden" name="confirm" value="1" />
          <button class="btn btn-sm btn-danger" type="submit">${icon('trash', 'icon-sm')} حذف الباقة</button>
        </form>`
    }
   </div>
  </div>`;
    })
    .join('');

  const notice = saved
    ? `<div class="notice">${escapeHtml(
        saved === 'plan_deleted' ? OK_TEXT.plan_deleted : OK_TEXT.plan_saved
      )}${saved === 'plan_deleted' && note ? ` — ${escapeHtml(note)}` : saved === 'plan_deleted' ? '' : ` (${escapeHtml(saved)})`}</div>`
    : '';
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
          <div class="field">
            <label for="new-storage">مساحة التخزين (MB)</label>
            <input type="number" id="new-storage" name="storage_mb" min="10" max="102400" step="10" required
              value="${escapeHtml(String(PLAN_STORAGE_DEFAULT_MB))}" />
          </div>
        <div class="field">
            <label for="new-role">دور الباقة (يحدد الخدمات)</label>
            <select id="new-role" name="role_code">${roleOptions('')}</select>
          </div>
        </div>
        <div class="field">
          <label for="new-tagline">الوصف المختصر</label>
          <input type="text" id="new-tagline" name="tagline" maxlength="160" />
        </div>
        <div class="field">
          <label for="new-features">أسطر إضافية تُعرض مع المزايا (سطر لكل ميزة — اختياري)</label>
          <textarea id="new-features" name="features" rows="4" maxlength="4000"></textarea>
          <p class="form-hint">المزايا الأساسية تُولَّد من صلاحيات دور الباقة المختار أدناه — لا تكتبها يدوياً.</p>
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
      columns: ['الكود', 'الاسم', 'السعر', 'النقاط', 'مساحة التخزين', 'الدور', 'الحالة', 'المشتركون', 'إجراءات'],
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
  supervisors = [],
  supervisorPermissions = [],
  supportWhatsapp = '',
  currency = 'LYD',
  methods = [],
  saved = false,
  error = '',
  adminToken = '',
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

  // قسم المشرفين: جدول supervisors + إضافة بريد (حساب بريد جوجل)
  const supervisorRows = supervisors.length
    ? supervisors
        .map(
          (row) => `<tr>
    <td><p class="strong">${escapeHtml(row.full_name || row.email)}</p><p class="muted">${escapeHtml(row.email)}</p></td>
    <td>${row.is_active === false ? '<span class="badge badge-off">لم يسجّل الدخول</span>' : '<span class="badge badge-active">نشط</span>'}</td>
    <td>${escapeHtml(row.plan_code || '—')}</td>
    <td class="row-actions">
      <form method="post" action="/admin/settings/supervisors/delete${token}"
        data-confirm="إزالة ${escapeHtml(row.email)} من المشرفين؟ سيعود دوره إلى دور باقته.">
        <input type="hidden" name="email" value="${escapeHtml(row.email)}" />
        <button class="btn btn-sm btn-danger" type="submit">إزالة</button>
      </form>
    </td>
  </tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="muted">لا مشرفين بعد — أضف بريد مشرف من النموذج بالأسفل.</td></tr>';

  // طرق الدفع + عملة الموقع: يحددها المدير، وتظهر للباحث في صفحة الاشتراك.
  const currencyOptions = SITE_CURRENCIES.map(
    (item) =>
      `<option value="${escapeHtml(item.code)}"${item.code === currency ? ' selected' : ''}>${escapeHtml(item.label)} (${escapeHtml(item.symbol)})</option>`
  ).join('');

  const methodRows = methods.length
    ? methods
        .map(
          (method) => `<tr>
      <td><p class="strong">${escapeHtml(method.label)}</p><p class="muted">${escapeHtml(method.code)}</p></td>
      <td>${escapeHtml(formatMoney(0, method.currency).split(' ')[1] || method.currency)}</td>
      <td>${escapeHtml(method.note || '—')}${method.details ? `<p class="muted">${escapeHtml(method.details)}</p>` : ''}</td>
      <td>${method.isActive ? '<span class="badge badge-active">مفعّلة</span>' : '<span class="badge badge-off">معطّلة</span>'}</td>
      <td class="row-actions">
        <form method="post" action="/admin/settings/payment-methods/delete${token}">
          <input type="hidden" name="code" value="${escapeHtml(method.code)}" />
          <button class="btn btn-sm btn-danger" type="submit" data-confirm="حذف طريقة «${escapeHtml(
            method.label
          )}»؟ إن لها طلبات سابقة فستُعطَّل بدل حذفها.">حذف</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="muted">لا طرق دفع بعد — أضف الأولى من النموذج بالأسفل.</td></tr>';

  const paymentsSection = `<div class="card mt-16">
    <div class="card-head"><h2>الدفع وطرق التحويل</h2></div>
    <p class="muted">
      الدفع <b>يدوي خارج المنصة</b>: يحوّل الباحث المبلغ ثم يرسل رقم العملية، والإدارة تؤكّد الطلب من صفحة
      <a href="/admin/payments">طلبات الدفع</a> فتُفعَّل باقته وتُضاف نقاطه.
    </p>

    <form method="post" action="/admin/settings/currency${token}" class="toolbar">
      <div class="field">
        <label for="site-currency">عملة الموقع (تظهر في كل الأسعار)</label>
        <select id="site-currency" name="currency">${currencyOptions}</select>
      </div>
      <button class="btn btn-primary" type="submit">حفظ العملة</button>
    </form>

    <table class="ref-table mt-16">
      <thead><tr><th>الطريقة</th><th>العملة</th><th>التفاصيل</th><th>الحالة</th><th>إجراء</th></tr></thead>
      <tbody>${methodRows}</tbody>
    </table>

    <form method="post" action="/admin/settings/payment-methods${token}" class="form-card mt-16">
      <div class="field-row">
        <div class="field">
          <label for="pm-code">الكود (إنجليزي صغير)</label>
          <input type="text" id="pm-code" name="code" maxlength="50" required placeholder="bank_transfer" />
        </div>
        <div class="field">
          <label for="pm-label">اسم الطريقة</label>
          <input type="text" id="pm-label" name="label" maxlength="120" required placeholder="تحويل بنكي" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="pm-currency">العملة</label>
          <select id="pm-currency" name="currency">${currencyOptions}</select>
        </div>
        <div class="field">
          <label for="pm-order">الترتيب</label>
          <input type="number" id="pm-order" name="display_order" min="0" max="999" value="0" />
        </div>
      </div>
      <div class="field">
        <label for="pm-note">وصف مختصر</label>
        <input type="text" id="pm-note" name="note" maxlength="255" placeholder="حوّل المبلغ ثم أرسل رقم العملية." />
      </div>
      <div class="field">
        <label for="pm-details">تفاصيل التحويل (تظهر للباحث)</label>
        <textarea id="pm-details" name="details" rows="3" maxlength="2000" placeholder="مثال: مصرف الجمهورية — الحساب 1234567 — IBAN: LY00 ..."></textarea>
      </div>
      <label class="check"><input type="checkbox" name="is_active" value="1" checked /> مفعّلة (تظهر للباحثين)</label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">حفظ طريقة الدفع</button>
        <span class="muted">نفس الكود يحدّث الطريقة بدل إنشاء نسختين.</span>
      </div>
    </form>
  </div>`;

  
/** قسم المشرفين: جدول supervisors + إضافة بريد (حساب بريد جوجل). */

/**
 * الدعم الفني على واتساب: المدير يضبط الرقم من هنا (لا يمسّ الكود)، ويرى
 * رابط المعاينة مباشرةً قبل الحفظ ليتأكد أنه يفتح على محادثة صحيحة.
 */
function supportSection(supportWhatsapp, token) {
  const current = String(supportWhatsapp || '').trim();
  const preview = whatsappLink();

  return `<div class="card mt-16">
    <div class="card-head">
      <h2>الدعم الفني (واتساب)</h2>
      <div class="links">
        ${
          current
            ? '<span class="badge badge-active">الزر ظاهر في صفحات الباحث</span>'
            : '<span class="badge badge-off">الزر مخفي الآن</span>'
        }
      </div>
    </div>
    <p class="muted">الرقم الذي يضغط عليه الباحث عند أي مشكلة أو شكوى — يظهر كزر عائم أسفل الشاشة
      في صفحات الزائر والباحث (ولا يظهر في لوحة الإدارة).</p>
    <form method="post" action="/admin/settings/support-whatsapp${token}" class="form-card">
      <div class="field">
        <label for="wa-number">رقم واتساب الاستقبال</label>
        <input type="text" id="wa-number" name="whatsapp" inputmode="tel" maxlength="24"
          value="${escapeHtml(current)}" placeholder="09xxxxxxxx أو +2189xxxxxxxx" />
        <p class="form-hint">أرقام فقط (8 إلى 15 رقماً). تُضاف رمز الدولة 218 تلقائياً إذا كتبته محلياً.
          اتركه فارغاً لإخفاء الزر عن الباحثين.</p>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">حفظ الرقم</button>
        ${
          preview
            ? `<a class="btn" href="${escapeHtml(preview)}" target="_blank" rel="noopener">معاينة الرابط ↗</a>
               <span class="muted">${escapeHtml(current)}</span>`
            : '<span class="muted">لا رابط بعد — أدخل رقماً صالحاً.</span>'
        }
      </div>
    </form>
  </div>`;
}

const supervisorsSection = `<div class="card mt-16">
    <div class="card-head">
      <h2>المشرفون (${escapeHtml(formatNumber(supervisors.length))})</h2>
    </div>
    <table class="ref-table">
      <thead><tr><th>المشرف</th><th>الحالة</th><th>الباقة</th><th>إجراء</th></tr></thead>
      <tbody>${supervisorRows}</tbody>
    </table>
    ${permissionsEditor({
      permissions: supervisorPermissions,
      addAction: `/admin/settings/supervisors/permissions${token}`,
      deleteAction: `/admin/settings/supervisors/permissions/delete${token}`,
      ownerLabel: 'دور المشرف',
      label: 'ما يستطيعه المشرف في المنصة:',
      emptyText: 'لا صلاحيات للمشرف بعد.'
    })}
    <form method="post" action="/admin/settings/supervisors/add${token}" class="form-card mt-16">
      <div class="field">
        <label for="sup-email">إضافة مشرف (بريد حساب جوجل)</label>
        <input type="email" id="sup-email" name="email" maxlength="255" required placeholder="supervisor@university.edu" />
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">إضافة مشرف</button>
        <span class="muted">يُطبَّق فوراً — دوره مشرف في طلبه القادم.</span>
      </div>
    </form>
  </div>`;

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
          <label for="max_storage_mb">الحصة العامة (fallback) لكل باحث (MB)</label>
          <input type="number" id="max_storage_mb" name="max_storage_mb" min="10" max="102400" step="10" required
            value="${escapeHtml(String(limits.maxStorageMb))}" />
          <p class="form-hint">تُستعمل فقط إن لم تكن للباقة حصة محدّدة. حصة كل باقة تُضبط من صفحة «الباقات» (storage_mb).</p>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">حفظ الحدود</button>
        <span class="muted">يُطبَّق فوراً — لا يحتاج إعادة تشغيل الخادم.</span>
      </div>
      </form>
    </div>
  </div>
  <div class="modal" id="limits-help">
    <div class="card">
      <div class="card-head"><h2>حدود التخزين</h2><a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a></div>
      <ul class="muted">
        <li><b>حجم الملف الواحد</b> — أقصى حجم لملف يرفعه الباحث (بين 1 و2048 MB).</li>
        <li><b>المساحة الكلية</b> — مجموع ما يرفعه باحث واحد؛ لو ملأها لا يستطيع الرفع حتى يحذف ملفاً، ويجب ألا تقل عن حجم الملف الواحد.</li>
        <li>كل تعديل يُحفظ فوراً ويسري على كل الحسابات بلا إعادة تشغيل.</li>
      </ul>
    </div>
  </div>
  ${paymentsSection}
  ${supportSection(supportWhatsapp, token)}
  ${supervisorsSection}`;

  return renderLayout({
    title: 'الإعدادات',
    subtitle: 'حدود التخزين + طرق الدفع + المشرفون',
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
          <p class="form-hint">الباقات المعروضة هنا هي الباقات المفعّلة حالياً.</p>
        </div>
        <div class="form-actions">
          <button class="btn" type="submit">تغيير الباقة</button>
        </div>
      </form>
    </div>
    <div class="row-actions mt-16">
      ${
        isSelf || user.role === 'admin'
          ? `<p class="muted">${
              user.role === 'admin'
                ? 'حساب المدير محمي: لا يمكن إيقافه أو حذفه — يغيّر بريده فقط من الإعدادات.'
                : 'هذا حسابك أنت — الإيقاف والحذف معطّلان لحمايتك من قفل اللوحة على نفسك.'
            }</p>`
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
    <p class="muted">الحذف يزيل الحساب نهائياً مع كل ما يخصه: ملفات ومحادثات وملاحظات ومراجع وإشعارات ورصيد. لا يمكن التراجع.</p>
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

/**
 * محرّر صلاحيات قابل لإعادة الاستعمال — يظهر في مكانين لأن المعنى واحد:
 *   • داخل كرت **الباقة**: ما تفتحه الباقة لمشتركيها.
 *   • داخل قسم **المشرفين** في الإعدادات: ما يستطيعه المشرف.
 * لا صفحة «أدوار» منفصلة: الدور يتبع صاحبه (باقة أو مشرف) فيرى المدير كل شيء حيث يعمل.
 */
function permissionsEditor({
  permissions = [],
  choices = PERMISSION_CHOICES,
  addAction,
  deleteAction,
  ownerLabel = '',
  label = 'ما تفتحه هذه الباقة لمشتركيها:',
  emptyText = 'لا صلاحيات بعد.'
}) {
  const owned = new Set(permissions);
  const chips = permissions.length
    ? permissions
        .map(
          (perm) => `<span class="chip" title="${escapeHtml(perm)}">${escapeHtml(permissionLabel(perm))}
      <form method="post" action="${deleteAction}" data-confirm="حذف صلاحية «${escapeHtml(
            permissionLabel(perm)
          )}»${ownerLabel ? ` من ${escapeHtml(ownerLabel)}` : ''}؟">
        <input type="hidden" name="permission" value="${escapeHtml(perm)}" />
        <button class="chip-x" type="submit" aria-label="حذف">✕</button>
      </form></span>`
        )
        .join('\n    ')
    : `<p class="muted">${escapeHtml(emptyText)}</p>`;

  const options = choices
    .filter((code) => !owned.has(code))
    .map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(permissionLabel(code))}</option>`)
    .join('');

  return `<div class="permissions-editor">
  <p class="form-hint"><b>${escapeHtml(label)}</b></p>
  <div class="chips">${chips}</div>
  ${options ? `<form class="toolbar mt-12" method="post" action="${addAction}">
    <select name="permission" required title="اختر صلاحية لتفتحها">
      <option value="" disabled selected>اختر صلاحية...</option>
      ${options}
    </select>
    <button class="btn btn-primary" type="submit">فتح الصلاحية</button>
  </form>` : '<p class="muted mt-12">كل الصلاحيات متاحة لهذه الباقة.</p>'}
</div>`;
}


/** اسم مصدر الاستيراد للعرض. */
function librarySourceName(code) {
  return { upload: 'رفع مباشر', openlibrary: 'Open Library', doaj: 'DOAJ', zenodo: 'Zenodo' }[code] || code || 'upload';
}

/**
 * بطاقة عنصر في مكتبة المنصة: العنوان والشارات + التوثيق + البيانات + الإجراءات.
 * الأزرار كلها نماذج POST عادية أو روابط (بلا سكربتات)، والتعديل يفتح مودال #edit-{id}.
 */
function libraryItemRow(item, token) {
  const id = escapeHtml(item.id);
  const meta = [
    item.authors || 'بلا مؤلف محدد',
    item.year ? String(item.year) : '',
    item.field || ''
  ].filter(Boolean);

  return `<article class="lib-item lib-card">
  <div class="lib-card-head">
    <h3>${escapeHtml(item.title)}</h3>
    <div class="lib-badges">
      ${librarySourceBadge(item.sourceSystem)}
      ${item.hasFile ? `<span class="badge badge-active">ملف ${escapeHtml(humanBytes(item.sizeBytes))}</span>` : '<span class="badge">بيانات فقط</span>'}
      ${item.isActive ? '' : '<span class="badge badge-off">معطّل</span>'}
    </div>
  </div>
  <p class="lib-citation">${escapeHtml(item.citation || '—')}</p>
  <p class="lib-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join('<span>·</span>')}</p>
  ${item.subjects ? `<div class="chips">${librarySubjectChips(item.subjects)}</div>` : ''}
  <div class="lib-actions">
    ${
      item.hasFile
        ? `<a class="btn btn-sm" href="/admin/library/${id}/file${token}">${icon('download', 'icon-sm')} تحميل الملف</a>`
        : ''
    }
    ${
      item.externalUrl
        ? `<a class="btn btn-sm" href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener">فتح المصدر ↗</a>`
        : ''
    }
    <a class="btn btn-sm" href="#edit-${id}">${icon('edit', 'icon-sm')} تعديل</a>
    <form class="inline-form" method="post" action="/admin/library/${id}/toggle${token}">
      <input type="hidden" name="active" value="${item.isActive ? '0' : '1'}" />
      <button class="btn btn-sm ${item.isActive ? 'btn-danger' : 'btn-quiet'}" type="submit">${
        item.isActive ? 'تعطيل' : 'تفعيل'
      }</button>
    </form>
    <form class="inline-form" method="post" action="/admin/library/${id}/delete${token}"
      data-confirm="حذف «${escapeHtml(item.title || 'هذا العنصر')}» من المكتبة نهائياً مع ملفه من القرص؟">
      <button class="btn btn-sm btn-danger" type="submit">${icon('trash', 'icon-sm')} حذف</button>
    </form>
  </div>
</article>`;
}

/** شارة مصدر الاستيراد. */
function librarySourceBadge(code) {
  const label = librarySourceName(code);
  return code && code !== 'upload'
    ? `<span class="badge badge-plan">${escapeHtml(label)}</span>`
    : `<span class="badge">${escapeHtml(label)}</span>`;
}

/** ترويسة الصفحة: العنوان والوصف وأزرار الإجراءات. */
function libraryHero() {
  return `<div class="card lib-hero">
    <div class="lib-hero-top">
      <div>
        <h2>المكتبة العلمية المركزية</h2>
        <p>ارفع كتبك بالتوثيق التلقائي، أو جلب كتباً وأبحاثاً مجانية من المواقع المفتوحة ليقرأها كل الباحثين من رابط واحد.</p>
      </div>
      <div class="lib-hero-actions">
        <a class="btn btn-primary" href="#add-item">＋ إضافة كتاب</a>
        <a class="btn" href="#fetch-panel">جلب من مصادر مجانية</a>
      </div>
    </div>
  </div>`;
}

/** بطاقة مصدر قابل للاختيار (بديل القائمة المنسدلة — يعمل بلا سكربتات عبر :checked). */
function librarySourcePicker(sources, current) {
  return `<div class="source-picker" role="radiogroup" aria-label="مصدر الجلب">
    ${sources
      .map(
        (item) => `<label class="source-option">
      <input type="radio" name="esrc" value="${escapeHtml(item.id)}"${item.id === current ? ' checked' : ''} />
      <span class="source-option-body">
        <span class="source-name"><span class="source-dot"></span>${escapeHtml(item.label)}</span>
        ${item.hint ? `<span class="source-hint">${escapeHtml(item.hint)}</span>` : ''}
      </span>
    </label>`
      )
      .join('')}
  </div>`;
}

/** لوحة الجلب الجانبية: اختيار المصدر ثم كلمة البحث أو التصنيف. */
function libraryFetchPanel({ sources, search, q, status, adminToken, token }) {
  return `<section class="card lib-panel" id="fetch-panel">
    <div class="lib-section-head"><h2>جلب من مواقع مجانية</h2></div>
    <p class="lib-hint">اختر المصدر ثم اكتب كلمة بحث أو تصنيفاً — والنتيجة تظهر أسفل الصفحة.</p>
    <form class="lib-form" method="get" action="/admin/library">
      ${adminToken ? `<input type="hidden" name="token" value="${escapeHtml(adminToken)}" />` : ''}
      <input type="hidden" name="q" value="${escapeHtml(q)}" />
      <input type="hidden" name="status" value="${escapeHtml(status)}" />
      <div class="lib-fields">
        <div class="lib-field-full">
          <span class="field-label">المصدر</span>
          ${librarySourcePicker(sources, search.source)}
        </div>
        <div class="field lib-field-full">
          <label for="lib-eq">كلمة البحث (عنوان/مؤلف)</label>
          <input type="search" id="lib-eq" name="eq" value="${escapeHtml(search.q || '')}" placeholder="مثال: machine learning" />
        </div>
        <div class="field lib-field-full">
          <label for="lib-subject">التصنيف (اختياري)</label>
          <input type="search" id="lib-subject" name="subject" value="${escapeHtml(search.subject || '')}" placeholder="مثال: psychology" />
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${icon('searchCheck', 'icon-sm')} ابدأ الجلب</button>
      </div>
    </form>
    <p class="lib-hint-box">
      <b>كيف يعمل؟</b> الجلب بلا مفاتيح من: Crossref (بيانات الاستشهاد الكاملة) · OpenAlex (يفهرس IEEE وACM
      والSpringer) · IEEE Xplore · ACM Digital Library (عبر بادئات DOI الرسمية) · Semantic Scholar · arXiv ·
      Europe PMC · Open Library (كتب + Internet Archive) · DOAJ · Zenodo.
      عند الاستيراد يحاول الموقع تنزيل الملف تلقائياً (أو يجد نسخة مفتوحة عبر Unpaywall)، وإن لم يتوفّر يُضاف
      العنصر ببياناته كاملة: المؤلفون · المجلة · السنة · DOI · رابط المصدر.
    </p>
  </section>`;
}

/** قسم نتائج الجلب الخارجي (يظهر فقط بعد تشغيل البحث). */
function libraryExternalSection(external, sources, token) {
  if (!external) return '';
  const label = sources.find((item) => item.id === external.source)?.label || 'المصدر الخارجي';
  const count = external.results?.length || 0;

  const content = external.error
    ? `<div class="alert">${escapeHtml(external.error)}</div>`
    : count
      ? `<div class="lib-list">${external.results.map((result) => libraryExternalResult(result, external.source, token)).join('')}</div>`
      : '<div class="empty">لا نتائج — جرّب كلمة أخرى أو تصنيفاً مختلفاً.</div>';

  return `<section class="card">
    <div class="lib-section-head">
      <h2>نتائج الجلب من ${escapeHtml(label)}</h2>
      <span class="lib-section-note">${count ? `${formatNumber(count)} نتيجة — ضغطة واحدة تستورد العنصر وملفه` : ''}</span>
    </div>
    ${content}
  </section>`;
}

/** صفحة المكتبة العلمية: تخطيط بطل + عمودان (قائمة العناصر ولوحة الجلب) + نتائج الجلب. */
export function renderAdminLibrary({
  items = [],
  total = 0,
  pages = 1,
  page = 1,
  counts = {},
  q = '',
  status = 'all',
  external = null,
  sources = [],
  search = {},
  ok = '',
  note = '',
  error = '',
  adminToken = '',
  account = null
}) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const notice = OK_TEXT[ok] ? `<div class="notice">${escapeHtml(OK_TEXT[ok])}${note ? ` — ${escapeHtml(note)}` : ''}</div>` : '';
  const errorNotice = error ? `<div class="alert">${escapeHtml(error)}</div>` : '';
  const acceptTypes = LIBRARY_EXTENSIONS.map((ext) => `.${ext}`).join(',');

  const stats = [
    statRaw('إجمالي المكتبة', formatNumber(counts.total ?? total)),
    statRaw('بملف كامل', formatNumber(counts.withFile ?? 0)),
    statRaw('بيانات فقط', formatNumber(Math.max((counts.total ?? total) - (counts.withFile ?? 0), 0))),
    statRaw('معطّلة', formatNumber(counts.inactive ?? 0))
  ].join('');

  const filterLinks = ['all', 'active', 'off']
    .map((value) => {
      const label = { all: 'الكل', active: 'مفعّلة', off: 'معطّلة' }[value];
      const href = `/admin/library${buildQuery({ q, status: value, page: 1, esrc: search.source, eq: search.q, subject: search.subject, token: adminToken })}`;
      return `<a class="chip${status === value ? ' is-active' : ''}" href="${href}">${escapeHtml(label)}</a>`;
    })
    .join('');

  const pager = pages > 1
    ? `<div class="toolbar mt-12">
      <span class="muted">صفحة ${escapeHtml(formatNumber(page))} من ${escapeHtml(formatNumber(pages))}</span>
      ${page > 1 ? `<a class="btn btn-sm" href="/admin/library${buildQuery({ q, status, page: page - 1, esrc: search.source, eq: search.q, subject: search.subject, token: adminToken })}">السابق</a>` : ''}
      ${page < pages ? `<a class="btn btn-sm" href="/admin/library${buildQuery({ q, status, page: page + 1, esrc: search.source, eq: search.q, subject: search.subject, token: adminToken })}">التالي</a>` : ''}
    </div>`
    : '';

  const itemsHtml = items.length
    ? `<div class="lib-list">${items.map((item) => libraryItemRow(item, token)).join('')}</div>${pager}${items.map((item) => libraryEditModal(item, token)).join('')}`
    : `<div class="empty">${
        q ? 'لا نتائج لهذا البحث داخل المكتبة — جرّب كلمة أخرى.' : 'لا عناصر بعد — ارفع كتاباً أو استورد من المصادر المجانية.'
      }</div>`;

  const body = `
  ${notice}${errorNotice}
  ${libraryHero()}

  <div class="lib-layout">
    <section class="card">
      <div class="lib-section-head">
        <h2>عناصر المكتبة${total ? ` (${formatNumber(total)})` : ''}</h2>
        <form class="toolbar" method="get" action="/admin/library" role="search">
          ${adminToken ? `<input type="hidden" name="token" value="${escapeHtml(adminToken)}" />` : ''}
          <input type="hidden" name="status" value="${escapeHtml(status)}" />
          <input type="hidden" name="esrc" value="${escapeHtml(search.source || '')}" />
          <input type="hidden" name="eq" value="${escapeHtml(search.q || '')}" />
          <input type="hidden" name="subject" value="${escapeHtml(search.subject || '')}" />
          <div class="field">
            <label for="lib-q">بحث داخل المكتبة</label>
            <input type="search" id="lib-q" name="q" value="${escapeHtml(q)}" placeholder="عنوان، مؤلف، أو تخصص..." />
          </div>
          <button class="btn btn-primary" type="submit">${icon('searchCheck', 'icon-sm')} بحث</button>
        </form>
      </div>
      <div class="lib-hero-filters">${filterLinks}</div>
      <div class="lib-stats">${stats}</div>
      ${itemsHtml}
    </section>
    ${libraryFetchPanel({ sources, search, q, status, adminToken, token })}
  </div>

  ${libraryExternalSection(external, sources, token)}

  ${libraryAddModal(token, acceptTypes)}`;

  return renderLayout({
    title: 'المكتبة العلمية',
    subtitle: 'رفع الكتب بالتوثيق + جلب من مصادر مجانية وتخزينها في الموقع',
    activeKey: 'library',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}

/** رابط استعلام آمن من كائن قيم. */
function buildQuery(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values || {})) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (!text) continue;
    params.set(key, key === 'token' ? text.slice(0, 200) : text.slice(0, 200));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** شرائح تصنيفات (chips) من نص مفصول بـ « · ». */
function librarySubjectChips(subjects) {
  const list = String(subjects || '')
    .split('·')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
  return list.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join(' ');
}

/** مودال تعديل عنصر — يفتح برابط #edit-{id} بلا سكربتات. */
function libraryEditModal(item, token) {
  const id = escapeHtml(item.id);
  return `
  <div class="modal" id="edit-${id}">
    <div class="card">
      <div class="card-head">
        <h2>تعديل عنصر المكتبة</h2>
        <a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a>
      </div>
      <p class="muted">التوثيق يُعاد توليده تلقائياً إن تركت حقل التوثيق فارغاً.</p>
      <form method="post" action="/admin/library/${id}/edit${token}">
        <div class="field-row">
          <div class="field">
            <label for="e-title-${id}">العنوان *</label>
            <input type="text" id="e-title-${id}" name="title" maxlength="500" required value="${escapeHtml(item.title)}" />
          </div>
          <div class="field">
            <label for="e-authors-${id}">المؤلفون</label>
            <input type="text" id="e-authors-${id}" name="authors" maxlength="1000" value="${escapeHtml(item.authors)}" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="e-year-${id}">سنة النشر</label>
            <input type="number" id="e-year-${id}" name="year" min="1000" max="2999" value="${item.year ?? ''}" />
          </div>
          <div class="field">
            <label for="e-source-${id}">الناشر / المصدر (للمراجع)</label>
            <input type="text" id="e-source-${id}" name="source" maxlength="255" value="${escapeHtml(item.source)}" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="e-field-${id}">التخصص / التصنيف</label>
            <input type="text" id="e-field-${id}" name="field" maxlength="255" value="${escapeHtml(item.field)}" />
          </div>
          <div class="field">
            <label for="e-subjects-${id}">وسوم التصنيف (مفصولة بـ ·)</label>
            <input type="text" id="e-subjects-${id}" name="subjects" maxlength="500" value="${escapeHtml(item.subjects)}" />
          </div>
        </div>
        <div class="field">
          <label for="e-abstract-${id}">الملخص</label>
          <textarea id="e-abstract-${id}" name="abstract" rows="3" maxlength="5000">${escapeHtml(item.abstract)}</textarea>
        </div>
        <div class="field">
          <label for="e-citation-${id}">التوثيق (APA)</label>
          <textarea id="e-citation-${id}" name="citation" rows="2" maxlength="2000">${escapeHtml(item.citation)}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">حفظ التعديلات</button>
          <span class="muted">${item.hasFile ? `الملف الحالي: ${escapeHtml(item.fileName)} (${humanBytes(item.sizeBytes)})` : 'بلا ملف مرفوع.'}</span>
        </div>
      </form>
    </div>
  </div>`;
}

/** مودال إضافة كتاب جديد (ملف اختياري + بيانات + توثيق تلقائي). */
function libraryAddModal(token, acceptTypes) {
  return `
  <div class="modal" id="add-item">
    <div class="card">
      <div class="card-head">
        <h2>إضافة كتاب إلى المكتبة</h2>
        <a class="btn btn-sm" href="#" title="إغلاق">إغلاق ✕</a>
      </div>
      <p class="muted">الملف يُحفظ في storage/library/references مرة واحدة ويقرأه كل الباحثين — التوثيق يُولَّد تلقائياً إن تركته فارغاً.</p>
      <form method="post" action="/admin/library/add${token}" enctype="multipart/form-data">
        <div class="field-row">
          <div class="field">
            <label for="add-title">العنوان *</label>
            <input type="text" id="add-title" name="title" maxlength="500" required placeholder="مثال: أساسيات البحث العلمي" />
          </div>
          <div class="field">
            <label for="add-authors">المؤلفون</label>
            <input type="text" id="add-authors" name="authors" maxlength="1000" placeholder="أحمد محمد، سارة علي" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="add-year">سنة النشر</label>
            <input type="number" id="add-year" name="year" min="1000" max="2999" placeholder="2024" />
          </div>
          <div class="field">
            <label for="add-source">الناشر / المصدر (للمراجع)</label>
            <input type="text" id="add-source" name="source" maxlength="255" placeholder="دار النشر، أو اسم المجلة" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="add-field">التخصص / التصنيف</label>
            <input type="text" id="add-field" name="field" maxlength="255" placeholder="مثال: إدارة الأعمال" />
          </div>
          <div class="field">
            <label for="add-degree">الدرجة المستهدفة</label>
            <select id="add-degree" name="degree_level">
              <option value="">لكل الدرجات</option>
              <option value="bachelor">طالب جامعي (بكالوريوس)</option>
              <option value="master">باحث ماجستير</option>
              <option value="phd">باحث دكتوراه</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="add-subjects">وسوم التصنيف (مفصولة بـ ·)</label>
          <input type="text" id="add-subjects" name="subjects" maxlength="500" placeholder="علم النفس · القياس · المناهج" />
        </div>
        <div class="field">
          <label for="add-abstract">الملخص</label>
          <textarea id="add-abstract" name="abstract" rows="3" maxlength="5000"></textarea>
        </div>
        <div class="field">
          <label for="add-citation">التوثيق (APA) — اختياري</label>
          <textarea id="add-citation" name="citation" rows="2" maxlength="2000" placeholder="اتركه فارغاً ليُولَّد من العنوان والمؤلف والسنة والمصدر."></textarea>
        </div>
        <div class="field">
          <label for="add-file">ملف الكتاب (اختياري)</label>
          <input type="file" id="add-file" name="file" accept="${escapeHtml(acceptTypes)}" />
          <p class="form-hint">الصيغ المسموحة: ${escapeHtml(acceptTypes)} — حتى 200MB.</p>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">إضافة إلى المكتبة</button>
          <span class="muted">يظهر فوراً في نتائج البحث للباحثين.</span>
        </div>
      </form>
    </div>
  </div>`;
}

/** بطاقة نتيجة بحث خارجي مع زر الاستيراد (نموذج POST مخفي ببيانات النتيجة). */
function libraryExternalResult(result, provider, token) {
  const abstract = String(result.abstract || '');
  const meta = [
    result.authors || 'بلا مؤلف محدد',
    result.year ? String(result.year) : '',
    result.source || '',
    result.doi ? `DOI: ${result.doi}` : '',
    result.citations ? `${formatNumber(result.citations)} استشهاد` : ''
  ].filter(Boolean);

  return `<article class="lib-item lib-card">
  <div class="lib-card-head">
    <h3>${escapeHtml(result.title)}</h3>
    <div class="lib-badges">
      ${librarySourceBadge(provider)}
      ${result.isOpenAccess ? '<span class="badge badge-active">مفتوح الوصول</span>' : ''}
      ${result.downloadable ? '<span class="badge badge-active">ملف متاح</span>' : '<span class="badge">بيانات فقط</span>'}
    </div>
  </div>
  <p class="lib-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join('<span>·</span>')}</p>
  ${abstract ? `<p class="lib-abs">${escapeHtml(abstract.slice(0, 300))}${abstract.length > 300 ? '…' : ''}</p>` : ''}
  ${result.subjects ? `<div class="chips">${librarySubjectChips(result.subjects)}</div>` : ''}
  <div class="lib-actions">
    <form class="inline-form" method="post" action="/admin/library/import${token}">
      <input type="hidden" name="provider" value="${escapeHtml(provider)}" />
      <input type="hidden" name="locator" value="${escapeHtml(result.locator || '')}" />
      <input type="hidden" name="title" value="${escapeHtml(result.title)}" />
      <input type="hidden" name="authors" value="${escapeHtml(result.authors || '')}" />
      <input type="hidden" name="year" value="${result.year ?? ''}" />
      <input type="hidden" name="source_label" value="${escapeHtml(result.source || '')}" />
      <input type="hidden" name="abstract" value="${escapeHtml(abstract.slice(0, 1500))}" />
      <input type="hidden" name="subjects" value="${escapeHtml(result.subjects || '')}" />
      <input type="hidden" name="item_url" value="${escapeHtml(result.url || '')}" />
      <button class="btn btn-primary btn-sm" type="submit">${icon('download', 'icon-sm')} استيراد إلى المكتبة${result.downloadable ? ' + تحميل الملف' : ' (بيانات فقط)'}</button>
    </form>
    <a class="btn btn-sm" href="${escapeHtml(result.url || '#')}" target="_blank" rel="noopener">فتح المصدر ↗</a>
    ${result.pdfUrl ? `<a class="btn btn-sm" href="${escapeHtml(result.pdfUrl)}" target="_blank" rel="noopener">${icon('download', 'icon-sm')} PDF مفتوح ↗</a>` : ''}
  </div>
</article>`;
}
