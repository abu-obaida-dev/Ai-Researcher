import { formatDateTime, formatMoney, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة «الاشتراك والدفع» للباحث: الدفع يدوي خارج المنصة.
 * يختار باقة + طريقة دفع (مع تفاصيل التحويل) ثم يكتب رقم العملية، والإدارة تؤكّد.
 */

/** شارة حالة الطلب. */
function statusBadge(status) {
  const map = {
    pending: '<span class="badge badge-plan">قيد المراجعة</span>',
    confirmed: '<span class="badge badge-active">مؤكّد</span>',
    rejected: '<span class="badge badge-error">مرفوض</span>'
  };
  return map[status] || map.pending;
}

/** بطاقة طريقة الدفع مع تفاصيل التحويل. */
function renderMethod(method, currency, index) {
  return `<label class="source-option">
    <input type="radio" name="method_code" value="${escapeHtml(method.code)}"${index === 0 ? ' checked' : ''} required />
    <span class="source-option-body">
      <span class="source-name"><span class="source-dot"></span>${escapeHtml(method.label)}
        <span class="badge">${escapeHtml(formatMoney(0, method.currency).split(' ')[1] || method.currency)}</span>
      </span>
      ${method.note ? `<span class="source-hint">${escapeHtml(method.note)}</span>` : ''}
      ${method.details ? `<span class="source-hint">${escapeHtml(method.details)}</span>` : ''}
    </span>
  </label>`;
}

/** جدول طلبات الباحث. */
function renderRequests(requests) {
  if (!requests.length) return '<div class="empty">لا طلبات دفع بعد — قدّم طلباً من النموذج بالأعلى.</div>';

  const rows = requests
    .map(
      (item) => `<tr>
    <td>
      <p class="strong">${escapeHtml(item.planTitle)}</p>
      <p class="muted">${escapeHtml(item.methodLabel)} · ${escapeHtml(formatMoney(item.amount, item.currency))}</p>
      ${item.adminNote ? `<p class="muted">رد الإدارة: ${escapeHtml(item.adminNote)}</p>` : ''}
    </td>
    <td>${escapeHtml(item.referenceNo || '—')}</td>
    <td>${statusBadge(item.status)}</td>
    <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
  </tr>`
    )
    .join('');

  return `<table class="ref-table">
    <thead><tr><th>الطلب</th><th>رقم العملية</th><th>الحالة</th><th>التاريخ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function renderPaymentsPage({
  account = null,
  unread = 0,
  plans = [],
  methods = [],
  requests = [],
  currency = 'LYD',
  selectedPlan = '',
  flash = null
}) {
  const paid = plans.filter((plan) => Number(plan.price) > 0);
  const chosen = selectedPlan || paid[0]?.code || '';
  const planOptions = paid
    .map(
      (plan) =>
        `<option value="${escapeHtml(plan.code)}"${plan.code === chosen ? ' selected' : ''}>${escapeHtml(plan.title)} — ${escapeHtml(formatMoney(plan.price, currency))}</option>`
    )
    .join('');

  const notice = flash?.message
    ? `<div class="${flash.type === 'error' ? 'alert' : 'notice'}">${escapeHtml(flash.message)}</div>`
    : '';

  const form = methods.length
    ? `<form method="post" action="/payments" class="form-card">
      <div class="field">
        <label for="pay-plan">الباقة المطلوبة</label>
        <select id="pay-plan" name="plan_code" required>${planOptions}</select>
      </div>
      <div class="field">
        <span class="field-label">طريقة الدفع</span>
        <div class="source-picker">${methods.map((method, index) => renderMethod(method, currency, index)).join('')}</div>
      </div>
      <div class="field">
        <label for="pay-ref">رقم عملية التحويل / رقم الإيصال *</label>
        <input type="text" id="pay-ref" name="reference_no" required maxlength="120" placeholder="مثال: TRX-2024-8891" />
      </div>
      <div class="field">
        <label for="pay-note">ملاحظة (اختياري)</label>
        <textarea id="pay-note" name="note" rows="2" maxlength="1000" placeholder="اكتب أي تفاصيل تساعد الإدارة في التأكيد."></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${icon('coins', 'icon-sm')} أرسل طلب الدفع</button>
        <span class="muted">الدفع يتم خارج المنصة، والإدارة تؤكّد الطلب بعد مراجعة التحويل.</span>
      </div>
    </form>`
    : '<div class="empty">لا توجد طرق دفع مفعّلة حالياً — راجع الإدارة.</div>';

  const body = `
  ${notice}
  <div class="grid">
    <section class="card">
      <div class="lib-section-head"><h2>طلب دفع جديد</h2></div>
      ${form}
    </section>
    <section class="card">
      <div class="lib-section-head"><h2>كيف يتم الدفع؟</h2></div>
      <ol class="muted">
        <li>اختر الباقة وطريقة الدفع، واقرأ تفاصيل التحويل (رقم الحساب أو المحفظة).</li>
        <li>حوّل المبلغ ${escapeHtml(formatMoney(0, currency).split(' ')[1] || currency)} خارج المنصة.</li>
        <li>اكتب رقم العملية وأرسل الطلب.</li>
        <li>الإدارة تؤكّد الطلب، فتُفعَّل باقتك وتضاف نقاطها فوراً.</li>
      </ol>
    </section>
  </div>

  <section class="card">
    <div class="lib-section-head"><h2>طلباتي (${formatNumber(requests.length)})</h2></div>
    ${renderRequests(requests)}
  </section>`;

  return renderLayout({
    title: 'الاشتراك والدفع',
    subtitle: 'الدفع يدوي خارج المنصة — قدّم الطلب والإدارة تؤكّده',
    area: 'app',
    activeKey: 'payments',
    account,
    unread,
    scripts: ['/js/app-shell.js'],
    body
  });
}