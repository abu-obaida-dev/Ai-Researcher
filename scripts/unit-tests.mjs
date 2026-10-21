/**
 * اختبارات وحدة للخدمات الحرجة (بلا خادم وبلا طلبات شبكة):
 *   node --test scripts/unit-tests.mjs
 * تغطي: حساب النقاط وتوحيد استهلاك المزوّدين · عملة المنصة · التحقّق من المدخلات
 * · تطبيع النص العربي (أساس ترشيح المراجع) · التحقّق من رقم واتساب الدعم.
 * اختبار الدخان الحيّ (scripts/smoke-phase1.mjs) يغطّي ما يحتاج قاعدة بيانات.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('النظافة الأمنية (H4): لا تبعيات ميتة ولا تجاوز لفحص uuid', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const dead of ['express-session', 'cookie-parser', 'jsonwebtoken', 'google-auth-library']) {
    assert.ok(!(pkg.dependencies || {})[dead], `التبعية الميتة حُذفت: ${dead}`);
  }
  assert.ok(pkg.overrides?.uuid, 'تجاوز uuid المرقّع موجود (^11.1.1)');
});

import { chargeUsage, estimateReservation, estimateTokens, normalizeUsage } from '../src/services/tokens.js';
import { normalizeCurrency } from '../src/services/payments.js';
import {
  askedForReferenceTitle,
  buildSearchQuery,
  extractTopic,
  isTopicSpecific,
  literatureToolFor,
  normalizeArabic,
  relevanceScore
} from '../src/services/literature.js';
import { LIBRARY_SOURCES, SOURCE_GROUPS, assertPublicUrl, normalizeYearRange, sourceGroup } from '../src/services/library-sources.js';
import { loadSupportWhatsapp, saveSupportWhatsapp } from '../src/services/settings.js';
import { assertContentMatchesExtension, contentMatchesExtension } from '../src/services/upload-guard.js';
import { safeEqual } from '../src/middleware/security.js';
import { needsOnboarding, requireCoreOnboarding } from '../src/middleware/auth.js';
import { renderOnboardingPage } from '../src/views/auth.js';
import { buildSystemPrompt } from '../src/services/supervisor-prompt.js';
import { PROVIDERS, classifyFailure } from '../src/services/ai.js';
import {
  INPUT_BUDGETS,
  MODEL_INPUT_BUDGETS,
  budgetForModel,
  measurePayloadTokens,
  trimFilesInSystem,
  trimPayloadToBudget
} from '../src/services/payload-budget.js';
import {
  applyQuestionToState,
  defenseProgress,
  extractDefenseFinalTag,
  extractQuestionFromReply,
  maxQuestionsFor,
  nextPendingPart,
  planParts
} from '../src/services/defense.js';
import { evaluateStepCompletion, specForStep } from '../src/services/step-review.js';
// ملاحظة (إصلاح C1): وظائف «ترتيب المصادر» و«دفائف البحث» و«اشتقاق العبارة من السجل»
// أُزيلت عمداً من assistant.js في commit 54d0d51 — المعلم لم يعد يبحث في المكتبة
// نيابةً عن الباحث (الباحث يبحث بنفسه)، فحُذفت اختباراتها هنا لتطابق التصميم الجديد.
import { extractLastSuggestedQuery } from '../src/services/assistant.js';
import {
  ASSISTANT_REPLY_CAPS,
  buildAssistantPrompt,
  detectAssistantTask,
  isExplicitSearchRequest
} from '../src/services/assistant-prompt.js';
import { isUuid } from '../src/constants.js';
import { SESSION_TTL_MS, createSessionCookie } from '../src/auth/google.js';

/* ------------------------------- النقاط ------------------------------- */

test('estimateTokens: تقدير سريع وعامل 2.6', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens('abcd'), Math.ceil(4 / 2.6));
  assert.ok(estimateTokens('مرحباً بكم في المنصة') > 0);
});

test('estimateReservation: الحجز ≥ 1 ويغطّي الإدخال + سقف الرد', () => {
  const empty = estimateReservation({ replyCap: 0, system: '', messages: [] });
  assert.equal(empty.credits, 1, 'لا استخدام ⇒ حجز أدنى 1');
  assert.ok(estimateReservation().credits >= 1, 'السقف الافتراضي للرد يُحتسب');

  const small = estimateReservation({ system: 's'.repeat(100), messages: [{ content: 'سؤال' }], replyCap: 200 });
  const big = estimateReservation({ system: 's'.repeat(4000), messages: [{ content: 'س'.repeat(4000) }], replyCap: 4000 });
  assert.ok(big.credits > small.credits, 'رسالة أكبر ⇒ حجز أكبر');
  assert.ok(Number.isInteger(small.credits));
});

test('normalizeUsage: يوحّد OpenAI وGemini ويضمّ نقاط التفكير', () => {
  const openai = normalizeUsage({ prompt_tokens: 100, completion_tokens: 20 });
  assert.deepEqual(openai, { inputTokens: 100, outputTokens: 20 });

  // نقاط التفكير خارج candidates ⇒ تُحتسب إخراجاً (وإلا خسرنا 10% من الاستخدام)
  const gemini = normalizeUsage({ promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 100 });
  assert.deepEqual(gemini, { inputTokens: 10, outputTokens: 105 });

  assert.deepEqual(normalizeUsage(null), { inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(normalizeUsage({ prompt_tokens: 'x' }), { inputTokens: 0, outputTokens: 0 });
});

test('chargeUsage: خصم صحيح ومعامل الباقة وسقف أدنى 1', () => {
  const base = chargeUsage({ inputTokens: 1000, outputTokens: 1000, multiplier: 1 });
  assert.ok(base.credits >= 1);
  assert.equal(base.inputTokens, 1000);

  const double = chargeUsage({ inputTokens: 1000, outputTokens: 1000, multiplier: 2 });
  assert.ok(double.credits >= base.credits, 'معامل أعلى لا يقلّل الخصم');

  assert.equal(chargeUsage({ inputTokens: 0, outputTokens: 0, multiplier: 1 }).credits, 1, 'سقف أدنى 1');
  assert.equal(chargeUsage({ inputTokens: -50, multiplier: 1 }).inputTokens, -50, 'لا نغيّر الأرقام السالبة (الخصم يتولّاها)');
});

/* ------------------------------- الدفع ------------------------------- */

test('normalizeCurrency: يقبل المدعوم ويُرجع الافتراضي لغيره', () => {
  assert.equal(normalizeCurrency('lyd'), 'LYD');
  assert.equal(normalizeCurrency(' USD '), 'USD');
  assert.equal(normalizeCurrency('EUR'), 'LYD', 'عملة غير مدعومة ⇒ الافتراضي');
  assert.equal(normalizeCurrency(''), 'LYD');
  assert.equal(normalizeCurrency(null), 'LYD');
});

/* --------------------------- تطبيع النص العربي --------------------------- */

test('normalizeArabic: يوحّد الهمزات والتاء المربوطة ويزيل التشكيل', () => {
  assert.equal(normalizeArabic('أسماء'), normalizeArabic('اسماء'));
  assert.equal(normalizeArabic('المكتبة'), normalizeArabic('المكتبه'));
  assert.equal(normalizeArabic('إدارة'), normalizeArabic('اداره'));
  assert.equal(normalizeArabic('مُدَرِّس'), normalizeArabic('مدرس'));
  assert.equal(normalizeArabic(''), '');
});

test('extractTopic: يحذف عبارة الطلب ولا يقطع الكلمات', () => {
  assert.ok(!extractTopic('اقترحلي مراجع').includes('مراجع'));
  // كان الحذف يقطع الكلمات: «لي» من «التعليم» و«مع» من «معالجة»
  assert.ok(extractTopic('التعلم الآلي في التعليم العالي').includes('التعليم'));
  // extractTopic مطبَّع (ة→ه) ⇒ نقارن بصيغته المطبَّعة لا الأصلية
  assert.ok(extractTopic('معالجة اللغة الطبيعية').includes(normalizeArabic('معالجة')));
});

test('isTopicSpecific: الموضوع بالاسم مقبول، والعبارة العامة مرفوضة', () => {
  assert.equal(isTopicSpecific('تكنولوجيا المعلومات وإدارة التغيير التنظيمي'), true);
  assert.equal(isTopicSpecific(''), false);
  assert.equal(isTopicSpecific('من فضلك'), false);
});

test('buildSearchQuery: يضيف المقابل الإنجليزي للمصطلحات المعروفة', () => {
  const q = buildSearchQuery({ topic: 'التعلم العميق' });
  assert.ok(q.includes('deep learning'), q);

  // «الطبيعيه» ليست «الطب» ⇒ لا نضيف medicine خطأً
  assert.ok(!buildSearchQuery({ topic: 'اللغة الطبيعية' }).includes('medicine'));
});

test('normalizeYearRange: فلتر سنة الإصدار — قلب المعكوس ورفض الشاذ واستقلال الطرفين', () => {
  // من > إلى يُقلَبان بدل رفض البحث
  assert.deepEqual(normalizeYearRange('2020', '2015'), { from: 2015, to: 2020 });
  // بلا قيم أو بقيم شاذة ⇒ بلا ترشيح (0)
  assert.deepEqual(normalizeYearRange('', ''), { from: 0, to: 0 });
  assert.deepEqual(normalizeYearRange('منذ', 4000), { from: 0, to: 0 });
  assert.deepEqual(normalizeYearRange('abc', '20x4'), { from: 0, to: 0 });
  // طرف واحد يكفي (من-بدون-إلى / إلى-بدون-من)
  assert.deepEqual(normalizeYearRange(2019, ''), { from: 2019, to: 0 });
  assert.deepEqual(normalizeYearRange('', '2024'), { from: 0, to: 2024 });
  // المدى السليم يبقى كما هو
  assert.deepEqual(normalizeYearRange('2010', '2024'), { from: 2010, to: 2024 });
});

test('LIBRARY_SOURCES: كل المصدر مسجّل ببيانات مكتملة ومجموعة معروفة', () => {
  for (const id of ['springer', 'wiley', 'tandf', 'sage', 'unpaywall', 'internetarchive', 'loc', 'core', 'pmc', 'hal', 'base', 'ssrn', 'toubkal']) {
    const entry = LIBRARY_SOURCES.find((item) => item.id === id);
    assert.ok(entry, `المصدر مفقود: ${id}`);
    assert.ok(entry.label && entry.hint, `بيانات ناقصة: ${id}`);
  }
  // كل المصدر (بما فيه القديمة) له مجموعة في SOURCE_GROUPS — وإلا اختفى من القائمة المنسدلة
  for (const item of LIBRARY_SOURCES) {
    const group = sourceGroup(item.id);
    assert.ok(SOURCE_GROUPS.some((entry) => entry.id === group), `مجموعة ناقصة: ${item.id}`);
  }
});

test('relevanceScore: العنوان المطابق يتقدّم على غير المطابق', () => {
  const topic = 'تكنولوجيا المعلومات وإدارة التغيير';
  const match = relevanceScore({ title: 'دور تكنولوجيا المعلومات في إدارة التغيير', venue: 'مجلة', abstract: '' }, topic);
  const miss = relevanceScore({ title: 'الفلك والكون', venue: 'أخرى', abstract: '' }, topic);
  assert.ok(match > miss, `${match} > ${miss}`);
});

/* --------------------------- دعم واتساب --------------------------- */

test('saveSupportWhatsapp: يقبل الصيغ ويصدّر الناقص', async () => {
  // هذه الاختبارات تكتب في settings الحقيقية محلياً — نحمي رقم الدعم المحفوظ
  // ونعيده كما كان في finally حتى لا يضيع الرقم الحقيقي مع كل `npm test`.
  const original = await loadSupportWhatsapp();
  try {
    assert.equal((await saveSupportWhatsapp('')).ok, true, 'فارغ = تعطيل الزر');
    assert.equal((await saveSupportWhatsapp('0912')).ok, false, 'أقل من 8 أرقام مرفوض');
    assert.equal((await saveSupportWhatsapp('09abc')).ok, false, 'حروف مرفوضة');
    assert.equal((await saveSupportWhatsapp('1234567890123456789')).ok, false, 'أكثر من 15 رقماً مرفوض');
  } finally {
    await saveSupportWhatsapp(original || '');
  }
});

/* ------------------ أمان: بصمة الملفات المرفوعة ------------------ */

const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const zipWith = (marker) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(marker)]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);

