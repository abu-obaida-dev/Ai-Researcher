/**
 * أيقونات SVG مضغوطة تُرسم داخل الصفحات المولَّدة على الخادم — بدون أي مكتبة أيقونات
 * وبدون أي ملف خارجي. كل الأيقونات ترث اللون من النص (currentColor).
 */

const PATHS = {
  sparkles:
    '<path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7z"/><path d="M18 15.5l.9 2.4 2.3.9-2.3.9-.9 2.4-.9-2.4-2.3-.9 2.3-.9z"/>',
  message: '<path d="M21 14.5a4 4 0 0 1-4 4H8.5L4 22V6a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  language: '<path d="M4 5h11M9.5 3v2c0 4.5-2.6 8-5.5 9.5"/><path d="M6 12c1.2 3 3.6 5.4 6.5 6.5"/><path d="M13 21l4-10 4 10M14.8 17.5h5.4"/>',
  searchCheck: '<path d="M14 3v5h5"/><path d="M19 21V8l-5-5H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/><circle cx="11.5" cy="15" r="2.6"/><path d="m10.4 15 .9.9 1.7-1.8"/>',
  bulb: '<path d="M9.5 18h5M10.5 21.5h3"/><path d="M12 2.5a6 6 0 0 0-3.4 10.9c.5.4.9 1 .9 1.6h5c0-.6.4-1.2.9-1.6A6 6 0 0 0 12 2.5Z"/>',
  userPlus: '<circle cx="9" cy="8" r="3.6"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M18.5 7.5v6M15.5 10.5h6"/>',
  clipboard: '<path d="M9 4.5h6v3H9z"/><path d="M9 6H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2"/><path d="M9 12.5h6M9 16.5h4"/>',
  rocket:
    '<path d="M14.6 3.4c2.4-1.9 5.4-2 6.3-1.1.9.9.8 3.9-1.1 6.3l-4.2 5.2-5.4-5.4z"/><path d="M10.2 8.4 4.5 14v3.5H8L13.6 12"/><path d="M5 19.5c-.6 1.6.4 2.6 2 2"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 6.4A6 6 0 0 1 18 17.6"/><path d="M9 6v6M7.5 7.5h3"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M9.8 10h3.2a1.6 1.6 0 0 1 0 3.2h-2.4a1.6 1.6 0 0 0 0 3.2h3.4"/>',
  shield: '<path d="M12 3l7 3v6c0 4.4-2.9 7.7-7 9-4.1-1.3-7-4.6-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  graduation: '<path d="M2.5 9 12 5l9.5 4-9.5 4z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  arrow: '<path d="M19 12H5M11.5 5.5 5 12l6.5 6.5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10.5 11v6M13.5 11v6"/>',
  file: '<path d="M14 3v5h5"/><path d="M19 21V8l-5-5H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/><path d="M8.5 13h7M8.5 17h5"/>',
  paperclip: '<path d="M20 11.5 12.3 19a4.6 4.6 0 0 1-6.5-6.5l7.9-7.9a3.1 3.1 0 0 1 4.4 4.4l-7.9 7.9a1.6 1.6 0 0 1-2.2-2.2l7-7"/>',
  send: '<path d="M21 3 3 10.5l7.5 3 3 7.5z"/><path d="M10.5 13.5 21 3"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
  upload: '<path d="M12 21V9"/><path d="m7.5 13.5 4.5-4.5 4.5 4.5"/><path d="M4 4h16"/>',
  pin: '<path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z"/><path d="M12 15v5"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 18 17"/><path d="M20 5v6h-6"/>'
};

/** أيقونة واحدة بحجم افتراضي مناسب للنصوص والبطاقات. */
export function icon(name, className = 'icon') {
  const paths = PATHS[name] || PATHS.check;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** شعار جوجل الرسمي بألوانه — يُستخدم في زر الدخول فقط (متوافق مع دليل استخدام العلامة). */
export function googleIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
<path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87z"/>
<path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A11.99 11.99 0 0 0 12 24z"/>
<path fill="#FBBC05" d="M5.27 14.29a7.19 7.19 0 0 1 0-4.58V6.62H1.28a12.01 12.01 0 0 0 0 10.76l3.99-3.09z"/>
<path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75z"/>
</svg>`;
}
