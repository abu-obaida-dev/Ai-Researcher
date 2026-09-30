/**
 * دوال عرض (presentation helpers) مستخدمة في الصفحات المولَّدة على الخادم.
 * نفس أسلوب التنسيق المستخدم في الواجهة السابقة للحفاظ على شكل المخرجات.
 */

/** تنسيق الأرقام بأرقام لاتينية مع فواصل الآلاف. */
export function formatNumber(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

/** تاريخ عربي مقروء (بدون وقت). */
export function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

/** تاريخ ووقت مختصر. */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/** السعر بالريال/الدولار كما هو مخزّن، مع علامة العملة. */
export function formatPrice(value) {
  const amount = Number(value ?? 0);
  if (amount === 0) return 'مجاناً';
  return `${amount.toFixed(2)} ر.س`;
}