test('upload-guard: يقبل الملفات الحقيقية لكل صيغة مسموحة', () => {
  const good = [
    ['pdf', PDF],
    ['png', PNG],
    ['jpg', JPG],
    ['jpeg', JPG],
    ['webp', WEBP],
    ['doc', OLE2],
    ['xls', OLE2],
    ['ppt', OLE2],
    ['zip', ZIP],
    ['docx', zipWith('word/document.xml')],
    ['xlsx', zipWith('xl/workbook.xml')],
    ['pptx', zipWith('ppt/presentation.xml')],
    ['txt', Buffer.from('نص البحث العادي\nسطر ثانٍ')],
    ['md', Buffer.from('# عنوان\n\nنص')],
    ['csv', Buffer.from('a,b,c\n1,2,3')]
  ];
  for (const [ext, buffer] of good) {
    assert.ok(contentMatchesExtension(ext, buffer), `${ext} يجب أن يُقبل`);
  }
});

test('upload-guard: يرفض ملفاً متنكّراً بامتداد آخر (الاستغلال الأساسي)', () => {
  const evil = [
    ['pdf', Buffer.from('<html><script>alert(1)</script></html>')],
    ['pdf', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])], // ملف ELF تنفيذي
    ['png', Buffer.from('<svg onload=alert(1)>')],
    ['jpg', PDF],
    ['webp', Buffer.from('<script>alert(1)</script>')],
    ['docx', ZIP], // ZIP بلا مجلد word/
    ['xlsx', zipWith('word/document.xml')], // docx متنكّر xlsx
    ['pptx', zipWith('xl/workbook.xml')],
    ['xlsx', PDF]
  ];
  for (const [ext, buffer] of evil) {
    assert.equal(contentMatchesExtension(ext, buffer), false, `${ext} متنكّر يجب أن يُرفض`);
  }
});

test('upload-guard: النصي يرفض ملفاً ثنائياً متنكّراً، ويقبل نصاً فيه HTML', () => {
  assert.equal(contentMatchesExtension('txt', Buffer.from([0x00, 0x01, 0x02, 0x00])), false, 'ثنائي (NUL)');
  assert.equal(contentMatchesExtension('txt', Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])), false, 'محارف تحكّم');

  // نص عادي قد يحوي HTML — يُقبل لأن العرض يمرّ بـ text/plain + escapeHtml دائماً.
  assert.equal(contentMatchesExtension('txt', Buffer.from('<script>alert(1)</script>\nنص البحث')), true);
  assert.equal(contentMatchesExtension('md', Buffer.from('# عنوان\n\n<script>x</script>')), true);
  assert.equal(contentMatchesExtension('csv', Buffer.from('name,note\n"sheet1","<b>عريض</b>"')), true);
});

test('upload-guard: الملف الفارغ مرفوض، وepub يُفحص كتوقيع ZIP', () => {
  assert.throws(() => assertContentMatchesExtension('pdf', Buffer.alloc(0)), /BAD_CONTENT|لا يطابق/);
  // epub حاوية ZIP ⇒ نتحقق من توقيعه أيضاً (وليس امتداداً غير مفحوص)
  assert.equal(contentMatchesExtension('epub', zipWith('mimetypeapplication/epub+zip')), true);
  assert.equal(contentMatchesExtension('epub', Buffer.from('mimetypeapplication/epub+zip')), false, 'بلا توقيع ZIP مرفوض');
});

/* ------------------ أمان: المقارنة الآمنة زمنياً ------------------ */

test('safeEqual: تقارن بدقة ولا تقبل قيماً مختلفة', () => {
  assert.equal(safeEqual('abc123', 'abc123'), true);
  assert.equal(safeEqual('abc123', 'abc124'), false);
  assert.equal(safeEqual('abc', 'abcd'), false, 'طول مختلف ⇒ false');
  assert.equal(safeEqual('', ''), false, 'فارغ يُرفض دائماً (يمنع دخول بلا رمز)');
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual('abc123', null), false);
});

/* ---------- أمان: حارس UUID (يمنع إسقاط الخادم عبر رابط واحد) ---------- */

test('isUuid: يقبل UUID حقيقياً ويرفض كل ما عداه', () => {
  assert.equal(isUuid('766edb5a-8f20-474a-b8fa-c3cc9ce8fe62'), true);
  assert.equal(isUuid('766EDB5A-8F20-474A-B8FA-C3CC9CE8FE62'), true, 'غير حسّاس لحالة الأحرف');

  const bad = [
    'abc',
    'undefined',
    '',
    null,
    undefined,
    '../../etc/passwd',
    "' OR 1=1--",
    '766edb5a-8f20-474a-b8fa-c3cc9ce8fe6', // ناقص محرف
    '766edb5a-8f20-474a-b8fa-c3cc9ce8fe622', // زائد محرف
    '766edb5a8f20474ab8fac3cc9ce8fe62' // بلا شرطات
  ];
  for (const value of bad) {
    assert.equal(isUuid(value), false, `${String(value)} يجب أن يُرفض`);
  }
});

/* ------------- بوابة الملف الجزئية (P0-2): قراءة مفتوحة، سياق محمي ------------- */

/** وسيطات وهمية: يلتقط التوجيه أو الاكتمال بلا خادم. */
function mockRes() {
  const res = { statusCode: 302, location: '', redirected: false };
  res.redirect = (_code, url) => {
    res.redirected = true;
    res.location = url;
  };
  return res;
}

test('needsOnboarding: المدير وباحث مكمل بلا حاجة، والباحث الجديد بحاجة', () => {
  assert.equal(needsOnboarding(null), false, 'بلا حساب لا طلب');
  assert.equal(needsOnboarding({ role: 'admin' }), false, 'المدير لا يحتاج ملفاً');
  assert.equal(needsOnboarding({ role: 'researcher', onboarding_complete: true }), false);
  assert.equal(needsOnboarding({ role: 'researcher', onboarding_complete: false }), true);
  assert.equal(needsOnboarding({ role: 'researcher' }), true, 'غياب العلامة = غير مكتمل');
});

test('requireCoreOnboarding: يحوّل غير المكمل إلى /onboarding بالعودة ?next=', () => {
  const req = { account: { role: 'researcher', onboarding_complete: false }, originalUrl: '/chat?step=methodology' };
  const res = mockRes();
  let continued = false;

  requireCoreOnboarding(req, res, () => {
    continued = true;
  });

  assert.equal(continued, false, 'لا يمرّ لغير المكمل');
  assert.equal(res.redirected, true);
  assert.ok(res.location.startsWith('/onboarding?next='), res.location);
  assert.ok(res.location.includes(encodeURIComponent('/chat?step=methodology')), 'يحفظ وجهة العودة');

  // المكتمل يمرّ بلا توجيه
  const okReq = { account: { role: 'researcher', onboarding_complete: true }, originalUrl: '/chat' };
  const okRes = mockRes();
  let passed = false;
  requireCoreOnboarding(okReq, okRes, () => {
    passed = true;
  });
  assert.equal(passed, true, 'الباحث المكمل يمرّ');
  assert.equal(okRes.redirected, false);

  // بلا حساب ⇒ صفحة الدخول
  const anonReq = { account: null, originalUrl: '/journey' };
  const anonRes = mockRes();
  requireCoreOnboarding(anonReq, anonRes, () => {});
  assert.ok(anonRes.location.startsWith('/login?next='), anonRes.location);
});

test('صفحة الملف: مستقلة بلا سايدبار قبل الإكمال، وداخل اللوحة بعده', () => {
  const values = { degree_level: '', research_field: '', custom_field: '', research_stage: '', progress_stage: '' };

  const fresh = renderOnboardingPage({
    account: { role: 'researcher', email: 'new@example.com', full_name: 'باحث جديد', onboarding_complete: false },
    values
  });
  assert.ok(!fresh.includes('<aside class="app-side">'), 'لا سايدبار قبل إكمال الملف');
  assert.ok(!fresh.includes('<header class="app-top">'), 'لا شريط علوي قبل إكمال الملف');
  assert.ok(fresh.includes('class="onboarding-standalone"'), 'حاوية الصفحة المستقلة موجودة');
  assert.ok(fresh.includes('أكمل ملفك البحثي'), 'عنوان واضح للمهمة');
  assert.ok(fresh.includes('href="/logout"'), 'طريق للخروج من الصفحة المستقلة');

  const done = renderOnboardingPage({
    account: { role: 'researcher', email: 'done@example.com', full_name: 'باحث مكمل', onboarding_complete: true },
    values,
    profile: { research_field: 'الحقوق' }
  });
  assert.ok(done.includes('<aside class="app-side">'), 'السايدبار يظهر بعد إكمال الملف');
  assert.ok(done.includes('<header class="app-top">'), 'الشريط العلوي يظهر بعد الإكمال');
  assert.ok(!done.includes('class="onboarding-standalone"'), 'لا حاوية مستقلة بعد الإكمال');
});

test('المشرف: أول رد يستعمل سياق الـ onboarding ويقود بخطوة واحدة لا بسؤال عام', () => {
  const ctx = {
    userName: 'gik knk',
    degree: 'باحث ماجستير',
    field: 'علوم الحاسب',
    title: 'غير محدد',
    university: 'غير محدد',
    language: 'العربية',
    citationStyle: 'APA 7',
    currentStage: 'اختيار الموضوع',
    researchGoal: 'اختيار فكرة أو موضوع البحث',
    researchGoalKey: 'topic',
    progressLevel: 'لم أبدأ بعد',
    stepsStatus: 'تحديد المشكلة: لم يبدأ',
    journeyCompleted: false,
    memorySummary: '',
    openTask: '',
    daysSinceLast: 0,
    strikes: 0,
    mode: 'normal',
    files: '',
    fileNames: [],
    replyCap: 900
  };

  const first = buildSystemPrompt({ ...ctx, isFirstMessageEver: true });

  // بيانات الملف تصل السياق كاملاً (الهدف + الحالة إلى جانب الدرجة والتخصص)
  assert.ok(first.includes('الدرجة: باحث ماجستير'));
  assert.ok(first.includes('الهدف الحالي من إنجاز البحث: اختيار فكرة أو موضوع البحث'));
  assert.ok(first.includes('حالة تقدّمه في مشروعه: لم أبدأ بعد'));

  // سلوك الترحيب: يقود للخطوة التالية ولا يسأل سؤالاً عاماً
  assert.ok(first.includes('# الترحيب والبداية (أول رسالة في تاريخه)'));
  assert.ok(first.includes('نقطة الانطلاق المناسبة لهدفه'), 'يقترح أول خطوة تناسب هدفه');
  assert.ok(first.includes('لا تقترحي له موضوعاً أو عنواناً جاهزاً'), 'لا تكتب الموضوع للباحث');
  assert.ok(first.includes('سؤال واحد في الرد كله'), 'قاعدة السؤال الواحد محفوظة');
  assert.ok(!first.includes('اسأليه عما يريد إنجازه اليوم'), 'لا سؤال عام بعد');

  // بلا هدف مطابق للقوائم: يبقى توجيه عام بخطوة واحدة بدل فقدان التوجيه
  const noKey = buildSystemPrompt({ ...ctx, researchGoalKey: '', isFirstMessageEver: true });
  assert.ok(noKey.includes('اختاري أول خطوة منطقية من مساره الحالية'));

  // بعد أول رسالة: لا ترحيب ولا قسم ترحيب إطلاقاً
  const later = buildSystemPrompt({ ...ctx, isFirstMessageEver: false });
  assert.ok(later.includes('لا ترحيب إطلاقاً'));
  assert.ok(!later.includes('# الترحيب والبداية (أول رسالة في تاريخه)'));
  assert.ok(!later.includes('نقطة الانطلاق المناسبة لهدفه'));
});

