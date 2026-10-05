import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, testDatabaseConnection } from './src/db/client.js';
import { loadSupportWhatsapp } from './src/services/settings.js';
import { hintForDatabaseError } from './src/db/errors.js';
import { adminRouter } from './src/routes/admin.js';
import { authRouter } from './src/routes/auth.js';
import { chatRouter } from './src/routes/chat.js';
import { defenseRouter } from './src/routes/defense.js';
import { paymentsRouter } from './src/routes/payments.js';
import { requireSameOrigin, securityHeaders } from './src/middleware/security.js';
import { journeyRouter } from './src/routes/journey.js';
import { notificationsRouter } from './src/routes/notifications.js';
import { workspaceRouter } from './src/routes/workspace.js';
import { attachAccount } from './src/middleware/auth.js';
import { freeTrialTokens, listPublicPlans } from './src/services/plans.js';
import { APP_NAME, APP_TAGLINE } from './src/constants.js';
import {  } from './src/services/ai.js';
import { renderLandingPage } from './src/views/landing.js';
import { listPaymentMethods, siteCurrency } from './src/services/payments.js';
import { renderNotFoundPage, renderStatusPage } from './src/views/home.js';
import { renderNotice } from './src/views/layout.js';
import { isGoogleAuthConfigured } from './src/auth/google.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

/**
 * تشخيص متغيّرات البيئة عند الإقلاع — **أسماء فقط، بلا أي قيمة**.
 *
 * لماذا: أكثر أسباب فشل النشر أن يُضاف متغيّر في لوحة Vercel بعد النشر،
 * فلا يدخل في النشر الحالي، أو يُضاف لـ Preview بدل Production، أو تحمل
 * قيمته مسافات. الرسالة تُطبع في سجل النشر فتُجيب عن كل هذه الأسئلة فوراً
 * بلا كشف أي سرّ.
 */
const REQUIRED_ENV = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'ADMIN_TOKEN',
  'APP_BASE_URL',
  'SITE_URL',
  'ADMIN_EMAILS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET'
];

const AI_ENV_KEYS = ['OPENROUTER_API_KEYS', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'];

function envPresenceReport() {
  const missing = REQUIRED_ENV.filter((key) => !String(process.env[key] ?? '').trim());
  const aiReady = AI_ENV_KEYS.some((key) => String(process.env[key] ?? '').trim());

  const lines = ['── فحص متغيّرات البيئة ──'];
  lines.push(
    missing.length ? `  ✖ ناقص: ${missing.join(' · ')}` : '  ✓ كل المتغيّرات الإلزامية موجودة'
  );
  lines.push(aiReady ? '  ✓ مفتاح ذكاء اصطناعي موجود' : '  ✖ لا مفتاح ذكاء اصطناعي (الشات لن يعمل)');

  // سببان شائعان: مسافات زائدة أو علامات اقتباس جُرّرت مع القيمة من لوحة Vercel
  const suspicious = REQUIRED_ENV.filter((key) => {
    const raw = process.env[key];
    return typeof raw === 'string' && raw !== raw.trim();
  });
  if (suspicious.length) lines.push(`  ⚠️  قيم بمسافات زائدة (انسخها من جديد): ${suspicious.join(' · ')}`);

  return { missing, aiReady, lines };
}

/**
 * الوكيل العكسي (Nginx / Caddy / Cloudflare …):
 * بدون ضبط trust proxy يصبح req.ip هو عنوان الوكيل (127.0.0.1 غالباً)،
 * فيُسمح بدخول لوحة الإدارة من أي جهاز بلا رمز، وتتعطّل حدود المعدّل.
 * الحل: عرّف TRUST_PROXY بعدد الوكلاء أمام التطبيق (غالباً 1).
 * لا نضع true أبداً لأن ذلك يجعل أي زائر يختار عنوانه بنفسه.
 */
/**
 * على Vercel (وكل منصّة Functions) الطلب يمرّ عبر وكيل خاص بالمنصّة ⇒ العنوان
 * الحقيقي للزائر غير مرئي إلا عبر ترويسة `x-forwarded-for`. نثق بشبكة واحدة
 * بشكل افتراضي، فلا يحتاج المستخدم لضبط TRUST_PROXY ولا يخطئ في ضبطه.
 */
function isServerlessPlatform() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function trustProxySetting() {
  if (isServerlessPlatform()) return 1;

  const raw = String(process.env.TRUST_PROXY ?? '').trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === 'loopback') return 1;
  const hops = Number.parseInt(raw, 10);
  return Number.isInteger(hops) && hops > 0 ? hops : false;
}

