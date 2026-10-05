/**
 * فحص سريع لإعدادات النشر قبل الرفع (يعمل بلا خادم وبلا شبكة خارجية):
 *   node --env-file=.env scripts/check-deploy-env.mjs
 *
 * الهدف: أن يجد الإنسان الأخطاء المتكرّرة على Vercel قبل أول نشر،
 * لأن كل خطأ منها يُظهر كـ «Build Error» غامض داخل لوحة Vercel.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const warnings = [];
const ok = [];

const env = (key) => String(process.env[key] ?? '').trim();
const onVercel = Boolean(process.env.VERCEL);

function pass(text) { ok.push(text); }
function warn(text) { warnings.push(text); }
function fail(text) { problems.push(text); }

/* ١) متغيّرات البيئة الإلزامية */
for (const key of ['DATABASE_URL', 'ADMIN_TOKEN', 'SESSION_SECRET']) {
  const value = env(key);
  if (!value) fail(`${key} غير معرّف — بدونه لن يعمل الإنتاج.`);
  else if (key === 'ADMIN_TOKEN' && value.length < 24) fail(`ADMIN_TOKEN قصير (${value.length} محرف) — الحد الأدنى ٢٤.`);
  else pass(`${key} معرّف`);
}

// JWT_SECRET بديل مقبول لـ SESSION_SECRET
if (!env('SESSION_SECRET') && env('JWT_SECRET')) {
  warn('SESSION_SECRET فارغ — سيُستخدم JWT_SECRET كبديل.');
}

if (!env('ADMIN_TOKEN')) {
  fail('بدون ADMIN_TOKEN تفتح لوحة الإدارة لأي زائر خلف الوكيل.');
}

if (env('TRUST_PROXY') === '' && !onVercel) {
  warn('TRUST_PROXY فارغ — مطلوب لو الخادم خلف Nginx/Caddy (على Vercel يُضبط تلقائياً).');
}

const baseUrl = env('APP_BASE_URL');
if (!baseUrl) fail('APP_BASE_URL غير معرّف — رابط العودة من دخول جوجل لن يعمل.');
else if (!/^https?:\/\//.test(baseUrl)) fail('APP_BASE_URL لا يبدأ بـ http:// أو https://');
else pass(`APP_BASE_URL = ${baseUrl}`);

const siteUrl = env('SITE_URL');
if (siteUrl && !/^https?:\/\//.test(siteUrl)) fail('SITE_URL لا يبدأ بـ http:// أو https://');
else if (!siteUrl) warn('SITE_URL فارغ — سيُقيَّد CORS بلا أصل مسموح (يعمل، لكن لا تُنصح به).');

/* ٢) مفتاح AI: بدونه المنصة تعمل لكن الشات يفشل */
const hasAiKey = ['OPENROUTER_API_KEYS', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'].some((k) => env(k));
if (hasAiKey) pass('مفتاح مزوّد ذكاء اصطناعي واحد على الأقل معرّف');
else fail('لا يوجد مفتاح AI (OPENROUTER/GEMINI/GROQ) — الشات والمناقشة لن يعملا.');

/* ٣) مفاتيح دخول Google */
if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) pass('بيانات دخول Google معرّفة');
else fail('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ناقصة — لن يستطيع أحد تسجيل الدخول.');

if (!env('ADMIN_EMAILS')) fail('ADMIN_EMAILS فارغ — لن يدخل أي مدير للوحة.');

/* ٤) ملفات لا بدّ من وجودها على الخادم */
if (existsSync(path.join(ROOT, 'vercel.json'))) pass('vercel.json موجود');
else warn('vercel.json غير موجود — النشر على Vercel قد يحتاج ضبطاً يدوياً.');

if (existsSync(path.join(ROOT, 'public', 'js', 'app-shell.js'))) pass('public/ موجود (الجرس والقوائم)');
else fail('public/ ناقص — الواجهة ستُقدَّم بلا خطوط أو أيقونات.');

/* ٥) تحذير: أسرارFirebas e على القرص لن تُرفع إلى Git */
const serviceAccount = readdirSync(ROOT).find((name) => /firebase-adminsdk.*\.json$/.test(name));
if (serviceAccount) {
  warn(`ملف حساب خدمة Firebase (${serviceAccount}) مستثنى من Git — لن يُرفع مع النشر. إشعارات الهاتف (FCM) معطّلة على Vercel، وهذا مقبول: الإشعارات داخل الموقع تعمل.`);
}

/* ٦) تحذير: حد 4.5MB في Vercel */
if (onVercel) {
  warn('على Vercel حدّ جسم الطلب ٤.٥ م.ب — رفع الملفات (>4.5MB) سيُرفض بـ 413. هذا متوقّع للتجربة الحالية.');
}

/* النتيجة */
console.log('\n=== فحص إعدادات النشر ===\n');
for (const line of ok) console.log(`✅ ${line}`);
if (warnings.length) {
  console.log('');
  for (const line of warnings) console.log(`⚠️  ${line}`);
}
if (problems.length) {
  console.log('');
  for (const line of problems) console.log(`❌ ${line}`);
  console.log(`\n✖ ${problems.length} مشكلة تمنع النشر.\n`);
  process.exit(1);
}
console.log('\n✅ الإعدادات جاهزة للنشر.\n');