test('المشرف في خطوة topic: تستخرج المشكلة بالأسئلة ولا تصيغ مشكلة أو فرضية جاهزة', () => {
  const base = {
    userName: 'سارة',
    degree: 'باحثة ماجستير',
    field: 'علوم الحاسب',
    title: 'غير محدد',
    university: 'غير محدد',
    language: 'العربية',
    citationStyle: 'APA 7',
    currentStage: 'تحديد المشكلة والفرضيات',
    researchGoal: 'اختيار فكرة أو موضوع البحث',
    researchGoalKey: 'topic',
    progressLevel: 'لدي موضوع محدد',
    stepsStatus: 'تحديد المشكلة والفرضيات: جاري',
    journeyCompleted: false,
    memorySummary: '',
    openTask: '',
    daysSinceLast: 0,
    isFirstMessageEver: false,
    strikes: 0,
    mode: 'normal',
    files: '',
    fileNames: [],
    replyCap: 900,
    currentStepKey: 'topic'
  };

  const atTopic = buildSystemPrompt(base);
  assert.ok(atTopic.includes('# مرحلة المشكلة والفرضيات: تستخرجين ولا تكتبين'), 'قسم الخطوة موجود');
  assert.ok(atTopic.includes('لا تكتبي له مشكلة بحثية جاهزة ولا فرضية جاهزة'), 'ممنوع تأليف المشكلة/الفرضيات');
  assert.ok(atTopic.includes('بأسئلة إرشادية، سؤالاً واحداً في كل رد'), 'الاستخلاص بأسئلة وسؤال واحد');
  assert.ok(atTopic.includes('ناقشين قابليتها للقياس والاختبار'), 'الفرضيات نقاش لا اقتراح جاهز');

  // قاعدة الطلب الصريح: رفض بلا صياغة بديلة وبلا مثال قريب + سؤال واحد فقط
  assert.ok(atTopic.includes('لا تكتبي أي صياغة بديلة، ولا تضعي مثالاً قريباً من موضوعه'), 'لا صياغة بديلة ولا مثال قريب');
  assert.ok(atTopic.includes('اسأليه سؤالاً إرشادياً واحداً فقط في هذا الرد'), 'سؤال إرشادي واحد فقط');

  // سلوك الرد: لا سؤال مزدوج ولا اقتراحات/أمثلة غير مطلوبة مع السؤال الإرشادي
  assert.ok(atTopic.includes('لا تذكري سؤالاً ثانياً إلى جانب السؤال الإرشادي'), 'ممنوع السؤال الثاني في الرد');
  assert.ok(atTopic.includes('لا تجمعي سؤالين معاً'), 'ممنوع جمع سؤالين في سؤال واحد');
  assert.ok(
    atTopic.includes('لا تذكر أمثلة أو خيارات أو اقتراحات من عندك، إلا إذا طلب الباحث صراحة أمثلة أو خيارات'),
    'لا أمثلة أو خيارات من عندك بلا طلب صريح'
  );

  // اقتراح الباحث مشكلة أو فرضية: تصور أولي لا اعتماد نهائي
  assert.ok(atTopic.includes('لا تصفيها بأنها «مشكلة بحثية مؤكدة» أو «فرضية جيدة»'), 'لا اعتماد صريح للاقتراح');
  assert.ok(atTopic.includes('تصوراً أولياً يحتاج إلى اختبار وتحديد'), 'الاقتراح تصور أولي');
  assert.ok(
    atTopic.includes('«هذا اتجاه محتمل»، «هذه فكرة يمكن تطويرها»، «لنحدد كيف يمكن قياسها»'),
    'عبارات الرد المقترحة الثلاث'
  );

  // المراجع ممنوعة كلياً في topic: تسجيل موضوع عام وحده لا يكفي
  assert.ok(atTopic.includes('المراجع ممنوعة تماماً في هذه المرحلة'), 'ممنوع المراجع في topic');
  assert.ok(atTopic.includes('وتسجيله وحده لا يكفي'), 'العنوان العام لا يفتح المراجع');
  assert.ok(atTopic.includes('قبل البحث عن المراجع نحتاج أولاً إلى تحديد المشكلة'), 'رفض لطيف ثم سؤال الحدود');
  assert.ok(atTopic.includes('سؤال إرشادي واحد فقط يستكمل به تحديد المشكلة'), 'سؤال إرشادي واحد في الرد');
  const registered = buildSystemPrompt({ ...base, topicRecorded: 'الذكاء الاصطناعي في التعليم' }, { references: 5 });
  assert.ok(registered.includes('المراجع ممنوعة تماماً'), 'المسجَّل العام لا يرفع المنعية');
  assert.ok(!registered.includes('# أداة المراجع (نتائج حقيقية من قواعد البيانات)'), 'لا يُحقن قسم الأداة في topic');
  assert.ok(registered.includes('لا تكتبي أي صياغة بديلة'), 'قاعدة الرفض تبقى بعد التسجيل');

  // خارج الخطوة: لا القسم (حتى لو كانت الرسالة في مرحلة أخرى) — وقسم الأداة يعود
  const later = buildSystemPrompt({ ...base, currentStepKey: 'proposal' }, { references: 5 });
  assert.ok(!later.includes('# مرحلة المشكلة والفرضيات'), 'يسقط بعد topic');
  assert.ok(!later.includes('لا تذكر أمثلة أو خيارات أو اقتراحات من عندك'), 'القاعدة الجديدة تسقط مع القسم خارج topic');
  assert.ok(!later.includes('تصوراً أولياً يحتاج إلى اختبار وتحديد'), 'قاعدة «تصور أولي» تسقط مع القسم خارج topic');
  assert.ok(later.includes('# أداة المراجع (نتائج حقيقية من قواعد البيانات)'), 'خارج topic يُحقن قسم الأداة');

  // وضع المناقشة يستثناه (لا تُحقن فيه أقسام الرحلة)
  const def = buildSystemPrompt({ ...base, mode: 'defense' });
  assert.ok(!def.includes('# مرحلة المشكلة والفرضيات'), 'غائب في وضع المناقشة');
});

test('بوابة الانتقال بين المراحل: التزام بـ currentStepKey ورفض للمرحلة المستقبلية بسؤال واحد', () => {
  const base = {
    userName: 'خالد',
    degree: 'باحث ماجستير',
    field: 'علوم الحاسب',
    title: 'الذكاء الاصطناعي في التعليم',
    university: 'غير محدد',
    language: 'العربية',
    citationStyle: 'APA 7',
    currentStage: 'تحديد المشكلة والفرضيات',
    researchGoal: 'اختيار فكرة أو موضوع البحث',
    researchGoalKey: 'topic',
    progressLevel: 'لدي موضوع محدد',
    stepsStatus: 'تحديد المشكلة والفرضيات: جاري · المنهجية: لم يبدأ',
    journeyCompleted: false,
    memorySummary: '',
    openTask: '',
    daysSinceLast: 0,
    isFirstMessageEver: false,
    strikes: 0,
    mode: 'normal',
    files: '',
    fileNames: [],
    replyCap: 900,
    currentStepKey: 'topic'
  };

  const atTopic = buildSystemPrompt(base);
  assert.ok(atTopic.includes('# قواعد الانتقال بين المراحل'), 'القسم موجود');
  assert.ok(atTopic.includes('التزمي دائماً بخطوته الحالية'), 'التزام بـ currentStepKey');
  assert.ok(atTopic.includes('لا تقدّمي محتوى أو إرشاد خطوة لم يصل إليها بعد'), 'لا محتوى لخطوة لم يبلغها');
  assert.ok(atTopic.includes('حتى لو طلبها صراحة، ولو كأنه شرحاً عاماً'), 'لا شرح عام للمرحلة القادمة');
  assert.ok(atTopic.includes('لا تنفّذي طلبه'), 'رفض التنفيذ لا مجرد التوجيه');
  assert.ok(atTopic.includes('سؤالاً واحداً فقط يعينه على إكمال خطوته الحالية'), 'الرد سؤال واحد يخدم الحالية');
  assert.ok(atTopic.includes('ما زلنا في مرحلة تحديد المشكلة والفرضيات'), 'مثال الرد يحمل مرحلته ديناميكياً');

  // عامة: تعمل في منتصف المسار أيضاً — ليست من topic وحدها
  const mid = buildSystemPrompt({ ...base, currentStepKey: 'methodology', currentStage: 'المنهجية وعينة البحث' });
  assert.ok(mid.includes('# قواعد الانتقال بين المراحل'), 'تعمل عند أي خطوة');
  assert.ok(mid.includes('ما زلنا في مرحلة المنهجية وعينة البحث'), 'اسم المرحلة يتبع currentStage');
  assert.ok(!mid.includes('# مرحلة المشكلة والفرضيات'), 'قسم topic يبقى خاصاً به');

  // تسقط: وضع المناقشة (قواعدها الخاصة) وعند اكتمال المسار (لا خطوة حالية)
  const defPrompt = buildSystemPrompt({ ...base, mode: 'defense' });
  assert.ok(!defPrompt.includes('# قواعد الانتقال بين المراحل'), 'غائبة في وضع المناقشة');
  const finished = buildSystemPrompt({ ...base, currentStepKey: '', journeyCompleted: true });
  assert.ok(!finished.includes('# قواعد الانتقال بين المراحل'), 'غائبة بلا خطوة حالية');
});

/* -------- بطاقة مراجعة اكتمال الخطوة: الكشف الحتمي (نقافي بلا قاعدة بيانات) -------- */

test('specForStep: مواصفة حتمية لكل خطوة معروفة وسقوط آمن للمجهول', () => {
  for (const key of ['topic', 'proposal', 'literature', 'methodology', 'data', 'analysis', 'writing', 'discussion', 'defense']) {
    const spec = specForStep(key);
    assert.ok(spec.fields.length >= 3, `${key}: ٣ حقول على الأقل`);
    assert.ok(
      spec.fields.every((field) => field.key && field.label && field.pattern instanceof RegExp),
      `${key}: كل حقل له مفتاح وسمّي ونمط`
    );
    assert.equal(spec.isFallback, undefined, `${key}: مواصفة معروفة لا تُعدّ سقوطاً`);
  }

  const fallback = specForStep('does-not-exist');
  assert.equal(fallback.isFallback, true);
  assert.ok(fallback.fields.length >= 1, 'السقوط الآمن يبقى بحقول حقيقية');
  assert.equal(specForStep('').isFallback, true, 'مفتاح فارغ ⇒ السقوط الآمن');
});

test('evaluateStepCompletion: مؤشرات الخطوة كاملة ⇒ بطاقة مكتملة بالقيم', () => {
  const transcript = [
    'الباحث: اعتمدت المنهج الوصفي لدراستي وحددت العينة بحجم 200 مستجيب، والأداة المعدّة استبانة ميدانية.',
    'المشرفة: ممتاز — المنهج والعينة والأداة واضحة، انتقل لجمع البيانات.'
  ].join('\n');

  const result = evaluateStepCompletion({ stepKey: 'methodology', transcript, stepTitle: 'المنهجية وعينة البحث' });
  assert.equal(result.complete, true, 'المنهج + العينة + الأداة كلها وُجدت');
  assert.equal(result.matched, result.total);
  assert.equal(result.stepTitle, 'المنهجية وعينة البحث');
  assert.equal(result.fields.length, 3);
  assert.ok(
    result.fields.every((field) => field.matched && field.value.length > 0),
    'كل حقل حمل قيمة مستخرجة من النص'
  );
  assert.ok(result.fields.find((field) => field.key === 'method').value.includes('المنهج الوصفي'));
  assert.ok(result.fields.every((field) => !field.value.includes('\n')), 'القيمة سطر واحد');
});

test('evaluateStepCompletion: حديث ناقص لا يكتمل والحقول غير الموقّعة تبقى فارغة', () => {
  const result = evaluateStepCompletion({ stepKey: 'methodology', transcript: 'كيف أكتب مقدمة بحثي؟' });
  assert.equal(result.complete, false, 'لا كشف بلا مؤشرات كافية');
  assert.ok(result.matched < result.total);
  assert.ok(result.fields.some((field) => !field.matched && field.value === ''));
  assert.equal(evaluateStepCompletion({}).complete, false, 'بلا نص لا اكتمال');
});

test('evaluateStepCompletion: السقوط الآمن لخطوة غير معرّفة (إنجاز معلن + ملخص)', () => {
  const done = evaluateStepCompletion({
    stepKey: 'brand-new-step',
    transcript: 'أنجزت المطلوب في هذه الخطوة. ملخص: أكملت كل البنود المطلوبة.'
  });
  assert.equal(done.isFallback, true);
  assert.equal(done.complete, true, 'إنجاز معلن + ملخص يكفيان في السقوط الآمن');
  assert.ok(done.fields.every((field) => field.value.length > 0));

  const notDone = evaluateStepCompletion({ stepKey: 'brand-new-step', transcript: 'ما رأيك في الطقس اليوم؟' });
  assert.equal(notDone.complete, false, 'حديث بلا إنجاز لا يولّد بطاقة');
});
/* ------------------------------- المعلم ------------------------------- */

