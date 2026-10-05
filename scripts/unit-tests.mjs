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