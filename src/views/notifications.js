import { formatDateTime } from './format.js';
import { escapeHtml, renderLayout } from './layout.js';

/**
 * صفحة الإشعارات داخل لوحة الباحث: تفعيل إشعارات الهاتف (FCM Web) + قائمة الإشعارات داخل الموقع.
 * أزرار التفعيل تُدار من /js/notifications-client.js (بدون أي سكربت سطري هنا).
 * قائمة الجرس في الشريط العلوي تُدار من /js/app-shell.js عبر نفس الـ APIs.
 */

/** عنصر واحد في قائمة الإشعارات (نقطة حمراء إن لم يُقرأ + زر تعليم كمقروء). */
function renderItem(item) {
  const unreadClass = item.read ? '' : ' notif-unread';
  const dot = item.read ? '' : '<span class="notif-dot" aria-hidden="true"></span>';
  const body = escapeHtml(item.body || '');
  const time = escapeHtml(formatDateTime(item.created_at));
  const readButton = item.read
    ? ''
    : `<button type="button" class="btn notif-read-btn" data-read-id="${escapeHtml(item.id)}">تعليم كمقروء</button>`;

  return `<li class="notif-item${unreadClass}" data-notif-id="${escapeHtml(item.id)}">
    ${dot}
    <div class="notif-content">
      <p class="notif-title"><a class="notif-link" href="${escapeHtml(item.url || '/dashboard')}">${escapeHtml(
        item.title
      )}</a></p>
      ${body ? `<p class="notif-body">${body}</p>` : ''}
      <p class="notif-time">${time}</p>
    </div>
    ${readButton}
  </li>`;
}

/** صفحة الإشعارات الكاملة. */
export function renderNotificationsPage({ account, items, unread, devices, hint }) {
  const listHtml = items.length
    ? `<ul class="notif-list">${items.map(renderItem).join('')}</ul>`
    : '<div class="empty">لا توجد إشعارات بعد — نُرسل لك الجديد هنا فور حدوثه.</div>';

  const readAllButton = unread
    ? `<button type="button" class="btn" id="btn-read-all">تعليم الكل كمقروء (${unread})</button>`
    : '';

  const body = `<div class="notif-grid">
  <div class="card">
    <h2>إشعارات هاتفك</h2>
    <p class="muted" id="push-status">${escapeHtml(hint.text)}</p>
    <dl class="kv">
      <div><dt>أجهزة مفعّلة</dt><dd id="device-count">${devices}</dd></div>
      <div><dt>غير مقروء</dt><dd>${unread}</dd></div>
    </dl>
    <div class="links" id="push-actions">
      <button type="button" class="btn btn-primary" id="btn-enable-push"${
        hint.webReady ? '' : ' disabled'
      }>تفعيل على هذا الجهاز</button>
      <button type="button" class="btn" id="btn-disable-push">إيقاف على هذا الجهاز</button>
      <a class="btn" href="/dashboard">لوحتي</a>
    </div>
    ${
      hint.webReady
        ? ''
        : '<div class="alert"><b>خطوة واحدة متبقية:</b> أضف مفاتيح <code>FIREBASE_*</code> الستة في ملف <code>.env</code> ثم أعد تشغيل الخادم (التفاصيل في <code>.env.example</code>).</div>'
    }
  </div>

  <div class="card">
    <div class="notif-head">
      <h2>الإشعارات داخل الموقع</h2>
      ${readAllButton}
    </div>
    ${listHtml}
  </div>
</div>
`;

  return renderLayout({
    title: 'الإشعارات',
    subtitle: unread ? `لديك ${unread} إشعار غير مقروء` : 'كل جديد المنصة في مكان واحد',
    area: 'app',
    activeKey: '',
    account,
    unread,
    scripts: [
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js',
      '/js/notifications-client.js',
      '/js/app-shell.js'
    ],
    body
  });
}