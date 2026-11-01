import { DEFAULT_CURRENCY, SITE_CURRENCIES } from '../constants.js';

/** Presentation helpers for server-rendered pages. */

/** Formats numbers with Latin digits and thousands separators. */
export function formatNumber(value) {
  return Number(value ?? 0).toLocaleString('en-US');
}

/** Formats an Arabic date with Latin digits. */
export function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

/** Formats a compact date and time with Latin digits. */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/** Formats a monetary amount in the selected or default site currency. */
export function formatMoney(value, currency = DEFAULT_CURRENCY) {
  const amount = Number(value ?? 0);
  const code = String(currency || DEFAULT_CURRENCY).toUpperCase();
  const meta = SITE_CURRENCIES.find((item) => item.code === code) || SITE_CURRENCIES[0];

  const number = Number.isInteger(amount) ? formatNumber(amount) : amount.toFixed(2);
  return `${number} ${meta.symbol}`;
}
