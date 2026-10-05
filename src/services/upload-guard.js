/**
 * فحص البصمة الثنائية (Magic Bytes) لكل ملف مرفوع.
 *
 * لماذا هذا موجود أصلاً بعد قائمة الامتدادات؟
 *   - defence-in-depth: الامتداد ونوع MIME يرسلهما المتصفح، أي أن المهاجم يتحكم بهما.
 *     هذا الفحص يقرأ **بايتات الملف نفسها** فيتحقق أن المحتوى الحقيقي يطابق ما ادّعاه.
 *   -يمنع الملفات «المتنكرة» (polyglot): ملف تنفيذي أو سكربت باسم `report.pdf`.
 *   -يمنع ملفاً ثنائياً أو صفحة HTML يتنكّر بامتداد `.txt` فيدخل محلّل النصوص/الجداول.
 *
 * قاعدة التصميم: **الرفض صامت ومباشر** (BAD_CONTENT) ولا نلمس بايت واحد على القرص.
 * ما لا نتحقق منه بدقة (عائلات ZIP) نتحقق من الحد الأدنى: توقيع ZIP صحيح.
 *
 * ملاحظة أمنية مهمة: هذا الفحص طبقة إضافية ولا يُعتمد عليه وحده — الحماية
 * الفعلية من تنفيذ الأكواد هي: قائمة امتدادات مغلقة + content-type مُجبَر +
 * nosniff + Content-Disposition + CSP sandbox على كل استجابة ملف.
 */

/** توقيع OLE2 (الحاوية القديمة لملفات Office: doc / xls / ppt). */
const OLE2 = [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]];

/** توقيع ZIP: ملف عادي / فارغ / ممتدّ. كل صيغ Office الحديثة وepub قائمة على ZIP. */
const ZIP = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08]
];

/** جدول البصمة لكل امتداد مسموح. */
const SIGNATURES = {
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  webp: [], // يُفحص specially (RIFF....WEBP) لأن التوقيع غير متجاور
  doc: OLE2,
  xls: OLE2,
  ppt: OLE2,
  zip: ZIP,
  docx: ZIP,
  xlsx: ZIP,
  pptx: ZIP,
  epub: ZIP
};

/** الصيغ النصية: يجب ألا تحمل بايت NUL ولا نسبة عالية من محارف التحكم. */
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);

/** امتدادات ZIP التي لها «مجلد» داخلي مميّز نبحث عنه في ترويسة الملف. */
const ZIP_FAMILY_MARKER = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' };

/** كم بايت نفحص بحثاً عن مجلد داخل ZIP (الملفات المحلية في أول загazers). */
const ZIP_MARKER_SCAN_BYTES = 2 * 1024 * 1024;

/** هل تبدأ البايتات بتوقيع معيّن؟ */
function startsWith(buffer, signature) {
  if (!buffer || buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

/** خطأ رفض موحّد يحمل كوداً تتعرف عليه طبقة المسارات. */
function reject(reason) {
  const error = new Error('محتوى الملف لا يطابق امتداده — تم الرفض.');
  error.code = 'BAD_CONTENT';
  error.reason = reason;
  return error;
}

/** WebP = 'RIFF' + 4 بايت حجم + 'WEBP'. */
function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

/**
 * نص عادي؟ نرفض بايت NUL (تشيّر على ملف ثنائي متنكّر) ونرفض كثافة عالية من محارف التحكم.
 *
 * ملاحظة مقصودة: **لا نرفض وجود وسوم HTML داخل النص**.
 * ملف `.txt` قد يحتوي فعلياً على مقتطفات كود أو HTML (شائع في ملاحظات الباحث)،
 * وهذا ليس خطراً أمنياً لأن العرض يمرّ دوماً عبر:
 *   - `safeInlineMime` ⇒ `text/plain; charset=utf-8` + `nosniff` (لا تفسير كـ HTML)،
 *   - و`escapeHtml` داخل صفحة المعاينة.
 * فالخطر الحقيقي هو المحتوى **الثنائي** متنكّراً في امتداد نصي، لا النص نفسه.
 */
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;

  let control = 0;
  for (const byte of sample) {
    // نسمح بـ \t \n \r و0x1B، ونرفض الباقي من محارف التحكم.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  if (sample.length && control / sample.length > 0.05) return false;

  return true;
}

/**
 * يتحقق أن محتوى الملف يطابق امتداده. يرمي خطأ `BAD_CONTENT` عند عدم المطابقة.
 * @param {string} extension الامتداد بحروف صغيرة (بلا نقطة)
 * @param {Buffer} buffer بايتات الملف كما وصل من القرص/الذاكرة
 */
export function assertContentMatchesExtension(extension, buffer) {
  if (!buffer?.length) throw reject('empty');

  const ext = String(extension || '').toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    if (!looksLikeText(buffer)) throw reject('text-binary');
    return;
  }

  if (ext === 'webp') {
    if (!isWebp(buffer)) throw reject('webp');
    return;
  }

  const signatures = SIGNATURES[ext];
  // امتداد ليس في الجدول ولا نصي: لا نتحقق، فيترك لمن تحقّق منه (مثل epub في المكتبة).
  if (!signatures) return;

  if (!signatures.some((signature) => startsWith(buffer, signature))) {
    throw reject('signature');
  }

  // عائلة Office الحديثة: ZIP صحيح + المجلد الداخلي المتوقع في ترويسة الملف.
  // فحص إضافي بـ indexOf على البايتات الخام (بلا فك ضغط) ⇒ رخيص وبلا أسطح هجوم.
  const marker = ZIP_FAMILY_MARKER[ext];
  if (marker && buffer.length > 4) {
    const scan = buffer.subarray(0, Math.min(buffer.length, ZIP_MARKER_SCAN_BYTES));
    if (!scan.includes(marker, 0, 'latin1')) {
      throw reject('zip-family');
    }
  }
}

/** نسخة غير رميّة للاختبارات والتشخيص. */
export function contentMatchesExtension(extension, buffer) {
  try {
    assertContentMatchesExtension(extension, buffer);
    return true;
  } catch {
    return false;
  }
}