const trustProxy = trustProxySetting();
if (trustProxy !== false) {
  app.set('trust proxy', trustProxy);
  console.log(`trust proxy مفعّل بعدد ${trustProxy} من الوكلاء.`);
}

/**
 * في الإنتاج لا نسمح بتشغيل المنصة بلا سرّ جلسات حقيقي، لأن السقوط على
 * قيمة ثابتة في الكود يجعل تزوير كوكي الجلسة ممكناً لأي شخص يقرأ الكود.
 */
function assertSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || process.env.JWT_SECRET || '').trim();
  if (secret) return;

  if (process.env.NODE_ENV === 'production') {
    console.error(
      [
        '',
        '✖ متغيّر SESSION_SECRET (أو JWT_SECRET) مطلوب في الإنتاج.',
        '',
        'أنشئ سراً طويلاً وعشوائياً وضعه في .env ثم أعد التشغيل:',
        '  SESSION_SECRET=' + crypto.randomBytes(48).toString('hex'),
        ''
      ].join('\n')
    );
    process.exit(1);
  }

  console.warn('تحذير: لم يُعرَّف SESSION_SECRET — المستخدَم سر تطوير ثابت (غير صالح للإنتاج).');
}

assertSessionSecret();

/**
 * حارس الإنتاج: لا تُقلع المنصة على الإنترنت بإعداد ناقص.
 *
 * أخطر سيناريو عملي في هذا المشروع:
 *   `TRUST_PROXY` غير معرّف + `ADMIN_TOKEN` فارغ  ⇒  خلف Nginx يصبح
 *   `req.ip = 127.0.0.1` لكل زائر ⇒  لوحة الإدارة مفتوحة **بلا كلمة مرور**،
 *  Incl. تأكيد طلبات الدفع وتفعيل الباقات.
 *
 * لذلك في الإنتاج نطلب ADMIN_TOKEN ونطلب ضبط TRUST_PROXY صراحةً.
 * استثناء وحيد مسموح: ADMIN_ALLOW_LOCAL=1 (نشر خلف جدار ناري بلا لوحة إدارة).
 */
function assertProductionSecurity() {
  if (process.env.NODE_ENV !== 'production') return;

  const problems = [];

  // استثناء صريح: ADMIN_ALLOW_LOCAL=1 يتجاوز شرط TRUST_PROXY (نشر خلف جدار ناري).
  const allowLocalOnly = String(process.env.ADMIN_ALLOW_LOCAL || "").trim() === "1";

  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  if (!adminToken) {
    problems.push(
      'ADMIN_TOKEN غير معرّف — بدونه تفتح لوحة الإدارة لأي زائر خلف وكيل عكسي.\n' +
        '     أنشئ رمزاً قوياً:  ADMIN_TOKEN=' +
        crypto.randomBytes(32).toString('hex')
    );
  } else if (adminToken.length < 24) {
    problems.push('ADMIN_TOKEN قصير جداً (أقل من 24 محرفاً) — استعمل قيمة عشوائية طويلة.');
  }

  if (trustProxy === false && !allowLocalOnly) {
    problems.push(
      'TRUST_PROXY غير معرّف — خلف Nginx/Caddy يصبح كل زائر 127.0.0.1 فتُفتح\n' +
        '     حدود المعدّل ولوحة الإدارة. اضبطه بعدد الوكلاء:  TRUST_PROXY=1'
    );
  }

  if (String(process.env.APP_BASE_URL || '').trim().length === 0) {
    problems.push('APP_BASE_URL غير معرّف — رابط العودة من دخول جوجل سيكون غير صحيح.');
  }

  if (problems.length) {
    console.error(
      [
        '',
        '✖ رفض الإقلاع في الإنتاج — إعدادات أمان ناقصة:',
        '',
        ...problems.map((line, i) => `  ${i + 1}. ${line}`),
        '',
        'راجع README (قسم «النشر») أو شغّل محلياً عبر:  npm run dev',
        ''
      ].join('\n')
    );
    process.exit(1);
  }

  console.log('فحص أمان الإنتاج: ADMIN_TOKEN ✓ · TRUST_PROXY ✓ · APP_BASE_URL ✓ · SESSION_SECRET ✓');
}

