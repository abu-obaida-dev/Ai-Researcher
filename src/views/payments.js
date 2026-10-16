import { formatDateTime, formatMoney, formatNumber } from './format.js';
import { icon } from './icons.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة «الاشتراك والدفع» للباحث: الدفع يدوي خارج المنصة.
 * يختار باقة وطريقة دفع (تحويل بنكي أو كاش فقط)، ويؤكد رقمه على واتساب،
 * والنظام يولّد كود تفعيل من 6 أرقام يرسله عبر واتساب لخدمة العملاء.
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
    <td>${escapeHtml(item.referenceCode || item.referenceNo || '—')}</td>
    <td>${statusBadge(item.status)}</td>
    <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
  </tr>`
    )
    .join('');

  return `<table class="ref-table">
    <thead><tr><th>الطلب</th><th>رقم التفعيل</th><th>الحالة</th><th>التاريخ</th></tr></thead>
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
  whatsapp = '',
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
        <label for="pay-whatsapp">رقم الواتساب للتواصل *</label>
        <input type="tel" id="pay-whatsapp" name="whatsapp_number" required value="${escapeHtml(whatsapp)}" maxlength="20" placeholder="مثال: 0912345678" />
        <span class="field-hint">سيظهر لك كود تفعيل من 6 أرقام بعد الإرسال — أرسله عبر واتساب لخدمة العملاء.</span>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${icon('coins', 'icon-sm')} أرسل طلب الدفع</button>
        <span class="muted">الدفع يتم خارج المنصة (تحويل بنكي أو كاش)، والإدارة تؤكّد الطلب وتفعّل باقتك يدوياً.</span>
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
        <li>اختر الباقة وطريقة الدفع (تحويل بنكي أو كاش)، وتحقق من رقم الواتساب الظاهر أعلاه.</li>
        <li>سدد المبلغ خارج المنصة وفقًا لطريقة الدفع المختارة.</li>
        <li>أرسل الطلب — سيعطيك النظام كود تفعيل من 6 أرقام.</li>
        <li>أرسل الكود عبر واتساب لخدمة العملاء لتفعيل باقتك وإضافة نقاطها.</li>
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