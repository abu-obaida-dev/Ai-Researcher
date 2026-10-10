import { PUBLIC_NAV, SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '../constants.js';
import { currentSupportWhatsapp } from '../services/settings.js';
import { formatNumber } from './format.js';
import { icon } from './icons.js';
import { homePathFor, needsOnboarding } from '../middleware/auth.js';

/**
 * قالب HTML مشترك لكل الصفحات المولَّدة على الخادم — بدون أي إطار عمل للواجهة.
 *
 * كل التنسيقات هنا مستخرجة من ملف الهوية الموجود في المجلد public:
 * «Zena AI — الهوية البصرية» + zena-ai-icon.svg + logo1.webp + logo2.webp.
 *
 * الألوان المعتمدة (لوحة الهوية):
 *   Ink Navy   #102A43  اللون الأساسي، العناوين، الشعار
 *   Sea Teal   #0D8E93  الأزرار، الروابط، الحالات النشطة
 *   Fresh Teal #19B5A5  الإبرازات، الأيقونات، الرسومات المساعدة
 *   Mist       #D8F3EF  الخلفيات الخفيفة، البطاقات، الحدود
 *   Paper      #F7FBFC  الخلفية الأساسية
 *   Apricot    #F4A261  الشرارة ونقاط الانتباه (استخدام محدود جداً)
 *   Slate      #526777  النصوص الثانوية
 * النسب المقترحة في الدليل: 55% Paper / 25% Ink Navy / 12% Mist / 6% Teal / 2% Apricot.
 *
 * الخطوط: Manrope (400..800) للحروف اللاتينية والواجهة، وIBM Plex Sans Arabic (400..700)
 * للنص العربي. الخطّان مستضافان محلياً في public/fonts مع تعريفات public/fonts.css
 * (تنزيلهما مرة واحدة بـ node scripts/fetch-fonts.mjs) لتعمل الواجهة بدون أي CDN خارجي.
 */

const APP_NAME = 'Zena AI';
const APP_TAGLINE = 'المشرف البحثي الذكي';

/**
 * نطاق الموقع العام — لازم لوسوم المشاركة (og:url) وملف sitemap.xml.
 * من البيئة، ونستعمل مضيف الطلب إن لم يُضبط (sitemap لا يقبل مسارات نسبية).
 */
const SITE_URL = String(process.env.SITE_URL || '').replace(/\/+$/, '');

/**
 * يحوّل مساراً داخلياً إلى رابط لوسوم المشاركة.
 * مع `SITE_URL` ⇒ رابط مطلق (وهو ما تتطلبه Facebook وWhatsApp وSlack).
 * بدونه ⇒ مسار نسبي (لا يكسر الصفحة، ويصبح مطلقاً فور ضبط النطاق في البيئة).
 */
export function absoluteUrl(pathname = '/') {
  const path = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${pathname}`;
  return `${SITE_URL}${path}`;
}

/** رابط sitemap/robots مطلق دائماً — يشتقّ من الطلب عند غياب SITE_URL. */
export function siteOrigin(req) {
  if (SITE_URL) return SITE_URL;
  if (!req) return '';
  return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
}

/** ملفات الشعار والخطوط كما هي في مجلد public — تُقدَّم كملفات ثابتة من server.js. */
const BRAND = {
  icon: '/zena-ai-icon.svg', // أيقونة التطبيق والـ favicon (الأيقونة الأساسية)
  mark: '/logo2.webp', // الشعار الأساسي: كتاب مفتوح + شرارة + فقاعة حوار
  roundMark: '/logo1.webp', // نسخة دائرية تُستخدم لأيقونة التطبيق
  touchIcon: '/apple-touch-icon.png', // أيقونة لمس بصيغة PNG (المتصفحات لا تدعم webp للأيقونات)
  shareImage: '/logo2.webp', // صورة المشاركة (og:image)
  fonts: '/fonts.css' // تعريفات خطوط الهوية
};

/**
 * روابط السايدبار في لوحة الإدارة (area: 'admin') — مجموعات بأيقونات:
 * الإشراف (نظرة عامة/باحثون/مديرون/أدوار) · المنصة (باقات/استهلاك/مزوّدون) · النظام (إعدادات).
 */
const ADMIN_NAV = [
  {
    label: 'الإشراف',
    items: [
      { href: '/admin', label: 'نظرة عامة', key: 'home', icon: 'sparkles', permission: 'admin:panel' },
      { href: '/admin/users', label: 'الباحثون', key: 'users', icon: 'user', permission: 'admin:users' },
    ]
  },
  {
    label: 'المنصة',
    items: [
      { href: '/admin/plans', label: 'الباقات وصلاحياتها', key: 'plans', icon: 'coins', permission: 'admin:plans' },
      { href: '/admin/library', label: 'المكتبة العلمية', key: 'library', icon: 'book', permission: 'admin:library' },
      { href: '/admin/payments', label: 'طلبات الدفع', key: 'payments', icon: 'coins', permission: 'admin:payments' },
      { href: '/admin/usage', label: 'الاستهلاك', key: 'usage', icon: 'clipboard', permission: 'admin:usage' }
    ]
  },
  {
    label: 'النظام',
    items: [
      // الإعدادات (حدود التخزين + المشرفون) للمدير وحده — لا تُمنح للمشرف بالمعطيات
      { href: '/admin/settings', label: 'الإعدادات', key: 'settings', icon: 'edit', adminOnly: true }
    ]
  }
];

/**
 * روابط الشريط الجانبي في لوحة الباحث (area: 'app').
 * المصدر الواحد لأدوات المستخدم: الإحصائية، مسار البحث، المشرف الذكي، المراجع، المفكرة، ملفاتى، المناقشة.
 * المفتاح service يربط الرابط بخدمة من PLATFORM_SERVICES — ما لا تسمح به باقة الحساب لا يظهر.
 */
const APP_NAV = [
  { href: '/dashboard', label: 'الإحصائية', key: 'dashboard', icon: 'coins' },
  { href: '/journey', label: 'مسار البحث', key: 'journey', icon: 'graduation', service: 'journey' },
  { href: '/references', label: 'المراجع', key: 'references', icon: 'book', service: 'library' },
  { href: '/notes', label: 'المفكرة', key: 'notes', icon: 'list', service: 'notes' },
  { href: '/files', label: 'ملفاتى', key: 'files', icon: 'clipboard', service: 'files' },
  { href: '/defense', label: 'المناقشة', key: 'defense', icon: 'graduation', service: 'defense' },
  { href: '/payments', label: 'الاشتراك والدفع', key: 'payments', icon: 'coins' }
];

/** رابط المشرف الذكي منفصلاً: يُعرض أسفل القائمة وفوق سجل الجلسات (ChatGPT/Claude). */
const APP_CHAT_NAV = { href: '/chat', label: 'المشرف الذكي', key: 'chat', icon: 'message', service: 'chat' };

/**
 * روابط الحساب (legacy): لم تعد تُستخدم في السايدبار — الحساب/الملف البحثي/الخروج
 * في قائمة صورة الحساب بالشريط العلوي (renderUserMenu). تُبقى مُصدَّرة للتوافق فقط.
 */
const APP_ACCOUNT_NAV = [
  { href: '/account', label: 'حسابى والرصيد', key: 'account', icon: 'user' },
  { href: '/onboarding', label: 'ملفي البحثى', key: 'onboarding', icon: 'searchCheck' }
];

/** يمنع حقن HTML عند طباعة أي قيمة قادمة من قاعدة البيانات أو من المستخدم. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLES = `
/* ==== متغيرات الهوية: الألوان المعتمدة أولاً ثم درجات مشتقة منها (تفتيح/تعتيم فقط) ==== */
:root {
  --ink:#102a43; --sea:#0d8e93; --fresh:#19b5a5; --mist:#d8f3ef;
  --paper:#f7fbfc; --apricot:#f4a261; --slate:#526777;

  --ink-05:rgba(16,42,67,.05); --ink-10:rgba(16,42,67,.1);
  --sea-deep:#0a6f73; --mist-soft:#eaf8f6; --apricot-soft:#fdeada;
  --fresh-12:rgba(25,181,165,.12); --fresh-20:rgba(25,181,165,.2);

  --radius:16px; --radius-sm:10px;
  --line:1px solid var(--mist);
  --shadow:0 1px 2px var(--ink-05), 0 10px 26px -20px var(--ink-10);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--paper); color: var(--slate);
  /* Manrope أولاً للاتيني والواجهة، وIBM Plex Sans Arabic يتولى الحروف العربية تلقائياً */
  font-family: "Manrope", "IBM Plex Sans Arabic", "Noto Sans Arabic", system-ui, sans-serif;
  font-size: 14px; font-weight: 400; line-height: 1.7;
}
h1, h2, h3 { margin: 0; color: var(--ink); font-weight: 700; line-height: 1.4; }
p { margin: 0; }
a { color: var(--sea); text-decoration: none; }
a:hover { color: var(--sea-deep); }
:focus-visible { outline: 2px solid var(--fresh); outline-offset: 2px; }
::selection { background: var(--mist); color: var(--ink); }

/* ==== الترويسة: كحلي الحبر (دور الشريط الجانبي في الدليل) مع شرارة مشمشية رفيعة ==== */
.topbar { background: var(--ink); color: #fff; border-bottom: 3px solid var(--apricot); }
.topbar-inner {
  max-width: 1100px; margin: 0 auto; padding: 14px 20px;
  display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
}
.brand { display: flex; align-items: center; gap: 12px; color: #fff; text-decoration: none; }
.brand:hover, .brand:visited { color: #fff; }
/* الأيقونة موضوعة على وسادة بلون Paper للحفاظ على مساحة الأمان ووضوحها فوق الكحلي */
.brand-mark {
  display: grid; place-items: center; flex: 0 0 auto;
  width: 44px; height: 44px; padding: 5px; border-radius: 13px;
  background: var(--paper); box-shadow: 0 0 0 1px var(--fresh-20);
}
.brand-mark img { display: block; width: 100%; height: 100%; }
.brand-text { display: flex; flex-direction: column; gap: 1px; }
.brand-title { font-weight: 800; font-size: 17px; letter-spacing: .01em; line-height: 1.25; }
.brand-sub { font-size: 11px; font-weight: 500; color: var(--mist); line-height: 1.35; }
.nav { display: flex; flex-wrap: wrap; gap: 6px; }
.nav a {
  padding: 7px 13px; border-radius: var(--radius-sm);
  font-size: 12px; font-weight: 600; color: var(--mist); text-decoration: none;
  transition: background .15s ease, color .15s ease;
}
.nav a:hover { background: var(--fresh-20); color: #fff; }
.nav a.active { background: var(--sea); color: #fff; font-weight: 700; }

/* ==== التخطيط العام ==== */
.page { max-width: 1100px; margin: 0 auto; padding: 24px 20px 44px; }
.page-head { margin-bottom: 18px; }
.page-head h1 { font-size: 22px; }
.page-head p { margin-top: 6px; font-size: 12.5px; color: var(--slate); }

/* ==== البطاقات: أبيض على Paper مع حدود Mist ==== */
.card {
  background: #fff; border: var(--line); border-radius: var(--radius);
  padding: 18px; margin-bottom: 16px; box-shadow: var(--shadow);
}
.card h2 { margin-bottom: 12px; font-size: 15px; }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.stat {
  background: #fff; border: var(--line); border-top: 3px solid var(--fresh);
  border-radius: 14px; padding: 14px; box-shadow: var(--shadow);
}
.stat-label { font-size: 11px; font-weight: 500; color: var(--slate); }
.stat-value { margin-top: 4px; font-size: 23px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
/* ==== الجداول ==== */
table { width: 100%; border-collapse: collapse; }
th, td { text-align: right; padding: 10px; border-bottom: 1px solid var(--mist); font-size: 12.5px; vertical-align: top; }
th { background: var(--mist-soft); color: var(--ink); font-size: 11px; font-weight: 700; }
tbody tr:hover { background: var(--paper); }
.muted { color: var(--slate); font-size: 11px; }
.strong { font-weight: 800; color: var(--ink); }

/* ==== الشارات: Mist للنجاح/الخطة، كحلي مخفف للموقوف، والمشمشي للمدير فقط ==== */
.badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.badge-active { background: var(--mist); color: var(--sea-deep); }
.badge-off { background: var(--ink-05); color: var(--slate); }
.badge-admin { background: var(--apricot-soft); color: var(--ink); }
.badge-plan { background: var(--mist-soft); color: var(--ink); }
.badge-error { background: #fdecea; color: #a03024; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.small { font-size: 12px; }

/* ==== عناصر التحكم ==== */
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
input[type=search], input[type=text] {
  padding: 8px 12px; border: var(--line); border-radius: var(--radius-sm);
  background: #fff; color: var(--ink); font-family: inherit; font-size: 12.5px; outline: none;
}
input::placeholder { color: var(--slate); opacity: .7; }
input[type=search]:focus, input[type=text]:focus { border-color: var(--fresh); box-shadow: 0 0 0 3px var(--fresh-12); }
/* القوائم المنسدلة: مظهر موحّد (سهم مرسوم + حدود + تركيز واضح) بدل الشكل الافتراضي للعنصر */
select {
  appearance: none; -webkit-appearance: none;
  padding: 8px 32px 8px 12px; border: var(--line); border-radius: var(--radius-sm);
  background-color: #fff;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23526777' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: left 10px center; background-size: 13px;
  color: var(--ink); font-family: inherit; font-size: 12.5px; font-weight: 600;
  line-height: 1.6; cursor: pointer; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
select:hover { border-color: var(--fresh); }
select:focus { border-color: var(--fresh); box-shadow: 0 0 0 3px var(--fresh-12); }
select option { color: var(--ink); background: #fff; font-weight: 500; }
select:disabled { background-color: var(--mist-soft); color: var(--slate); cursor: not-allowed; }
/* حقول البحث المرفقة بتسمية داخل شريط الأدوات */
.toolbar .field { margin: 0; flex: 1 1 220px; min-width: 0; }
.toolbar .field label { font-size: 11.5px; margin-bottom: 5px; }
.toolbar .field input[type=search], .toolbar .field input[type=text] { width: 100%; padding: 10px 13px; border: 1px solid var(--mist); border-radius: 12px; font-size: 13px; }
.btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 15px;
  border: var(--line); border-radius: var(--radius-sm); background: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink);
  cursor: pointer; text-decoration: none;
  transition: border-color .15s ease, color .15s ease, background .15s ease;
}
.btn:hover { border-color: var(--fresh); color: var(--sea); }
.btn-primary { background: var(--sea); border-color: var(--sea); color: #fff; font-weight: 700; }
.btn-primary:hover { background: var(--sea-deep); border-color: var(--sea-deep); color: #fff; }

/* ==== الرسائل والتنبيهات: خلفية بيضاء مع شرارة مشمشية على الطرف ==== */
.notice {
  border: var(--line); border-inline-start: 4px solid var(--apricot);
  border-radius: var(--radius); background: #fff; padding: 16px 18px; color: var(--slate);
}
.notice h2 { margin-bottom: 8px; font-size: 15px; }
.notice pre {
  margin-top: 10px; padding: 12px; background: var(--paper); border: 1px dashed var(--mist);
  border-radius: var(--radius-sm); color: var(--ink); font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  direction: ltr; text-align: left; white-space: pre-wrap;
}
.empty {
  border: 1px dashed var(--mist); background: var(--paper); border-radius: var(--radius-sm);
  padding: 18px; text-align: center; font-size: 12.5px; color: var(--slate);
}

/* ==== التذييل ==== */
.footer {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  border-top: 1px solid var(--mist); background: #fff; padding: 18px 20px;
  text-align: center; font-size: 11px; color: var(--slate);
}
.footer-brand { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 800; color: var(--ink); }
.footer-brand img { display: block; width: 18px; height: 18px; }

/* ==== الواجهة التعريفية: الشعار + الجملة الافتتاحية ==== */
.hero { background: #fff; border: var(--line); border-radius: 20px; padding: 30px; box-shadow: var(--shadow); }
.hero-top { display: flex; flex-wrap: wrap; align-items: center; gap: 24px; }
.hero-logo { display: block; flex: 0 0 auto; width: 116px; height: 116px; object-fit: contain; }
.hero h1 { font-size: 27px; font-weight: 800; }
.hero .tagline { margin-top: 10px; max-width: 62ch; font-size: 13.5px; color: var(--slate); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
.chips li { background: var(--mist); color: var(--ink); border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; }
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
/* الاقتباسات والمراجع: خلفية Mist كما في الدليل */
.quote { margin-top: 16px; padding: 13px 15px; border-radius: var(--radius-sm); background: var(--mist); color: var(--ink); font-size: 12.5px; font-weight: 500; }

code {
  background: var(--mist-soft); border: 1px solid var(--mist); border-radius: 6px; padding: 1px 6px;
  color: var(--ink); font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
ul { margin: 0; padding-inline-start: 20px; }
li { font-size: 12.5px; color: var(--slate); }

/* مسافات مساعدة تُغني عن الأنماط المضمّنة */
.mt-12 { margin-top: 12px; }
.mt-16 { margin-top: 16px; }
hr, .hr { border: 0; border-top: 1px solid var(--mist); margin: 16px 0; }

/* ==== الأيقونات المضمّنة ==== */
.icon { width: 20px; height: 20px; flex: 0 0 auto; }
.icon-sm { width: 15px; height: 15px; flex: 0 0 auto; }

/* ==== ترويسة وتذييل الصفحة العامة ==== */
.site-header {
  position: sticky; top: 0; z-index: 50;
  background: rgba(255, 255, 255, .93); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--mist);
}
.site-header-inner {
  max-width: 1100px; margin: 0 auto; padding: 12px 20px;
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
}
.site-header .brand-title { color: var(--ink); }
.site-header .brand-sub { color: var(--slate); }
.site-nav { display: flex; gap: 18px; flex-wrap: wrap; }
.site-nav a { font-size: 13px; font-weight: 600; color: var(--slate); }
.site-nav a:hover { color: var(--sea); }
.site-actions { display: flex; align-items: center; gap: 8px; }
.link-quiet { padding: 8px 10px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; color: var(--slate); }
.link-quiet:hover { background: var(--mist-soft); color: var(--sea-deep); }

.site-footer { background: var(--ink); color: var(--mist); }
.footer-grid {
  max-width: 1100px; margin: 0 auto; padding: 42px 20px 26px;
  display: grid; gap: 28px; grid-template-columns: 1.6fr 1fr 1fr;
}
.footer-grid h3 { color: #fff; font-size: 13px; margin-bottom: 12px; }
.footer-grid ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.footer-grid a { color: var(--mist); font-size: 12.5px; opacity: .85; }
.footer-grid a:hover { color: #fff; opacity: 1; }
.footer-logo { display: inline-flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 800; color: #fff; }
.footer-logo img { padding: 3px; border-radius: 8px; background: var(--paper); }
.footer-desc { margin-top: 13px; max-width: 46ch; font-size: 12.5px; line-height: 1.95; opacity: .85; }
.footer-contacts { margin-top: 13px; font-size: 12px; opacity: .8; }
.footer-bottom {
  border-top: 1px solid rgba(216, 243, 239, .18); padding: 13px 20px;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 18px;
}
.footer-copy { font-size: 11px; opacity: .72; }
/* شارة حالة الخدمة في أسفل الفوتر — تشير إلى صفحة /status */
.status-chip {
  display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px;
  border-radius: 999px; background: rgba(216, 243, 239, .12);
  border: 1px solid rgba(216, 243, 239, .26);
  color: #fff; font-size: 11px; font-weight: 700; text-decoration: none;
}
.status-chip:hover { background: rgba(216, 243, 239, .22); color: #fff; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #3ddc97; box-shadow: 0 0 0 3px rgba(61, 220, 151, .22); }

/* ترويسة الموقع على الشاشات الصغيرة: صفّان فقط — (العلامة + الأزرار) ثم روابط قابلة للتمرير */
@media (max-width: 700px) {
  .site-header-inner { gap: 6px 10px; padding: 10px 16px; }
  .site-nav {
    order: 3; width: 100%; flex-wrap: nowrap; gap: 4px;
    overflow-x: auto; scrollbar-width: none; padding-bottom: 2px;
  }
  .site-nav::-webkit-scrollbar { display: none; }
  .site-nav a { white-space: nowrap; padding: 6px 11px; border-radius: 999px; background: var(--mist-soft); font-size: 12.5px; }
  .site-nav a:hover { background: var(--mist); color: var(--sea-deep); }
}

/* ==== أقسام الصفحة العامة ==== */
.slab { padding: 58px 0; background: #fff; border-bottom: 1px solid var(--mist); }
.slab-alt { background: var(--mist-soft); }
.slab-inner { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
.slab-inner.narrow { max-width: 780px; }
.center { max-width: 62ch; margin: 0 auto; text-align: center; }
.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--sea); }
.section-title { margin-top: 10px; font-size: 26px; }
.section-lead { margin-top: 12px; font-size: 13.5px; line-height: 1.95; color: var(--slate); }

/* ==== القسم البطولي ==== */
.landing-hero { position: relative; overflow: hidden; background: #fff; border-bottom: 1px solid var(--mist); }
.landing-hero::after {
  content: ""; position: absolute; inset-inline-end: -140px; top: -150px; width: 340px; height: 340px;
  border-radius: 50%; background: var(--apricot-soft); opacity: .6; filter: blur(60px);
}
.hero-grid {
  position: relative; max-width: 1100px; margin: 0 auto; padding: 56px 20px;
  display: grid; gap: 36px; grid-template-columns: 1.05fr .95fr; align-items: center;
}
.eyebrow-pill {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 999px;
  background: var(--mist); color: var(--sea-deep); font-size: 11.5px; font-weight: 700;
}
.hero-copy h1 { margin-top: 18px; font-size: 34px; font-weight: 800; line-height: 1.45; }
.hero-copy .lead { margin-top: 16px; max-width: 56ch; font-size: 14.5px; line-height: 1.95; color: var(--slate); }
.hero-actions { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 10px; }
.accent { color: var(--sea); }
/* تدرّج تركوازي للكلمة المفتاحية في العنوان (مع بقاء لون احتياطي إن لم يُدعم background-clip) */
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .accent {
    background: linear-gradient(120deg, var(--sea) 5%, var(--fresh) 95%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }
}
.checklist { margin-top: 22px; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px 20px; }
.checklist li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--slate); }
.checklist li::before {
  content: "✓"; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
  background: var(--mist); color: var(--sea-deep); font-size: 11px; font-weight: 800;
}

/* ==== بطاقة المحادثة التوضيحية في الهيرو ==== */
/* الأسماء مسبوقة بـ hero- حصراً حتى لا تتقاطع مع قواعد شات التطبيق (.chat-card/.chat-body/.bubble)
   التي تُعرَّف لاحقاً وتسبّبت بارتفاع بطاقة تساوي 70vh على الموبايل وتبديل ألوان الفقاعات. */
.hero-visual { position: relative; }
.hero-visual::before {
  content: ""; position: absolute; z-index: 0;
  inset-inline-start: -14px; bottom: -18px; width: 120px; height: 120px;
  border-radius: 50%; background: var(--mist); opacity: .7;
}
.hero-chat {
  position: relative; z-index: 1;
  background: #fff; border: 1px solid var(--mist); border-radius: 22px; padding: 18px;
  box-shadow: 0 26px 60px -36px var(--ink-10);
}
.hero-chat-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 13px; border-bottom: 1px solid var(--mist); }
.hero-chat-agent { display: flex; align-items: center; gap: 10px; }
.hero-chat-agent img { padding: 3px; border-radius: 10px; background: var(--paper); }
.hero-chat-agent b { display: block; font-size: 13px; color: var(--ink); }
.hero-chat-agent em { display: block; font-size: 11px; font-weight: 700; font-style: normal; color: var(--sea); }
.hero-chat-pill { padding: 5px 11px; border-radius: 999px; background: var(--mist-soft); color: var(--ink); font-size: 11px; font-weight: 700; }
.hero-chat-body { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; }
.hero-bubble-user { margin-inline-start: auto; max-width: 88%; padding: 10px 14px; border-radius: 16px; background: var(--sea); color: #fff; font-size: 12.5px; line-height: 1.85; }
.hero-bubble-ai { margin-inline-end: auto; max-width: 94%; padding: 12px 14px; border-radius: 16px; background: var(--mist-soft); color: var(--ink); font-size: 12.5px; line-height: 1.95; }
.hero-bubble-ai strong { display: block; margin-bottom: 6px; }
.typing { margin-inline-end: auto; display: flex; gap: 5px; width: fit-content; padding: 12px 14px; border-radius: 14px; background: var(--mist-soft); }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--slate); opacity: .4; animation: zena-blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .18s; }
.typing span:nth-child(3) { animation-delay: .36s; }
@keyframes zena-blink {
  0%, 100% { opacity: .25; transform: translateY(0); }
  50% { opacity: .85; transform: translateY(-3px); }
}

.hero-stats { position: relative; border-top: 1px solid var(--mist); background: var(--paper); }
.hero-stats-inner { max-width: 1100px; margin: 0 auto; padding: 22px 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
/* بطاقات الأرقام الثلاث — نمط البطاقات نفسه المستخدم في لوحة التحكم */
.stat-cell {
  background: #fff; border: 1px solid var(--mist); border-radius: 16px;
  padding: 16px 14px; text-align: center; box-shadow: var(--shadow);
  transition: transform .18s ease, border-color .18s ease;
}
.stat-cell:hover { transform: translateY(-2px); border-color: var(--fresh); }
.stat-cell b { display: block; font-size: 24px; font-weight: 800; color: var(--sea); }
.stat-cell span { font-size: 12px; font-weight: 600; color: var(--slate); }

/* ==== بطاقات المميزات والخطوات ==== */
.feature-grid { margin-top: 34px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.feature-card {
  background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 22px;
  box-shadow: var(--shadow);
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.feature-card:hover { transform: translateY(-3px); border-color: var(--fresh); box-shadow: 0 24px 42px -32px var(--ink-10); }
.feature-icon {
  display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px;
  background: var(--mist-soft); color: var(--sea);
}
/* تنوع لوني بين رقائق الأيقونات: زوجي = مشمشي ناعم بدل التركوازي المتكرر */
.feature-card:nth-child(even) .feature-icon { background: var(--apricot-soft); color: var(--ink); }
.feature-card h3 { margin-top: 14px; font-size: 15px; }
.feature-card p { margin-top: 8px; font-size: 12.5px; line-height: 1.95; color: var(--slate); }

/* ==== إضافات الصفحة الرئيسية: شعار الهيرو + الشعار النصي + الخدمات + بطاقات الجمهور ==== */
.hero-logo { display: block; height: 52px; width: auto; margin-bottom: 18px; }
.hero-slogan { margin-top: 12px; font-size: 15px; font-weight: 800; color: var(--sea-deep); }
.service-grid { margin-top: 34px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.service-card {
  background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 22px; box-shadow: var(--shadow);
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.service-card:hover { transform: translateY(-3px); border-color: var(--fresh); box-shadow: 0 24px 42px -32px var(--ink-10); }
.service-card h3 { margin-top: 14px; font-size: 15px; }
.service-card p { margin-top: 8px; font-size: 12.5px; line-height: 1.95; color: var(--slate); }
.services-cta { margin-top: 30px; }
.split-band { margin-top: 34px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.info-card { background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 24px; box-shadow: var(--shadow); }
.info-card h3 { display: flex; align-items: center; gap: 9px; font-size: 15px; }
.info-card h3 svg { color: var(--sea); }
.info-list { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
.info-list li { position: relative; padding-inline-start: 24px; font-size: 12.5px; line-height: 1.95; color: var(--slate); }
.info-list li::before {
  content: "✓"; position: absolute; inset-inline-start: 0; top: 2px; width: 17px; height: 17px;
  display: grid; place-items: center; border-radius: 50%; background: var(--mist);
  color: var(--sea-deep); font-size: 10px; font-weight: 800;
}

.steps-grid { margin-top: 40px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.step-card { position: relative; background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 26px 22px 22px; box-shadow: var(--shadow); }
/* شارة الرقم في خطوات «كيف تعمل» — مسبوقة بـ step- بدل step-number المتصادمة مع شارة رحلة المستخدم */
.step-badge {
  position: absolute; top: -15px; inset-inline-end: 22px; display: grid; place-items: center;
  width: 32px; height: 32px; border-radius: 50%; background: var(--sea); color: #fff; font-size: 13px; font-weight: 800;
  box-shadow: 0 6px 14px -8px var(--sea-deep);
}
.step-card h3 { margin-top: 14px; font-size: 15px; }
.step-card p { margin-top: 8px; font-size: 12.5px; line-height: 1.95; color: var(--slate); }

/* ==== بطاقات الباقات ==== */
.plans { margin-top: 36px; display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
.plan {
  position: relative; display: flex; flex-direction: column; background: #fff;
  border: 1px solid var(--mist); border-radius: 20px; padding: 26px 20px 20px;
  box-shadow: var(--shadow);
}
/* الباقة المميزة: حدود تركوازية + تدرّج خفيف في الخلفية لتمييزها عن الأخريات */
.plan.featured {
  border-color: var(--fresh);
  background: linear-gradient(180deg, var(--mist-soft), #fff 46%);
  box-shadow: 0 28px 52px -36px var(--ink-10);
}
.plan-flag {
  position: absolute; top: -13px; inset-inline-end: 20px; padding: 4px 12px; border-radius: 999px;
  background: var(--sea); color: #fff; font-size: 11px; font-weight: 700;
}
.plan h3 { font-size: 16px; }
.plan .tagline { margin-top: 6px; min-height: 40px; font-size: 12.5px; line-height: 1.8; color: var(--slate); }
.plan-price { margin-top: 16px; display: flex; align-items: baseline; gap: 6px; }
.plan-price b { font-size: 28px; font-weight: 800; color: var(--ink); }
.plan-price span { font-size: 12px; font-weight: 700; color: var(--slate); }
.plan-period { margin-top: 4px; font-size: 11px; font-weight: 600; color: var(--slate); }
.plan-tokens {
  margin-top: 14px; display: inline-flex; align-items: center; gap: 6px; width: fit-content;
  padding: 6px 12px; border-radius: 12px; background: var(--mist-soft); color: var(--ink); font-size: 11.5px; font-weight: 800;
}
.plan-storage {
  margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; width: fit-content;
  padding: 6px 12px; border-radius: 12px; background: var(--mist-soft); color: var(--sea-deep); font-size: 11.5px; font-weight: 800;
}
.plan-features { margin: 20px 0 0; padding: 0; list-style: none; display: flex; flex: 1; flex-direction: column; gap: 10px; }
.plan-features li { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.85; color: var(--slate); }
.plan-features li::before { content: "✓"; font-weight: 800; color: var(--fresh); }
.plan .btn { margin-top: 20px; justify-content: center; }
.plans-note { margin-top: 18px; text-align: center; font-size: 12.5px; line-height: 1.95; color: var(--slate); }
.plans-note a { font-weight: 700; }

/* ==== الأسئلة الشائعة ==== */
.faq-list { margin-top: 30px; display: flex; flex-direction: column; gap: 10px; }
.faq-item {
  background: #fff; border: 1px solid var(--mist); border-radius: 16px; padding: 16px 18px;
  box-shadow: var(--shadow);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.faq-item:hover { border-color: var(--fresh); box-shadow: 0 18px 34px -28px var(--ink-10); }
.faq-item[open] { border-color: var(--fresh); }
.faq-item summary {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer;
  list-style: none; font-size: 13.5px; font-weight: 700; color: var(--ink);
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::after { content: "▾"; color: var(--sea); transition: transform .15s ease; }
.faq-item[open] summary::after { transform: rotate(180deg); }
.faq-item p { margin-top: 12px; font-size: 12.5px; line-height: 2; color: var(--slate); }

/* ==== شريط الدعوة ==== */
/* خلفية كحلية بعمق بصري: شرارتا teal/مشمشي مموّهتان خلف المحتوى */
.cta-band { position: relative; overflow: hidden; background: var(--ink); color: #fff; }
.cta-band::after {
  content: ""; position: absolute; inset-inline-start: -110px; bottom: -140px;
  width: 300px; height: 300px; border-radius: 50%;
  background: var(--sea); opacity: .3; filter: blur(60px);
}
.cta-band::before {
  content: ""; position: absolute; inset-inline-end: 12%; top: -130px;
  width: 250px; height: 250px; border-radius: 50%;
  background: var(--apricot); opacity: .14; filter: blur(55px);
}
.cta-inner {
  position: relative; z-index: 1;
  max-width: 1100px; margin: 0 auto; padding: 48px 20px;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px;
}
.cta-inner h2 { color: #fff; font-size: 24px; }
.cta-inner p { margin-top: 10px; max-width: 52ch; font-size: 13px; line-height: 1.95; color: var(--mist); }
.cta-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.btn-light { background: #fff; border-color: #fff; color: var(--sea-deep); font-weight: 700; }
.btn-light:hover { background: var(--mist); border-color: var(--mist); color: var(--ink); }
.btn-ghost-light { background: transparent; border-color: rgba(216, 243, 239, .45); color: #fff; font-weight: 700; }
.btn-ghost-light:hover { background: var(--fresh-20); border-color: var(--fresh); color: #fff; }

/* ==== صفحات الدخول والتسجيل ==== */
.auth-split { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
.auth-aside {
  position: relative; overflow: hidden; display: flex; flex-direction: column;
  justify-content: space-between; gap: 30px; padding: 44px; background: var(--ink); color: #fff;
}
.auth-aside::after {
  content: ""; position: absolute; inset-inline-start: -110px; bottom: -130px; width: 300px; height: 300px;
  border-radius: 50%; background: var(--fresh-20); filter: blur(70px);
}
.aside-brand {
  position: relative; display: inline-flex; align-items: center; gap: 10px; width: fit-content;
  padding: 8px 12px; border-radius: 14px; background: rgba(255, 255, 255, .06); font-size: 15px; font-weight: 800;
}
.aside-brand img { padding: 3px; border-radius: 8px; background: var(--paper); }
.aside-copy { position: relative; }
.auth-aside h2 { color: #fff; font-size: 26px; line-height: 1.55; }
.auth-benefits { margin-top: 26px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px; }
.auth-benefits li { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--mist); }
.auth-benefits .feature-icon { background: rgba(255, 255, 255, .08); color: var(--fresh); }
.auth-aside small { position: relative; font-size: 11.5px; color: var(--mist); opacity: .75; }
.auth-form-side { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 40px 20px; background: var(--paper); }
.auth-card { width: 100%; max-width: 440px; background: #fff; border: 1px solid var(--mist); border-radius: 24px; padding: 30px; box-shadow: var(--shadow); }
.auth-card h1 { font-size: 20px; }
.auth-card .lead { margin-top: 10px; font-size: 13px; line-height: 1.95; color: var(--slate); }
.google-btn {
  margin-top: 22px; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;
  padding: 13px 16px; border: 1px solid var(--mist); border-radius: 14px; background: #fff;
  font-family: inherit; font-size: 13.5px; font-weight: 700; color: var(--ink); text-decoration: none;
  transition: border-color .15s ease, background .15s ease;
}
.google-btn:hover { border-color: var(--fresh); background: var(--mist-soft); color: var(--ink); }
.google-btn svg { width: 20px; height: 20px; }
.auth-note { margin-top: 18px; text-align: center; font-size: 11.5px; line-height: 1.95; color: var(--slate); }
.auth-links { margin-top: 20px; text-align: center; font-size: 12.5px; font-weight: 600; }
.alert {
  margin-top: 18px; padding: 13px 15px; border: 1px solid var(--mist); border-inline-start: 4px solid var(--apricot);
  border-radius: 14px; background: #fff; color: var(--ink); font-size: 12.5px; line-height: 1.95;
}
.alert ul { margin-top: 6px; }

/* ==== زر واتساب العائم (دعم فني) ==== */
/* مثبّت أسفل الشاشة، لا يغطي المحتوى، ويختفي نصّه على الشاشات الضيقة */
.wa-float {
  position: fixed;
  inset-block-end: 18px;
  inset-inline-start: 18px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 15px;
  border-radius: 999px;
  background: #128C7E;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  box-shadow: 0 6px 18px rgba(18, 140, 126, 0.32);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.wa-float:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(18, 140, 126, 0.38); }
.wa-float:focus-visible { outline: 2px solid var(--sea); outline-offset: 2px; }
.wa-float-icon { width: 20px; height: 20px; }
@media (max-width: 560px) {
  .wa-float { inset-block-end: 14px; inset-inline-start: 14px; padding: 11px; }
  .wa-float-label { display: none; }
}

/* ==== الإشعارات: جرس الترويسة + قائمة الإشعارات داخل الموقع ==== */
.nav-bell {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 12px; border: 1px solid var(--mist);
  background: #fff; color: var(--ink); cursor: pointer; font-family: inherit; padding: 0;
  transition: background .15s ease, border-color .15s ease;
}
.nav-bell:hover { background: var(--mist-soft); border-color: var(--fresh); }
.nav-bell-badge {
  position: absolute; top: -6px; inset-inline-start: -6px; min-width: 18px; height: 18px;
  padding: 0 5px; border-radius: 999px; background: var(--apricot); color: var(--ink);
  font-size: 10px; font-weight: 800; line-height: 18px; text-align: center;
}
.nav-bell-badge[hidden] { display: none; }
button.btn:disabled { opacity: .55; cursor: not-allowed; }

/* ==== نماذج الملف البحثي ==== */
.onboarding-grid { display: grid; gap: 18px; grid-template-columns: 1.6fr 1fr; align-items: start; }
.onboarding-standalone { max-width: 980px; margin: 0 auto; padding: 34px 20px 48px; }
.onboarding-standalone .page-head { text-align: center; margin-bottom: 20px; }
.onboarding-aside { display: grid; gap: 14px; }
.form-card { background: #fff; border: 1px solid var(--mist); border-radius: 20px; padding: 26px; }
.form-section { margin-top: 24px; padding-top: 22px; border-top: 1px solid var(--mist); }
.form-section.first { margin-top: 0; padding-top: 0; border-top: 0; }
.form-section h2 { font-size: 14px; }
.form-hint { margin-top: 6px; font-size: 11.5px; color: var(--slate); }
.choices { margin-top: 14px; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.choice { position: relative; display: block; }
.choice input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.choice span {
  display: block; padding: 12px 14px; border: 1px solid var(--mist); border-radius: 14px; background: #fff;
  color: var(--slate); font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: border-color .15s ease, background .15s ease, color .15s ease;
}
.choice span:hover { border-color: var(--fresh); }
.choice input:checked + span { border-color: var(--sea); background: var(--mist-soft); color: var(--sea-deep); box-shadow: inset 0 0 0 1px var(--sea); }
.choice input:focus-visible + span { outline: 2px solid var(--fresh); outline-offset: 2px; }
.field { margin-top: 16px; }
.field label, .field-label { display: block; margin-bottom: 7px; font-size: 12.5px; font-weight: 700; color: var(--ink); }
.field input[type=text], .field input[type=number], .field input[type=email],
.field input[type=date], .field input[type=password], .field select, .field textarea {
  width: 100%; padding: 11px 13px; border: 1px solid var(--mist); border-radius: 12px; background: #fff;
  color: var(--ink); font-family: inherit; font-size: 13px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.field textarea { min-height: 88px; line-height: 1.8; resize: vertical; }
.field input[type=text]:focus, .field input[type=number]:focus, .field input[type=email]:focus,
.field input[type=date]:focus, .field input[type=password]:focus,
.field select:focus, .field textarea:focus { border-color: var(--fresh); box-shadow: 0 0 0 3px var(--fresh-12); }

/* منتقي ملف مخصّص: input مخفي + label منسّق يدعم السحب والإفلات */
.file-picker { position: relative; }
.file-picker-input {
  position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; margin: 0;
}
.file-picker-label {
  display: flex; align-items: center; gap: 13px; margin: 0; padding: 16px;
  border: 1.5px dashed var(--mist); border-radius: 14px; background: var(--mist-soft);
  cursor: pointer; transition: border-color .15s ease, background .15s ease;
}
.file-picker-label:hover { border-color: var(--sea); background: #fff; }
.file-picker-input:focus-visible + .file-picker-label { outline: 2px solid var(--fresh); outline-offset: 2px; }
.file-picker-input.dragging + .file-picker-label { border-color: var(--sea); background: var(--fresh-12); border-style: solid; }
.file-picker-icon {
  flex: 0 0 auto; width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center;
  background: #fff; color: var(--sea); border: 1px solid var(--mist);
}
.file-picker-text { display: grid; gap: 2px; flex: 1 1 auto; min-width: 0; }
.file-picker-title { font-size: 13.5px; color: var(--ink); }
.file-picker-hint { font-size: 11.5px; color: var(--slate); font-weight: 500; }
.file-picker-btn {
  flex: 0 0 auto; padding: 7px 14px; border-radius: 999px; background: var(--ink); color: #fff;
  font-size: 12px; font-weight: 700;
}
.file-picker-name {
  margin: 8px 0 0; padding: 8px 12px; border-radius: 10px; background: var(--fresh-12);
  color: var(--sea-deep); font-size: 12px; font-weight: 700; word-break: break-all;
}
.file-picker-name:empty { display: none; }

/* شريط مساحة المستخدم (صفحة «ملفاتى») */
.file-viewer { display: grid; gap: 14px; grid-template-columns: 280px minmax(0, 1fr); align-items: start; }
.file-viewer-info .file-meta { margin: 12px 0 16px; }
.file-viewer-stage { min-width: 0; padding: 10px; }
.file-preview { border-radius: 12px; overflow: hidden; }
.file-preview--image { background: var(--mist-soft); text-align: center; padding: 10px; }
.file-preview--image img {
  max-width: 100%; max-height: 78vh; width: auto; border-radius: 8px; display: inline-block;
  box-shadow: var(--shadow);
}
.file-preview--pdf { background: var(--ink-05); }
.file-preview--pdf iframe { width: 100%; height: 78vh; border: 0; border-radius: 8px; background: #fff; display: block; }
.file-preview--text {
  margin: 0; max-height: 78vh; overflow: auto; padding: 16px; background: #fbfdfe;
  border: 1px solid var(--mist); border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere;
  font-size: 12.5px; line-height: 1.9; color: var(--ink);
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
}
/* معاينة جدول بيانات (xlsx/csv) */
.file-preview--sheet { display: grid; gap: 10px; }
.sheet-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.sheet-tab {
  padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  background: var(--mist-soft); color: var(--ink-70); border: 1px solid transparent;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sheet-tab.is-active { background: var(--ink); color: var(--paper); }
.sheet-panel { display: none; }
.sheet-panel:target { display: block; }
.file-preview--sheet .sheet-panel:first-of-type { display: block; }
.sheet-wrap {
  max-height: 72vh; overflow: auto; border: 1px solid var(--mist); border-radius: 10px;
  background: #fff;
}
.sheet-table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: 12.5px; }
.sheet-table th, .sheet-table td {
  padding: 8px 12px; border-bottom: 1px solid var(--mist); border-left: 1px solid var(--mist);
  text-align: start; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
}
.sheet-table th { background: var(--mist-soft); font-weight: 700; position: sticky; top: 0; z-index: 1; }
.sheet-table td.is-empty { background: var(--mist-soft); }
.sheet-table tr:hover td { background: var(--mist-soft); }
.sheet-table tr:nth-child(even) td { background: rgba(15, 40, 62, 0.02); }

@media (max-width: 900px) {
  .file-viewer { grid-template-columns: minmax(0, 1fr); }
  .file-preview--pdf iframe { height: 62vh; }
  .sheet-wrap { max-height: 62vh; }
}

/* ---- شريط الوضع + إرفاق الملفات في صفحة الشات ---- */
.chat-modebar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 12px; margin: 0 0 8px; border-radius: 10px;
  background: var(--mist-soft); color: var(--slate); font-size: 12px; font-weight: 600;
}
.chat-modebar span { display: inline-flex; align-items: center; gap: 6px; }
.chat-modebar.is-defense { background: rgba(15, 40, 62, 0.08); color: var(--ink); }

/* نتائج أداة المراجع: لوحة قابلة للطي فوق صندوق الكتابة — لا تغطي الحوار أبداً.
   مطويّة افتراضياً، وعند الفتح لها تمرير داخلي بارتفاع محدود. */
.chat-refs {
  flex: 0 0 auto; max-height: 34vh; overflow-y: auto; margin: 0 0 8px;
  padding: 8px 10px; border: 1px solid var(--mist); border-radius: 14px; background: var(--mist-soft);
}
.chat-refs > summary {
  display: flex; align-items: center; gap: 7px; cursor: pointer; list-style: none;
  font-size: 12px; font-weight: 800; color: var(--ink);
}
.chat-refs > summary::-webkit-details-marker { display: none; }
.chat-refs > summary::after { content: '▾'; margin-inline-start: auto; color: var(--sea); font-size: 11px; }
.chat-refs[open] > summary::after { content: '▴'; }
.chat-refs > summary:hover { color: var(--sea-deep); }
.chat-refs .chat-refs-hint { margin: 6px 0 8px; font-size: 10.5px; color: var(--slate); }
.ref-found-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.ref-found {
  display: flex; flex-direction: column; gap: 2px; padding: 8px 10px;
  border-radius: 10px; background: #fff; border: 1px solid var(--mist);
}
.ref-found b { font-size: 11.5px; line-height: 1.7; color: var(--ink); }
.ref-found-meta { font-size: 10.5px; color: var(--slate); }
.ref-found-links { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; font-weight: 700; margin-top: 2px; }
.ref-found-links a { color: var(--sea); }
.ref-found.is-library { border-inline-start: 3px solid var(--sea); }

/* بطاقة مراجعة اكتمال الخطوة: تُدرَج داخل الحوار بعد آخر رد، قراءة أولاً
   بزرَي تعديل/إلغاء، ووضع التعديل يستبدلها بنموذج حقول بلا جافاسكربت. */
.step-review {
  flex: 0 0 auto; margin: 8px 0; padding: 12px 14px;
  border: 1px solid #bfe3cf; border-radius: 14px;
  background: linear-gradient(180deg, #f4fbf7, #fff 70%);
}
.sr-head { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink); margin-bottom: 4px; }
.sr-head svg { color: #2f9e6d; }
.sr-hint { margin: 0 0 8px; font-size: 10.5px; color: var(--slate); }
.sr-list { display: grid; gap: 6px; margin: 0 0 10px; }
.sr-list > div { display: grid; grid-template-columns: minmax(90px, 150px) 1fr; gap: 8px; align-items: start; }
.sr-list dt { font-size: 11px; font-weight: 800; color: var(--slate); }
.sr-list dd { margin: 0; font-size: 12px; color: var(--ink); line-height: 1.7; word-break: break-word; }
.sr-form { display: grid; gap: 8px; margin-bottom: 4px; }
.sr-field { display: grid; gap: 4px; }
.sr-field span { font-size: 11px; font-weight: 800; color: var(--slate); }
.sr-field input {
  width: 100%; padding: 7px 10px; border: 1px solid var(--mist); border-radius: 9px;
  font: inherit; font-size: 12px; background: #fff; color: var(--ink);
}
.sr-field input:focus { outline: 2px solid rgba(13, 142, 147, 0.25); border-color: var(--sea); }
.sr-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

.chat-attach {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 12px; border-top: 1px solid var(--mist); background: var(--mist-soft);
}
.chat-attach-label { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--slate); font-weight: 600; }
.chat-attach-chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 190px;
  padding: 3px 9px; border-radius: 999px; cursor: pointer;
  background: var(--paper); border: 1px solid var(--mist);
  font-size: 11.5px; color: var(--ink-70);
}
.chat-attach-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-attach-chip input { margin: 0; accent-color: var(--sea); }
.chat-attach-chip .attach-name { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attach-tag {
  font-size: 9.5px; font-weight: 800; padding: 1px 5px; border-radius: 5px; flex: 0 0 auto;
}
.attach-tag.is-ok { background: var(--mist); color: var(--sea-deep); }
.attach-tag.is-off { background: #f1f3f6; color: #8a97a6; }
.chat-attach-chip:has(input:checked) { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.chat-attach-hint { font-size: 11px; color: var(--slate); margin-inline-start: auto; }

.storage-bar { display: grid; gap: 7px; }
.storage-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.storage-head b { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink); }
.storage-head span { font-size: 12.5px; font-weight: 800; color: var(--sea-deep); }
.storage-bar .meter { margin: 0; }
.storage-bar.is-near .meter i { background: linear-gradient(90deg, #f4a261, #e07a3f); }
.storage-bar.is-near .storage-head span { color: #b4651f; }
.storage-bar.is-full .meter i { background: linear-gradient(90deg, #d64545, #a12d2d); }
.storage-bar.is-full .storage-head span { color: #a12d2d; }
.storage-bar .meter i { background: linear-gradient(90deg, var(--fresh), var(--sea)); }
.field-row { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.form-actions { margin-top: 26px; display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }

/* ==== صفحة الحساب ==== */
/* نفس شبكة الإحصائية: بطاقة عريضة أعلى + بطاقتان جنباً إلى جنب + عمود واحد على الجوال */
.account-grid { display: grid; gap: 16px; grid-template-columns: 1.4fr 1fr; }
.account-grid > .card.full { grid-column: 1 / -1; }
.account-hero { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; }
.account-hero h2 { font-size: 18px; }
.account-meta { display: grid; gap: 7px; min-width: 0; }
.account-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-start; max-width: 100%; }
/* شارة الدور بجانب الاسم — أوضح من سطر «باحث · عضو منذ» المختلط */
.role-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 11px; border-radius: 999px;
  background: var(--mist-soft); border: 1px solid var(--mist); color: var(--sea-deep);
  font-size: 11.5px; font-weight: 700; white-space: nowrap;
}
.role-chip.is-admin { background: var(--ink); border-color: var(--ink); color: #fff; }
.id-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.id-meta .muted { margin: 0; }
/* ==== الإحصائية (الصفحة الرئيسية للوحة الباحث) ==== */
.dash-grid { display: grid; gap: 16px; grid-template-columns: 1.4fr 1fr; }
.dash-grid .card h2 { font-size: 15px; }
.dash-welcome { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; }
.dash-welcome h2 { font-size: 18px; }
.id-card { display: flex; align-items: center; gap: 16px; }
.avatar {
  display: grid; place-items: center; width: 58px; height: 58px; border-radius: 18px;
  background: var(--mist); color: var(--sea-deep); font-size: 20px; font-weight: 800; object-fit: cover;
}
.id-card h2 { font-size: 17px; }
.id-card p { margin-top: 4px; font-size: 12.5px; }
.balance { margin-top: 6px; font-size: 30px; font-weight: 800; color: var(--ink); }
.balance span { font-size: 12px; font-weight: 600; color: var(--slate); }
.meter { margin-top: 10px; height: 10px; border-radius: 999px; background: var(--mist-soft); overflow: hidden; }
.meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--fresh), var(--sea)); }
.kv { margin-top: 16px; display: grid; gap: 10px; }
.kv div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-bottom: 9px; border-bottom: 1px dashed var(--mist); font-size: 12.5px; }
.kv dt { font-weight: 600; color: var(--slate); }
.kv dd { margin: 0; font-weight: 700; color: var(--ink); text-align: end; }

/* شريط مؤشرات الإحصائية (KPIs) */
.stat-grid { grid-column: 1 / -1; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); }
.stat-card {
  display: flex; align-items: center; gap: 12px; padding: 15px 17px;
  background: #fff; border: 1px solid var(--mist); border-radius: 18px; box-shadow: var(--shadow);
}
.stat-icon {
  display: grid; place-items: center; flex: 0 0 auto; width: 40px; height: 40px;
  border-radius: 13px; background: var(--mist-soft); color: var(--sea-deep);
}
.stat-label { font-size: 12px; font-weight: 600; color: var(--slate); }
.stat-value { font-size: 21px; font-weight: 800; color: var(--ink); line-height: 1.35; }
.stat-hint { margin-top: 2px; font-size: 11px; color: var(--slate); opacity: .92; }
.dash-hello { display: grid; gap: 7px; min-width: 0; }
.dash-side { display: grid; gap: 12px; justify-items: start; max-width: 100%; }
.dash-side .chips { margin: 0; justify-content: flex-start; }

/* مخططات الإحصائية: أعمدة + دائري (CSS خالص، بلا مكتبات ولا سكربتات) */
.dash-grid > .card.full { grid-column: 1 / -1; }
.chart-card { align-self: start; }
.chart-total { font-size: 11.5px; font-weight: 700; color: var(--sea-deep); white-space: nowrap; }
.bars { display: flex; align-items: flex-end; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.bar-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bar-value { font-size: 11px; font-weight: 700; color: var(--ink); }
.bar-value.is-empty { color: var(--slate); opacity: .5; }
.bar-track {
  width: 100%; height: 132px; display: flex; flex-direction: column; justify-content: flex-end;
  background: var(--mist-soft); border-radius: 10px; overflow: hidden;
}
.bar-fill {
  display: block; width: 100%; height: 0; border-radius: 10px;
  background: linear-gradient(180deg, var(--fresh), var(--sea));
}
.bar-label { font-size: 10.5px; font-weight: 600; color: var(--slate); }
/* عمود اليوم الحالي: أوضح بصرياً حتى يُعرف اتجاه الزمن في المخطط (RTL: الأقدم يميناً) */
.bar-col.is-today .bar-label { color: var(--sea-deep); font-weight: 800; }
.bar-col.is-today .bar-track { box-shadow: inset 0 0 0 1px var(--fresh-20); }

.donut-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 22px; margin-top: 14px; }
.donut { position: relative; flex: 0 0 auto; width: 148px; height: 148px; border-radius: 50%; }
.donut-hole {
  position: absolute; inset: 26%; border-radius: 50%; background: #fff;
  display: grid; place-items: center; align-content: center; text-align: center; line-height: 1.3;
}
.donut-hole b { display: block; font-size: 18px; color: var(--ink); }
.donut-hole em { font-size: 10px; font-style: normal; color: var(--slate); }
.legend { flex: 1 1 205px; min-width: 0; list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.legend-dot { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; }
.legend-label { color: var(--ink); font-weight: 600; }
.legend-value { margin-inline-start: auto; color: var(--slate); font-weight: 700; white-space: nowrap; }

.mini-stats { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
.mini-stats li { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.mini-icon {
  display: grid; place-items: center; flex: 0 0 auto; width: 30px; height: 30px;
  border-radius: 10px; background: var(--mist-soft); color: var(--sea-deep);
}
.mini-stats b { color: var(--ink); font-size: 15px; font-weight: 800; }
.mini-label { color: var(--slate); }
.mini-note { margin-top: 12px; display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--slate); }

@media (max-width: 900px) {
  .hero-grid { grid-template-columns: 1fr; padding: 40px 20px; }
  .hero-copy h1 { font-size: 28px; }
  .onboarding-grid, .account-grid, .dash-grid { grid-template-columns: 1fr; }
  .footer-grid { grid-template-columns: 1fr 1fr; }
  .auth-split { grid-template-columns: 1fr; }
  .auth-aside { display: none; }
  .slab { padding: 44px 0; }
}
@media (max-width: 560px) {
  .hero-stats-inner { grid-template-columns: 1fr; gap: 10px; }
  .footer-grid { grid-template-columns: 1fr; }
  .section-title { font-size: 21px; }
  .hero-copy h1 { font-size: 24px; }
}

@media (max-width: 560px) {
  .topbar-inner { padding: 12px 16px; }
  .page { padding: 20px 16px 36px; }
  .hero { padding: 22px; }
  .hero h1 { font-size: 22px; }
  .hero-logo { width: 84px; height: 84px; }
}

/* ==== لوحة الباحث (area: 'app'): شريط علوي مضغوط + شريط جانبي يسار ==== */
.app-top { position: sticky; top: 0; z-index: 60; background: var(--ink); color: #fff; border-bottom: 2px solid var(--apricot); }
.app-top-inner { max-width: 1400px; margin: 0 auto; padding: 7px 16px; display: flex; align-items: center; gap: 10px; }
.app-top .brand { gap: 9px; }
.app-top .brand-mark { width: 34px; height: 34px; padding: 4px; border-radius: 11px; }
.app-top .brand-title { font-size: 15px; }
.app-top .brand-sub { font-size: 10px; }
.app-top-spacer { flex: 1; }
.app-top-actions { display: flex; align-items: center; gap: 8px; }
.icon-btn {
  position: relative; display: inline-grid; place-items: center; width: 36px; height: 36px;
  border-radius: 12px; border: 1px solid rgba(216, 243, 239, .26); background: rgba(255, 255, 255, .07);
  color: #fff; cursor: pointer; font-family: inherit; padding: 0;
}
.icon-btn:hover { background: rgba(255, 255, 255, .17); }
.icon-btn-badge {
  position: absolute; top: -5px; inset-inline-start: -5px; min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: 999px; background: var(--apricot); color: var(--ink);
  font-size: 10px; font-weight: 800; line-height: 17px; text-align: center;
}
.icon-btn-badge[hidden] { display: none; }
.avatar-xs {
  display: grid; place-items: center; background: var(--paper); color: var(--sea-deep);
  font-size: 12px; font-weight: 800;
}

/* ==== قائمة حساب المستخدم المنسدلة (زر دائري بصورة الحساب في الناف بار) ==== */
/* الزر دائري بصورة الحساب؛ القائمة بيضاء أسفله على حافة الشريط نحو داخل الصفحة */
.user-wrap { position: relative; }
.user-toggle {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%;
  border: 2px solid rgba(216, 243, 239, .35); background: transparent; cursor: pointer; padding: 0; overflow: hidden;
}
.user-toggle:hover { border-color: var(--fresh); }
.user-toggle img, .user-toggle .avatar-xs {
  width: 100%; height: 100%; border-radius: 50%; object-fit: cover;
  display: grid; place-items: center; background: var(--paper); color: var(--sea-deep);
  font-size: 13px; font-weight: 800;
}
.user-menu {
  position: absolute; top: calc(100% + 9px); inset-inline-end: 0; min-width: 218px;
  background: #fff; border: 1px solid var(--mist); border-radius: 16px; color: var(--slate);
  box-shadow: 0 26px 48px -26px var(--ink-10); overflow: hidden; z-index: 80; padding: 6px;
}
.user-menu[hidden] { display: none; }
.user-menu-head { padding: 10px 12px 8px; border-bottom: 1px solid var(--mist); display: grid; gap: 2px; }
.user-menu-head b { color: var(--ink); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-menu-head span { font-size: 11.5px; color: var(--slate); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-menu a {
  display: flex; align-items: center; gap: 10px; padding: 9px 11px; margin-top: 2px;
  border-radius: 11px; color: var(--slate); font-size: 12.5px; font-weight: 600;
}
.user-menu a:hover { background: var(--mist-soft); color: var(--sea-deep); }
.user-menu a.danger, .app-nav a.danger { color: #a13a2c; }
.user-menu a.danger:hover, .app-nav a.danger:hover { background: var(--apricot-soft); color: #7c2b1f; }

/* النسخة الفاتحة للقائمة في الترويسة العامة */
.site-actions .user-toggle { border-color: var(--mist); }
.site-actions .user-toggle:hover { border-color: var(--fresh); }
.site-actions .user-menu a.danger { color: #a13a2c; }
.site-actions .user-menu a.danger:hover { background: var(--apricot-soft); color: #7c2b1f; }

/* ==== قائمة الجرس ==== */
/* الجرس في نهاية شريط التطبيق (يسار الشاشة لأن الواجهة RTL)، فنثبّت القائمة
   على الحافة نفسها (inset-inline-end) لتتمدد نحو داخل الصفحة لا خارج الشاشة.
   ولو انقلبت الواجهة إلى LTR عادت تلقائياً للجهة المقابلة. */
.bell-wrap { position: relative; }
.bell-menu {
  position: absolute; top: calc(100% + 9px); inset-inline-end: 0;
  width: min(370px, calc(100vw - 20px));
  /* لا تتجاوز القائمة أسفل الشاشة أبداً: الرأس والتذييل ثابتان والقائمة وحدها تُمرَّر */
  max-height: calc(100vh - 78px);
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid var(--mist); border-radius: 16px; color: var(--slate);
  box-shadow: 0 26px 48px -26px var(--ink-10); overflow: hidden; z-index: 80;
}
[dir="ltr"] .bell-menu { inset-inline-end: auto; inset-inline-start: 0; }
.bell-menu[hidden] { display: none; }
.bell-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 13px; border-bottom: 1px solid var(--mist); }
.bell-head b { color: var(--ink); font-size: 13px; }
.bell-mini {
  border: 0; background: transparent; color: var(--sea); font-family: inherit;
  font-size: 11.5px; font-weight: 700; cursor: pointer; padding: 4px 7px; border-radius: 8px;
  white-space: nowrap;
}
.bell-mini:hover { background: var(--mist-soft); }
/* مرونة كاملة: تأخذ ما تبقّى من ارتفاع القائمة بلا حدّ ثابت مقطوع */
.bell-list {
  list-style: none; margin: 0; padding: 6px; flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 6px; align-content: start;
}
.bell-list li { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border-radius: 12px; border: 1px solid transparent; background: var(--paper); }
.bell-list li.unread { background: var(--mist-soft); border-color: var(--fresh-20); }
.bell-item-body { flex: 1; min-width: 0; }
.bell-item-title { color: var(--ink); font-size: 12.5px; font-weight: 700; }
.bell-item-text { margin-top: 3px; font-size: 11.5px; line-height: 1.8; color: var(--slate); overflow-wrap: anywhere; }
.bell-item-time { margin-top: 4px; font-size: 10.5px; color: var(--slate); opacity: .85; }
.bell-item-actions { display: grid; gap: 3px; flex: 0 0 auto; }
.bell-empty { flex: 0 0 auto; padding: 20px 14px; text-align: center; font-size: 12px; color: var(--slate); }
.bell-empty[hidden] { display: none; }
/* ملاحظة: الجرس في أعلى الشاشة، فالقائمة تنزل دائماً للأسفل ولا تنقلب أبداً
   (القلب للأعلى يدفعها خارج أعلى الشاشة فيختفي كل شيء). على الشاشات القصيرة
   نكتفي بتقليل الفراغات، والـ max-height أعلاه يمنع تجاوز حافة الشاشة. */
@media (max-height: 620px) {
  .bell-menu { top: calc(100% + 5px); max-height: calc(100vh - 66px); }
  .bell-list li { padding: 7px 9px; }
}

/* ==== هيكل الصفحة: شريط جانبي يمين (لأن الواجهة RTL) + محتوى ==== */
.app-page { padding: 0; }
.app-shell {
  max-width: 1400px; margin: 0 auto; padding: 14px 16px 34px;
  display: grid; gap: 16px; grid-template-columns: 230px minmax(0, 1fr); align-items: start;
}
.app-main { grid-column: 2; min-width: 0; }
.app-main .page-head h1 { font-size: 20px; }
.app-side { grid-column: 1; grid-row: 1; position: sticky; top: 60px; }
.app-nav {
  background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 7px;
  box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 2px;
  min-height: calc(100vh - 110px);
}
/* قسم المشرف الذكي + سجل الجلسات مثبّت أسفل القائمة (margin-top:auto في flex column) */
.app-nav-foot { margin-top: auto; display: grid; gap: 2px; padding-top: 2px; }
.app-nav a { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 12px; color: var(--slate); font-size: 12.5px; font-weight: 600; }
.app-nav a:hover { background: var(--mist-soft); color: var(--sea-deep); }
.app-nav a.active { background: var(--ink); color: #fff; font-weight: 700; }
.app-nav a.active .icon { color: var(--fresh); }
.app-nav-label { padding: 9px 11px 3px; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; color: var(--slate); }
.app-nav-sep { height: 1px; background: var(--mist); margin: 6px 9px; }
.app-nav a.danger:hover { background: var(--apricot-soft); color: var(--ink); }

/* ==== لوحة الإدارة (area: 'admin'): ترويسة + سايدبار + عناصر تحكم ==== */
.topbar-actions { display: flex; align-items: center; gap: 8px; }
.topbar-link { color: #fff; font-size: 13px; font-weight: 600; padding: 8px 11px; border-radius: 10px; }
.topbar-link:hover { background: rgba(255, 255, 255, .12); color: #fff; }
/* أقراص الصلاحيات: الاسم + زر صغير للحذف داخل الشريحة نفسها */
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--mist-soft); border: 1px solid var(--mist); border-radius: 999px;
  padding: 4px 10px; font-size: 12px; font-weight: 600; color: var(--ink);
}
.chip form { display: inline-flex; margin: 0; }
.chip button {
  border: 0; background: transparent; padding: 0 1px; cursor: pointer;
  color: var(--slate); font-size: 14px; line-height: 1;
}
.chip button:hover { color: #a13a2c; }
/* شبكة معلومات في صفحة تفصيل الباحث وبطاقة النظام */
.info-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
.info-grid .card { margin: 0; }
.row-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* ==== لوحة الإدارة: عمودان متجاوبان + جدول بتمرير داخلي + مودال بـ :target (بلا JS) ==== */
.duo { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); align-items: start; }
.duo .card { margin: 0; }
/* جدول داخل صندوق بارتفاع محدود: شريط تمرير رأسي + رأس جدول ملتصق */
.table-scroll { max-height: 420px; overflow-y: auto; border: var(--line); border-radius: 12px; background: #fff; }
.table-scroll > table { margin: 0; }
.table-scroll thead th { position: sticky; top: 0; background: #fff; z-index: 1; box-shadow: inset 0 -1px 0 var(--mist); }
/* مودال يظهر عند مطابقة #معرّف في الرابط — نفس أزرار التعديل القديمة تعمل بلا سكربت */
.modal { display: none; position: fixed; inset: 0; z-index: 80; background: rgba(16, 42, 67, 0.5); padding: 40px 16px; overflow-y: auto; }
.modal:target { display: block; }
.modal .card { max-width: 760px; margin: 0 auto; }
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.modal-close { font-size: 24px; line-height: 1; color: var(--slate); text-decoration: none; }
.modal-close:hover { color: var(--ink); }
/* شريط فلترة (تاريخ + ساعات + عدد النتائج) فوق جداول العمليات */
.filter-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 12px; }
.filter-bar .field { margin: 0; min-width: 132px; }
.filter-bar label { font-size: 11.5px; font-weight: 700; }
.filter-bar .form-actions { margin: 0; }

/* ============ مساحة عمل الباحث: مسار البحث والمراجع والمفكرة والملفات والشات ============ */
/* ترويسة بطاقة: العنوان يمين وزر إجراء يسار (مثل «إضافة نقاط» في الإحصائية) */
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.card-head h2 { margin: 0; }
.btn-sm { padding: 7px 12px; font-size: 12.5px; }
.btn-block { width: 100%; justify-content: center; }

/* سجل الاستهلاك: قائمة مضغوطة بدل جدول */
.usage-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.usage-item { display: flex; align-items: center; gap: 11px; padding: 10px 8px; border-radius: 12px; }
.usage-item + .usage-item { border-top: 1px solid var(--mist); }
.usage-item:hover { background: var(--mist-soft); }
.usage-icon {
  flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px; background: var(--mist-soft);
  color: var(--sea-deep); display: grid; place-items: center;
}
.usage-main { flex: 1 1 auto; min-width: 0; }
.usage-main b { font-size: 13px; }
.usage-summary {
  font-size: 12px; color: var(--slate); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.usage-side { flex: 0 0 auto; display: grid; justify-items: end; gap: 2px; }
.usage-tokens { font-size: 12.5px; font-weight: 800; color: var(--ink); }
.usage-time { font-size: 10.5px; color: var(--slate); }
.usage-item.is-failed .usage-icon { background: var(--apricot-soft); color: #8a4b1f; }
.usage-item.is-failed .usage-tokens { color: var(--slate); font-weight: 600; }

.btn-quiet { background: #fff; color: var(--slate); border: 1px solid var(--mist); }
.btn-quiet:hover { background: var(--mist-soft); color: var(--ink); }
.btn-danger { background: #fff; color: #a13a2c; border: 1px solid #e9c9c0; }
.btn-danger:hover { background: var(--apricot-soft); color: #7c2b1f; }
.inline-form { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
.inline-form select { max-width: 170px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--slate); margin: 8px 0; }

.journey-grid { display: grid; gap: 14px; }
.journey-summary .meter { margin: 10px 0 12px; }
.journey-step {
  background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 14px 16px;
  display: grid; gap: 10px; box-shadow: var(--shadow);
}
.journey-step.is-done { border-color: #bfe3cf; background: linear-gradient(180deg, #f4fbf7, #fff 60%); }
.journey-step.is-in_progress { border-color: #f0d9a8; background: linear-gradient(180deg, #fffaf0, #fff 60%); }
.step-head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.step-number {
  flex: 0 0 auto; width: 32px; height: 32px; border-radius: 999px; background: var(--ink); color: #fff;
  display: grid; place-items: center; font-weight: 800; font-size: 13px;
}
.journey-step.is-done .step-number { background: #2f9e6d; }
.journey-step.is-in_progress .step-number { background: #d09a1c; }
.step-heading { flex: 1 1 220px; min-width: 0; }
.step-heading h3 { font-size: 15px; display: flex; align-items: center; gap: 6px; }
.step-heading p { font-size: 12.5px; margin-top: 2px; }
.step-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.step-check { color: #2f9e6d; display: inline-flex; }
.step-guidance { background: var(--mist-soft); border-radius: 12px; padding: 9px 12px; font-size: 13px; }
.step-links { display: flex; gap: 8px; flex-wrap: wrap; }
.step-form { border-top: 1px dashed var(--mist); padding-top: 10px; display: grid; gap: 8px; }
.step-form-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.step-status-group { display: flex; gap: 6px; flex-wrap: wrap; }
.step-status-choice {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px;
  border: 1px solid var(--mist); background: #fff; font-size: 12.5px; font-weight: 600; color: var(--slate);
}
.step-status-choice input { margin: 0; }
.step-status-choice:has(input:checked) { background: var(--ink); color: #fff; border-color: var(--ink); }
.step-status-choice.is-done:has(input:checked) { background: #2f9e6d; border-color: #2f9e6d; }
.step-status-choice.is-in_progress:has(input:checked) { background: #d09a1c; border-color: #d09a1c; }

.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start; }
.grid .card { min-width: 0; }
.ref-table, .file-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ref-table th, .file-table th { text-align: right; color: var(--slate); font-size: 12px; padding: 8px; border-bottom: 1px solid var(--mist); }
.ref-table td, .file-table td { padding: 9px 8px; border-bottom: 1px solid var(--mist); vertical-align: top; }
.ref-citation { font-size: 12px; margin-top: 3px; }
.lib-list { display: grid; gap: 10px; }
.lib-item { border: 1px solid var(--mist); border-radius: 14px; padding: 11px 13px; background: #fff; }
.lib-item h3 { font-size: 14px; }
.lib-item p { font-size: 12.5px; margin: 4px 0 8px; }

/* ==== صفحة المكتبة العلمية (لوحة الإدارة): تخطيط بطل + عمود جلب جانبي ==== */
/* ترويسة داكنة بأزرار فاتحة: تفصل بين «إدارة المكتبة» و«جلب الجديد» */
.lib-hero { padding: 0; overflow: hidden; }
.lib-hero-top {
  display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: space-between;
  padding: 20px; background: linear-gradient(135deg, var(--ink) 0%, #164b6e 100%); color: #fff;
}
.lib-hero-top h2 { color: #fff; font-size: 17px; margin: 0; }
.lib-hero-top p { margin-top: 5px; font-size: 12.5px; color: var(--mist); max-width: 64ch; }
.lib-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lib-hero-actions .btn { background: rgba(255, 255, 255, .12); border-color: rgba(255, 255, 255, .3); color: #fff; }
.lib-hero-actions .btn:hover { background: #fff; border-color: #fff; color: var(--ink); }
.lib-hero-actions .btn-primary { background: var(--fresh); border-color: var(--fresh); color: var(--ink); }
.lib-hero-actions .btn-primary:hover { background: #fff; border-color: #fff; color: var(--ink); }
/* شريط الإحصاءات داخل البطل — بمسافة سفلية تنفصل بها عن قائمة العناصر */
.lib-stats { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); padding: 16px 18px; margin-bottom: 22px; }
.lib-stats .stat { box-shadow: none; background: var(--paper); border-color: var(--mist); }
.lib-stats .stat-value { font-size: 20px; }
.lib-hero-filters { padding: 0 18px; display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 14px; }
/* عمودان: قائمة العناصر (الواسع) + لوحة الجلب (ثابتة على الشاشات الكبيرة) */
.lib-layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 336px; align-items: start; }
.lib-panel { position: sticky; top: 16px; }
@media (max-width: 1020px) {
  .lib-layout { grid-template-columns: minmax(0, 1fr); }
  .lib-panel { position: static; }
}
/* بطاقة عنصر: رأس (عنوان + شارات) + توثيق + وسوم + شريط إجراءات */
.lib-card { display: grid; gap: 8px; padding: 14px 15px; }
.lib-card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; justify-content: space-between; }
.lib-card-head h3 { font-size: 14.5px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lib-badges { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.lib-citation { font-size: 12px; color: var(--slate); }
.lib-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11.5px; color: var(--slate); }
.lib-meta b { color: var(--ink); font-weight: 700; }
.lib-abs { font-size: 12.5px; color: var(--slate); }
.lib-actions { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; border-top: 1px dashed var(--mist); padding-top: 9px; }
.lib-actions .btn { padding: 6px 12px; font-size: 12px; }
/* منتقي المصادر: بطاقات اختيار بدل قائمة منسدلة (يعمل بلا سكربتات عبر :checked) */
.source-picker { display: grid; gap: 8px; }
.source-option { position: relative; display: block; }
.source-option input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.source-option-body {
  display: block; cursor: pointer; border: 1px solid var(--mist); border-radius: 12px; padding: 10px 12px;
  background: #fff; transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.source-option-body:hover { border-color: var(--fresh); }
.source-option input:checked + .source-option-body { border-color: var(--sea); background: var(--mist-soft); box-shadow: 0 0 0 3px var(--fresh-12); }
.source-option input:focus-visible + .source-option-body { outline: 2px solid var(--fresh); outline-offset: 2px; }
.source-name { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 800; color: var(--ink); }
.source-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sea); flex: 0 0 auto; }
.source-hint { margin-top: 4px; font-size: 11.5px; color: var(--slate); }
/* حقول الجلب وحقول البحث الداخلي */
.lib-fields { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.lib-fields .field { margin-top: 0; }
.lib-fields .lib-field-full { grid-column: 1 / -1; }
.lib-hint { font-size: 11.5px; color: var(--slate); }
.lib-hint-box {
  margin-top: 14px; padding: 11px 13px; border-radius: 12px; background: var(--paper);
  border: 1px dashed var(--mist); font-size: 11.5px; color: var(--slate);
}
.lib-hint-box b { color: var(--ink); }
/* رأس قسم النتائج الخارجية */
.lib-section-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.lib-section-head h2 { margin: 0; }
.lib-section-head .lib-section-note { font-size: 11.5px; color: var(--slate); }
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.toolbar input[type="search"], .toolbar select { flex: 1 1 200px; max-width: 100%; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 999px;
  background: var(--mist-soft); border: 1px solid var(--mist); color: var(--slate);
  font-size: 12px; font-weight: 600; text-decoration: none;
}
.chip:hover { background: #fff; color: var(--ink); border-color: var(--slate); }

.note-list { display: grid; gap: 10px; }
.note-card { border: 1px solid var(--mist); border-radius: 14px; padding: 12px 14px; background: #fff; display: grid; gap: 7px; }
.note-card.is-pinned { border-color: #d9c8a4; background: #fffdf5; }
.note-card.is-editing { border-color: var(--sea); }
.note-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.note-head h3 { font-size: 14.5px; display: flex; align-items: center; gap: 6px; }
.note-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.note-body { white-space: pre-wrap; font-size: 13.5px; line-height: 1.8; }
.note-tags { display: flex; gap: 6px; flex-wrap: wrap; }

/* ---- صفحة الشات: كارت واحد بملء الارتفاع + الجلسات أسفل رابط المشرف الذكي ---- */
/* شريط التمرير بلون الهوية (كحلي + أخضر زنجبي) في كل مكان */
* { scrollbar-width: thin; scrollbar-color: var(--sea) var(--mist-soft); }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: var(--mist-soft); border-radius: 999px; }
*::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, var(--sea), var(--sea-deep));
  border-radius: 999px; border: 2px solid var(--mist-soft);
}
*::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, var(--sea-deep), var(--ink)); }
*::-webkit-scrollbar-corner { background: var(--mist-soft); }

/* وضع ملء الارتفاع: لا سكرول في الصفحة، والتمرير داخل الصناديق فقط */
.app-shell--fit { height: calc(100vh - 50px); padding-bottom: 14px; }
.app-shell--fit .app-main { height: 100%; min-height: 0; }
.app-shell--fit .app-side { max-height: 100%; }
.app-shell--fit .app-nav { min-height: 100%; }

.app-side { display: grid; gap: 12px; align-content: start; max-height: calc(100vh - 76px); overflow-y: auto; }
.app-nav-sep.first { margin-top: 2px; }
.chat-card {
  display: flex; flex-direction: column; gap: 0;
  height: 100%; min-height: 0; padding: 14px 16px 12px;
}
.chat-flash { margin: 0 0 10px; }
.chat-context {
  display: flex; align-items: center; gap: 7px; margin-bottom: 10px; padding: 7px 11px;
  background: var(--mist-soft); border-radius: 12px; font-size: 12px; color: var(--slate);
}
.chat-context a { margin-inline-start: auto; font-size: 11.5px; font-weight: 700; color: var(--sea-deep); }
.chat-body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
  padding: 4px 4px 10px; scroll-behavior: smooth;
}
.chat-welcome {
  margin: auto; text-align: center; color: var(--slate); display: grid; gap: 10px; justify-items: center;
  padding: 20px;
}
.chat-welcome p { font-size: 13px; max-width: 420px; }
.bubble { border-radius: 16px; padding: 10px 13px; max-width: min(86%, 720px); font-size: 13.5px; line-height: 1.9; }
/* نحدّد اللون هنا لأن .bubble-user في صفحة الهبوط يستخدم خلفية غامقة ونصاً أبيض */
.bubble-user { background: var(--mist-soft); color: var(--ink); border: 1px solid var(--mist); align-self: flex-start; }
.bubble-ai { background: #fff; color: var(--ink); border: 1px solid #cfe3f0; align-self: flex-end; }
.bubble-text { white-space: pre-wrap; line-height: 1.9; overflow-wrap: anywhere; }
.bubble-meta { font-size: 10.5px; color: var(--slate); margin-top: 6px; }
/* مؤشر «يكتب…» وفقاعة معلّقة أثناء الإرسال بلا إعادة تحميل (chat-send.js) */
.bubble.is-thinking { color: var(--slate); font-size: 12.5px; animation: chat-think 1.2s ease-in-out infinite; }
.bubble.is-pending { opacity: 0.85; }
@keyframes chat-think { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.chat-composer {
  display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--mist); padding-top: 11px;
}
.chat-composer-row { display: flex; align-items: flex-end; gap: 8px; }
.chat-composer textarea {
  flex: 1 1 auto; min-height: 46px; max-height: 170px; resize: vertical; line-height: 1.7;
  padding: 12px 14px; border-radius: 14px; border: 1px solid var(--mist); font: inherit; font-size: 13.5px;
}
.chat-composer textarea:focus { outline: 2px solid var(--sea); outline-offset: 1px; }
.chat-send {
  flex: 0 0 auto; width: 46px; height: 46px; padding: 0; border-radius: 14px; display: grid; place-items: center;
}

/* سجل الجلسات أسفل رابط المشرف الذكي داخل نفس القائمة (ChatGPT/Claude style) */
.chat-nav { display: grid; gap: 6px; margin-top: 4px; min-height: 0; }
.chat-side-empty { font-size: 11.5px; color: var(--slate); text-align: center; padding: 6px 4px; }
.chat-side-note { font-size: 10px; color: var(--slate); opacity: .85; text-align: center; padding: 2px 4px 4px; }
.chat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; max-height: min(34vh, 300px); overflow-y: auto; }
.chat-item { display: flex; align-items: center; gap: 2px; border-radius: 10px; }
.chat-item:hover { background: var(--mist-soft); }
.chat-item.is-active { background: var(--ink); }
.chat-item.is-active a, .chat-item.is-active a span { color: #fff; }
.chat-item a {
  flex: 1 1 auto; min-width: 0; display: grid; padding: 6px 9px; color: var(--slate);
  font-size: 12px; font-weight: 600; line-height: 1.4;
}
.chat-item a b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-item a span { font-size: 10.5px; font-weight: 400; opacity: .85; }
.chat-del { margin: 0; flex: 0 0 auto; }
.chat-del-btn {
  width: 26px; height: 26px; margin-inline-end: 4px; display: grid; place-items: center; cursor: pointer;
  background: transparent; border: 0; border-radius: 8px; color: var(--slate); opacity: 0;
}
.chat-item:hover .chat-del-btn, .chat-item.is-active .chat-del-btn { opacity: 1; }
.chat-del-btn:hover { background: var(--apricot-soft); color: #7c2b1f; }

@media (max-width: 900px) {
  .ref-table thead, .file-table thead { display: none; }
  .ref-table tr, .file-table tr { display: grid; gap: 6px; padding: 10px 0; border-bottom: 1px solid var(--mist); }
  .ref-table td, .file-table td { border: 0; padding: 0; }
}

@media (max-width: 900px) {
  .app-shell { grid-template-columns: minmax(0, 1fr); padding: 12px 14px 30px; }
  .app-shell--fit { height: auto; padding-bottom: 12px; }
  .app-main { grid-column: 1; grid-row: 2; }
  .app-side { grid-column: 1; grid-row: 1; position: static; max-height: none; overflow: visible; }
  .app-nav { display: flex; overflow-x: auto; gap: 6px; padding: 6px; min-height: 0; }
  .app-nav a { white-space: nowrap; padding: 8px 12px; border-radius: 999px; }
  .app-nav-foot { margin-top: 0; display: flex; align-items: center; gap: 6px; }
  .app-nav-sep { display: none; }
  .app-nav-label { display: none; }
  .app-top .brand-text { display: none; }
  .chat-card { height: 70vh; min-height: 420px; }
  .chat-nav { margin-top: 0; }
  .chat-list { max-height: 120px; }
  .chat-side-note { display: none; }
}
`;

/**
 * سايدبار لوحة الإدارة: مجموعات أقسام بأيقونات + تمييز الصفحة الحالية،
 * وأسفله رابط زيارة الموقع وتسجيل الخروج (نفس عائلة تنسيقات app-nav).
 */
/** هل للحساب حق دخول لوحة الإدارة؟ (المدير دائماً، والمشرف بصلاحية admin:panel). */
function hasAdminPanel(account) {
  if (!account) return false;
  if (account.role === 'admin') return true;
  return Array.isArray(account.adminPermissions) && account.adminPermissions.includes('admin:panel');
}

/**
 * سايدبار لوحة الإدارة: لا يظهر للمشرف إلا ما يملك صلاحيته.
 * `adminPermissions` تُحمَّل مع الحساب في middleware/auth.js (حساب واحد لكل طلب)،
 * والصفحات المحجوبة (adminOnly) — كالإعدادات — تبقى للمدير وحده ولا تُمنح.
 */
function renderAdminSidebar(activeKey, account = null) {
  const link = (item) =>
    `<a href="${item.href}"${item.key === activeKey ? ' class="active"' : ''}>${icon(item.icon, 'icon-sm')}<span>${escapeHtml(
      item.label
    )}</span></a>`;

  const isManager = account?.role === 'admin';
  const granted = Array.isArray(account?.adminPermissions) ? new Set(account.adminPermissions) : null;
  const visible = (item) => {
    if (isManager) return true;
    if (item.adminOnly) return false;
    return !item.permission || !granted || granted.has(item.permission);
  };

  const groups = ADMIN_NAV.map((group) => {
    const items = group.items.filter(visible);
    return items.length ? `<div class="app-nav-label">${escapeHtml(group.label)}</div>${items.map(link).join('')}` : '';
  })
    .filter(Boolean)
    .join('');

  return `<aside class="app-side">
  <nav class="app-nav" aria-label="أقسام لوحة الإدارة">
    <div class="app-nav-sep first"></div>
    ${groups}
    <div class="app-nav-foot">
      <div class="app-nav-sep"></div>
      <a href="/">${icon('rocket', 'icon-sm')}<span>زيارة الموقع</span></a>
      <a class="danger" href="/logout">${icon('logout', 'icon-sm')}<span>تسجيل الخروج</span></a>
    </div>
  </nav>
</aside>`;
}

/** ترويسة لوحة الإدارة: الشعار بعنوان «لوحة الإدارة» + رابط زيارة الموقع + قائمة الحساب. */
function renderAdminTopbar(activeKey, account) {
  return `<header class="topbar admin-top">
  <div class="topbar-inner">
    ${renderBrand(activeKey)}
    <div class="topbar-actions">
      <a class="topbar-link" href="/">زيارة الموقع</a>
      ${account ? renderUserMenu(account) : ''}
    </div>
  </div>
</header>`;
}

/**
 * بطاقة إحصائية واحدة.
 * الأرقام (والأرقام المكتوبة كنص) تُنسَّق بفواصل الآلاف، أم النصوص ذات الوحدات
 * (مثل «100 MB» أو «1.2 GB · 42 ملف») فتُعرض كما هي — وإلا تحوّلت إلى NaN.
 */
export function renderStat(label, value) {
  const isNumeric =
    value == null ||
    typeof value === 'number' ||
    (typeof value === 'string' && (value.trim() === '' || Number.isFinite(Number(value))));
  const text = isNumeric ? formatNumber(value) : String(value);
  return `<div class="stat"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(
    text
  )}</p></div>`;
}

/** جدول بسيط مع رسالة عند عدم وجود بيانات. */
export function renderTable({ columns, rows, emptyMessage = 'لا توجد بيانات بعد.' }) {
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  }

  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  return `<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${rows.map((row) => `<tr>${row}</tr>`).join('')}</tbody>
</table>`;
}

/**
 * ترويسة الهوية: أيقونة الشعار على وسادة Paper + اسم Zena AI بخط Manrope 800،
 * ثم الجملة التعريفية بلون Mist. (الشعار يوضع دائماً داخل مساحة أمان ولا يُمدَّد أو يُلوَّن.)
 */
function renderBrand(activeKey) {
  const sub = activeKey ? `${APP_TAGLINE} · لوحة الإدارة` : APP_TAGLINE;

  return `<a class="brand" href="/">
  <span class="brand-mark"><img src="${BRAND.icon}" alt="" width="34" height="34" /></span>
  <span class="brand-text">
    <span class="brand-title">${escapeHtml(APP_NAME)}</span>
    <span class="brand-sub">${escapeHtml(sub)}</span>
  </span>
</a>`;
}

/**
 * محتوى قائمة الإشعارات المنسدلة (مشترك بين شريط التطبيق والترويسة العامة).
 * لا صفحة إشعارات مخصّصة — كل الإشعارات تُعرض هنا ويُدار بها من /js/app-shell.js.
 */
function renderBellMenu() {
  return `<div class="bell-menu" id="bell-menu" hidden>
    <div class="bell-head">
      <b>الإشعارات</b>
      <button type="button" class="bell-mini" id="bell-read-all">تعليم الكل كمقروء</button>
    </div>
    <ul class="bell-list" id="bell-list"></ul>
    <div class="bell-empty" id="bell-empty">جارٍ تحميل الإشعارات…</div>
  </div>`;
}

/**
 * قائمة حساب المستخدم المنسدلة (مشتركة بين شريط التطبيق والترويسة العامة):
 * زر دائري بصورة الحساب يفتح قائمة: حسابي · ملفي البحثي · الباقات · لوحة الإدارة (للمدير) · تسجيل الخروج.
 */
function renderUserMenu(account) {
  const name = String(account?.full_name || account?.email || 'باحث').trim();
  const email = String(account?.email || '').trim();
  const initial = name.charAt(0) || '؟';

  const avatar = account?.photo_url
    ? `<img src="${escapeHtml(account.photo_url)}" alt="" width="32" height="32" referrerpolicy="no-referrer" />`
    : `<span class="avatar-xs">${escapeHtml(initial)}</span>`;

  return `<div class="user-wrap">
    <button type="button" class="user-toggle" id="user-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="user-menu" title="${escapeHtml(name)}" aria-label="قائمة الحساب">
      ${avatar}
    </button>
    <div class="user-menu" id="user-menu" hidden>
      <div class="user-menu-head">
        <b>${escapeHtml(name)}</b>
        ${email && email !== name ? `<span>${escapeHtml(email)}</span>` : ''}
      </div>
      <a href="/account">${icon('user', 'icon-sm')}<span>حسابي ورصيد النقاط</span></a>
      <a href="/payments">${icon('coins', 'icon-sm')}<span>الاشتراك والدفع</span></a>
      <a href="/onboarding">${icon('searchCheck', 'icon-sm')}<span>ملفي البحثي</span></a>
      <a href="/#pricing">${icon('coins', 'icon-sm')}<span>الباقات</span></a>
      ${hasAdminPanel(account) ? `<a href="/admin">${icon('shield', 'icon-sm')}<span>لوحة الإدارة</span></a>` : ''}
      <a class="danger" href="/logout">${icon('logout', 'icon-sm')}<span>تسجيل الخروج</span></a>
    </div>
  </div>`;
}

/** الشريط العلوي المضغوط للوحة الباحث: الشعار + جرس الإشعارات + صورة الحساب (قائمة منسدلة). */
function renderAppTopbar(account, unread = 0) {
  const badge =
    unread > 0
      ? `<span class="icon-btn-badge" id="bell-badge">${unread > 99 ? '99+' : unread}</span>`
      : '<span class="icon-btn-badge" id="bell-badge" hidden>0</span>';

  return `<header class="app-top">
  <div class="app-top-inner">
    <a class="brand" href="/dashboard">
      <span class="brand-mark"><img src="${BRAND.icon}" alt="" width="26" height="26" /></span>
      <span class="brand-text">
        <span class="brand-title">${escapeHtml(APP_NAME)}</span>
        <span class="brand-sub">${escapeHtml(APP_TAGLINE)}</span>
      </span>
    </a>
    <span class="app-top-spacer"></span>
    <div class="app-top-actions">
      <div class="bell-wrap">
        <button type="button" class="icon-btn" id="bell-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="bell-menu" title="الإشعارات" aria-label="الإشعارات">
          ${icon('bell', 'icon-sm')}
          ${badge}
        </button>
        ${renderBellMenu()}
      </div>
      ${renderUserMenu(account)}
    </div>
  </div>
</header>`;
}

/**
 * الشريط الجانبي للوحة الباحث.
 * الترتيب: فاصل ← أدوات البحث ← فاصل ← المشرف الذكي ← سجل الجلسات.
 * navBottom محتوى إضافي تحت رابط المشرف الذكي (تستخدمه صفحة الشات لسجل جلساتها)،
 * والحساب/الملف البحثي/الخروج كلها في الشريط العلوي فلا نكرّرها هنا.
 */
function renderAppSidebar(activeKey, account, navBottom = '') {
  const link = (item) =>
    `<a href="${item.href}"${item.key === activeKey ? ' class="active"' : ''}>${icon(item.icon, 'icon-sm')}<span>${escapeHtml(
      item.label
    )}</span></a>`;

  // الخدمات المفتوحة تُحسب في middleware/auth.js مرة واحدة لكل طلب وحُمّلت على req.account.
  // غيابها (زائر أو خطأ قراءة) ⇒ نعرض كل الأدوات حتى لا يختفي شيء بالخطأ.
  const open = Array.isArray(account?.services)
    ? new Set(
        account.services
          .filter((item) => (typeof item === 'string' ? true : item?.enabled !== false))
          .map((item) => (typeof item === 'string' ? item : item?.key))
          .filter(Boolean)
      )
    : null;
  const visible = (item) => !item.service || !open || open.has(item.service);

  const admin = hasAdminPanel(account)
    ? `<a href="/admin"${activeKey === 'admin' ? ' class="active"' : ''}>${icon('shield', 'icon-sm')}<span>لوحة الإدارة</span></a>`
    : '';

  return `<aside class="app-side">
  <nav class="app-nav" aria-label="أدوات الباحث">
    <div class="app-nav-sep first"></div>
    ${APP_NAV.filter(visible).map(link).join('')}
    ${admin}
    <div class="app-nav-foot">
      <div class="app-nav-sep"></div>
      ${visible(APP_CHAT_NAV) ? link(APP_CHAT_NAV) : ''}
      ${navBottom}
    </div>
  </nav>
</aside>`;
}

/** ترويسة الصفحة العامة: قائمة الموقع + زر الدخول أو صورة الحساب (قائمة منسدلة) حسب الجلسة. */
function renderPublicHeader(account, unread = 0) {
  const nav = PUBLIC_NAV.map((item) => `<a href="${item.href}">${escapeHtml(item.label)}</a>`).join('');

  const actions = account
    ? `<a class="link-quiet" href="${needsOnboarding(account) ? '/onboarding' : homePathFor(account)}">${
        needsOnboarding(account) ? 'أكمل ملفك البحثي' : hasAdminPanel(account) ? 'لوحة الإدارة' : 'لوحتي'
      }</a>
       ${renderUserMenu(account)}`
    : `<a class="link-quiet" href="/login">تسجيل الدخول</a>
       <a class="btn btn-primary" href="/login">ابدأ مجاناً</a>`;

  // جرس الإشعارات يظهر فقط للمسجّل — قائمة منسدلة (بلا صفحة مخصّصة)
  const bellBadge =
    unread > 0
      ? `<span class="nav-bell-badge" id="bell-badge">${unread > 99 ? '99+' : unread}</span>`
      : '<span class="nav-bell-badge" id="bell-badge" hidden>0</span>';
  const bell = account
    ? `<div class="bell-wrap">
      <button type="button" class="nav-bell" id="bell-toggle" aria-expanded="false" aria-haspopup="true" aria-controls="bell-menu" title="الإشعارات" aria-label="الإشعارات">
        ${icon('bell', 'icon-sm')}
        ${bellBadge}
      </button>
      ${renderBellMenu()}
    </div>`
    : '';

  return `<header class="site-header">
  <div class="site-header-inner">
    ${renderBrand('')}
    <nav class="site-nav">${nav}</nav>
    <div class="site-actions">${bell}${actions}</div>
  </div>
</header>`;
}

/**
 * رابط واتساب للدعم الفني: يحوّل الرقم (بصيغته المحلية أو الدولية) إلى رابط
 * `wa.me` برسالة عربية جاهزة، فيفتح المحادثة ويملأ النص للباحث.
 * الرقم: `SUPPORT_WHATSAPP` في ملف البيئة أولاً ثم الثابت في constants.
 */
export function whatsappLink(message = 'مرحباً، لدي مشكلة في المنصة وأحتاج مساعدة.') {
  // الرقم من صفحة الإعدادات أولاً (ما عدّله المدير)، ثم البيئة، ثم لا شيء.
  const raw = currentSupportWhatsapp() || SUPPORT_WHATSAPP;
  if (!raw) return '';

  // نُبقي الأرقام فقط، ثم نضيف رمز الدولة (218) إن كان الرقم محلياً يبدأ بـ 0.
  let digits = raw.replace(/[^\d+]/g, '').replace(/\+/g, '');
  if (/^0/.test(digits)) digits = `218${digits.replace(/^0+/, '')}`;
  if (digits.length < 8) return '';   // رقم ناقص أو افتراضي ⇒ لا نرسل المستخدم إلى رابط مكسور

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** زر واتساب عائم أسفل الشاشة — نقطة وصول واحدة للدعم في كل صفحة. */
function renderWhatsappFloat() {
  const href = whatsappLink();
  if (!href) return '';

  return `<a class="wa-float" href="${escapeHtml(href)}" target="_blank" rel="noopener"
   aria-label="تواصل معنا على واتساب" title="عند أي مشكلة — راسلنا على واتساب">
    ${icon('whatsapp', 'wa-float-icon')}
    <span class="wa-float-label">مشكلة؟ راسلنا</span>
  </a>`;
}

/** تذييل الصفحة العامة بمعلومات المنصة والدعم. */
function renderPublicFooter() {
  const productLinks = PUBLIC_NAV.map(
    (item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`
  ).join('');

  return `<footer class="site-footer">
  <div class="footer-grid">
    <div>
      <span class="footer-logo"><img src="${BRAND.icon}" alt="" width="26" height="26" />${escapeHtml(APP_NAME)}</span>
      <p class="footer-desc">
        منصة عربية للإشراف البحثي بالذكاء الاصطناعي، تساعد طلاب الدراسات العليا والباحثين في إعداد
        أبحاثهم ورسائلهم العلمية بمنهجية صحيحة.
      </p>
      <div class="footer-contacts">
        <p>البريد: <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a></p>
        ${
          whatsappLink()
            ? `<p>واتساب: <a href="${escapeHtml(whatsappLink())}" target="_blank" rel="noopener">${escapeHtml(
                currentSupportWhatsapp()
              )}</a></p>`
            : ''
        }
      </div>
    </div>
    <div>
      <h3>المنصة</h3>
      <ul>${productLinks}</ul>
    </div>
    <div>
      <h3>الحساب</h3>
      <ul>
        <li><a href="/login">تسجيل الدخول بحساب جوجل</a></li>
        <li><a href="/account">حسابي ورصيد النقاط</a></li>
        <li><a href="/onboarding">ملفي البحثي</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <a class="status-chip" href="/status"><span class="status-dot" aria-hidden="true"></span> جميع الأنظمة تعمل</a>
    <span class="footer-copy">© ${new Date().getFullYear()} ${escapeHtml(APP_NAME)} — جميع الحقوق محفوظة. المنصة أداة مساعدة
    للباحث ولا تُغني عن إشراف الأستاذ المشرف.</span>
  </div>
</footer>`;
}

/**
 * قالب الصفحة الكامل.
 * - `area`: 'public' صفحة عامة (ترويسة وتذييل الموقع)، 'auth' صفحة دخول بلا ترويسة،
 *   'admin' لوحة الإدارة بالشريط الكحلي وقائمة الإدارة.
 * - `pageHead: false` يُستخدم في الصفحات التي تحمل عنوانها البطولي في الجسم (الصفحة الرئيسية).
 * - إن كان العنوان يحتوي اسم المنصة لا يُكرَّر في وسم <title>.
 */
export function renderLayout({
  title,
  subtitle = '',
  activeKey = '',
  body = '',
  area = 'admin',
  pageHead = true,
  account = null,
  unread = 0,
  scripts = [],
  navBottom = '',
  fitViewport = false,
  canonicalPath = ''
}) {
  const documentTitle = title.includes(APP_NAME) ? title : `${title} — ${APP_NAME}`;

  const header =
    area === 'public'
      ? renderPublicHeader(account, unread)
      : area === 'auth'
        ? ''
        : area === 'app'
          ? renderAppTopbar(account, unread)
          : area === 'admin'
            ? renderAdminTopbar(activeKey, account)
            : `<header class="topbar">
  <div class="topbar-inner">
    ${renderBrand(activeKey)}
  </div>
</header>`;

  // تذييل الموقع للصفحات العامة فقط — لوحة الإدارة بلا تذييل (مساحتها أثقل من محتواها)
  const footer = area === 'public' ? renderPublicFooter() : '';

  // زر الدعم العائم: مع الزائر والباحث، وبلا إزعاج في لوحة الإدارة (الفريق لا يحتاجه).
  const whatsappFloat = area === 'admin' ? '' : renderWhatsappFloat();

  // وصف الصفحة للمشاركة ومحركات البحث: نصّ الصفحة إن وُجد، وإلا وسم المنصة.
  const metaDescription = String(subtitle || '').trim() || `${APP_NAME} — ${APP_TAGLINE}`;
  // المسار الفعلي للصفحة (يمرّره المسار) — يُستخدم في og:url و link canonical.
  const currentPath = String(canonicalPath || activeKey || '/');

  const headBlock = pageHead
    ? `<div class="page-head">
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>`
    : '';

  // جرس الإشعارات المنسدل يعمل أيضاً على الصفحات العامة ولوحة الإدارة لمن لديه جلسة
  // app-shell للجرس والقوائم. الجرس يظهر في «public» و«app» و«admin» ⇒ يُحمَّل في الثلاث،
  // ويتجاهل نفسه إن لم يجد عناصره (صفحة بلا جرس) فلا أثر زائد.
  //
  // ملاحظة: لم نُحمّل /js/push-notifications.js هنا — حُذف زر «تفعيل إشعارات الهاتف»
  // من قائمة الجرس بقرار المنصة، فصار السكربت بلا نقطة انطلاق (init يتحقق من الزر
  // ويرجع فوراً). الخدمة نفسها باقية على الخادم، وما فعّل الإشعارات سابقاً ما زال
  // يستقبلها عبر Service Worker نفسه.
  const bellAreas = ['public', 'app', 'admin'];
  const extraScripts = bellAreas.includes(area) && account ? ['/js/app-shell.js'] : [];
  const allScripts = [
    ...new Set([...(Array.isArray(scripts) ? scripts : []), ...extraScripts])
  ];
  const scriptTags = allScripts
    .map((src) => `<script src="${escapeHtml(src)}" defer></script>`)
    .join('\n');

  // لوحة الباحث: السايدبار يمين (RTL) والمحتوى في العمود الثاني.
  // navBottom محتوى إضافي أسفل قائمة السايدبار (سجل جلسات الشات مثلاً).
  // fitViewport يمنع سكرول الصفحة ويجعل المحتوى يملأ ما تبقى من ارتفاع الشاشة.
  const shellClass = fitViewport ? 'app-shell app-shell--fit' : 'app-shell';
  const mainInner =
    area === 'app'
      ? `<div class="${shellClass}"><div class="app-main">${headBlock}${body}</div>${renderAppSidebar(
        activeKey,
        account,
        navBottom
      )}</div>`
      : area === 'admin'
        ? `<div class="${shellClass}"><div class="app-main">${headBlock}${body}</div>${renderAdminSidebar(
          activeKey,
          account
        )}</div>`
        : `${headBlock}${body}`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(metaDescription)}" />
<meta name="theme-color" content="#102A43" />

<!-- المشاركة على وسائل التواصل: بلا هذه يظهر الرابط نصاً بلا صورة أو وصف -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(APP_NAME)}" />
<meta property="og:locale" content="ar_LY" />
<meta property="og:title" content="${escapeHtml(documentTitle)}" />
<meta property="og:description" content="${escapeHtml(metaDescription)}" />
<meta property="og:image" content="${escapeHtml(absoluteUrl(BRAND.shareImage))}" />
<meta property="og:image:alt" content="${escapeHtml(APP_NAME)}" />
<meta property="og:url" content="${escapeHtml(absoluteUrl(currentPath))}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(documentTitle)}" />
<meta name="twitter:description" content="${escapeHtml(metaDescription)}" />
<meta name="twitter:image" content="${escapeHtml(absoluteUrl(BRAND.shareImage))}" />
<link rel="canonical" href="${escapeHtml(absoluteUrl(currentPath))}" />

<!-- تطبيق ويب: يجعل الإشعارات مثبّتة على الهاتف وتعمل بلا شريط متصفح -->
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="${escapeHtml(APP_NAME)}" />
<title>${escapeHtml(documentTitle)}</title>
<link rel="stylesheet" href="${BRAND.fonts}" />
<link rel="icon" type="image/svg+xml" href="${BRAND.icon}" />
<link rel="apple-touch-icon" sizes="180x180" href="${escapeHtml(BRAND.touchIcon)}" />
<style>${STYLES}</style>
</head>
<body>
${header}
<main class="${area === 'auth' ? 'auth-main' : area === 'app' || area === 'admin' ? 'app-page' : 'page'}">
  ${mainInner}
</main>
${footer}
${whatsappFloat}
${scriptTags}
</body>
</html>`;
}

/** صفحة رسالة (خطأ أو تنبيه) بنفس هوية المنصة. */
export function renderNotice({ title, message, details = '', status = 200, extraHtml = '' }) {
  const body = `
  <div class="notice">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
    ${details ? `<pre>${escapeHtml(details)}</pre>` : ''}
    ${extraHtml}
  </div>`;

  return { status, html: renderLayout({ title, subtitle: 'لوحة الإدارة', activeKey: 'home', body }) };
}

/**
 * صفحة «الخدمة غير متاحة في باقتك»: تشرح ما تحتاجه الباقة وترى ما هو مفتوح فعلياً.
 * تُستخدم من requireService في middleware/auth.js.
 */
export function renderServiceNotice({ service = 'هذه الخدمة', account = null, services = [] }) {
  const open = services.filter((item) => item.enabled);
  const chips = open.length
    ? open.map((item) => `<a class="chip" href="${escapeHtml(item.href)}">${icon(item.icon, 'icon-sm')} ${escapeHtml(item.short)}</a>`).join(' ')
    : '<span class="muted">لا خدمات أخرى مفتوحة في باقتك حالياً.</span>';

  const body = `
  <div class="notice">
    <h2>${escapeHtml(service)} غير متاحة في باقتك</h2>
    <p>هذه الخدمة مرتبطة بدور باقتك. كل باقة تحدّد دورها من صفحة «الباقات»، والدور يحدد الخدمات المفتوحة.</p>
    <p class="muted">الحساب الحالي: ${escapeHtml(account?.email || '—')}${account?.plan_code ? ` · الباقة: ${escapeHtml(account.plan_code)}` : ''}</p>
    <div class="chips">${chips}</div>
    <div class="links">
      <a class="btn btn-primary" href="/#pricing">عرض الباقات</a>
      <a class="btn" href="/dashboard">رجوع إلى الإحصائية</a>
      <a class="btn" href="/chat">المشرف الذكي</a>
    </div>
  </div>`;

  return { status: 403, html: renderLayout({ title: 'الخدمة غير متاحة', subtitle: service, area: 'app', account, body }) };
}

export { APP_NAME, APP_TAGLINE, BRAND, ADMIN_NAV, APP_NAV, APP_ACCOUNT_NAV, STYLES };