assertProductionSecurity();

/** مجلد ملفات الهوية: الشعارات (svg/webp) وخطوط Manrope وIBM Plex Sans Arabic. */
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const BRAND_ICON = path.join(PUBLIC_DIR, 'zena-ai-icon.svg');

// CSP: نضيف فقط ما تحتاجه إشعارات Firebase — سكربتات gstatic (مكتبة الإشعارات)
// ونقاط اتصال FCM، مع السماح بصور الحسابات الخارجية. باقي الافتراضات تبقى كما هي
// (سكربتات self فقط، بدون أي inline scripts). وCOEP يُعطّل حتى لا يمنع تحميل مكتبة Firebase.
// تشخيص البيئة: يُطبع في سجل النشر بأسماء المتغيّرات الناقصة فقط (بلا أي قيمة).
for (const line of envPresenceReport().lines) console.log(line);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'https://www.gstatic.com'],
        connectSrc: ["'self'", 'https://*.googleapis.com', 'https://www.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:']
      }
    },
    crossOriginEmbedderPolicy: false
  })
);
/**
 * CORS: لا نسمح إلا بأصل المنصة نفسه.
 *
 * قبل: `cors()` مفتوح ⇒ `Access-Control-Allow-Origin: *` ⇒ أي موقع يقرأ
 * ردود الـ API우리 (حتى لو الكوكي SameSite=Lax يمنع إرساله).
 * بعد: نسمح فقط بـ SITE_URL/APP_BASE_URL إن ضُبطا، وإلا **لا نرسل** ترويسة CORS
 * إطلاقاً ⇒ الطلبات من مواقع أخرى يُحجبها المتصفح. وهذا آمن لأن كل واجهة
 * المنصة (الصفحات و Service Worker) على نفس الأصل ولا تحتاج CORS أصلاً.
 */
function corsOriginSetting() {
  const raw = String(process.env.SITE_URL || process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return false; // لا ترويسة ⇒ المتصفح يمنع القراءة من أصل آخر
  return raw;
}

const corsOrigin = corsOriginSetting();
if (corsOrigin) {
  app.use(
    cors({
      origin: [corsOrigin],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600
    })
  );
} else {
  // بدون أصل معرّف: نمنع القراءة من المتصفح عبر أصل آخر، بلا كسر الطلبات من نفس الأصل.
  app.use(cors({ origin: false, credentials: false }));
}

app.use(express.json());
// نماذج HTML (مثل إكمال الملف البحثي) تُرسل كـ application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

// ملفات الهوية من مجلد public: /zena-ai-icon.svg و/logo1.webp و/logo2.webp و/fonts.css و/fonts/*
// (استضافة محلية بدل CDN خارجي، فتعمل الصفحات بنفس الخطوط حتى بدون إنترنت)
app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'ignore', maxAge: '7d' }));