test('detectAssistantTask: كشف حتمي للمهمة (تعليم/ترجمة/تلخيص)', () => {
  assert.equal(detectAssistantTask({ question: 'أريد أن أتعلم كيف أهيكل بحثي' }), 'teach');
  assert.equal(detectAssistantTask({ question: 'ما هو الإطار النظري؟' }), 'teach');
  assert.equal(detectAssistantTask({ question: 'ترجم هذا الملف' }), 'translate');
  assert.equal(detectAssistantTask({ question: 'translate the attached file' }), 'translate');
  assert.equal(detectAssistantTask({ question: 'لخص لي مراجع عن التسويق الرقمي' }), 'summarize');
  assert.equal(detectAssistantTask({ question: 'ابحث لي في المكتبة عن مصادر' }), 'summarize');
  // الترجمة تتقدّم على التلخيص لو جاءتا معاً (الملف هو المقصد)
  assert.equal(detectAssistantTask({ question: 'ترجم ولخص هذا الملف' }), 'translate');
});

test('متابعة البحث عند المعلم: «نعم/الأولى» بعد اقتراح عبارات ⇒ تلخيص لا تعليم', () => {
  const history = [
    { role: 'user', content: 'ابحث في المكتبة ولخص لي أهم ما يتعلق بتخصصي' },
    {
      role: 'assistant',
      content: 'لم نجد نتائج مطابقة. كلمات مفتاحية مقترحة للبحث:\n1. **AI in Computer Science Education** (الذكاء في تعليم الحاسب)\n2. **Machine Learning for CS Students** (تعلم الآلة للطلاب)\n3. **Intelligent Tutoring Systems in CS** (أنظمة التدريس الذكية)'
    }
  ];
  assert.equal(detectAssistantTask({ question: 'نعم اعد البحث باستخدام اول كلمه', history }), 'summarize');
  assert.equal(detectAssistantTask({ question: 'الأولى', history }), 'summarize');
  assert.equal(detectAssistantTask({ question: '2', history }), 'summarize');
  // موضوع جديد صريح ⇒ تلخيص عبر الرسالة نفسها لا عبر السجل
  assert.ok(isExplicitSearchRequest('ابحث عن التعلم العميق'), 'طلب صريح يُكتشف');
  assert.ok(!isExplicitSearchRequest('نعم اعد البحث'), 'المتابعة ليست طلباً صريحاً');

  // (حُذف اشتقاق العبارة من السجل extractQueryFromHistory — لم يعد المعلم يبحث
  //  بنفسه بعد الالتزام بالتصميم الجديد؛ الاختبار يغطي دالة الاشتقاق الباقية.)
  assert.equal(
    extractLastSuggestedQuery(history),
    'AI in Computer Science Education',
    'آخر عبارة مقترحة هي الأولى ترتيباً (الأحدث في السرد)'
  );
  // سؤال تعليمي حقيقي بعد البحث ⇒ تعليم لا تلخيص
  assert.equal(detectAssistantTask({ question: 'ما هو الإطار النظري؟', history }), 'teach');
});

test('buildAssistantPrompt: قواعد المعلم حسب المهمة (تفصيل للمبتدئين · أمثلة من المجال · بلا اختلاق)', () => {
  const teach = buildAssistantPrompt({
    task: 'teach',
    field: 'علوم الحاسب',
    degree: 'bachelor',
    title: 'نظام كشف الاحتيال المالي'
  });
  assert.ok(teach.includes('التعليم'), 'مهمة التعليم معروفة للنموذج');
  assert.ok(teach.includes('لا تختلق مرجعاً'), 'منع الاختلاق يسري على كل المهام');
  assert.ok(teach.includes('المعلم'), 'الهوية واضحة');
  assert.ok(teach.includes('علوم الحاسب'), 'تخصص الباحث يُحقن');
  assert.ok(teach.includes('نظام كشف الاحتيال المالي'), 'عنوان البحث يُحقن لربط الأمثلة به');
  assert.ok(teach.includes('طالب جامعي (بكالوريوس)'), 'رمز الدرجة يُحوَّل لتسمية عربية');
  assert.ok(teach.includes('بالتفصيل الممل'), 'أسلوب التفصيل للمبتدئين منصوص');
  assert.ok(teach.includes('حصراً من تخصصه نفسه') || teach.includes('تخصص الباحث نفسه'), 'الأمثلة من المجال نفسه حصراً');
  assert.ok(teach.includes('ممنوع'), 'منع أمثلة المجالات الأخرى صريح');
  assert.ok(teach.includes('سجل المحادثة'), 'حفظ السياق منصوص في القواعد العامة');

  const translate = buildAssistantPrompt({ task: 'translate' });
  assert.ok(translate.includes('الترجمة'), 'مهمة الترجمة معروفة');

  const summarize = buildAssistantPrompt({ task: 'summarize' });
  // حدّ التلخيص الجديد (commit 54d0d51): تلخيص مرفق الباحث فقط — لا بحث نيابةً عنه.
  assert.ok(summarize.includes('تلخّص ما وُفّر من الباحث فقط'), 'التلخيص يقيَّد بما وُفّر من الباحث');
  assert.ok(summarize.includes('لا تبحث بنفسك'), 'المعلم لا يبحث في المكتبة نيابةً عن الباحث');
});

test('ASSISTANT_REPLY_CAPS: سقف الترجمة أطول من التعليم والتلخيص (حدّ واحد لكل مهمة)', () => {
  // (استُبدل هذا الاختبار باختبار assistantSourceBatches المحذوف — المعلم لم يعد
  //  يبحث في المكتبة خارجياً بعد قرار التصميم الجديد، فأُلغيت دفائف المصادر.)
  assert.equal(ASSISTANT_REPLY_CAPS.translate > ASSISTANT_REPLY_CAPS.teach, true, 'سقف الترجمة أطول');
  assert.equal(ASSISTANT_REPLY_CAPS.translate > ASSISTANT_REPLY_CAPS.summarize, true, 'الترجمة أطول من التلخيص');
  assert.ok(
    Object.values(ASSISTANT_REPLY_CAPS).every((cap) => Number.isInteger(cap) && cap > 0),
    'كل السقوف موجبة صحيحة'
  );
});

test('حارس SSRF الموسّع (H2): يرفض الداخلية والخاصة والصيغ الرقمية ويقبل العامة', () => {
  // عامة مقبولة
  assert.doesNotThrow(() => assertPublicUrl('https://api.openalex.org/works?search=test'));
  assert.doesNotThrow(() => assertPublicUrl('http://lx2.loc.gov:210/lcdb?version=1.1'));
  // داخلية كلاسيكية
  for (const bad of [
    'http://localhost:3000/x',
    'http://127.0.0.1/',
    'http://0.0.0.0/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://example.local/x',
    'ftp://example.com/x'
  ]) {
    assert.throws(() => assertPublicUrl(bad), /شبكة داخلية|غير صالح/, `مرفوض: ${bad}`);
  }
  // (H2) صيغ بديلة وتوجيه-مموّهة: عشرية كاملة وسداسية وCGNAT وIPv6 خاصة
  for (const bad of [
    'http://2130706433/', // 127.0.0.1 عشرية
    'http://0x7f000001/', // 127.0.0.1 سداسية
    'http://100.64.0.1/', // CGNAT
    'http://[fc00::1]/',
    'http://[fe80::1]/'
  ]) {
    assert.throws(() => assertPublicUrl(bad), /شبكة داخلية|غير صالح/, `مرفوض: ${bad}`);
  }
});

test('مرجع الهياكل الأكاديمية: الأنواع السبعة كاملة وأسلوب «التفصيل داخل التفصيل»', () => {
  const ctx = {
    userName: 'سارة', degree: 'باحثة ماجستير', field: 'العلوم التربوية',
    title: 'فعالية التعلم النشط', university: 'غير محدد', language: 'العربية',
    citationStyle: 'APA 7', currentStage: 'الإطار النظري', researchGoal: 'كتابة الفصول',
    researchGoalKey: 'writing', progressLevel: 'أكتب فصول البحث', stepsStatus: 'الإطار النظري: جاري',
    journeyCompleted: false, memorySummary: '', openTask: '', daysSinceLast: 0,
    isFirstMessageEver: false, strikes: 0, mode: 'normal', files: '', fileNames: [],
    replyCap: 900, currentStepKey: 'literature'
  };
  const prompt = buildSystemPrompt(ctx);

  // الأنواع السبعة كلها موجودة
  for (const marker of [
    'هيكلية ورقة العمل (Working Paper)',
    'هيكلية الورقة البحثية (Research Paper)',
    'هيكلية مشروع البكالوريوس',
    'هيكلية مشروع الدبلوم',
    'هيكلية مقترح رسالة الماجستير',
    'هيكلية رسالة الماجستير',
    'هيكلية أطروحة الدكتوراه',
    'الفرق الأساسي بين المستويات'
  ]) {
    assert.ok(prompt.includes(marker), `النوع مفقود: ${marker}`);
  }

  // أسلوب التفصيل: كل جزء باسمه ووظيفته (عيّنة من ثلاث هيئات)
  assert.ok(prompt.includes('الملخص — نبذة مختصرة'), 'شرح وظيفة الملخص في ورقة العمل');
  assert.ok(prompt.includes('مراجعة الأدبيات): أوسع وأكثر نقداً من ماجستير'), 'تمييز أطروحة الدكتوراه');
  assert.ok(prompt.includes('الإطار النظري المختصر'), 'خصوصية الدبلوم');

  // حدود: شرح بنية فقط — لا كتابة محتوى
  assert.ok(prompt.includes('ولا تكتبي محتوى أي قسم من بحثه'), 'الهيكلية لا تعني كتابة المحتوى');
});

/* ------------- جلسة المناقشة: لا «فخ» المراجع (تشخيص رسالة ١٥ أكتوبر) ------------- */

test('askedForReferenceTitle: سؤال المناقشة «بعنوان… ومراجعات…؟» لا يُعدّ سؤال مراجع', () => {
  // الرسالة الواقعية التي أطلقت البوابة زوراً في جلسة defense:
  const exam = [
    {
      role: 'assistant',
      content:
        'ورقتك البحثية المثبتة بعنوان: "EGLS" ومراجعات العدالة (Fairness Audits) تفشل في منع الانجراف.\n' +
        'السؤال: كيف يُثبت المعيار من الناحية المنهجية أن الفصل الهيكلي كافٍ؟'
    },
    { role: 'user', content: 'المفروض عندك فى البحث الاجابه' }
  ];
  assert.equal(askedForReferenceTitle(exam), false, 'سؤال أكاديمي فيه «مراجعات» لا يُفعّل البوابة');

  // أسئلة المراجع الحقيقية ما تزال تعمل:
  assert.equal(
    askedForReferenceTitle([{ role: 'assistant', content: 'في أي عنوان بالتحديد تريد المراجع؟' }]),
    true,
    'السؤال الصريح يُعدّ'
  );
  assert.equal(
    askedForReferenceTitle([{ role: 'assistant', content: 'هل تحتاج مراجع حول مشكلتك البحثية؟' }]),
    true,
    'طلب مباشر للمراجع يُعدّ'
  );
  assert.equal(
    askedForReferenceTitle([{ role: 'user', content: 'أي شيء' }]),
    false,
    'رسائل الباحث لا تُعدّ سؤالاً من المشرفة'
  );
});

test('أداة المراجع: رسالة بلا طلب مراجع لا تُشغّلها أصلاً (ترجع null بلا شبكة)', async () => {
  const result = await literatureToolFor('المفروض عندك فى البحث الاجابه', {});
  assert.equal(result, null, 'wantsLiterature = false وaskedBefore = false ⇒ null');
});

