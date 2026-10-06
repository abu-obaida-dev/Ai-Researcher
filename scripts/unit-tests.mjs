/**
 * اختبارات وحدة للخدمات الحرجة (بلا خادم وبلا طلبات شبكة):
 *   node --test scripts/unit-tests.mjs
 * تغطي: حساب النقاط وتوحيد استهلاك المزوّدين · عملة المنصة · التحقّق من المدخلات
 * · تطبيع النص العربي (أساس ترشيح المراجع) · التحقّق من رقم واتساب الدعم.
 * اختبار الدخان الحيّ (scripts/smoke-phase1.mjs) يغطّي ما يحتاج قاعدة بيانات.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chargeUsage, estimateReservation, estimateTokens, normalizeUsage } from '../src/services/tokens.js';
import { normalizeCurrency } from '../src/services/payments.js';
import { buildSearchQuery, extractTopic, isTopicSpecific, normalizeArabic, relevanceScore } from '../src/services/literature.js';
import { saveSupportWhatsapp } from '../src/services/settings.js';
import { assertContentMatchesExtension, contentMatchesExtension } from '../src/services/upload-guard.js';
import { safeEqual } from '../src/middleware/security.js';
import { needsOnboarding, requireCoreOnboarding } from '../src/middleware/auth.js';
import { renderOnboardingPage } from '../src/views/auth.js';
import { buildSystemPrompt } from '../src/services/supervisor-prompt.js';
import { evaluateStepCompletion, specForStep } from '../src/services/step-review.js';
import { isUuid } from '../src/constants.js';

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

test('relevanceScore: العنوان المطابق يتقدّم على غير المطابق', () => {
  const topic = 'تكنولوجيا المعلومات وإدارة التغيير';
  const match = relevanceScore({ title: 'دور تكنولوجيا المعلومات في إدارة التغيير', venue: 'مجلة', abstract: '' }, topic);
  const miss = relevanceScore({ title: 'الفلك والكون', venue: 'أخرى', abstract: '' }, topic);
  assert.ok(match > miss, `${match} > ${miss}`);
});

/* --------------------------- دعم واتساب --------------------------- */

test('saveSupportWhatsapp: يقبل الصيغ ويصدّر الناقص', async () => {
  assert.equal((await saveSupportWhatsapp('')).ok, true, 'فارغ = تعطيل الزر');
  assert.equal((await saveSupportWhatsapp('0912')).ok, false, 'أقل من 8 أرقام مرفوض');
  assert.equal((await saveSupportWhatsapp('09abc')).ok, false, 'حروف مرفوضة');
  assert.equal((await saveSupportWhatsapp('1234567890123456789')).ok, false, 'أكثر من 15 رقماً مرفوض');
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
  assert.ok(later.includes('# أداة المراجع (نتائج حقيقية من قواعد البيانات)'), 'خارج topic يُحقن قسم الأداة');

  // وضع المناقشة يستثناه (لا تُحقن فيه أقسام الرحلة)
  const def = buildSystemPrompt({ ...base, mode: 'defense' });
  assert.ok(!def.includes('# مرحلة المشكلة والفرضيات'), 'غائب في وضع المناقشة');
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