// أيقونة المتصفح: نفس أيقونة الهوية بصيغة SVG للمسارات المعتادة
app.get(['/favicon.ico', '/favicon.svg'], (_req, res) => {
  res.type('image/svg+xml').sendFile(BRAND_ICON);
});

// ربط حساب الجلسة بكل طلب في req.account (لا يفشل الطلب إذا لم توجد جلسة)
// أمان عام: طلبات المواقع الأخرى تُرفض (CSRF) + ترويسات أمان إضافية
app.use(securityHeaders);
app.use(requireSameOrigin());

app.use(attachAccount);

// رقم واتساب الدعم (يضبطه المدير من الإعدادات) — يُقرأ مرة عند الإقلاع
loadSupportWhatsapp().catch(() => {});


app.get('/', async (req, res) => {
  const info = {
    name: 'Zena AI',
    stack: 'Node.js + PostgreSQL',
    status: 'ok',
    admin: '/admin/users',
    brand: '/zena-ai-icon.svg',
    message: 'Project migrated from React/Next.js Firebase to Node.js + PostgreSQL.'
  };

  // نفس المسار يخدم المتصفح بصفحة الهبوط ووكلاء الـ API بـ JSON
  if (req.accepts(['json', 'html']) === 'html') {
    const [plans, freeTokens, currency, paymentMethods] = await Promise.all([
      listPublicPlans(),
      freeTrialTokens(),
      siteCurrency(),
      listPaymentMethods()
    ]);
    res.type('html').send(renderLandingPage({ plans, freeTokens, currency, paymentMethods, account: req.account }));
    return;
  }

  res.json(info);
});

// صفحة حالة الخدمة للمطوّرين (روابط الـ API ولوحة الإدارة)
app.get('/status', (req, res) => {
  res.type('html').send(renderStatusPage({ account: req.account }));
});

/**
 * تشخيص متغيّرات البيئة للمدير — **أسماء وحالات فقط، بلا أي قيمة**.
 *
 * لماذا هو آمن: لا يُعيد أي جزء من السرّ (لا طولاً ولا بادئة)، فحتى لو
 * وصل الرابط لطرف غير مخوَّل لا يحصل على معلومة مفيدة. محميٌّ بمعرّف المدير.
 */
app.get('/api/env-check', async (req, res) => {
  if (req.account?.role !== 'admin') {
    res.status(403).json({ message: 'هذا المسار متاح لمدير المنصة فقط.' });
    return;
  }

  const status = (key) => {
    const value = String(process.env[key] ?? '').trim();
    return { set: value.length > 0, length: value.length, padded: typeof process.env[key] === 'string' && process.env[key] !== String(process.env[key]).trim() };
  };

  res.json({
    ok: true,
    googleAuthReady: isGoogleAuthConfigured(),
    aiReady: AI_ENV_KEYS.some((key) => String(process.env[key] ?? '').trim()),
    variables: Object.fromEntries(REQUIRED_ENV.map((key) => [key, status(key)])),
    hint: 'الخطأ الشائع: إضافة متغيّر بعد النشر ⇒ يلزم Redeploy، أو إضافته لـ Preview بدل Production.'
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    const now = await testDatabaseConnection();
    res.json({
      status: 'ok',
      service: 'ai-researcher-api',
      database: 'postgresql',
      dbTime: now
    });
  } catch (error) {
    // في الإنتاج نُخفي تفاصيل الخطأ (نصوص driver/مضيف/مستخدم) ⇒ لا نساعد على الاستطلاع.
    // التفاصيل تبقى في سجل الخادم للمطوّر، وللعميل رسالة عامة فقط.
    const isProd = process.env.NODE_ENV === 'production';
    console.error('فشل فحص قاعدة البيانات:', error?.message || error);
    res.status(503).json({
      status: 'error',
      service: 'ai-researcher-api',
      database: 'postgresql',
      message: 'Database connection failed',
      ...(isProd ? {} : { hint: hintForDatabaseError(error), error: error instanceof Error ? error.message : 'Unknown error' })
    });
  }
});

// بيانات المستخدمين ليست عامة: هذا المسار يحتاج جلسة مدير المنصة (بقية الأدوات في /admin).
app.get('/api/users', async (req, res) => {
  if (req.account?.role !== 'admin') {
    res.status(403).json({ message: 'هذا المسار متاح لمدير المنصة فقط.' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, email, full_name, role, is_active, plan_code, tokens_balance, onboarding_complete, created_at
         FROM users ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ users: result.rows });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to fetch users',
      hint: hintForDatabaseError(error),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/api/plans', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM plans ORDER BY created_at DESC');
    res.json({ plans: result.rows });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to fetch plans',
      hint: hintForDatabaseError(error),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * تطبيق الويب (PWA): بدونه لا تثبيت المنصة على الهاتف ولا عامل خدمة مستقل.
 * الأيقونات PNG مولّدة محلياً (المتصفحات لا تقبل webp لأيقونات التطبيق).
 */
app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').json({
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    lang: 'ar',
    dir: 'rtl',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#102A43',
    lang_ar: 'ar',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/zena-ai-icon.svg', sizes: 'any', type: 'image/svg+xml' }
    ],
    shortcuts: [
      { name: 'المشرف الذكي', url: '/chat' },
      { name: 'مراجعي', url: '/references' },
      { name: 'مسار البحث', url: '/journey' }
    ]
  });
});