test('جلسة المناقشة: الموجّه بلا قواعد مراجع وبلا قسم نتائج الأداة', () => {
  const base = {
    userName: 'gik knk',
    degree: 'باحث ماجستير',
    field: 'علوم الحاسب',
    title: 'الذكاء الاصطناعي في التعليم',
    university: '—',
    citationStyle: 'APA 7',
    language: 'العربية',
    currentStage: 'المقدمة ومشكلة البحث',
    researchGoal: 'إنهاء البحث',
    progressLevel: 'لدي موضوع محدد',
    stepsStatus: 'تحديد المشكلة والفرضيات: جاري',
    journeyCompleted: false,
    memorySummary: '',
    openTask: '',
    daysSinceLast: 0,
    isFirstMessageEver: false,
    strikes: 0,
    mode: 'defense',
    files: '',
    fileNames: [],
    replyCap: 900,
    currentStepKey: ''
  };

  const def = buildSystemPrompt(base, { references: 5 });
  assert.ok(def.includes('# المناقشة الأكاديمية المستقلة'), 'قسم المناقشة موجود');
  assert.ok(!def.includes('# أداة المراجع (نتائج حقيقية من قواعد البيانات)'), 'لا يُحقن قسم نتائج الأداة في defense');
  assert.ok(!def.includes('العنوان الذي يريد مراجع عنه'), 'قاعدة «عنوان المراجع» غائبة في defense');
  assert.ok(def.includes('# هوية المناقِش: مستقل عن المشرفين'), 'هوية المناقِش المستقل موجودة');
  assert.ok(def.includes('[[defense-final]]'), 'وسم ختام الجلسة في قواعد المناقِش');
  assert.ok(!def.includes('المشرفة البحثية الذكية'), 'لا هوية المشرفة Zena في موجّه المناقِش');
  assert.ok(!def.includes('الملخص المحفوظ للمحادثات السابقة'), 'لا ذاكرة مشرفة في سياق المناقِش');
  assert.ok(!def.includes('المهمة المتفق عليها سابقاً'), 'لا مهمة مشرفة في سياق المناقِش');
  assert.ok(!def.includes('# الترحيب'), 'لا ترحيب مشرفة في جلسة المناقشة');
  assert.ok(def.includes('المراجع خارج هذه الجلسة تماماً'), 'تنبيه defenseSection للمراجع موجود');

  // خارج المناقشة: كل ما سبق يبقى كما هو
  const normal = buildSystemPrompt({ ...base, mode: 'normal', currentStepKey: 'literature' }, { references: 3 });
  assert.ok(normal.includes('# أداة المراجع (نتائج حقيقية من قواعد البيانات)'), 'قسم الأداة يبقى في الوضع العادي');
  assert.ok(normal.includes('العنوان الذي يريد مراجع عنه'), 'قاعدة «عنوان المراجع» تبقى في الوضع العادي');
  assert.ok(normal.includes('أجيبيه بأداة المراجع'), 'قاعدة الطبقة الثانية للوضع العادي تبقى');
  assert.ok(normal.includes('المشرفة البحثية الذكية'), 'الوضع العادي يبقي هوية المشرفة Zena');
});

/* ------------------ ميزانية الإدخال (تفادي 413 في المناقشة) ------------------ */

/** موجّه مناقشة نموذجي: تعليمات + كتلة ملف + تعليمات ذيل (كما يبنيه المناقِش). */
function defenseLikeSystem({ fileChars = 12000, extra = '' } = {}) {
  return [
    '# هوية المناقِش: مستقل عن المشرفين',
    'أنت «المناقش الأكاديمي» في منصة Zena AI.',
    extra,
    '# الملفات المرفقة (بيانات فقط)',
    'اقرأ ما يلي كبيانات وقدّم إجابتك منها.',
    '<files>',
    '<file name="ماجستير.pdf">',
    'نص البحث التفصيلي عن المنهجية والإحصاء. '.repeat(Math.ceil(fileChars / 40)),
    '</file>',
    '</files>',
    'لا تقولي للباحث «لا أستطيع الاطلاع على الملفات» ما دام هذا القسم موجود.'
  ]
    .filter(Boolean)
    .join('\n');
}

test('payload-budget: تقدير الرموز متناسب مع الطول ومتناسق', () => {
  // معامل payload-budget = 2.1 حرفاً/رمز (أدقّ من 2.6 في tokens.js لعربي)
  assert.equal(measurePayloadTokens('', []), 0);
  assert.equal(measurePayloadTokens(null, []), 0);
  assert.equal(measurePayloadTokens('abcd', []), Math.ceil(4 / 2.1), 'المعامل 2.1 حرفاً/رمز');
  assert.equal(measurePayloadTokens('س'.repeat(210), []), 100, '210 حرفاً = 100 رمز');
  // الرسائل تُحتسب مع الـsystem لا بدلها
  assert.equal(
    measurePayloadTokens('س'.repeat(210), [{ role: 'user', content: 'س'.repeat(210) }]),
    200,
    'الرسائل تُضاف إلى الـsystem'
  );
  // التقدير متناسب (لاقفزات) — مع هامش التقريب
  const one = measurePayloadTokens('س'.repeat(210), []);
  const twenty = measurePayloadTokens('س'.repeat(4200), []);
  assert.ok(Math.abs(twenty - one * 20) <= 2, `العلاقة خطّية تقريباً (${one} ⇒ ${twenty})`);
});

test('payload-budget: ميزانية كل نموذج على حدة وأضيق من ميزانية المزوّد', () => {
  // gpt-oss-20b: حدّ TPM 8000 ⇒ 4000 · qwen3.8-27b: حدّ ITPM 7000 ⇒ 3600
  // allam-2-7b: سياق 4096 فقط ⇒ 2800
  // (الأرقام بهامش أمان تحت حدود Groq الفعلية — انظر payload-budget.js)
  assert.equal(MODEL_INPUT_BUDGETS['openai/gpt-oss-20b'], 4000);
  assert.equal(MODEL_INPUT_BUDGETS['qwen/qwen3.8-27b'], 3600);
  assert.equal(MODEL_INPUT_BUDGETS['allam-2-7b'], 2800);

  assert.equal(budgetForModel('openai/gpt-oss-20b', 'groq'), 4000);
  assert.equal(budgetForModel('qwen/qwen3.8-27b', 'groq'), 3600);
  assert.equal(budgetForModel('allam-2-7b', 'groq'), 2800);

  // نموذج مجهول: نأخذ أضيق ميزانية معروفة (أأمن) لا أعرضها
  const unknown = budgetForModel('some/new-model', 'groq');
  assert.ok(unknown <= INPUT_BUDGETS.groq, 'النموذج المجهول لا يتجاوز ميزانية المزوّد');
  assert.ok(unknown >= 2000, 'ميزانية النموذج المجهول ليست بلا فائدة');

  // ميزانية كل نموذج على حدة ولا تتجاوز ميزانية المزوّد العام
  for (const [model, budget] of Object.entries(MODEL_INPUT_BUDGETS)) {
    assert.ok(budget <= INPUT_BUDGETS.groq, `${model} لا يتجاوز ميزانية Groq العامة`);
  }
  // ولكل نموذج حدّه الخاص (أضيق أو مساوٍ)
  assert.ok(
    MODEL_INPUT_BUDGETS['qwen/qwen3.8-27b'] <= MODEL_INPUT_BUDGETS['openai/gpt-oss-20b'],
    'qwen3.8 أضيق من gpt-oss-20b'
  );
  assert.ok(
    MODEL_INPUT_BUDGETS['allam-2-7b'] < MODEL_INPUT_BUDGETS['qwen/qwen3.8-27b'],
    'allam-2-7b أضيق من qwen3.8'
  );
});

test('payload-budget: برومبت المناقشة الضخم يُقصّ إلى الميزانية (تفادي 413)', () => {
  const system = defenseLikeSystem({ fileChars: 12000 });
  const messages = [
    { role: 'user', content: 'سؤال سابق ' + 'ط'.repeat(800) },
    { role: 'assistant', content: 'رد سابق ' + 'ر'.repeat(800) },
    { role: 'user', content: 'السؤال الأخير: ما المنهجية المستخدمة في اختبار الفرضية؟' }
  ];

  const before = measurePayloadTokens(system, messages);
  assert.ok(before > 3000, 'البرومبت الأصلي يتجاوز الميزانية (شرط الاختبار)');

  const result = trimPayloadToBudget(system, messages, 3000);
  assert.ok(result.trimmed, 'وُسم أن القَصّ جرى');
  assert.ok(result.tokens <= 3000, `الحمولة بعد القصّ ${result.tokens} ≤ 3000`);
  assert.ok(result.tokens <= before, 'القصّ لم يزيد الحجم');
  assert.ok(result.fileChars > 0, 'بقي جزء من نصّ الملف — لم نُفرغه كاملاً');
});

test('payload-budget: الملف يُقصّ قبل الرسائل (مصدر الحقيقة أولاً)', () => {
  const system = defenseLikeSystem({ fileChars: 12000 });
  const messages = [
    { role: 'user', content: 'سؤال قديم ' + 'ط'.repeat(2000) },
    { role: 'user', content: 'السؤال الأخير: ما المنهجية؟' }
  ];

  const result = trimPayloadToBudget(system, messages, 2500);
  assert.ok(result.tokens <= 2500, 'ضمن الميزانية');
  assert.ok(result.fileChars > 0, 'نصّ الملف باقٍ بعد القصّ');
  assert.ok(
    result.messages[0].content.length < 2000 || result.messages.length === 1,
    'الرسالة الأقدم قُصّت أولاً'
  );
  assert.equal(
    result.messages.at(-1).content,
    'السؤال الأخير: ما المنهجية؟',
    'آخر رسالة (سؤال الباحث) لم تُمسّ'
  );
});

test('payload-budget: تعليمات المشرف (الرأس والذيل) محفوظة رغم القصّ', () => {
  const system = defenseLikeSystem({ fileChars: 12000 });
  const messages = [{ role: 'user', content: 'السؤال الأخير: ما المنهجية؟' }];

  for (const budget of [800, 1200, 2000, 3000, 5000]) {
    const result = trimPayloadToBudget(system, messages, budget);
    assert.ok(result.tokens <= budget, `ميزانية ${budget}: الحمولة ضمن الحدّ`);
    assert.ok(
      result.system.includes('# هوية المناقِش: مستقل عن المشرفين'),
      `ميزانية ${budget}: هوية المناقِش (رأس الموجّه) محفوظة`
    );
    assert.ok(
      result.system.includes('لا تقولي للباحث «لا أستطيع الاطلاع على الملفات»'),
      `ميزانية ${budget}: تعليمة الذيل محفوظة`
    );
  }
});

test('payload-budget: وسوم <file> تبقى سليمة (لا <file> بلا </file>)', () => {
  const system = defenseLikeSystem({ fileChars: 20000 });
  const messages = [{ role: 'user', content: 'سؤال؟' }];

  for (const budget of [600, 900, 1500, 2500, 4000]) {
    const result = trimPayloadToBudget(system, messages, budget);
    const open = (result.system.match(/<file name=/g) || []).length;
    const close = (result.system.match(/<\/file>/g) || []).length;
    assert.equal(open, close, `ميزانية ${budget}: عدد وسوم الفتح = الإغلاق`);
    assert.ok(
      result.system.includes('<files>') && result.system.includes('</files>'),
      `ميزانية ${budget}: كتلة الملفات سليمة`
    );
  }
});

test('payload-budget: حدود الميزانية — الحمولة ضمن الحدّ تُترك بلا قصّ', () => {
  const system = defenseLikeSystem({ fileChars: 100 });
  const messages = [{ role: 'user', content: 'سؤال قصير' }];

  const fits = trimPayloadToBudget(system, messages, 100000);
  assert.equal(fits.trimmed, false, 'حمولة ضمن الميزانية: لا قصّ');
  assert.equal(fits.system, system, 'الـsystem لم يتغيّر');
  assert.equal(fits.messages, messages, 'الرسائل لم تتغيّر (نفس المرجع)');

  // ميزانية متطرفة ⇒ لا انهيار (يُرفع الحدّ الأدنى إلى 500 رمز).
  // الحمولة هنا أصغر من 500 رمز ⇒ لا قصّ (وهو السلوك الصحيح).
  const tiny = trimPayloadToBudget(system, messages, 0);
  assert.ok(tiny.tokens >= 0, 'ميزانية صفرية لا ترمي استثناءً');
  assert.ok(tiny.tokens <= 500, `ميزانية صفرية تُرفع إلى الحدّ الأدنى (${tiny.tokens} ≤ 500)`);

  // وبحمولة أكبر من الحدّ الأدنى ⇒ يجب أن تُقصّ فعلاً
  const big = defenseLikeSystem({ fileChars: 12000 });
  const tinyBig = trimPayloadToBudget(big, messages, 0);
  assert.ok(tinyBig.trimmed, 'حمولة كبيرة مع ميزانية صفرية ⇒ قصّ');
  assert.ok(tinyBig.tokens <= 500, `النتيجة ≤ الحدّ الأدنى (${tinyBig.tokens} ≤ 500)`);
  assert.ok(tinyBig.system.length < big.length, 'تم القصّ على أي حال');
});

