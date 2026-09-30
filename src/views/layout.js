import { PUBLIC_NAV, SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '../constants.js';
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
const APP_TAGLINE = 'مساعدك البحثى الذكى';

/** ملفات الشعار والخطوط كما هي في مجلد public — تُقدَّم كملفات ثابتة من server.js. */
const BRAND = {
  icon: '/zena-ai-icon.svg', // أيقونة التطبيق والـ favicon (الأيقونة الأساسية)
  mark: '/logo2.webp', // الشعار الأساسي: كتاب مفتوح + شرارة + فقاعة حوار
  roundMark: '/logo1.webp', // نسخة دائرية تُستخدم كأيقونة لمس/مشاركة
  fonts: '/fonts.css' // تعريفات خطوط الهوية
};

/** روابط التنقل في لوحة الإدارة. */
const NAV_ITEMS = [
  { href: '/admin', label: 'نظرة عامة', key: 'home' },
  { href: '/admin/users', label: 'الباحثون', key: 'users' },
  { href: '/admin/plans', label: 'الباقات', key: 'plans' },
  { href: '/admin/usage', label: 'الاستهلاك', key: 'usage' }
];

/**
 * روابط الشريط الجانبي في لوحة الباحث (area: 'app').
 * المصدر الواحد لأدوات المستخدم: الإحصائية، مسار البحث، المشرف الذكي، المراجع، المفكرة، ملفاتى.
 */
const APP_NAV = [
  { href: '/dashboard', label: 'الإحصائية', key: 'dashboard', icon: 'coins' },
  { href: '/journey', label: 'مسار البحث', key: 'journey', icon: 'graduation' },
  { href: '/chat', label: 'المشرف الذكي', key: 'chat', icon: 'message' },
  { href: '/references', label: 'المراجع', key: 'references', icon: 'book' },
  { href: '/notes', label: 'المفكرة', key: 'notes', icon: 'list' },
  { href: '/files', label: 'ملفاتى', key: 'files', icon: 'clipboard' }
];

/** روابط الحساب أسفل الشريط الجانبي (تظهر للجميع، ولوحة الإدارة للمدير فقط). */
const APP_ACCOUNT_NAV = [
  { href: '/account', label: 'حسابى والرصيد', key: 'account', icon: 'userPlus' },
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

/* ==== عناصر التحكم ==== */
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
input[type=search], input[type=text] {
  padding: 8px 12px; border: var(--line); border-radius: var(--radius-sm);
  background: #fff; color: var(--ink); font-family: inherit; font-size: 12.5px; outline: none;
}
input::placeholder { color: var(--slate); opacity: .7; }
input[type=search]:focus, input[type=text]:focus { border-color: var(--fresh); box-shadow: 0 0 0 3px var(--fresh-12); }
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
.footer-bottom { border-top: 1px solid rgba(216, 243, 239, .18); padding: 15px 20px; text-align: center; font-size: 11px; opacity: .72; }

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
.checklist { margin-top: 22px; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px 20px; }
.checklist li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--slate); }
.checklist li::before {
  content: "✓"; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
  background: var(--mist); color: var(--sea-deep); font-size: 11px; font-weight: 800;
}

/* بطاقة المحادثة التوضيحية */
.chat-card {
  background: #fff; border: 1px solid var(--mist); border-radius: 22px; padding: 18px;
  box-shadow: 0 26px 60px -36px var(--ink-10);
}
.chat-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 13px; border-bottom: 1px solid var(--mist); }
.chat-agent { display: flex; align-items: center; gap: 10px; }
.chat-agent img { padding: 3px; border-radius: 10px; background: var(--paper); }
.chat-agent b { display: block; font-size: 13px; color: var(--ink); }
.chat-agent em { display: block; font-size: 11px; font-weight: 700; font-style: normal; color: var(--sea); }
.chat-pill { padding: 5px 11px; border-radius: 999px; background: var(--mist-soft); color: var(--ink); font-size: 11px; font-weight: 700; }
.chat-body { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; }
.bubble-user { margin-inline-start: auto; max-width: 88%; padding: 10px 14px; border-radius: 16px; background: var(--sea); color: #fff; font-size: 12.5px; line-height: 1.85; }
.bubble-ai { margin-inline-end: auto; max-width: 94%; padding: 12px 14px; border-radius: 16px; background: var(--mist-soft); color: var(--ink); font-size: 12.5px; line-height: 1.95; }
.bubble-ai strong { display: block; margin-bottom: 6px; }
.typing { margin-inline-end: auto; display: flex; gap: 5px; width: fit-content; padding: 12px 14px; border-radius: 14px; background: var(--mist-soft); }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--slate); opacity: .4; animation: zena-blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .18s; }
.typing span:nth-child(3) { animation-delay: .36s; }
@keyframes zena-blink {
  0%, 100% { opacity: .25; transform: translateY(0); }
  50% { opacity: .85; transform: translateY(-3px); }
}