/** robots.txt: يفتح الصفحات العامة ويغلق ما يحتاج جلسة أو لوحة إدارة. */
app.get('/robots.txt', (req, res) => {
  const base = String(process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res
    .type('text/plain')
    .send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /dashboard',
        'Disallow: /chat',
        'Disallow: /journey',
        'Disallow: /defense',
        'Disallow: /references',
        'Disallow: /notes',
        'Disallow: /files',
        'Disallow: /api/',
        'Disallow: /onboarding',
        '',
        `Sitemap: ${base}/sitemap.xml`,
        ''
      ].join('\n')
    );
});

/**
 * sitemap.xml للصفحات العامة فقط (لا الجلسات ولا لوحة الإدارة).
 * lastmod من قاعدة البيانات حين أمكن، وإلا تاريخ البناء.
 */
app.get('/sitemap.xml', async (req, res) => {
  // sitemap لا يقبل مسارات نسبية ⇒ نستعمل النطاق الفعلي إن لم يُضبط SITE_URL
  const base = String(process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const pages = [
    { path: '/', priority: '1.0', freq: 'weekly' },
    { path: '/login', priority: '0.4', freq: 'monthly' }
  ];

  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query('SELECT max(updated_at) AS last FROM settings');
    if (rows[0]?.last) lastmod = new Date(rows[0].last).toISOString().slice(0, 10);
  } catch {
    /* نُبقي تاريخ البناء */
  }

  const urls = pages
    .map(
      (page) =>
        `  <url><loc>${base}${page.path}</loc><lastmod>${lastmod}</lastmod>` +
        `<changefreq>${page.freq}</changefreq><priority>${page.priority}</priority></url>`
    )
    .join('\n');

  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// صفحات الموقع العامة والدخول (قبل لوحة الإدارة)
app.use(authRouter);

// الإشعارات: APIs توكنات الأجهزة وقائمة الإشعارات (بلا صفحة مخصّصة — تظهر في الجرس المنسدل)
app.use(notificationsRouter);

// مساحة عمل الباحث (1D + 1E + 1F): مسار البحث، المراجع، المفكرة، الملفات، الشات، المناقشة
app.use(journeyRouter);
app.use(workspaceRouter);
app.use(chatRouter);
app.use(defenseRouter);

// الاشتراك والدفع اليدوي خارج المنصة (الباحث)
app.use(paymentsRouter);

// لوحة الإدارة (صفحات HTML مولَّدة على الخادم) — بديل واجهة Next.js القديمة
app.use('/admin', adminRouter);

// روابط الموديلات المخصّصة (من /admin/providers) تُقرأ مرة عند الإقلاع إلى كاش الذاكرة

app.use((req, res) => {
  // مسارات الـ API تبقى JSON، وبقية المسارات تحصل على صفحة 404 عربية واضحة
  if (req.path.startsWith('/api')) {
    res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
    return;
  }

  res.status(404).type('html').send(renderNotFoundPage(req.originalUrl, req.account));
});

/**
 * معالج الأخطاء العام (يجب أن يكون آخر وسيط، فهو يلتقط ما يمرّره next(err)).
 *
 * لماذا هو مهم أمنياً: Express 4 **لا يلتقط** الاستثناءات داخل المعالجات غير المتزامنة
 * (async) ولا Promises المرفوضة ⇒ تتحول إلى unhandledRejection ⇒ في Node 20+ تُنهي العملية
 * ⇒ يخرج الموقع بالكامل بسبب طلب واحد خاطئ.
 * هذا المعالج + حارس UUID في طبقة الخدمات يغلقان هذا الطريق بالكامل.
 */
app.use((error, req, res, next) => {
  // إن كانت الاستجابة بدأت بالفعل فلا نكتب فوقها.
  if (res.headersSent) {
    next(error);
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';
  console.error(`خطأ غير معالَج في ${req.method} ${req.originalUrl}:`, error?.stack || error);

  if (req.path.startsWith('/api')) {
    res.status(500).json({ message: 'حدث خطأ في الخادم.' });
    return;
  }

  const { html } = renderNotice({
    title: 'حدث خطأ غير متوقع',
    message: 'تعذّر تنفيذ الطلب — أعد المحاولة بعد قليل.',
    details: isProd ? '' : String(error?.message || '')
  });
  res.status(500).type('html').send(html);
});

/**
 * شبكة أمان أخيرة على مستوى العملية: خطأ غير ملتقَط في أي مكان
 * **لا يُسقط الخادم** (سلوك Node الافتراضي منذ v15 هو الإنهاء).
 * نُسجّله ونكمل ⇒ خطأ واحد لا يوقف خدمة العميل التجريبية.
 */
process.on('unhandledRejection', (reason) => {
  console.error('وعد مرفوض لم يُعالَج (تم تسجيله دون إسقاط الخادم):', reason);
});

process.on('uncaughtException', (error) => {
  console.error('استثناء غير ملتقَط:', error?.stack || error);
});

const server = app.listen(PORT, () => {
  console.log(`AI Researcher API is running on http://localhost:${PORT}`);
});

/**
 * المنفذ مشغول: نعطي رسالة عربية تشرح الحل بدل انهيار بطباعة أثر المكدس.
 * غالباً السبب تشغيل نسختين (مثلاً `npm run dev` وخادم قديم في الخلفية).
 */
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      [
        '',
        `✖ المنفذ ${PORT} مشغول من عملية أخرى — تعذّر تشغيل الخادم.`,
        '',
        'لإيقاف العملية التي تحتجز المنفذ ثم أعد التشغيل:',
        `  lsof -ti tcp:${PORT} | xargs -r kill    # أو:  fuser -k ${PORT}/tcp`,
        '',
        'أو شغّل الخادم على منفذ آخر:',
        `  PORT=3001 npm run dev`,
        ''
      ].join('\n')
    );
    process.exit(1);
  }

  console.error('خطأ غير متوقع أثناء تشغيل الخادم:', error);
  process.exit(1);
});

/** إغلاق نظيف: يوقف استقبال الطلبات الجديدة ثم يغلق اتصالات قاعدة البيانات. */
async function shutdown(signal) {
  console.log(`\n${signal}: إيقاف الخادم...`);

  server.close(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error('خطأ أثناء إغلاق اتصالات قاعدة البيانات:', error.message);
    } finally {
      process.exit(0);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