test('trimFilesInSystem: يوزّع الحصّة على الملفات ويقصّ داخل الملف فقط', () => {
  const system = [
    'تعليمات',
    '<files>',
    '<file name="أ.pdf">',
    'ا'.repeat(3000),
    '</file>',
    '<file name="ب.pdf">',
    'ب'.repeat(3000),
    '</file>',
    '</files>',
    'خاتمة'
  ].join('\n');

  const result = trimFilesInSystem(system, 2000);
  assert.equal((result.system.match(/<file name=/g) || []).length, 2, 'ملفا');
  assert.equal((result.system.match(/<\/file>/g) || []).length, 2, 'الوسوم سليمة');
  assert.ok(result.system.includes('تعليمات') && result.system.includes('خاتمة'), 'ما حول الملفات محفوظ');
  // لكل ملف نحو نصف الحصّة ⇒ ~1000 حرف
  assert.ok(result.system.includes('ا'.repeat(900)), 'نصّ الملف الأول باقٍ');
  assert.ok(!result.system.includes('ا'.repeat(1100)), 'نصّ الملف الأول مقصوص');
  assert.ok(result.system.includes('ب'.repeat(900)), 'نصّ الملف الثاني باقٍ');
});

test('ai (Groq): خطأ الطول (413) يُعيد المحاولة بحمولة أقصر ثم ينجح', async () => {
  const groq = PROVIDERS.find((provider) => provider.key === 'groq');
  assert.ok(groq, 'مزوّد Groq موجود');

  const originalFetch = globalThis.fetch;
  const sent = [];
  let call = 0;

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    sent.push(body);
    call += 1;
    // أول محاولة: ترفض بـ 413 (حمولة أطول من الحدّ)، ثم تنجح
    if (call === 1) {
      return new Response(JSON.stringify({ error: { message: 'Please reduce the length of the messages' } }), {
        status: 413,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: 'ردّ ناجح بعد التقصير' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    const system = defenseLikeSystem({ fileChars: 20000 });
    const messages = [{ role: 'user', content: 'السؤال الأخير: ما المنهجية؟' }];

    const result = await groq.call({
      apiKey: 'test-key',
      models: ['openai/gpt-oss-20b'],
      system,
      messages,
      temperature: 0.4,
      maxTokens: 500
    });

    assert.equal(result.text, 'ردّ ناجح بعد التقصير', 'نجح بعد إعادة المحاولة');
    assert.equal(sent.length, 2, 'أُعيدت المحاولة مرة واحدة بعد 413');

    const first = sent[0].messages[0].content.length;
    const second = sent[1].messages[0].content.length;
    assert.ok(second < first, `الحمولة الثانية أقصر (${second} < ${first})`);

    // الحمولة المُعاد إرسالها ضمن ميزانية النموذج
    const budget = budgetForModel('openai/gpt-oss-20b', 'groq');
    const systemPart = sent[1].messages[0].content;
    const rest = sent[1].messages.slice(1);
    assert.ok(
      measurePayloadTokens(systemPart, rest) <= budget,
      `الحمولة المعاد إرسالها ≤ ميزانية النموذج (${budget})`
    );
    // التعليمات المحورية باقية بعد التقصير
    assert.ok(systemPart.includes('# هوية المناقِش'), 'هوية المناقِش محفوظة في الحمولة المعاد إرسالها');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ai (Groq): 413 المعدّل (ITPM) لا يُعيد المحاولة بحمولة أضيق', async () => {
  const groq = PROVIDERS.find((provider) => provider.key === 'groq');
  assert.ok(groq, 'مزوّد Groq موجود');

  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        error: {
          message:
            'Request too large for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on input tokens per minute (ITPM): Limit 7000, Requested 9000, please reduce your message size and try again.',
          type: 'rate_limit_exceeded'
        }
      }),
      { status: 413, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    await assert.rejects(
      () =>
        groq.call({
          apiKey: 'test-key',
          models: ['qwen/qwen3.8-27b'],
          system: defenseLikeSystem({ fileChars: 20000 }),
          messages: [{ role: 'user', content: 'السؤال الأخير: ما المنهجية؟' }],
          temperature: 0.4,
          maxTokens: 500
        }),
      (error) => {
        // خطأ معدّل = مؤقّت (يُعاد لاحقاً)، لا خطأ طول دائم
        assert.equal(error.status, 429, `خطأ معدّل مؤقّت (${error.status})`);
        assert.equal(error.reason, 'rate_limit', 'السبب مُعلَن: حدّ معدّل');
        assert.notEqual(error.reason, 'length', 'ليس خطأ طول');
        return true;
      }
    );
    // لم نُعد المحاولة بحمولة أضيق: تضييق الميزانية لا يُصلح خطأ المعدّل
    assert.equal(calls, 1, `لا إعادة محاولة على خطأ معدّل (${calls})`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ai (Groq): خطأ طول فقط يُصنَّف 413 (مع reason=length)', async () => {
  const groq = PROVIDERS.find((provider) => provider.key === 'groq');
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Please reduce the length of the messages' } }), {
      status: 413,
      headers: { 'content-type': 'application/json' }
    });

  try {
    await assert.rejects(
      () =>
        groq.call({
          apiKey: 'test-key',
          models: ['openai/gpt-oss-20b'],
          system: defenseLikeSystem({ fileChars: 20000 }),
          messages: [{ role: 'user', content: 'السؤال الأخير: ما المنهجية؟' }],
          temperature: 0.4,
          maxTokens: 500
        }),
      (error) => {
        assert.equal(error.status, 413, `خطأ طول = 413 (${error.status})`);
        assert.equal(error.reason, 'length', 'السبب: طول');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ai: تصنيف الفشل يفرّق بين 413-طول و413-معدّل', () => {
  // 413 طول: خاص بالطلب ⇒ لا يخرج المزوّد من الدوران (cooldown = 0)
  const length = classifyFailure(413, 'Groq 413: Please reduce the length of the messages');
  assert.equal(length.kind, 'length', '413 بلا ذكر معدّل = خطأ طول');
  assert.equal(length.cooldownMs, 0, 'خطأ الطول لا يخرج المزوّد من الدوران');

  // 413 معدّل: رصيد الدقيقة نفد ⇒ تهدئة مؤقّتة كـ 429
  const quota = classifyFailure(
    413,
    'Groq 413: Rate limit reached on input tokens per minute (ITPM): Limit 7000, Requested 9000'
  );
  assert.equal(quota.kind, 'quota', '413 مع ذكر ITPM = خطأ معدّل');
  assert.ok(quota.cooldownMs > 0, 'خطأ المعدّل يهدّئ المزوّد مؤقّتاً');

  // 429 العادي يبقى كما هو
  assert.equal(classifyFailure(429, 'rate limit').kind, 'quota', '429 يبقى quota');

  // 401 يبقى دائماً
  const auth = classifyFailure(401, 'Invalid API Key');
  assert.equal(auth.kind, 'auth', '401 يبقى auth');
  assert.equal(auth.hard, true, '401 خطأ دائم');

  // الكلمات الدالّة قد تقع خارج حدود الرسالة المختصرة ⇒ نمرّر body كاملاً
  const truncated = classifyFailure(
    413,
    'Groq 413: ' + 'x'.repeat(300),
    'input tokens per minute (ITPM): Limit 7000, Requested 9000'
  );
  assert.equal(truncated.kind, 'quota', 'ITPM خارج حدّ الاقتطاع يبقى معدّلاً');

  // 503 (مزيج/ازدحام) لا ينزلق إلى «length» لمجرّد أن رسالته تذكر الطول:
  // خطأ الطول ⇒ تهدئة 0 (المزوّد يبقى في الدوران) ⇒ نُخسر التهدئة.
  const mixed = classifyFailure(503, 'Groq فشل (طول + حدّ معدّل) — Please reduce the length of the messages');
  assert.equal(mixed.kind, 'busy', '503 يبقى busy رغم ذكر الطول في الرسالة');
  assert.ok(mixed.cooldownMs > 0, '503 يهدّئ مؤقّتاً');
});

test('ai (Groq): مزيج خطأ طول + خطأ معدّل يبقى مؤقّتاً (لا طول دائم)', async () => {
  const groq = PROVIDERS.find((provider) => provider.key === 'groq');
  assert.ok(groq, 'مزوّد Groq موجود');

  const originalFetch = globalThis.fetch;
  let call = 0;

  globalThis.fetch = async () => {
    call += 1;
    // النموذج الأول: خطأ طول حقيقي ⇒ يُعاد بميزانية أضيق.
    // النموذج الثاني: خطأ معدّل ⇒ يجب ألّا يُصنَّف خطأ طول دائم.
    if (call <= 2) {
      return new Response(JSON.stringify({ error: { message: 'Please reduce the length of the messages' } }), {
        status: 413,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(
      JSON.stringify({
        error: {
          message: 'Rate limit reached for model `allam-2-7b`. Please try again later.',
          type: 'rate_limit_exceeded'
        }
      }),
      { status: 413, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    await assert.rejects(
      () =>
        groq.call({
          apiKey: 'test-key',
          models: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'allam-2-7b'],
          system: defenseLikeSystem({ fileChars: 20000 }),
          messages: [{ role: 'user', content: 'السؤال الأخير: ما المنهجية؟' }],
          temperature: 0.4,
          maxTokens: 500
        }),
      (error) => {
        // مزج: جزء طول وجزء معدّل ⇒ نختار حالة مؤقّتة (503) لا 413 دائم
        assert.equal(error.status, 503, `المزج مؤقّت (${error.status})`);
        assert.equal(error.reason, 'mixed', 'السبب مُعلَن: مزيج');
        assert.notEqual(error.reason, 'length', 'المزج لا يُصنَّف خطأ طول');
        // التفاصيل التشخيصية محفوظة
        assert.ok(/ITPM|rate limit|Reduce the length|reduce the length/i.test(error.message), 'تفاصيل الفشل محفوظة');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ai (Groq): خطأ غير متعلق بالطول (401) لا يُعيد المحاولة', async () => {
  const groq = PROVIDERS.find((provider) => provider.key === 'groq');
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    await assert.rejects(
      () =>
        groq.call({
          apiKey: 'bad-key',
          models: ['openai/gpt-oss-20b'],
          system: 'تعليمات',
          messages: [{ role: 'user', content: 'سؤال' }],
          temperature: 0.4,
          maxTokens: 300
        }),
      (error) => {
        assert.equal(error.status, 402, 'خطأ المصادقة يُصنَّف 402 (رصيد/مفتاح)');
        return true;
      }
    );
    assert.equal(calls, 1, 'لا إعادة محاولة على خطأ مصادقة');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extractDefenseFinalTag: وسم التقييم النهائي يُحذف ويغلق الجلسة', () => {
  const ended = extractDefenseFinalTag('التقييم النهائي: قوة وضعف وتوصيات.\n[[defense-final]]');
  assert.equal(ended.ended, true, 'الوسم يعني انتهاء المناقشة');
  assert.equal(ended.text, 'التقييم النهائي: قوة وضعف وتوصيات.', 'الوسم يُحذف من النص ولا يظهر للمستخدم');
  assert.ok(!ended.text.includes('[['), 'لا وسوم داخلية في النص المحفوظ');

  const normal = extractDefenseFinalTag('سؤال عادي: ما منهجك؟');
  assert.equal(normal.ended, false, 'رسالة بلا وسم لا تُغلق الجلسة');
  assert.equal(normal.text, 'سؤال عادي: ما منهجك؟', 'النص يبقى كما هو');
});

test('defenseProgress: مراحل الجلسة تتبع التثبيت والإنهاء (لا coveredParts)', () => {
  assert.equal(defenseProgress({}).stageLabel, 'بانتظار رفع البحث', 'قبل تثبيت الملف');
  assert.equal(defenseProgress({ thesisFileId: 'x' }).stageLabel, 'المناقشة جارية', 'ملف مثبّت = المناقشة جارية');
  assert.equal(defenseProgress({ thesisFileId: 'x', done: true }).stageLabel, 'انتهت المناقشة', 'التقييم يُنهي الجلسة');
  assert.equal(defenseProgress({ thesisFileId: 'x', done: true }).stageKey, 'final', 'مرحلة النهاية');
});

/* =============================================================================
 * المناقشة: حدّ لعدد الأسئلة + تتبّع التغطية + منع التكرار
 * (كان يسأل بلا نهاية ويعود من الأول لأن `asked` لم يُزد قط)
 * ============================================================================= */

const THESIS_SAMPLE = `
الفصل الأول: المقدمة والمشكلة البحثية
تناولت المقدمة مشكلة الدراسة وأهدافها.
الفصل الثاني: الإطار النظري والأهداف
الفصل الثالث: منهجية الدراسة
مجتمع الدراسة وعينة البحث وأدوات جمع البيانات.
الفصل الرابع: نتائج الدراسة
جداول التحليل الإحصائي لكل الفرضيات.
الفصل الخامس: المناقشة والتوصيات
`;

test('planParts: تقسيم البحث إلى أجزائه الطبيعية بالترتيب المنطقي', () => {
  const parts = planParts(THESIS_SAMPLE);
  const keys = parts.map((part) => part.key);
  assert.deepEqual(keys, ['intro', 'problem', 'method', 'results', 'discussion'], 'الأجزاء بالترتيب المنطقي');
  assert.ok(parts.every((part) => part.label), 'لكل جزء عنوان عربي مقروء');
});

test('planParts: نص بلا عناوين يُطابَق على المتن، ونص فارغ ⇒ خطة فارغة', () => {
  const fromBody = planParts('يتضمن منهج الدراسة ونتائجها وتحليلها');
  assert.ok(fromBody.length > 0, 'نص بلا عناوين يُعطي خطة من المتن');
  assert.deepEqual(planParts(''), [], 'نص فارغ ⇒ لا خطة (سقف افتراضي)');
  assert.deepEqual(planParts('   '), [], 'نص أبيض ⇒ لا خطة');
});

test('maxQuestionsFor: سقف محسوب من الأجزاء (لا صفر ولا بلا حدّ)', () => {
  const parts = planParts(THESIS_SAMPLE);
  const total = maxQuestionsFor(parts);
  assert.ok(total > 0, 'السقف أكبر من صفر');
  assert.ok(total <= 14, 'السقف ضمن الحدّ الأقصى (14)');
  assert.ok(total >= 5, 'السقف ضمن الحدّ الأدنى (5)');
  assert.equal(maxQuestionsFor([]), 5, 'بلا خطة ⇒ حدّ أدنى افتراضي');
  assert.equal(maxQuestionsFor(planParts(THESIS_SAMPLE)), total, 'السقف ثابت لنفس الخطة');
});

test('maxQuestionsFor: بحث طويل (عدة أجزاء/فصول) ⇒ سقف طويل يتناسب مع الحجم', () => {
  // ٢٥ فصلاً، كل فصل ≈ ١٥٠٠ حرف ⇒ ٢٥ جزءاً × سؤال ≈ ٢٥ سؤالاً
  const long = Array.from({ length: 25 }, (_, i) =>
    `الفصل ${i + 1}: العنوان ${i + 1}\n${'y'.repeat(1500)}\n`
  ).join('');
  const parts = planParts(long);
  const total = maxQuestionsFor(parts);
  assert.ok(parts.length >= 20, 'البحث الطويل ينقسم إلى أجزاء متعددة');
  assert.ok(total > 14, 'بحث طويل ⇒ سقف أكبر من ١٤ سؤالاً');
  assert.ok(total <= 36, 'سقف طويل ضمن الحد الأعلى ٣٦');
});

test('applyQuestionToState: كل سؤال يزيد العدّاد ويحفظ نصّه والجزء', () => {
  const parts = planParts(THESIS_SAMPLE);
  let state = { asked: 0, coveredParts: [], askedQuestions: [], parts };

  state = applyQuestionToState(state, { question: 'ما مشكلة البحث؟', partKey: 'intro' });
  assert.equal(state.asked, 1, 'العدّاد يزيد بعد السؤال الأول');
  assert.deepEqual(state.coveredParts, ['intro'], 'الجزء المغطّى يُسجَّل');
  assert.deepEqual(state.askedQuestions, ['ما مشكلة البحث؟'], 'نصّ السؤال يُحفظ');

  state = applyQuestionToState(state, { question: 'ما منهجك؟', partKey: 'method' });
  assert.equal(state.asked, 2, 'العدّاد يزيد مرة أخرى');
  assert.deepEqual(state.coveredParts, ['intro'], 'المقدمة covered فقط؛ المنهجية حصّتها سؤالان');

  // السؤال الثاني في 'method' يستنفد حصّته (سؤالان) ⇒ الجزء يُغطّى الآن
  state = applyQuestionToState(state, { question: 'سؤال آخر في المنهجية؟', partKey: 'method' });
  assert.equal(state.asked, 3, 'كل سؤال يُحتسب');
  assert.deepEqual(state.coveredParts, ['intro', 'method'], 'الجزآن مغطّيان بعد استنفاد حصّة المنهجية');
});

test('applyQuestionToState: لا يُكسر العدّاد ولا يفسد الحالة القديمة', () => {
  const state = applyQuestionToState({ asked: 4, done: false, parts: [] }, { question: 'س؟', partKey: '' });
  assert.equal(state.asked, 5, 'العدّاد يزيد على الحالة الموجودة');
  assert.equal(state.done, false, 'بقية الحالة محفوظة');
  const empty = applyQuestionToState(undefined, {});
  assert.equal(empty.asked, 1, 'حالة فارغة ⇒ عدّاد من 1');
  assert.deepEqual(empty.askedQuestions, [], 'بلا نصّ سؤال ⇒ قائمة فارغة');
});

test('nextPendingPart: يختار أول جزء غير مغطّى ثم ينتهي', () => {
  const parts = planParts(THESIS_SAMPLE);
  let state = { asked: 0, coveredParts: [], askedQuestions: [], parts };
  assert.equal(nextPendingPart(state)?.key, 'intro', 'يبدأ من أول جزء');

  state = applyQuestionToState(state, { question: 'س1؟', partKey: 'intro' });
  assert.equal(nextPendingPart(state)?.key, 'problem', 'ينتقل للجزء التالي بعد التغطية');

  for (const part of parts) {
    state = applyQuestionToState(state, { question: 'س؟', partKey: part.key });
  }
  // 'method' و'results' حصّتهما سؤالان (كثافة) ⇒ dopo سؤال واحد لكل منهما ما تزال مفتوحة
  const stillOpen = nextPendingPart(state);
  assert.ok(stillOpen && (stillOpen.key === 'method' || stillOpen.key === 'results'),
    'جزء ذي حصّة غير مستنفدة يبقى مطلوباً (got: ' + (stillOpen?.key ?? '-') + ')');
  // استنفاد حصّة 'method' ثم 'results' ⇒ يغطّيان تباعاً
  state = applyQuestionToState(state, { question: 'س؟', partKey: 'method' });
  assert.equal(nextPendingPart(state)?.key, 'results', 'الجزء التالي ذي حصّة غير مستنفدة');
  state = applyQuestionToState(state, { question: 'س؟', partKey: 'results' });
  assert.equal(nextPendingPart(state), null, 'بعد استنفاد كل الحصص ⇒ لا جزء متبقٍ (⇒ تقييم نهائي)');
});

test('extractQuestionFromReply: يستخرج السؤال ولا يعدّ الردود بلا استفهام', () => {
  assert.equal(
    extractQuestionFromReply('إجابة دقيقة. السؤال التالي: ما معامل R2 في النموذج؟'),
    'ما معامل R2 في النموذج؟',
    'السؤال يُستخرج من آخر جملة استفهامية'
  );
  assert.equal(extractQuestionFromReply('إجابة نموذجية بلا أي سؤال.'), '', 'ردّ بلا استفهام ⇒ لا يُسجَّل');
  assert.equal(extractQuestionFromReply(''), '', 'ردّ فارغ ⇒ لا يُسجَّل');
});

test('defenseProgress: يعرض السقف والباقي (لم يعد null)', () => {
  const parts = planParts(THESIS_SAMPLE);
  const progress = defenseProgress({ asked: 3, parts, coveredParts: ['intro'], thesisFileId: 'file-1' });
  assert.equal(progress.total, maxQuestionsFor(parts), 'السقف معروض');
  assert.equal(progress.remaining, maxQuestionsFor(parts) - 3, 'الباقي محسوب');
  assert.equal(progress.asked, 3, 'العدد المعروض');
  assert.equal(progress.currentPart?.key, 'problem', 'الجزء التالي معروض');
  assert.ok(progress.stageHint.includes('باقي'), 'التلميح يذكر المتبقي');
  const finished = defenseProgress({ asked: 8, parts, thesisFileId: 'file-1' });
  assert.equal(finished.remaining, 0, 'لا متبقي بعد بلوغ السقف');
});

test('المناقشة: المناقِش يعرف الخطة والسقف في موجّهه (لا يسأل بلا نهاية)', () => {
  const parts = planParts(THESIS_SAMPLE);
  const prompt = buildSystemPrompt({
    mode: 'defense',
    defenseParts: parts,
    defenseTotal: maxQuestionsFor(parts),
    defenseAsked: 2,
    defenseCovered: ['intro'],
    defenseCurrentPart: { key: 'problem', label: 'المشكلة البحثية والأهداف' },
    defenseAskedQuestions: ['ما مشكلة البحث؟', 'ما هدفك؟']
  });
  assert.ok(prompt.includes('# خطة المناقشة'), 'قسم الخطة في موجّه المناقِش');
  assert.ok(prompt.includes('سقف أسئلة هذه المناقشة'), 'السقف معلن للمناقِش');
  assert.ok(prompt.includes('المشكلة البحثية والأهداف'), 'الجزء المطلوب معروف');
  assert.ok(prompt.includes('ما مشكلة البحث؟'), 'أسئلته السابقة معروضة له فلا يكرّرها');
  assert.ok(prompt.includes('لا تتجاوز سقف'), 'قاعدة عدم تجاوز السقف');
});

test('المناقشة: لا خطة ⇒ لا قسم خطة (وضع المشرف لا يتأثر)', () => {
  const prompt = buildSystemPrompt({ mode: 'defense', userName: 'ب' });
  assert.ok(!prompt.includes('# خطة المناقشة'), 'بلا خطة لا يُحقن القسم');
  const normal = buildSystemPrompt({ mode: 'normal', currentStage: 'البحث' });
  assert.ok(!normal.includes('# خطة المناقشة'), 'وضع المشرف لا يحصل على خطة المناقشة');
});

test('المناقشة: عدّاد حقيقي في المسار (لا يبقى صفراً بعد الأسئلة)', () => {
  const routeSrc = readFileSync(new URL('../src/routes/defense.js', import.meta.url), 'utf8');
  assert.ok(routeSrc.includes('recordDefenseQuestion'), 'المسار يسجّل السؤال في defense_state');
  assert.ok(routeSrc.includes('extractQuestionFromReply'), 'المسار يستخرج نصّ السؤال من الرد');
  assert.ok(routeSrc.includes('buildDefensePlanForFile'), 'المسار يبني الخطة عند تثبيت الملف');
  const chatSrc = readFileSync(new URL('../src/services/chat.js', import.meta.url), 'utf8');
  assert.ok(!chatSrc.includes('asked +'), 'chat.js لا يزيد العدّاد بنفسه (المسار وحده)');
});

test('المعلم: ذاكرته الخاصة تُحقن في موجّهه ومعزولة عن ذاكرة المشرف', () => {
  const withMemory = buildAssistantPrompt({
    task: 'teach',
    field: 'علوم الحاسب',
    memory: 'فهم الباحث هيكل البحث · شُرحت له المقدمة',
    openTask: 'شرح منهجية البحث في مقطعه القادم'
  });
  assert.ok(withMemory.includes('# ذاكرتك الخاصة'), 'قسم الذاكرة الخاصة موجود');
  assert.ok(withMemory.includes('فهم الباحث هيكل البحث'), 'محتوى الذاكرة محقون');
  assert.ok(withMemory.includes('شرح منهجية البحث'), 'المهمة التالية محقونة');
  assert.ok(withMemory.includes('لا تخلطها بذاكرة المشرف'), 'عزل الذاكرة منصوص في الموجّه');
  assert.ok(withMemory.includes('شخصيتك منفصلة'), 'عزل الشخصية منصوص في الموجّه');

  const bare = buildAssistantPrompt({ task: 'teach' });
  assert.ok(!bare.includes('# ذاكرتك الخاصة'), 'بلا ذاكرة لا يظهر القسم');
  assert.ok(bare.includes('أنت «المعلم»'), 'الهوية ثابتة');
});

test('الفصل البرمجي: ملف المعلم لا يستورد ذاكرة المشرف وملف المشرف لا يستورد ذاكرة المعلم', () => {
  const stripComments = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const teacherSrc = stripComments(readFileSync(new URL('../src/services/assistant.js', import.meta.url), 'utf8'));
  const assistantMemSrc = stripComments(readFileSync(new URL('../src/services/assistant-memory.js', import.meta.url), 'utf8'));
  const supervisorSrc = stripComments(readFileSync(new URL('../src/services/chat.js', import.meta.url), 'utf8'));
  assert.ok(!teacherSrc.includes('supervisor_memory'), 'المعلم لا يستعلم جدول المشرف');
  assert.ok(!teacherSrc.includes('supervisor-memory'), 'المعلم لا يستورد خدمة ذاكرة المشرف');
  assert.ok(!assistantMemSrc.includes('supervisor_memory'), 'خدمة ذاكرة المعلم لا تستعلم جدول المشرف');
  assert.ok(!supervisorSrc.includes('assistant_memory'), 'المشرف لا يستعلم جدول المعلم');
  assert.ok(!supervisorSrc.includes('assistant-memory'), 'المشرف لا يستورد خدمة ذاكرة المعلم');
  assert.ok(teacherSrc.includes('summarizeAssistantConversation(userId'), 'تلخيص المعلم مُستدعى (لا مجرد مستورد)');
});

test('الفصل السلوكي: استعلامات المشرف تستثني محادثات المناقشة', () => {
  const ctxSrc = readFileSync(new URL('../src/services/supervisor-context.js', import.meta.url), 'utf8');
  const chatSrc = readFileSync(new URL('../src/services/chat.js', import.meta.url), 'utf8');
  assert.ok(ctxSrc.includes("mode <> 'defense'"), 'سياق المشرف يستثني جلسات المناقشة');
  assert.ok(chatSrc.includes("c.mode <> 'defense'"), 'تلخيص المشرف يستثني جلسات المناقشة');
});

/* --------------------- قوائم الجرس المنسدلة على شاشات الهاتف --------------------- */

/**
 * محاكاة DOM مبسّطة تكفي لتشغيل /js/app-shell.js الفعلي داخل vm:
 * العنصر يحفظ style المرسل inline، وقياسه يطبّقها كما يفعل المتصفح
 * (العرض/الارتفاع/الانزاحة) — لنقيس القائمة بعد فتحها ونتحقق من حدود الشاشة.
 */
function makeStubElement({ id = '', hidden = false, rect = { left: 0, top: 0, width: 0, height: 0 } } = {}) {
  const listeners = {};
  return {
    id,
    hidden,
    style: {},
    textContent: '',
    innerHTML: '',
    attrs: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    remove() {},
    appendChild() {},
    closest() { return null; },
    querySelector() { return null; },
    fire(type, event) {
      (listeners[type] || []).forEach((fn) => fn(event || { stopPropagation() {}, target: this }));
    },
    getBoundingClientRect() {
      let { left, top, width, height } = rect;
      if (this.style.width) width = parseFloat(this.style.width);
      if (this.style.maxHeight) height = Math.min(height, parseFloat(this.style.maxHeight));
      if (this.style.transform) left += parseFloat(this.style.transform.replace(/[^-\d.]/g, ''));
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
  };
}

/** يشغّل سكربت الجرس الفعلي بمقاس شاشة معيّن وموضع قياسي للقائمة، ويعيد عناصره. */
function runAppShell({ vw, vh, bellRect, userRect = { left: 62, top: 70, width: 300, height: 260 } }) {
  const source = readFileSync(new URL('../public/js/app-shell.js', import.meta.url), 'utf8');
  const elements = new Map([
    ['bell-toggle', makeStubElement({ id: 'bell-toggle' })],
    ['bell-menu', makeStubElement({ id: 'bell-menu', hidden: true, rect: bellRect })],
    ['bell-list', makeStubElement({ id: 'bell-list' })],
    ['bell-badge', makeStubElement({ id: 'bell-badge', hidden: true })],
    ['bell-empty', makeStubElement({ id: 'bell-empty' })],
    ['bell-read-all', makeStubElement({ id: 'bell-read-all' })],
    ['user-toggle', makeStubElement({ id: 'user-toggle' })],
    ['user-menu', makeStubElement({ id: 'user-menu', hidden: true, rect: userRect })]
  ]);

  const sandbox = {
    document: {
      documentElement: { clientWidth: vw, clientHeight: vh },
      getElementById: (id) => elements.get(id) || null,
      addEventListener() {},
      createElement: () => makeStubElement({})
    },
    window: { addEventListener() {}, visualViewport: { addEventListener() {} }, confirm: () => true },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], unread: 0 }) })
  };

  vm.runInNewContext(source, sandbox, { filename: 'app-shell.js' });
  return elements;
}

/** تفريغ الميكرومهام: جلب الشارة المسبق وأي رسم غير متزامن بعد النقر. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('جرس الهاتف 360px: القائمة تنزلق لتبقي كاملة داخل الشاشة بدل أن يقصّها overflow-x', async () => {
  // ترويسة الموقع: الهامبرغر وصورة الحساب يسبقان الجرس (RTL) ⇒ حافتها اليسرى عند
  // ~108px وعرضها 340px ⇒ كانت تتجاوز اليمين بـ ~96px ويختفي جزءها (بداية العناوين).
  const shell = runAppShell({ vw: 360, vh: 740, bellRect: { left: 108, top: 70, width: 340, height: 520 } });
  await flush();
  shell.get('bell-toggle').fire('click');
  await flush();

  const menu = shell.get('bell-menu');
  assert.equal(menu.hidden, false, 'القائمة مفتوحة بعد النقر');
  const rect = menu.getBoundingClientRect();
  assert.ok(rect.left >= 8, `الحافة اليسرى داخل الشاشة (left=${rect.left})`);
  assert.ok(rect.right <= 360 - 8, `الحافة اليمنى داخل الشاشة (right=${rect.right})`);
  assert.ok(rect.bottom <= 740 - 8, `الأسفل داخل الشاشة (bottom=${rect.bottom})`);
  assert.ok(rect.width >= 300, `العرض يبقى كاملاً بعد الانزاحة (width=${rect.width}) — بلا قصّ`);
});

test('شريط لوحة الباحث 390px + شاشة قصيرة 360×640 بمحتوى طويل', async () => {
  const app = runAppShell({ vw: 390, vh: 844, bellRect: { left: 60, top: 57, width: 370, height: 560 } });
  await flush();
  app.get('bell-toggle').fire('click');
  await flush();
  const appRect = app.get('bell-menu').getBoundingClientRect();
  assert.ok(appRect.left >= 8 && appRect.right <= 390 - 8, `شريط اللوحة داخل الشاشة (right=${appRect.right})`);
  assert.ok(appRect.bottom <= 844 - 8, `أسفل القائمة داخل الشاشة (bottom=${appRect.bottom})`);

  // محتوى أطول من الشاشة: الارتفاع يُنقص بدل الخروج عن الأسفل، والقائمة تُمرَّر
  const short = runAppShell({ vw: 360, vh: 640, bellRect: { left: 108, top: 70, width: 340, height: 1200 } });
  await flush();
  short.get('bell-toggle').fire('click');
  await flush();
  const shortRect = short.get('bell-menu').getBoundingClientRect();
  assert.ok(shortRect.bottom <= 640 - 8, `المحتوى الطويل لا يتجاوز الأسفل (bottom=${shortRect.bottom})`);
  assert.ok(shortRect.height >= 160, `مساحة تمرير مفيدة متبقية (height=${shortRect.height})`);
});

test('سطح المكتب بلا تغيير + قائمة الحساب على الهاتف تُصحَّح أيضاً', async () => {
  const desktop = runAppShell({ vw: 1440, vh: 900, bellRect: { left: 108, top: 78, width: 370, height: 400 } });
  await flush();
  desktop.get('bell-toggle').fire('click');
  await flush();
  const menu = desktop.get('bell-menu');
  assert.equal(menu.style.transform, '', 'بلا انزاحة على الشاشة الواسعة — السلوك الأصلي محفوظ');
  assert.equal(menu.getBoundingClientRect().left, 108, 'القائمة ملتصقة بحافة الجرس كما كانت');

  // قائمة الحساب بنفس العطب: حافتها اليسرى عند 62px وعرضها 300px على شاشة 360
  const phone = runAppShell({ vw: 360, vh: 740, bellRect: { left: 108, top: 70, width: 340, height: 400 } });
  await flush();
  phone.get('user-toggle').fire('click');
  await flush();
  const userRect = phone.get('user-menu').getBoundingClientRect();
  assert.ok(userRect.left >= 8 && userRect.right <= 360 - 8, `قائمة الحساب داخل الشاشة (right=${userRect.right})`);
});

test('جلسة الدخول يوم واحد فقط: exp في التوقيع وMax-Age الكوكي من مصدر واحد', () => {
  assert.equal(SESSION_TTL_MS, 24 * 60 * 60 * 1000, 'SESSION_TTL_MS = 24 ساعة');

  // الحمولة الموقعة تحمل exp — منها يرفض الخادم الطلب بعد اليوم (وليس من الكوكي وحده)
  const cookie = createSessionCookie({ id: 'u1', email: 'reader@example.com', role: 'user' });
  const payload = JSON.parse(Buffer.from(cookie.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(payload.exp - payload.iat, SESSION_TTL_MS, 'مدة exp داخل التوقيع = SESSION_TTL_MS');
  assert.ok(Date.now() < payload.exp && payload.exp - Date.now() <= 24 * 60 * 60 * 1000, 'الجلسة الجديدة تنتهي خلال 24 ساعة');
});

test('firebase-admin v14: واجهة الإرسال في firebase.js تطابق المكتبة المثبّتة فعلاً', async () => {
  const stripComments = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const source = readFileSync(new URL('../src/services/firebase.js', import.meta.url), 'utf8');
  const code = stripComments(source);

  // النمط القديم (admin.apps/credential/messaging) أُزيل في v14 وكان يرمي TypeError
  // فتحتجزه try/catch ويرجع null ⇒ الإرسال يفشل بصمتاً والإنذار وحده في السجل.
  assert.ok(!code.includes('admin.apps'), 'لا استخدام للnamespace القديم admin.apps (محوّ في v14)');
  assert.ok(!code.includes('admin.credential'), 'لا استخدام للnamespace القديم admin.credential');
  assert.ok(code.includes('getMessaging('), 'التهيئة عبر getMessaging من firebase-admin/messaging');

  const root = await import('firebase-admin');
  const messaging = await import('firebase-admin/messaging');
  assert.equal(typeof root.initializeApp, 'function', 'initializeApp يُصدَّر من جذر firebase-admin');
  assert.equal(typeof root.cert, 'function', 'cert يُصدَّر من جذر firebase-admin');
  assert.equal(typeof messaging.getMessaging, 'function', 'getMessaging من المسار الفرعي firebase-admin/messaging');
});

test('أرقام الواتساب: تُحمَّل الثلاثة عند إقلاع الخادم وتُعاد قراءتها في صفحة الإعدادات', () => {
  // current* تقرأ كاش الذاكرة أولاً — بلا تحميل الإقلاع تبقى القيم فارغة بعد
  // إعادة التشغيل وتبدو «ضائعة» رغم بقائها محفوظة في جدول settings.
  // ملاحظة: ترتيب الإزالة مهم — تعليقات السطر أولاً (لأن `// ... /fonts/*` يحتوي
  // `/*` زائفاً يخدع تجريد البلوك فيحذف الكود الحقيقي)، ثم تعليقات البلوك.
  const stripComments = (src) => String(src).replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
  const serverSrc = stripComments(readFileSync(new URL('../server.js', import.meta.url), 'utf8'));
  assert.ok(serverSrc.includes('loadSupportWhatsapp()'), 'رقم الدعم العام يُقرأ عند الإقلاع');
  assert.ok(serverSrc.includes('loadVoiceWhatsappMale()'), 'رقم صوت الشباب يُقرأ عند الإقلاع');
  assert.ok(serverSrc.includes('loadVoiceWhatsappFemale()'), 'رقم صوت البنات يُقرأ عند الإقلاع');

  // صفحة الإعدادات تُعيد القراءة من القاعدة قبل العرض — استدعاء فعلي لا استيراد مهمل
  const adminSrc = stripComments(readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8'));
  assert.ok(adminSrc.includes('loadSupportWhatsapp()'), 'الإعدادات تقرأ رقم الدعم من settings قبل العرض');
  assert.ok(adminSrc.includes('loadVoiceWhatsappMale()'), 'الإعدادات تقرأ رقم الشباب من settings قبل العرض');
  assert.ok(adminSrc.includes('loadVoiceWhatsappFemale()'), 'الإعدادات تقرأ رقم البنات من settings قبل العرض');
});

