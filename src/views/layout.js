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
  { href: '/references', label: 'المراجع', key: 'references', icon: 'book' },
  { href: '/notes', label: 'المفكرة', key: 'notes', icon: 'list' },
  { href: '/files', label: 'ملفاتى', key: 'files', icon: 'clipboard' }
];

/** رابط المشرف الذكي منفصلاً: يُعرض أسفل القائمة وفوق سجل الجلسات (ChatGPT/Claude). */
const APP_CHAT_NAV = { href: '/chat', label: 'المشرف الذكي', key: 'chat', icon: 'message' };

/**
 * روابط الحساب: الحساب والملف البحثي في الشريط العلوي، وتعديل الملف من
 * بطاقات الإحصائية ومسار البحث — فلا تكرار في السايدبار.
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
.field label, .field-label { display: block; margin-bottom: 7px; font-size: 12.5px; font-weight: 700; color: var(--ink); }
.field input[type=text], .field select, .field textarea {
  width: 100%; padding: 11px 13px; border: 1px solid var(--mist); border-radius: 12px; background: #fff;
  color: var(--ink); font-family: inherit; font-size: 13px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.field textarea { min-height: 88px; line-height: 1.8; resize: vertical; }
.field input[type=text]:focus, .field select:focus, .field textarea:focus { border-color: var(--fresh); box-shadow: 0 0 0 3px var(--fresh-12); }

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
@media (max-width: 900px) {
  .file-viewer { grid-template-columns: minmax(0, 1fr); }
  .file-preview--pdf iframe { height: 62vh; }
}

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

/* ============ مساحة عمل الباحث: مسار البحث والمراجع والمفكرة والملفات والشات ============ */
/* ترويسة بطاقة: العنوان يمين وزر إجراء يسار (مثل «إضافة توكنز» في الإحصائية) */
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
.chat-composer {
  display: flex; align-items: flex-end; gap: 8px; border-top: 1px solid var(--mist); padding-top: 11px;
}
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
  .app-top .brand-text { display: none; }
  .app-user-name { display: none; }
  .chat-card { height: 70vh; min-height: 420px; }
  .chat-nav { margin-top: 0; }
  .chat-list { max-height: 120px; }
  .chat-side-note { display: none; }
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
          <div class="bell-foot"><a href="/notifications">كل الإشعارات</a> · <a href="/dashboard">لوحتي</a></div>
        </div>
      </div>
      <a class="app-user" href="/dashboard" title="لوحتي">${avatar}<span class="app-user-name">${escapeHtml(name)}</span></a>
      <a class="icon-btn" href="/account" title="حسابي ورصيد التوكنز" aria-label="حسابي ورصيد التوكنز">${icon('user', 'icon-sm')}</a>
      <a class="icon-btn" href="/logout" title="تسجيل الخروج" aria-label="تسجيل الخروج">${icon('logout', 'icon-sm')}</a>
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

  const admin =
    account?.role === 'admin'
      ? `<a href="/admin"${activeKey === 'admin' ? ' class="active"' : ''}>${icon('shield', 'icon-sm')}<span>لوحة الإدارة</span></a>`
      : '';

  return `<aside class="app-side">
  <nav class="app-nav" aria-label="أدوات الباحث">
    <div class="app-nav-sep first"></div>
    ${APP_NAV.map(link).join('')}
    ${admin}
    <div class="app-nav-foot">
      <div class="app-nav-sep"></div>
      ${link(APP_CHAT_NAV)}
      ${navBottom}
    </div>
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
  scripts = [],
  navBottom = '',
  fitViewport = false
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