.hero-stats { position: relative; border-top: 1px solid var(--mist); background: var(--paper); }
.hero-stats-inner { max-width: 1100px; margin: 0 auto; padding: 22px 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center; }
.stat-cell b { display: block; font-size: 24px; font-weight: 800; color: var(--sea); }
.stat-cell span { font-size: 12px; font-weight: 600; color: var(--slate); }

/* ==== بطاقات المميزات والخطوات ==== */
.feature-grid { margin-top: 34px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.feature-card {
  background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 22px;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.feature-card:hover { transform: translateY(-3px); border-color: var(--fresh); box-shadow: 0 24px 42px -32px var(--ink-10); }
.feature-icon {
  display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px;
  background: var(--mist-soft); color: var(--sea);
}
.feature-icon.warm { background: var(--apricot-soft); color: var(--ink); }
.feature-card h3 { margin-top: 14px; font-size: 15px; }
.feature-card p { margin-top: 8px; font-size: 12.5px; line-height: 1.95; color: var(--slate); }

.steps-grid { margin-top: 40px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.step-card { position: relative; background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 26px 22px 22px; }
.step-number {
  position: absolute; top: -15px; inset-inline-end: 22px; display: grid; place-items: center;
  width: 32px; height: 32px; border-radius: 50%; background: var(--sea); color: #fff; font-size: 13px; font-weight: 800;
}
.step-card h3 { margin-top: 14px; font-size: 15px; }
.step-card p { margin-top: 8px; font-size: 12.5px; line-height: 1.95; color: var(--slate); }

.costs { margin-top: 34px; background: #fff; border: 1px solid var(--mist); border-radius: 20px; padding: 26px; }
.costs-head { display: flex; align-items: flex-start; gap: 14px; }
.costs-head h3 { font-size: 16px; }
.costs-head p { margin-top: 6px; font-size: 12.5px; line-height: 1.95; color: var(--slate); }
.cost-grid { margin-top: 22px; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.cost-card { background: var(--paper); border: 1px solid var(--mist); border-radius: 14px; padding: 14px; }
.cost-card header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cost-card header b { font-size: 12.5px; color: var(--ink); }
.cost-card p { margin-top: 7px; font-size: 11.5px; color: var(--slate); }
.cost-pill { padding: 3px 10px; border-radius: 999px; background: #fff; color: var(--sea-deep); font-size: 11px; font-weight: 800; white-space: nowrap; }

/* ==== بطاقات الباقات ==== */
.plans { margin-top: 36px; display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
.plan {
  position: relative; display: flex; flex-direction: column; background: #fff;
  border: 1px solid var(--mist); border-radius: 20px; padding: 26px 20px 20px;
}
.plan.featured { border-color: var(--fresh); box-shadow: 0 28px 52px -36px var(--ink-10); }
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
.plan-features { margin: 20px 0 0; padding: 0; list-style: none; display: flex; flex: 1; flex-direction: column; gap: 10px; }
.plan-features li { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.85; color: var(--slate); }
.plan-features li::before { content: "✓"; font-weight: 800; color: var(--fresh); }
.plan .btn { margin-top: 20px; justify-content: center; }
.plans-note { margin-top: 18px; text-align: center; font-size: 12.5px; line-height: 1.95; color: var(--slate); }
.plans-note a { font-weight: 700; }

/* ==== الأسئلة الشائعة ==== */
.faq-list { margin-top: 30px; display: flex; flex-direction: column; gap: 10px; }
.faq-item { background: #fff; border: 1px solid var(--mist); border-radius: 16px; padding: 16px 18px; }
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
.cta-band { background: var(--ink); color: #fff; }
.cta-inner {
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

/* ==== الإشعارات: جرس الترويسة + قائمة الإشعارات داخل الموقع ==== */
.nav-bell {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 12px; border: 1px solid var(--mist);
  background: #fff; color: var(--ink); transition: background .15s ease, border-color .15s ease;
}
.nav-bell:hover { background: var(--mist-soft); border-color: var(--fresh); }
.nav-bell-badge {
  position: absolute; top: -6px; inset-inline-start: -6px; min-width: 18px; height: 18px;
  padding: 0 5px; border-radius: 999px; background: var(--apricot); color: var(--ink);
  font-size: 10px; font-weight: 800; line-height: 18px; text-align: center;
}
.notif-grid { display: grid; gap: 16px; }
.notif-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.notif-list { list-style: none; margin-top: 14px; display: grid; gap: 10px; }
.notif-item {
  display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px;
  border: 1px solid var(--mist); border-radius: 14px; background: #fff;
}
.notif-item.notif-unread { background: var(--mist-soft); border-color: var(--fresh); }
.notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--apricot); margin-top: 7px; flex: none; }
.notif-content { flex: 1; min-width: 0; }
.notif-title { font-weight: 700; font-size: 13.5px; }
.notif-link { color: var(--ink); text-decoration: none; }
.notif-link:hover { color: var(--fresh); }
.notif-body { margin-top: 4px; font-size: 12.5px; line-height: 1.9; color: var(--slate); }
.notif-time { margin-top: 6px; font-size: 11px; color: var(--slate); }
.notif-read-btn { font-size: 11.5px; padding: 7px 11px; flex: none; }
button.btn:disabled { opacity: .55; cursor: not-allowed; }

/* ==== نماذج الملف البحثي ==== */
.onboarding-grid { display: grid; gap: 18px; grid-template-columns: 1.6fr 1fr; align-items: start; }
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
.field label { display: block; margin-bottom: 7px; font-size: 12.5px; font-weight: 700; color: var(--ink); }
.field input[type=text], .field select, .field textarea {
  width: 100%; padding: 11px 13px; border: 1px solid var(--mist); border-radius: 12px; background: #fff;
  color: var(--ink); font-family: inherit; font-size: 13px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.field textarea { min-height: 88px; line-height: 1.8; resize: vertical; }
.field input[type=text]:focus, .field select:focus, .field textarea:focus { border-color: var(--fresh); box-shadow: 0 0 0 3px var(--fresh-12); }
.field-row { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.form-actions { margin-top: 26px; display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }

/* ==== صفحة الحساب ==== */
.account-grid { display: grid; gap: 16px; grid-template-columns: 1.4fr 1fr; }
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
.app-user {
  display: inline-flex; align-items: center; gap: 8px; padding: 3px 11px 3px 5px;
  border-radius: 999px; background: rgba(255, 255, 255, .09); color: #fff;
  font-size: 12px; font-weight: 700; max-width: 210px;
}
.app-user:hover { background: rgba(255, 255, 255, .18); color: #fff; }
.app-user img, .app-user .avatar-xs {
  width: 28px; height: 28px; border-radius: 50%; flex: 0 0 auto; object-fit: cover;
  display: grid; place-items: center; background: var(--paper); color: var(--sea-deep);
  font-size: 12px; font-weight: 800;
}
.app-user-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ==== قائمة الجرس ==== */
.bell-wrap { position: relative; }
.bell-menu {
  position: absolute; top: calc(100% + 9px); inset-inline-start: 0; width: min(370px, 92vw);
  background: #fff; border: 1px solid var(--mist); border-radius: 16px; color: var(--slate);
  box-shadow: 0 26px 48px -26px var(--ink-10); overflow: hidden; z-index: 80;
}
.bell-menu[hidden] { display: none; }
.bell-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 13px; border-bottom: 1px solid var(--mist); }
.bell-head b { color: var(--ink); font-size: 13px; }
.bell-mini {
  border: 0; background: transparent; color: var(--sea); font-family: inherit;
  font-size: 11.5px; font-weight: 700; cursor: pointer; padding: 4px 7px; border-radius: 8px;
}
.bell-mini:hover { background: var(--mist-soft); }
.bell-list { list-style: none; margin: 0; padding: 6px; max-height: 330px; overflow-y: auto; display: grid; gap: 6px; }
.bell-list li { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border-radius: 12px; border: 1px solid transparent; background: var(--paper); }
.bell-list li.unread { background: var(--mist-soft); border-color: var(--fresh-20); }
.bell-item-body { flex: 1; min-width: 0; }
.bell-item-title { color: var(--ink); font-size: 12.5px; font-weight: 700; }
.bell-item-text { margin-top: 3px; font-size: 11.5px; line-height: 1.8; color: var(--slate); }
.bell-item-time { margin-top: 4px; font-size: 10.5px; color: var(--slate); opacity: .85; }
.bell-item-actions { display: grid; gap: 3px; flex: 0 0 auto; }
.bell-empty { padding: 20px 14px; text-align: center; font-size: 12px; color: var(--slate); }
.bell-empty[hidden] { display: none; }
.bell-foot { padding: 9px 13px; border-top: 1px solid var(--mist); text-align: center; font-size: 11.5px; font-weight: 600; }

/* ==== هيكل الصفحة: محتوى يمين + شريط جانبي يسار ==== */
.app-page { padding: 0; }
.app-shell {
  max-width: 1400px; margin: 0 auto; padding: 14px 16px 34px;
  display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 230px; align-items: start;
}
.app-main { grid-column: 1; min-width: 0; }
.app-main .page-head h1 { font-size: 20px; }
.app-side { grid-column: 2; position: sticky; top: 60px; }
.app-nav { background: #fff; border: 1px solid var(--mist); border-radius: 18px; padding: 7px; box-shadow: var(--shadow); display: grid; gap: 2px; }
.app-nav a { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 12px; color: var(--slate); font-size: 12.5px; font-weight: 600; }
.app-nav a:hover { background: var(--mist-soft); color: var(--sea-deep); }
.app-nav a.active { background: var(--ink); color: #fff; font-weight: 700; }
.app-nav a.active .icon { color: var(--fresh); }
.app-nav-label { padding: 9px 11px 3px; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; color: var(--slate); }
.app-nav-sep { height: 1px; background: var(--mist); margin: 6px 9px; }
.app-nav a.danger:hover { background: var(--apricot-soft); color: var(--ink); }

@media (max-width: 900px) {
  .app-shell { grid-template-columns: minmax(0, 1fr); padding: 12px 14px 30px; }
  .app-main { grid-column: 1; }
  .app-side { grid-column: 1; position: static; order: -1; }
  .app-nav { display: flex; overflow-x: auto; gap: 6px; padding: 6px; }
  .app-nav a { white-space: nowrap; padding: 8px 12px; border-radius: 999px; }
  .app-nav-label, .app-nav-sep { display: none; }
  .app-top .brand-text { display: none; }
  .app-user-name { display: none; }
}
`;

/** شريط التنقل مع تمييز الصفحة الحالية. */
function renderNav(activeKey) {
  return NAV_ITEMS.map((item) => {
    const active = item.key === activeKey ? ' class="active"' : '';
    return `<a href="${item.href}"${active}>${escapeHtml(item.label)}</a>`;
  }).join('');
}

/** بطاقة إحصائية واحدة. */
export function renderStat(label, value) {
  return `<div class="stat"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(
    formatNumber(value)
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

/** الشريط العلوي المضغوط للوحة الباحث: الشعار + جرس الإشعارات + حساب المستخدم. */
function renderAppTopbar(account, unread = 0) {
  const name = String(account?.full_name || account?.email || 'باحث').trim();
  const avatar = account?.photo_url
    ? `<img src="${escapeHtml(account.photo_url)}" alt="" width="28" height="28" referrerpolicy="no-referrer" />`
    : `<span class="avatar-xs">${escapeHtml(name.charAt(0) || '؟')}</span>`;

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
        <div class="bell-menu" id="bell-menu" hidden>
          <div class="bell-head">
            <b>الإشعارات</b>
            <button type="button" class="bell-mini" id="bell-read-all">تعليم الكل كمقروء</button>
          </div>
          <ul class="bell-list" id="bell-list"></ul>
          <div class="bell-empty" id="bell-empty">جارٍ تحميل الإشعارات…</div>
          <div class="bell-foot"><a href="/notifications">كل الإشعارات</a> · <a href="/account">حسابى</a></div>
        </div>
      </div>
      <a class="app-user" href="/dashboard" title="لوحتي">${avatar}<span class="app-user-name">${escapeHtml(name)}</span></a>
      <a class="icon-btn" href="/logout" title="تسجيل الخروج" aria-label="تسجيل الخروج">${icon('logout', 'icon-sm')}</a>
    </div>
  </div>
</header>`;
}

/** الشريط الجانبي للوحة الباحث: أدوات البحث ثم روابط الحساب (واللوحة للمدير فقط). */
function renderAppSidebar(activeKey, account) {
  const link = (item) =>
    `<a href="${item.href}"${item.key === activeKey ? ' class="active"' : ''}>${icon(item.icon, 'icon-sm')}<span>${escapeHtml(
      item.label
    )}</span></a>`;

  const tools = APP_NAV.map(link).join('');
  const accountLinks = APP_ACCOUNT_NAV.map(link).join('');
  const admin =
    account?.role === 'admin'
      ? `<a href="/admin"${activeKey === 'admin' ? ' class="active"' : ''}>${icon('shield', 'icon-sm')}<span>لوحة الإدارة</span></a>`
      : '';

  return `<aside class="app-side">
  <nav class="app-nav" aria-label="أدوات الباحث">
    <span class="app-nav-label">أدوات البحث</span>
    ${tools}
    <div class="app-nav-sep"></div>
    <span class="app-nav-label">حسابى</span>
    ${accountLinks}
    ${admin}
    <a class="danger" href="/logout">${icon('logout', 'icon-sm')}<span>تسجيل الخروج</span></a>
  </nav>
</aside>`;
}

/** ترويسة الصفحة العامة: قائمة الموقع + زر الدخول أو الحساب حسب حالة الجلسة. */
function renderPublicHeader(account, unread = 0) {
  const nav = PUBLIC_NAV.map((item) => `<a href="${item.href}">${escapeHtml(item.label)}</a>`).join('');

  const actions = account
    ? `<a class="link-quiet" href="${needsOnboarding(account) ? '/onboarding' : homePathFor(account)}">${
        needsOnboarding(account) ? 'أكمل ملفك البحثي' : account.role === 'admin' ? 'لوحة الإدارة' : 'لوحتي'
      }</a>
       <a class="btn" href="/logout">${icon('logout', 'icon-sm')} خروج</a>`
    : `<a class="link-quiet" href="/login">تسجيل الدخول</a>
       <a class="btn btn-primary" href="/login">ابدأ مجاناً</a>`;

  // جرس الإشعارات يظهر فقط للمسجّل — مع شارة عدد غير المقروء إن وُجدت
  const bell = account
    ? `<a class="nav-bell" href="/notifications" title="الإشعارات" aria-label="الإشعارات">${icon('bell', 'icon-sm')}${
        unread > 0 ? `<span class="nav-bell-badge">${unread > 99 ? '99+' : unread}</span>` : ''
      }</a>`
    : '';

  return `<header class="site-header">
  <div class="site-header-inner">
    ${renderBrand('')}
    <nav class="site-nav">${nav}</nav>
    <div class="site-actions">${bell}${actions}</div>
  </div>
</header>`;
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
        <p>واتساب: ${escapeHtml(SUPPORT_WHATSAPP)}</p>
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
        <li><a href="/account">حسابي ورصيد التوكنز</a></li>
        <li><a href="/onboarding">ملفي البحثي</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    © ${new Date().getFullYear()} ${escapeHtml(APP_NAME)} — جميع الحقوق محفوظة. المنصة أداة مساعدة
    للباحث ولا تُغني عن إشراف الأستاذ المشرف.
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
  scripts = []
}) {
  const documentTitle = title.includes(APP_NAME) ? title : `${title} — ${APP_NAME}`;

  const header =
    area === 'public'
      ? renderPublicHeader(account, unread)
      : area === 'auth'
        ? ''
        : area === 'app'
          ? renderAppTopbar(account, unread)
          : `<header class="topbar">
  <div class="topbar-inner">
    ${renderBrand(activeKey)}
    <nav class="nav">${renderNav(activeKey)}</nav>
  </div>
</header>`;

  const footer =
    area === 'public'
      ? renderPublicFooter()
      : area === 'auth' || area === 'app'
        ? ''
        : `<footer class="footer">
  <span class="footer-brand"><img src="${BRAND.icon}" alt="" width="18" height="18" />${escapeHtml(APP_NAME)}</span>
  <span>Node.js + PostgreSQL · النسخة البرمجية نفسها متاحة كـ JSON على مسارات /api</span>
</footer>`;

  const headBlock = pageHead
    ? `<div class="page-head">
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
  </div>`
    : '';

  const scriptTags = Array.isArray(scripts)
    ? scripts.map((src) => `<script src="${escapeHtml(src)}" defer></script>`).join('\n')
    : '';

  // لوحة الباحث: المحتوى يمين + الشريط الجانبي يسار (RTL: العمود الأول يمين)
  const mainInner =
    area === 'app'
      ? `<div class="app-shell"><div class="app-main">${headBlock}${body}</div>${renderAppSidebar(
        activeKey,
        account
      )}</div>`
      : `${headBlock}${body}`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(APP_NAME)} — ${escapeHtml(APP_TAGLINE)}" />
<meta name="theme-color" content="#102A43" />
<title>${escapeHtml(documentTitle)}</title>
<link rel="stylesheet" href="${BRAND.fonts}" />
<link rel="icon" type="image/svg+xml" href="${BRAND.icon}" />
<link rel="apple-touch-icon" href="${BRAND.roundMark}" />
<style>${STYLES}</style>
</head>
<body>
${header}
<main class="${area === 'auth' ? 'auth-main' : area === 'app' ? 'app-page' : 'page'}">
  ${mainInner}
</main>
${footer}
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

export { APP_NAME, APP_TAGLINE, BRAND, NAV_ITEMS, APP_NAV, APP_ACCOUNT_NAV, STYLES };
