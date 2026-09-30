import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, testDatabaseConnection } from './src/db/client.js';
import { hintForDatabaseError } from './src/db/errors.js';
import { adminRouter } from './src/routes/admin.js';
import { authRouter } from './src/routes/auth.js';
import { notificationsRouter } from './src/routes/notifications.js';
import { attachAccount } from './src/middleware/auth.js';
import { freeTrialTokens, listPublicPlans } from './src/services/plans.js';
import { renderLandingPage } from './src/views/landing.js';
import { renderNotFoundPage, renderStatusPage } from './src/views/home.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

/** مجلد ملفات الهوية: الشعارات (svg/webp) وخطوط Manrope وIBM Plex Sans Arabic. */
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const BRAND_ICON = path.join(PUBLIC_DIR, 'zena-ai-icon.svg');

// CSP: نضيف فقط ما تحتاجه إشعارات Firebase — سكربتات gstatic (مكتبة الإشعارات)
// ونقاط اتصال FCM، مع السماح بصور الحسابات الخارجية. باقي الافتراضات تبقى كما هي
// (سكربتات self فقط، بدون أي inline scripts). وCOEP يُعطّل حتى لا يمنع تحميل مكتبة Firebase.
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
app.use(cors());
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
app.use(attachAccount);

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
    const [plans, freeTokens] = await Promise.all([listPublicPlans(), freeTrialTokens()]);
    res.type('html').send(renderLandingPage({ plans, freeTokens, account: req.account }));
    return;
  }

  res.json(info);
});

// صفحة حالة الخدمة للمطوّرين (روابط الـ API ولوحة الإدارة)
app.get('/status', (req, res) => {
  res.type('html').send(renderStatusPage({ account: req.account }));
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
    res.status(503).json({
      status: 'error',
      service: 'ai-researcher-api',
      database: 'postgresql',
      message: 'Database connection failed',
      hint: hintForDatabaseError(error),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 50');
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

// صفحات الموقع العامة والدخول (قبل لوحة الإدارة)
app.use(authRouter);

// الإشعارات: صفحة /notifications + APIs توكنات الأجهزة وقائمة الإشعارات
app.use(notificationsRouter);

// لوحة الإدارة (صفحات HTML مولَّدة على الخادم) — بديل واجهة Next.js القديمة
app.use('/admin', adminRouter);

app.use((req, res) => {
  // مسارات الـ API تبقى JSON، وبقية المسارات تحصل على صفحة 404 عربية واضحة
  if (req.path.startsWith('/api')) {
    res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
    return;
  }

  res.status(404).type('html').send(renderNotFoundPage(req.originalUrl, req.account));
});

const server = app.listen(PORT, () => {
  console.log(`AI Researcher API is running on http://localhost:${PORT}`);
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
