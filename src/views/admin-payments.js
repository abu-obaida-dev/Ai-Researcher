import { formatDateTime, formatMoney, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة إدارة طلبات الدفع (لوحة الإدارة — صلاحية admin:payments).
 * كل طلب: بيانات الباحث والباقة والمبلغ ورقم العملية، وزرّا تأكيد/رفض مع ملاحظة.
 */

/** شارة حالة الطلب في جدول الإدارة. */
function statusBadge(status) {
  const map = {
    pending: '<span class="badge badge-plan">قيد المراجعة</span>',
    confirmed: '<span class="badge badge-active">مؤكّد</span>',
    rejected: '<span class="badge badge-error">مرفوض</span>'
  };
  return map[status] || map.pending;
}

/** صف طلب مع نموذج التأكيد/الرفض (POST عادي بلا سكربتات). */
function requestRow(request, token) {
  const id = escapeHtml(request.id);
  const actions =
    request.status === 'pending'
      ? `<form class="lib-actions" method="post" action="/admin/payments/${id}/confirm${token}">
          <input type="text" name="admin_note" maxlength="500" placeholder="ملاحظة (اختياري)" aria-label="ملاحظة التأكيد" />
          <button class="btn btn-sm btn-primary" type="submit" data-confirm="تأكيد الطلب وتفعيل باقة ${escapeHtml(
            request.planTitle
          )} وإضافة ${formatNumber(request.planTokens)} نقطة للباحث؟">${icon('check', 'icon-sm')} تأكيد</button>
        </form>
        <form class="lib-actions" method="post" action="/admin/payments/${id}/reject${token}"
          data-confirm="رفض طلب الدفع؟ سيصل للباحث سبب الرفض.">
          <input type="text" name="admin_note" maxlength="500" placeholder="سبب الرفض" aria-label="سبب الرفض" />
          <button class="btn btn-sm btn-danger" type="submit">${icon('trash', 'icon-sm')} رفض</button>
        </form>`
      : `<p class="muted">${escapeHtml(request.adminNote || 'بلا ملاحظة')} · ${escapeHtml(request.handledBy || '')} ${
          request.handledAt ? `· ${escapeHtml(formatDateTime(request.handledAt))}` : ''
        }</p>`;

  return `<article class="lib-item lib-card">
  <div class="lib-card-head">
    <h3>${escapeHtml(request.planTitle)} — ${escapeHtml(formatMoney(request.amount, request.currency))}</h3>
    <div class="lib-badges">${statusBadge(request.status)}<span class="badge">${escapeHtml(request.methodLabel)}</span></div>
  </div>
  <p class="lib-meta">
    <span>${escapeHtml(request.userName || '—')}</span><span>·</span>
    <span>${escapeHtml(request.userEmail)}</span><span>·</span>
    <span>${escapeHtml(formatDateTime(request.createdAt))}</span>
  </p>
  <p class="lib-citation">رقم العملية: <b>${escapeHtml(request.referenceNo || '—')}</b> · النقاط الممنوحة: ${formatNumber(
    request.planTokens
  )}</p>
  ${request.note ? `<p class="lib-abs">ملاحظة الباحث: ${escapeHtml(request.note)}</p>` : ''}
  ${actions}
</article>`;
}

/** صفحة الطلبات: عدّادات + فلاتر + قائمة الطلبات. */
export function renderAdminPayments({
  requests = [],
  counts = {},
  total = 0,
  page = 1,
  pages = 1,
  status = 'pending',
  q = '',
  ok = '',
  error = '',
  adminToken = '',
  account = null
}) {
  const token = adminToken ? `?token=${encodeURIComponent(adminToken)}` : '';
  const notice = ok ? `<div class="notice">${escapeHtml(ok)}</div>` : '';
  const errorNotice = error ? `<div class="alert"><b>تعذّر:</b> ${escapeHtml(error)}</div>` : '';

  const link = (value, label, count) => {
    const params = new URLSearchParams({ status: value, page: '1' });
    if (q) params.set('q', q);
    if (adminToken) params.set('token', adminToken);
    return `<a class="chip${status === value ? ' is-active' : ''}" href="/admin/payments?${params.toString()}">${escapeHtml(
      label
    )}: ${formatNumber(count)}</a>`;
  };

  const filters = [
    link('pending', 'قيد المراجعة', counts.pending || 0),
    link('confirmed', 'مؤكّد', counts.confirmed || 0),
    link('rejected', 'مرفوض', counts.rejected || 0),
    link('all', 'الكل', total)
  ].join('');

  const pager =
    pages > 1
      ? `<div class="toolbar mt-12">
    <span class="muted">صفحة ${formatNumber(page)} من ${formatNumber(pages)}</span>
    ${page > 1 ? `<a class="btn btn-sm" href="/admin/payments?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${page - 1}${token}">السابق</a>` : ''}
    ${page < pages ? `<a class="btn btn-sm" href="/admin/payments?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${page + 1}${token}">التالي</a>` : ''}
  </div>`
      : '';

  const list = requests.length
    ? `<div class="lib-list">${requests.map((request) => requestRow(request, token)).join('')}</div>${pager}`
    : '<div class="empty">لا طلبات بهذه الفلترة.</div>';

  const body = `
  ${notice}${errorNotice}
  <div class="card lib-hero">
    <div class="lib-hero-top">
      <div>
        <h2>طلبات الدفع والتأكيد</h2>
        <p>الدفع يدوي خارج المنصة: يتحقق المدير من التحويل ثم يؤكّد الطلب، فتُفعَّل الباقة وتُضاف النقاط فوراً.</p>
      </div>
      <div class="lib-hero-actions">
        <a class="btn btn-primary" href="/admin/plans">إدارة الباقات</a>
      </div>
    </div>
    <div class="lib-hero-filters">${filters}</div>
    <form class="toolbar" method="get" action="/admin/payments">
      ${adminToken ? `<input type="hidden" name="token" value="${escapeHtml(adminToken)}" />` : ''}
      <input type="hidden" name="status" value="${escapeHtml(status)}" />
      <div class="field">
        <label for="pay-q">بحث</label>
        <input type="search" id="pay-q" name="q" value="${escapeHtml(q)}" placeholder="بريد الباحث، رقم العملية، أو اسم الباقة" />
      </div>
      <button class="btn btn-primary" type="submit">${icon('searchCheck', 'icon-sm')} بحث</button>
    </form>
  </div>

  <section class="card">
    <div class="lib-section-head"><h2>الطلبات (${formatNumber(total)})</h2></div>
    ${list}
  </section>`;

  return renderLayout({
    title: 'طلبات الدفع',
    subtitle: 'مراجعة وتأكيد اشتراكات الباحثين (دفع يدوي خارج المنصة)',
    activeKey: 'payments',
    account,
    scripts: ['/js/app-shell.js'],
    body
  });
}